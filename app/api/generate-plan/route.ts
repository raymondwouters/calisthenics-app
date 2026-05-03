import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { supabase } from '@/lib/supabase'
import { createSupabaseServer } from '@/lib/supabase-server'
import { GenerateRequest } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function inputHash(level: string, equipment: string[], daysPerWeek: number, goal: string): string {
  const key = [level, [...equipment].sort().join(','), daysPerWeek, goal].join('|')
  return createHash('sha256').update(key).digest('hex')
}

export async function POST(req: NextRequest) {
  const body: GenerateRequest = await req.json()
  const { level, equipment, daysPerWeek, goal, changes } = body

  // Only use cache when there are no custom changes
  if (!changes) {
    const hash = inputHash(level, equipment, daysPerWeek, goal)
    const { data: cached } = await supabase
      .from('cached_plans')
      .select('plan')
      .eq('input_hash', hash)
      .single()

    if (cached) {
      console.log('cache hit:', hash)
      const planId = await saveUserPlan(cached.plan, body)
      return NextResponse.json({ ...cached.plan, planId })
    }
  }

  const hash = inputHash(level, equipment, daysPerWeek, goal)

  const workoutDays = daysPerWeek
  const restDays = 7 - workoutDays

  const userMessage = `
Generate a personalized calisthenics workout plan for me with the following profile:
- Level: ${level}
- Equipment available: ${equipment.join(', ')}
- Training days per week: ${daysPerWeek}
- Primary goal: ${goal}

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
      return NextResponse.json(
        { error: 'Plan was too large to generate. Try fewer days or less equipment.' },
        { status: 500 }
      )
    }

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse plan from AI response' }, { status: 500 })
    }

    const planData = JSON.parse(jsonMatch[0])

    // Store in Supabase cache only for non-custom plans (fire and forget)
    if (!changes) {
      supabase
        .from('cached_plans')
        .insert({ input_hash: hash, plan: planData })
        .then(({ error }) => {
          if (error) console.error('Cache write error:', error.message)
          else console.log('cache stored:', hash)
        })
    }

    const planId = await saveUserPlan(planData, body)
    return NextResponse.json({ ...planData, planId })
  } catch (err) {
    console.error('Claude API error:', err)
    return NextResponse.json({ error: 'Failed to generate plan' }, { status: 500 })
  }
}

async function saveUserPlan(planData: object, inputs: GenerateRequest): Promise<string | null> {
  try {
    const serverClient = await createSupabaseServer()
    const { data: { user } } = await serverClient.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('plans')
      .insert({ user_id: user.id, plan: planData, inputs })
      .select('id')
      .single()

    if (error) {
      console.error('Plan save error:', error.message)
      return null
    }
    return data.id
  } catch {
    return null
  }
}
