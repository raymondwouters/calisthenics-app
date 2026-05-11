import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { createSupabaseServer } from '@/lib/supabase-server'
import { supabase } from '@/lib/supabase'
import { SetLog, WorkoutPlan, GenerateRequest, ProgressionAnalysis } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface LogRow {
  exercise_name: string
  sets_data: SetLog[]
  logged_at: string
  session_day: string
}

export async function POST() {
  const serverClient = await createSupabaseServer()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: logsData } = await supabase
    .from('exercise_logs')
    .select('exercise_name, sets_data, logged_at, session_day')
    .eq('user_id', user.id)
    .order('logged_at', { ascending: false })
    .limit(500)

  const logs = (logsData ?? []) as LogRow[]

  const { data: planData } = await supabase
    .from('plans')
    .select('plan, inputs')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

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

  const userMessage = `Analyse the user's logged workout data and identify progression trends. Use your calisthenics coaching knowledge to evaluate each exercise against its known progression line.

User profile: ${userProfile}

Logged sessions (most recent first):
${logSummary}

Current plan exercises:
${planExercises}

Rules:
- "ready_to_progress": exercises where the user has consistently hit or exceeded their target reps/duration across multiple recent sessions. Include ONLY the next step in the correct progression line — never skip a level.
- "needs_regression": exercises where the user is consistently falling short of target reps, struggling with form, or showing declining performance.
- "plateaued": exercises that are stable (neither clearly improving nor declining) for 3+ sessions. For each, determine a specific plateau_strategy from the options below.
- "insights": 2–4 high-level observations about training patterns, recovery, or volume.

For plateaued exercises, choose exactly one plateau_strategy from these options:
- {"action":"increase_volume","target_sets":N,"target_reps":"..."} — add sets or reps before progressing
- {"action":"change_tempo","tempo":"..."} — slow the movement (e.g. "3-1-3" = 3s down, 1s hold, 3s up)
- {"action":"add_pause","pause_seconds":N} — add a hold at the hardest point
- {"action":"regress_and_rebuild","reason":"..."} — drop to an easier variation to build a better base
- {"action":"deload","duration_weeks":1} — one week of reduced volume/intensity

Return ONLY a single-line compact JSON object with no explanation, no markdown, and no newlines inside string values:
{"ready_to_progress":[...],"needs_regression":[...],"plateaued":[{"exercise":"...","sessions_stable":0,"plateau_strategy":{...}}],"insights":[]}`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
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
      return NextResponse.json({ error: 'Failed to parse analysis' }, { status: 500 })
    }

    const analysis: ProgressionAnalysis = JSON.parse(jsonMatch[0])
    return NextResponse.json(analysis)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Analyse progressions error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
