import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface AdjustRequest {
  exerciseName: string
  direction: 'regression' | 'progression'
  level: string
  equipment: string[]
  goal: string
}

export async function POST(req: NextRequest) {
  const body: AdjustRequest = await req.json()
  const { exerciseName, direction, level, equipment, goal } = body

  const directionLabel = direction === 'regression' ? 'easier (one step lower in the progression)' : 'harder (one step higher in the progression)'

  const userMessage = `
The user has the following profile:
- Level: ${level}
- Equipment: ${equipment.join(', ')}
- Goal: ${goal}

They are currently doing "${exerciseName}" but find it ${direction === 'regression' ? 'too hard' : 'too easy'}.

Suggest the ${directionLabel} from the progression line for this exercise.

If this is already the easiest/hardest step available for their equipment, set "at_limit" to true and explain briefly in "notes".

Return ONLY a valid JSON object — no explanation, no markdown, no code block:
{
  "name": string,
  "sets": number,
  "reps": string,
  "rest_seconds": number,
  "notes": string,
  "at_limit": boolean
}
`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: getSkillPrompt(),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse response' }, { status: 500 })
    }

    return NextResponse.json(JSON.parse(jsonMatch[0]))
  } catch (err) {
    console.error('Adjust exercise error:', err)
    return NextResponse.json({ error: 'Failed to adjust exercise' }, { status: 500 })
  }
}
