import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { saveUserPlan } from '@/lib/plan-utils'
import { FeedbackPlanRequest } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const body: FeedbackPlanRequest = await req.json()
  const { currentPlan, inputs, logs, feedback } = body

  const logSummary = logs.length > 0
    ? logs.map(log => {
        const setsDesc = log.setsData.map(s =>
          s.reps !== undefined ? `${s.reps} reps` : `${s.duration_s}s`
        ).join(', ')
        return `- ${log.exerciseName} (${log.sessionDay}): ${setsDesc}`
      }).join('\n')
    : 'No sets logged yet.'

  const userMessage = `
The user currently has this workout plan:

${JSON.stringify(currentPlan, null, 2)}

Their profile:
- Level: ${inputs.level}
- Equipment: ${inputs.equipment.join(', ')}
- Days per week: ${inputs.daysPerWeek}
- Goal: ${inputs.goal}

What they logged this week:
${logSummary}

Their feedback:
"${feedback}"

Based on their feedback and logged performance, update the workout plan. Adjust exercises, progressions, volume, or structure as needed. If they hit their target reps on exercises, progress those exercises. If they found something too hard, regress it.

Return ONLY a valid JSON object — no explanation, no markdown, no code block.
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
      return NextResponse.json({ error: 'Plan too large to generate.' }, { status: 500 })
    }

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse updated plan' }, { status: 500 })
    }

    const planData = JSON.parse(jsonMatch[0])

    const planId = await saveUserPlan(planData, inputs)
    return NextResponse.json({ ...planData, planId })
  } catch (err) {
    console.error('Feedback plan error:', err)
    return NextResponse.json({ error: 'Failed to update plan' }, { status: 500 })
  }
}
