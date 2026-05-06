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

  for (const userId of userIds) {
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
