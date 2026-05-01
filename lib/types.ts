export interface Exercise {
  name: string
  sets: number
  reps: string
  rest_seconds: number
  notes?: string
}

export interface Block {
  type: 'warmup' | 'skill' | 'strength' | 'accessory' | 'core' | 'cooldown'
  exercises: Exercise[]
}

export interface Session {
  day: string
  label: string
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
}
