import Anthropic from '@anthropic-ai/sdk'
import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { supabase } from '@/lib/supabase'
import { GenerateRequest } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function inputHash(level: string, equipment: string[], daysPerWeek: number, goal: string): string {
  const key = [level, [...equipment].sort().join(','), daysPerWeek, goal].join('|')
  return createHash('sha256').update(key).digest('hex')
}

export async function POST(req: NextRequest) {
  const body: GenerateRequest = await req.json()
  const { level, equipment, daysPerWeek, goal } = body

  const hash = inputHash(level, equipment, daysPerWeek, goal)

  // Check Supabase cache first
  const { data: cached } = await supabase
    .from('cached_plans')
    .select('plan')
    .eq('input_hash', hash)
    .single()

  if (cached) {
    console.log('cache hit:', hash)
    return NextResponse.json(cached.plan)
  }

  const userMessage = `
Generate a personalized calisthenics workout plan for me with the following profile:
- Level: ${level}
- Equipment available: ${equipment.join(', ')}
- Training days per week: ${daysPerWeek}
- Primary goal: ${goal}

Return ONLY a valid JSON object. No explanation, no markdown, no code block — pure JSON.

Keep each session focused: warmup (2-3 exercises), strength/skill (3-4 exercises), core (1-2 exercises), cooldown (1-2 exercises). Do not pad with unnecessary exercises. Concise plans are better.

The JSON must follow this exact structure:
{
  "plan": {
    "level": string,
    "goal": string,
    "days_per_week": number,
    "sessions": [
      {
        "day": string,
        "label": string,
        "blocks": [
          {
            "type": "warmup" | "skill" | "strength" | "accessory" | "core" | "cooldown",
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

    const plan = JSON.parse(jsonMatch[0])

    // Store in Supabase cache (fire and forget — don't block the response)
    supabase
      .from('cached_plans')
      .insert({ input_hash: hash, plan })
      .then(({ error }) => {
        if (error) console.error('Cache write error:', error.message)
        else console.log('cache stored:', hash)
      })

    return NextResponse.json(plan)
  } catch (err) {
    console.error('Claude API error:', err)
    return NextResponse.json({ error: 'Failed to generate plan' }, { status: 500 })
  }
}
