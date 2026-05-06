export interface Exercise {
  name: string
  sets: number
  reps: string
  rest_seconds: number
  notes?: string
}

export interface Block {
  type: 'warmup' | 'skill' | 'strength' | 'accessory' | 'core' | 'cooldown' | 'stretch'
  exercises: Exercise[]
}

export interface Session {
  day: string
  label: string
  type?: 'workout' | 'rest'
  blocks: Block[]
}

export interface WorkoutPlan {
  level: string
  goal: string
  days_per_week: number
  sessions: Session[]
}

export interface PlanResponse {
  plan: WorkoutPlan
}

export interface GenerateRequest {
  level: string
  equipment: string[]
  daysPerWeek: number
  goal: string
  changes?: string
}

export interface SetLog {
  reps?: number
  duration_s?: number
  weight_kg?: number
}

export interface ExerciseLog {
  sessionDay: string
  exerciseName: string
  setsData: SetLog[]
}

export interface FeedbackPlanRequest {
  currentPlan: WorkoutPlan
  inputs: GenerateRequest
  logs: ExerciseLog[]
  feedback: string
}

export interface ProgressionAnalysis {
  summary: string
  ready_to_progress: string[]
  needs_regression: string[]
  plateaued: Array<{
    exercise: string
    sessions_stable: number
    recommendation: string
  }>
  insights: string[]
}

export interface NextWeekPlanRequest {
  currentPlan: WorkoutPlan
  inputs: GenerateRequest
  analysis: ProgressionAnalysis
}

export interface NextWeekPlanResponse {
  action: 'new_plan' | 'continue'
  reason: string
  weeks_to_continue?: number
  changes?: Array<{ exercise: string; from: string; to: string }>
  plan?: WorkoutPlan
  planId?: string
}

export interface WeeklyFeedback {
  id: string
  action: 'new_plan' | 'continue'
  reason: string
  weeks_to_continue?: number
  changes?: Array<{ exercise: string; from: string; to: string }>
  analysis: ProgressionAnalysis
  plan_id?: string
  created_at: string
}
