import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
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

  const userMessage = `You are a fitness progression analyst. Analyse the user's logged workout data and identify trends.

User profile: ${userProfile}

Logged sessions (most recent first):
${logSummary}

Current plan exercises:
${planExercises}

Return ONLY a single-line compact JSON object with no explanation, no markdown, and no newlines inside string values:
{"summary":"...","ready_to_progress":[...],"needs_regression":[...],"plateaued":[{"exercise":"...","sessions_stable":0,"recommendation":"..."}],"insights":[...]}`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
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
