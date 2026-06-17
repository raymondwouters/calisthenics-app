import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { Exercise } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface RefineRecoveryRequest {
  title: string
  intro: string
  exercises: Exercise[]
  feedback: string
}

export async function POST(req: NextRequest) {
  const body: RefineRecoveryRequest = await req.json()
  const { title, intro, exercises, feedback } = body

  if (!feedback?.trim()) {
    return NextResponse.json({ error: 'Feedback required' }, { status: 400 })
  }

  const userMessage = `
You are a calisthenics and recovery coach. Refine the following recovery session based on the user's focus request.

Current session:
Title: ${title}
Intro: ${intro}
Exercises:
${JSON.stringify(exercises, null, 2)}

User's focus request: "${feedback}"

Adjust the exercises to match what the user wants to focus on. You may add, remove, or swap exercises, change sets/reps/hold times, or reorder — whatever best serves their request. Keep the session 5–8 exercises.

Return ONLY valid JSON — no explanation, no markdown:
{
  "title": string,
  "intro": string,
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
    console.error('Refine recovery error:', err)
    return NextResponse.json({ error: 'Failed to refine recovery session' }, { status: 500 })
  }
}
