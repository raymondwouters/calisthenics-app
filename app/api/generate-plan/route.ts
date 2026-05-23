import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { supabase } from '@/lib/supabase'
import { GenerateRequest } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function inputHash(level: string, equipment: string[], daysPerWeek: number, goal: string, skills?: string[]): string {
  // v2: busts plans with old "Day 1" day names and missing rest days
  const skillKey = skills?.length ? skills.slice().sort().join('+') : ''
  const key = ['v2', level, [...equipment].sort().join(','), daysPerWeek, goal, skillKey].join('|')
  return createHash('sha256').update(key).digest('hex')
}

export async function POST(req: NextRequest) {
  const body: GenerateRequest & { isHoliday?: boolean } = await req.json()
  const { level, equipment, daysPerWeek, goal, skills, goalContext, changes, isHoliday } = body

  // Only use cache when there are no custom changes and no personalised goal context
  if (!changes && !goalContext && !isHoliday) {
    const hash = inputHash(level, equipment, daysPerWeek, goal, skills)
    const { data: cached } = await supabase
      .from('cached_plans')
      .select('plan')
      .eq('input_hash', hash)
      .single()

    if (cached) {
      console.log('cache hit:', hash)
      return NextResponse.json(cached.plan)
    }
  }

  const hash = inputHash(level, equipment, daysPerWeek, goal, skills)

  const workoutDays = daysPerWeek
  const restDays = 7 - workoutDays

  const userMessage = `
Generate a personalized calisthenics workout plan for me with the following profile:
- Level: ${level}
- Equipment available: ${equipment.join(', ')}
- Training days per week: ${daysPerWeek}
- Primary goal: ${goal}${skills?.length ? `\n- Target skills: ${skills.join(', ')}` : ''}${goalContext ? `\n- Additional context: ${goalContext}` : ''}

The plan MUST cover exactly 7 days: Monday through Sunday.
- ${workoutDays} days are workout days (spread evenly, e.g. Mon/Wed/Fri for 3 days)
- ${restDays} days are rest/recovery days

For WORKOUT days: type "workout", include warmup (2-3 exercises), strength/skill blocks (3-4 exercises), core (1-2 exercises), cooldown (1-2 exercises).

For REST days: type "rest", label "Active Recovery", include exactly one block of type "stretch" with 6-8 stretching exercises. The stretch session should take ~15 minutes, cover all major muscle groups (hip flexors, hamstrings, chest, lats/upper back, shoulders, quads, calves, wrists), and include calisthenics-specific mobility work (wrist prep, shoulder circles, hip 90/90, thoracic rotation). Use hold times in seconds (e.g. "30s", "45s").

${changes ? `Additional changes requested by the user: ${changes}` : ''}

Return ONLY a valid JSON object. No explanation, no markdown, no code block — pure JSON.

The JSON must follow this exact structure:
{
  "plan": {
    "level": string,
    "goal": string,
    "days_per_week": number,
    "sessions": [
      {
        "day": string,          // "Monday", "Tuesday", etc.
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

  function isValidPlan(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false
    const plan = (data as Record<string, unknown>).plan
    if (!plan || typeof plan !== 'object') return false
    const sessions = (plan as Record<string, unknown>).sessions
    return Array.isArray(sessions) && sessions.length > 0
  }

  let planData = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: [
          {
            type: 'text',
            text: getSkillPrompt(),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      })

      if (message.stop_reason === 'max_tokens') {
        console.error('Claude response truncated — plan too large')
        if (attempt === 2) return NextResponse.json({ error: 'truncated' }, { status: 500 })
        continue
      }

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        console.error(`Attempt ${attempt}: no JSON found in response`)
        if (attempt === 2) return NextResponse.json({ error: 'parse_failed' }, { status: 500 })
        continue
      }

      const parsed = JSON.parse(jsonMatch[0])
      if (!isValidPlan(parsed)) {
        console.error(`Attempt ${attempt}: invalid plan structure`)
        if (attempt === 2) return NextResponse.json({ error: 'invalid_structure' }, { status: 500 })
        continue
      }

      planData = parsed
      break
    } catch (err) {
      console.error(`Attempt ${attempt} error:`, err)
      if (attempt === 2) return NextResponse.json({ error: 'api_error' }, { status: 500 })
    }
  }

  // Store in Supabase cache only for non-custom, non-personalised, non-holiday plans (fire and forget)
  if (!changes && !goalContext && !isHoliday) {
    supabase
      .from('cached_plans')
      .insert({ input_hash: hash, plan: planData })
      .then(({ error }) => {
        if (error) console.error('Cache write error:', error.message)
        else console.log('cache stored:', hash)
      })
  }

  return NextResponse.json(planData)
}

