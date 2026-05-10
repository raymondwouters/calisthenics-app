import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { createSupabaseServer } from '@/lib/supabase-server'
import { saveUserPlan, saveWeeklyFeedback } from '@/lib/plan-utils'
import { NextWeekPlanRequest, NextWeekPlanResponse } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const serverClient = await createSupabaseServer()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: NextWeekPlanRequest = await req.json()
  const { currentPlan, inputs, analysis } = body

  const userMessage = `
The user has completed workouts and their progression has been analysed. Based on this analysis, decide whether to generate an updated plan for next week or recommend they continue their current plan.

User profile:
- Level: ${inputs.level}
- Equipment: ${inputs.equipment.join(', ')}
- Days per week: ${inputs.daysPerWeek}
- Goal: ${inputs.goal}

Current plan:
${JSON.stringify(currentPlan, null, 2)}

Progression analysis:
- Summary: ${analysis.summary}
- Ready to progress: ${analysis.ready_to_progress.join(', ') || 'none'}
- Needs regression: ${analysis.needs_regression.join(', ') || 'none'}
- Plateaued: ${analysis.plateaued.map(p => `${p.exercise} (${p.sessions_stable} sessions stable — ${p.recommendation})`).join(', ') || 'none'}
- Key insights: ${analysis.insights.join('; ')}

Decision rules:
- If there are meaningful progressions or regressions needed, generate a new plan.
- If the user is still adapting and would benefit from 1–3 more weeks on the same plan, recommend continuing.
- Progress exercises listed in "ready_to_progress" to their next harder variation.
- Regress exercises listed in "needs_regression" to an easier variation.
- Address plateaued exercises according to their recommendation.

Return ONLY a single-line compact JSON object — no explanation, no markdown, no newlines inside string values:

For a new plan: {"action":"new_plan","reason":"...","weeks_to_continue":null,"changes":[{"exercise":"Pike push-up","from":"3x8-10","to":"3x10-12"},...],"plan":{"plan":{"level":"...","goal":"...","days_per_week":3,"sessions":[...]}}}

For continue: {"action":"continue","reason":"...","weeks_to_continue":2,"changes":null,"plan":null}

The plan inside must follow this exact structure:
{"plan":{"level":string,"goal":string,"days_per_week":number,"sessions":[{"day":string,"label":string,"blocks":[{"type":"warmup"|"skill"|"strength"|"accessory"|"core"|"cooldown","exercises":[{"name":string,"sets":number,"reps":string,"rest_seconds":number,"notes":string}]}]}]}}
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
      return NextResponse.json({ error: 'Response too large.' }, { status: 500 })
    }

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse response' }, { status: 500 })
    }

    const cleaned = jsonMatch[0]
      .replace(/\r\n/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\t/g, ' ')

    const parsed = JSON.parse(cleaned)

    const response: NextWeekPlanResponse = {
      action: parsed.action,
      reason: parsed.reason,
      weeks_to_continue: parsed.weeks_to_continue ?? undefined,
      changes: parsed.changes ?? undefined,
    }

    if (parsed.action === 'new_plan' && parsed.plan) {
      const planId = await saveUserPlan(parsed.plan, inputs)
      response.plan = parsed.plan.plan ?? parsed.plan
      response.planId = planId ?? undefined
    }

    await saveWeeklyFeedback({
      userId: user.id,
      analysis,
      action: response.action,
      reason: response.reason,
      weeks_to_continue: response.weeks_to_continue,
      changes: response.changes,
      planId: response.planId,
    })

    return NextResponse.json(response)
  } catch (err) {
    console.error('Plan next week error:', err)
    return NextResponse.json({ error: 'Failed to generate next week plan' }, { status: 500 })
  }
}
