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
