import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { Session, GenerateRequest } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface RefineDayRequest {
  session: Session
  inputs: GenerateRequest
  feedback: string
}

export async function POST(req: NextRequest) {
  const body: RefineDayRequest = await req.json()
  const { session, inputs, feedback } = body

  const userMessage = `
You are a calisthenics coach. Refine the following workout session based on user feedback.

User profile:
- Level: ${inputs.level}
- Equipment: ${inputs.equipment.join(', ')}
- Goal: ${inputs.goal}

Current session (${session.day} — ${session.label}):
${JSON.stringify(session, null, 2)}

User feedback: "${feedback}"

Return an updated version of this session as a JSON object. Keep the same day, label, type, and block structure. Only adjust exercises within blocks as needed.

Return ONLY a valid JSON object matching this structure — no explanation, no markdown:
{
  "session": {
    "day": string,
    "type": "workout",
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
}
`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse session from AI response' }, { status: 500 })
    }

    const data = JSON.parse(jsonMatch[0])
    return NextResponse.json(data)
  } catch (err) {
    console.error('Claude API error:', err)
    return NextResponse.json({ error: 'Failed to refine session' }, { status: 500 })
  }
}
