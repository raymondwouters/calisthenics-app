import Anthropic from '@anthropic-ai/sdk'
import { getSkillPrompt } from '@/lib/skill'
import { supabase } from '@/lib/supabase'
import { SetLog, WorkoutPlan, GenerateRequest, ProgressionAnalysis, NextWeekPlanResponse } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface LogRow {
  exercise_name: string
  sets_data: SetLog[]
  logged_at: string
  session_day: string
}

function sanitizeJson(raw: string): string {
  return raw.replace(/("(?:[^"\\]|\\.)*")/g, m =>
    m.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  )
}

// ─── Agent 1: Progressions Analyst ───────────────────────────────────────────

export async function analyseProgressions(userId: string): Promise<ProgressionAnalysis> {
  const { data: logsData } = await supabase
    .from('exercise_logs')
    .select('exercise_name, sets_data, logged_at, session_day')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(500)

  const logs = (logsData ?? []) as LogRow[]

  const { data: planData } = await supabase
    .from('plans')
    .select('plan, inputs')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const currentPlan = planData?.plan as { plan: WorkoutPlan } | undefined
  const inputs = planData?.inputs as GenerateRequest | undefined

  const logSummary = logs.length > 0
    ? logs.map(log => {
        const setsDesc = log.sets_data.map(s =>
          s.reps !== undefined ? `${s.reps} reps` : `${s.duration_s}s`
        ).join(', ')
        const date = new Date(log.logged_at).toISOString().slice(0, 10)
        return `- ${log.exercise_name} (${log.session_day}, ${date}): ${setsDesc}`
      }).join('\n')
    : 'No sessions logged.'

  const planExercises = currentPlan?.plan?.sessions
    ?.flatMap(s => s.blocks.flatMap(b => b.exercises.map(e => `${e.name}: ${e.sets}×${e.reps}`)))
    .join('\n') ?? 'No current plan.'

  const userProfile = inputs
    ? `Level: ${inputs.level}, Goal: ${inputs.goal}, Equipment: ${inputs.equipment.join(', ')}`
    : 'Unknown profile.'

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `You are a fitness progression analyst. Analyse the user's logged workout data and identify trends.

User profile: ${userProfile}

Logged sessions (most recent first):
${logSummary}

Current plan exercises:
${planExercises}

Return ONLY a single-line compact JSON object with no explanation, no markdown, and no newlines inside string values:
{"summary":"...","ready_to_progress":[...],"needs_regression":[...],"plateaued":[{"exercise":"...","sessions_stable":0,"recommendation":"..."}],"insights":[...]}`,
    }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Agent 1 returned no valid JSON')

  return JSON.parse(sanitizeJson(jsonMatch[0])) as ProgressionAnalysis
}

// ─── Agent 2: Plan Writer ─────────────────────────────────────────────────────

export async function generateNextWeekPlan(
  userId: string,
  analysis: ProgressionAnalysis,
): Promise<NextWeekPlanResponse & { rawPlan?: object; inputs?: GenerateRequest }> {
  const { data: planData } = await supabase
    .from('plans')
    .select('plan, inputs')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const currentPlan = (planData?.plan as { plan: WorkoutPlan } | undefined)?.plan
  const inputs = planData?.inputs as GenerateRequest | undefined

  if (!currentPlan || !inputs) {
    return { action: 'continue', reason: 'No existing plan found.' }
  }

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: [{
      type: 'text',
      text: getSkillPrompt(),
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{
      role: 'user',
      content: `The user has completed workouts and their progression has been analysed. Decide whether to generate an updated plan for next week or recommend continuing.

User profile:
- Level: ${inputs.level}
- Equipment: ${inputs.equipment.join(', ')}
- Days per week: ${inputs.daysPerWeek}
- Goal: ${inputs.goal}

Current plan:
${JSON.stringify(currentPlan, null, 2)}

Progression analysis:
- Ready to progress: ${analysis.ready_to_progress.join(', ') || 'none'}
- Needs regression: ${analysis.needs_regression.join(', ') || 'none'}
- Plateaued: ${analysis.plateaued.map(p => `${p.exercise} (${p.sessions_stable} sessions stable — ${p.recommendation})`).join(', ') || 'none'}
- Key insights: ${analysis.insights.join('; ')}

Decision rules:
- If there are meaningful progressions or regressions needed, generate a new plan.
- If the user is still adapting and would benefit from 1–3 more weeks on the same plan, recommend continuing.
- Progress exercises in "ready_to_progress" to their next harder variation.
- Regress exercises in "needs_regression" to an easier variation.
- Address plateaued exercises per their recommendation.

Return ONLY a single-line compact JSON object — no explanation, no markdown, no newlines inside string values:

For a new plan: {"action":"new_plan","reason":"...","weeks_to_continue":null,"changes":[{"exercise":"...","from":"...","to":"..."}],"plan":{"plan":{"level":"...","goal":"...","days_per_week":3,"sessions":[...]}}}
For continue: {"action":"continue","reason":"...","weeks_to_continue":2,"changes":null,"plan":null}

Plan structure when action is new_plan:
{"plan":{"level":string,"goal":string,"days_per_week":number,"sessions":[{"day":string,"label":string,"blocks":[{"type":"warmup"|"skill"|"strength"|"accessory"|"core"|"cooldown","exercises":[{"name":string,"sets":number,"reps":string,"rest_seconds":number,"notes":string}]}]}]}}`,
    }],
  })

  if (message.stop_reason === 'max_tokens') throw new Error('Agent 2 response truncated')

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Agent 2 returned no valid JSON')

  const parsed = JSON.parse(sanitizeJson(jsonMatch[0]))

  return {
    action: parsed.action,
    reason: parsed.reason,
    weeks_to_continue: parsed.weeks_to_continue ?? undefined,
    changes: parsed.changes ?? undefined,
    rawPlan: parsed.action === 'new_plan' ? parsed.plan : undefined,
    inputs,
  }
}
