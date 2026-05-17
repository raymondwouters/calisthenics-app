import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { Exercise } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface RecoveryRequest {
  description: string
}

export interface RecoveryResponse {
  exercises: Exercise[]
  intro: string
}

export async function POST(req: NextRequest) {
  const body: RecoveryRequest = await req.json()
  const { description } = body

  if (!description?.trim()) {
    return NextResponse.json({ error: 'Description required' }, { status: 400 })
  }

  const userMessage = `
The user is experiencing the following issue and needs a targeted recovery/mobility session:

"${description}"

Generate 5–8 stretches or stabilising exercises specifically for their situation.
Focus on relieving the affected area, improving mobility, and gently strengthening any supporting muscles.
Use hold times (e.g. "30s", "45s") for passive stretches and rep ranges (e.g. "10–12") for active movements.
Keep rest_seconds low (15–30s) — this is a recovery session, not strength training.

Return ONLY valid JSON — no explanation, no markdown:
{
  "intro": string (one sentence describing the focus of this session),
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
`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
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
    console.error('Recovery error:', err)
    return NextResponse.json({ error: 'Failed to generate recovery session' }, { status: 500 })
  }
}
