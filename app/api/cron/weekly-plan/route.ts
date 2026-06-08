import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { analyseProgressions, generateNextWeekPlan } from '@/lib/agents'
import { saveUserPlanForUser, saveWeeklyFeedback } from '@/lib/plan-utils'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch all users who have logged at least one set in the past 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: activeUsers, error } = await supabase
    .from('exercise_logs')
    .select('user_id')
    .gte('logged_at', since)

  if (error) {
    console.error('Cron: failed to fetch active users', error.message)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  const userIds = [...new Set((activeUsers ?? []).map(r => r.user_id))] as string[]
  const results: Record<string, string> = {}

  // Fetch all users currently in holiday mode so we can skip them
  const { data: holidayRows } = await supabase
    .from('holiday_config')
    .select('user_id')
    .eq('is_active', true)

  const holidayUserIds = new Set((holidayRows ?? []).map(r => r.user_id as string))

  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)) // Monday
  weekStart.setHours(0, 0, 0, 0)

  for (const userId of userIds) {
    if (holidayUserIds.has(userId)) {
      await saveWeeklyFeedback({
        userId,
        action: 'holiday',
        reason: 'You were in holiday mode this week — normal progression is paused.',
      })
      results[userId] = 'holiday'
      continue
    }

    const { data: existingFeedback } = await supabase
      .from('weekly_feedback')
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', weekStart.toISOString())
      .limit(1)
      .maybeSingle()

    if (existingFeedback) {
      results[userId] = 'skipped_manual'
      continue
    }

    try {
      const analysis = await analyseProgressions(userId)
      const result = await generateNextWeekPlan(userId, analysis)

      let planId: string | undefined
      if (result.action === 'new_plan' && result.rawPlan && result.inputs) {
        planId = await saveUserPlanForUser(userId, result.rawPlan, result.inputs) ?? undefined
      }

      await saveWeeklyFeedback({
        userId,
        analysis,
        action: result.action,
        reason: result.reason,
        weeks_to_continue: result.weeks_to_continue,
        changes: result.changes,
        planId,
      })

      results[userId] = result.action
    } catch (err) {
      console.error(`Cron: failed for user ${userId}`, err)
      results[userId] = 'error'
    }
  }

  return NextResponse.json({ processed: userIds.length, results })
}
