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
  skills?: string[]
  goalContext?: string
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


export type PlateauStrategy =
  | { action: 'increase_volume'; target_sets: number; target_reps: string }
  | { action: 'change_tempo'; tempo: string }
  | { action: 'add_pause'; pause_seconds: number }
  | { action: 'regress_and_rebuild'; reason: string }
  | { action: 'deload'; duration_weeks: 1 }

export interface ProgressionAnalysis {
  ready_to_progress: string[]
  needs_regression: string[]
  plateaued: Array<{
    exercise: string
    sessions_stable: number
    plateau_strategy: PlateauStrategy
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

export interface ProgressionNode {
  name: string
  assisted: boolean       // true for band-assisted, jumping, negative variants not in the main line
  notes?: string          // e.g. "use resistance band", "from a box"
}

export interface ProgressionLine {
  family: string          // e.g. "Horizontal Push", "Vertical Pull"
  nodes: ProgressionNode[]
}

export interface ProgressionLinesResponse {
  lines: ProgressionLine[]
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

export type HolidayGoal =
  | 'maintain-strength'
  | 'active-recovery'
  | 'high-intensity-bodyweight'

export interface HolidayConfig {
  is_active: boolean
  equipment: string[]
  goal: HolidayGoal
}

export interface PersonalRecord {
  exerciseName: string
  reps: number
  previousBest: number
}

export interface WorkoutSummary {
  setsCompleted: number
  setsPlanned: number
  totalReps: number
  durationMinutes: number
  personalRecords: PersonalRecord[]
  repsDelta: number | null
}
