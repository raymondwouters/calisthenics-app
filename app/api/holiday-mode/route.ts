import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { supabase } from '@/lib/supabase'
import { HolidayConfig, HolidayGoal, GenerateRequest } from '@/lib/types'
import Anthropic from '@anthropic-ai/sdk'
import { getSkillPrompt } from '@/lib/skill'
import { createHash } from 'crypto'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const HOLIDAY_GOAL_CONTEXT: Record<HolidayGoal, string> = {
  'maintain-strength': 'Generate a holiday maintenance plan. Keep the movement patterns and relative intensity of the user\'s normal training, adapted to the available equipment. No deload, no regression — maintain the strength base.',
  'active-recovery': 'Generate a low-intensity active recovery week. Focus on mobility, light movement, and reducing accumulated fatigue. Minimal loading, nothing to failure.',
  'high-intensity-bodyweight': 'Generate a high-intensity bodyweight conditioning week. Prioritise rep volume, circuit-style training, and cardiovascular capacity using only the available equipment.',
}

function sanitizeJson(raw: string): string {
  return raw.replace(/("(?:[^"\\]|\\.)*")/g, m =>
    m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  )
}

function isValidPlan(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const plan = (data as Record<string, unknown>).plan
  if (!plan || typeof plan !== 'object') return false
  const sessions = (plan as Record<string, unknown>).sessions
  return Array.isArray(sessions) && sessions.length > 0
}

async function generateHolidayPlan(inputs: GenerateRequest): Promise<object | null> {
  const { level, equipment, daysPerWeek, goal, goalContext } = inputs
  const workoutDays = daysPerWeek
  const restDays = 7 - workoutDays

  const userMessage = `
Generate a personalized calisthenics workout plan for me with the following profile:
- Level: ${level}
- Equipment available: ${equipment.join(', ')}
- Training days per week: ${daysPerWeek}
- Primary goal: ${goal}
- Additional context: ${goalContext}

The plan MUST cover exactly 7 days: Monday through Sunday.
- ${workoutDays} days are workout days (spread evenly, e.g. Mon/Wed/Fri for 3 days)
- ${restDays} days are rest/recovery days

For WORKOUT days: type "workout", include warmup (2-3 exercises), strength/skill blocks (3-4 exercises), core (1-2 exercises), cooldown (1-2 exercises).

For REST days: type "rest", label "Active Recovery", include exactly one block of type "stretch" with 6-8 stretching exercises. The stretch session should take ~15 minutes, cover all major muscle groups (hip flexors, hamstrings, chest, lats/upper back, shoulders, quads, calves, wrists), and include calisthenics-specific mobility work (wrist prep, shoulder circles, hip 90/90, thoracic rotation). Use hold times in seconds (e.g. "30s", "45s").

Return ONLY a valid JSON object. No explanation, no markdown, no code block — pure JSON.

The JSON must follow this exact structure:
{
  "plan": {
    "level": string,
    "goal": string,
    "days_per_week": number,
    "sessions": [
      {
        "day": string,
        "type": "workout" | "rest",
        "label": string,
        "blocks": [
          {
            "type": "warmup" | "skill" | "strength" | "accessory" | "core" | "cooldown" | "stretch",
            "exercises": [
              {
                "name": string,
                "sets": number,
                "reps": string,
                "rest_seconds": number,
                "notes": string
              }
            ]
          }
        ]
      }
    ]
  }
}
`

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: [{ type: 'text', text: getSkillPrompt(), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
      })

      if (message.stop_reason === 'max_tokens') {
        if (attempt === 2) return null
        continue
      }

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        if (attempt === 2) return null
        continue
      }

      const parsed = JSON.parse(sanitizeJson(jsonMatch[0]))
      if (!isValidPlan(parsed)) {
        if (attempt === 2) return null
        continue
      }

      return parsed
    } catch {
      if (attempt === 2) return null
    }
  }
  return null
}

export async function GET() {
  const serverClient = await createSupabaseServer()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('holiday_config')
    .select('is_active, equipment, goal')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json(null)
  return NextResponse.json(data as HolidayConfig)
}

export async function PUT(req: NextRequest) {
  const serverClient = await createSupabaseServer()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: HolidayConfig = await req.json()
  const { is_active, equipment, goal } = body

  // Upsert holiday config
  const { error: configError } = await supabase
    .from('holiday_config')
    .upsert(
      { user_id: user.id, is_active, equipment, goal, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )

  if (configError) {
    console.error('Holiday config upsert error:', configError.message)
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }

  // When enabling, generate and save a holiday plan
  if (is_active) {
    // Fetch user's current normal plan inputs to inherit level/days
    const { data: normalPlanRow } = await supabase
      .from('plans')
      .select('inputs')
      .eq('user_id', user.id)
      .eq('is_holiday', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const normalInputs = normalPlanRow?.inputs as GenerateRequest | undefined
    const holidayInputs: GenerateRequest = {
      level: normalInputs?.level ?? 'Intermediate',
      equipment,
      daysPerWeek: normalInputs?.daysPerWeek ?? 3,
      goal: 'general-strength',
      goalContext: HOLIDAY_GOAL_CONTEXT[goal as HolidayGoal] ?? HOLIDAY_GOAL_CONTEXT['maintain-strength'],
    }

    const planData = await generateHolidayPlan(holidayInputs)
    if (!planData) {
      return NextResponse.json({ error: 'Failed to generate holiday plan' }, { status: 500 })
    }

    const { data: savedPlan, error: saveError } = await supabase
      .from('plans')
      .insert({ user_id: user.id, plan: planData, inputs: holidayInputs, is_holiday: true })
      .select('id')
      .single()

    if (saveError) {
      console.error('Holiday plan save error:', saveError.message)
      return NextResponse.json({ error: 'Failed to save holiday plan' }, { status: 500 })
    }

    return NextResponse.json({ success: true, planId: savedPlan.id, plan: planData })
  }

  return NextResponse.json({ success: true })
}
