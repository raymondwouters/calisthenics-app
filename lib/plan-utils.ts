import { supabase } from '@/lib/supabase'
import { createSupabaseServer } from '@/lib/supabase-server'
import { ProgressionAnalysis } from '@/lib/types'

export async function saveUserPlan(planData: object, inputs: object, isHoliday = false): Promise<string | null> {
  try {
    const serverClient = await createSupabaseServer()
    const { data: { user } } = await serverClient.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('plans')
      .insert({ user_id: user.id, plan: planData, inputs, is_holiday: isHoliday })
      .select('id')
      .single()

    if (error) {
      console.error('Plan save error:', error.message)
      return null
    }
    return data.id
  } catch {
    return null
  }
}

export async function saveUserPlanForUser(userId: string, planData: object, inputs: object, isHoliday = false): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('plans')
      .insert({ user_id: userId, plan: planData, inputs, is_holiday: isHoliday })
      .select('id')
      .single()

    if (error) {
      console.error('Plan save error:', error.message)
      return null
    }
    return data.id
  } catch {
    return null
  }
}

export async function saveWeeklyFeedback(params: {
  userId: string
  analysis: ProgressionAnalysis
  action: 'new_plan' | 'continue'
  reason: string
  weeks_to_continue?: number
  changes?: Array<{ exercise: string; from: string; to: string }>
  planId?: string
}): Promise<void> {
  const { error } = await supabase.from('weekly_feedback').insert({
    user_id: params.userId,
    analysis: params.analysis,
    action: params.action,
    reason: params.reason,
    weeks_to_continue: params.weeks_to_continue ?? null,
    changes: params.changes ?? null,
    plan_id: params.planId ?? null,
  })
  if (error) console.error('Weekly feedback save error:', error.message)
}
