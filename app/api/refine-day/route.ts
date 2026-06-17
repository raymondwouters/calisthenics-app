import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { Session, GenerateRequest } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface RefineDayRequest {
  session: Session
  inputs: GenerateRequest
  feedback: string
  completedExercises?: string[]  // exercise names already logged this day
  swapMode?: 'keep-logged' | 'swap-mentioned-only'
}

export async function POST(req: NextRequest) {
  const body: RefineDayRequest = await req.json()
  const { session, inputs, feedback, completedExercises, swapMode } = body

  let constraintNote = ''
  if (swapMode === 'keep-logged' && completedExercises && completedExercises.length > 0) {
    constraintNote = `
IMPORTANT: The user has already completed these exercises — do NOT change them, keep them exactly as-is and preserve their position in the session:
${completedExercises.map(e => `- ${e}`).join('\n')}
Only modify exercises that come after the completed ones.`
  } else if (swapMode === 'swap-mentioned-only') {
    constraintNote = `
IMPORTANT: Only swap exercises that the user explicitly mentions by name in their feedback. Leave all other exercises unchanged.`
  }

  const userMessage = `
You are a calisthenics coach. Refine the following workout session based on user feedback.

User profile:
- Level: ${inputs.level}
- Equipment: ${inputs.equipment.join(', ')}
- Goal: ${inputs.goal}

Current session (${session.day} — ${session.label}):
${JSON.stringify(session, null, 2)}

User feedback: "${feedback}"
${constraintNote}

Return an updated version of this session as a JSON object. Keep the same day, label, and type. Only adjust exercises within blocks as needed — do not change the block structure unless the user explicitly asks to.

Return ONLY a valid JSON object matching this structure — no explanation, no markdown:
{
  "session": {
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
