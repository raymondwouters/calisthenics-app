import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { GenerateRequest } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const body: GenerateRequest = await req.json()
  const { level, equipment, daysPerWeek, goal } = body

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
      system: getSkillPrompt(),
      messages: [{ role: 'user', content: userMessage }],
    })

    if (message.stop_reason === 'max_tokens') {
      console.error('Claude response truncated — plan too large')
      return NextResponse.json({ error: 'Plan was too large to generate. Try fewer days or less equipment.' }, { status: 500 })
    }

    const text = message.content[0].type === 'text' ? message.content[0].text : ''

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse plan from AI response' }, { status: 500 })
    }

    const plan = JSON.parse(jsonMatch[0])
    return NextResponse.json(plan)
  } catch (err) {
    console.error('Claude API error:', err)
    return NextResponse.json({ error: 'Failed to generate plan' }, { status: 500 })
  }
}
