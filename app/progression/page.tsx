'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { SetLog, WeeklyFeedback } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogRow {
  exercise_name: string
  sets_data: SetLog[]
  logged_at: string
  session_day: string
}

interface Session {
  date: Date
  dateKey: string
  sets: SetLog[]
  best: number | null
  unit: 'reps' | 's' | null
}

interface ExerciseProgression {
  name: string
  sessions: Session[]
  trend: 'up' | 'stable' | 'down' | 'new'
  delta: number | null
  unit: 'reps' | 's' | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBest(sets: SetLog[]): { value: number; unit: 'reps' | 's' } | null {
  const durations = sets.map(s => s.duration_s).filter((d): d is number => d !== undefined)
  const reps = sets.map(s => s.reps).filter((r): r is number => r !== undefined)
  if (durations.length > 0) return { value: Math.max(...durations), unit: 's' }
  if (reps.length > 0) return { value: Math.max(...reps), unit: 'reps' }
  return null
}

function formatBest(value: number, unit: 'reps' | 's'): string {
  return unit === 's' ? `${value}s` : String(value)
}

function formatSets(sets: SetLog[]): string {
  return sets.map(s => {
    if (s.duration_s !== undefined) return `${s.duration_s}s`
    if (s.reps !== undefined) return String(s.reps)
    return '✓'
  }).join(' · ')
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildProgressions(rows: LogRow[]): ExerciseProgression[] {
  // Group by exercise, deduplicate by date (rows are DESC so first = latest per date)
  const byExercise = new Map<string, Map<string, LogRow>>()

  for (const row of rows) {
    const dateKey = new Date(row.logged_at).toISOString().slice(0, 10)
    if (!byExercise.has(row.exercise_name)) byExercise.set(row.exercise_name, new Map())
    const dateMap = byExercise.get(row.exercise_name)!
    if (!dateMap.has(dateKey)) dateMap.set(dateKey, row)
  }

  const progressions: ExerciseProgression[] = []

  byExercise.forEach((dateMap, name) => {
    const sessions: Session[] = Array.from(dateMap.entries())
      .map(([dateKey, row]) => {
        const best = getBest(row.sets_data)
        return {
          date: new Date(row.logged_at),
          dateKey,
          sets: row.sets_data,
          best: best?.value ?? null,
          unit: best?.unit ?? null,
        }
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    const last = sessions[sessions.length - 1]
    const prev = sessions[sessions.length - 2]

    let trend: ExerciseProgression['trend'] = 'new'
    let delta: number | null = null

    if (prev && last.best !== null && prev.best !== null) {
      delta = last.best - prev.best
      trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'stable'
    }

    progressions.push({ name, sessions, trend, delta, unit: last.unit })
  })

  const order = { up: 0, stable: 1, new: 2, down: 3 }
  progressions.sort((a, b) => order[a.trend] - order[b.trend])

  return progressions
}

// ─── Components ───────────────────────────────────────────────────────────────

function TrendBadge({ trend, delta, unit }: Pick<ExerciseProgression, 'trend' | 'delta' | 'unit'>) {
  if (trend === 'new') {
    return <span className="text-xs text-muted-foreground">First session</span>
  }
  if (trend === 'up') {
    const label = delta !== null ? `+${delta}${unit === 's' ? 's' : ' reps'}` : '↑'
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-600/10 px-2 py-0.5 rounded-full">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
        {label}
      </span>
    )
  }
  if (trend === 'down') {
    const label = delta !== null ? `${delta}${unit === 's' ? 's' : ' reps'}` : '↓'
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        {label}
      </span>
    )
  }
  return (
    <span className="text-xs font-semibold text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
      → Same
    </span>
  )
}

function ExerciseCard({ ex }: { ex: ExerciseProgression }) {
  const last = ex.sessions[ex.sessions.length - 1]
  const recent = ex.sessions.slice(-5)

  return (
    <div className={`bg-card rounded-xl p-4 border ${ex.trend === 'up' ? 'border-emerald-500/30' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-sm font-semibold text-foreground leading-snug">{ex.name}</p>
        <TrendBadge trend={ex.trend} delta={ex.delta} unit={ex.unit} />
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        {shortDate(last.date)} · <span className="text-foreground/80">{formatSets(last.sets)}</span>
      </p>

      {/* Session history */}
      {recent.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {recent.map((s, i) => {
            const isLatest = i === recent.length - 1
            const prevSession = i > 0 ? recent[i - 1] : null
            const improved = prevSession && s.best !== null && prevSession.best !== null && s.best > prevSession.best
            return (
              <div
                key={s.dateKey}
                className={`flex flex-col items-center px-2 py-1.5 rounded-lg min-w-[44px] ${
                  isLatest
                    ? improved ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-secondary border border-border'
                    : 'bg-secondary/60'
                }`}
              >
                <span className={`text-[11px] font-bold leading-none ${isLatest ? (improved ? 'text-emerald-600' : 'text-foreground') : 'text-muted-foreground'}`}>
                  {s.best !== null && s.unit ? formatBest(s.best, s.unit) : '✓'}
                </span>
                <span className="text-[9px] text-muted-foreground mt-0.5 whitespace-nowrap">{shortDate(s.date)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProgressionPage() {
  const router = useRouter()
  const [progressions, setProgressions] = useState<ExerciseProgression[]>([])
  const [loading, setLoading] = useState(true)
  const [weeklyFeedback, setWeeklyFeedback] = useState<WeeklyFeedback | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowser()
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }

      const [logsResult, feedbackResult] = await Promise.all([
        supabase
          .from('exercise_logs')
          .select('exercise_name, sets_data, logged_at, session_day')
          .eq('user_id', user.id)
          .order('logged_at', { ascending: false })
          .limit(2000),
        supabase
          .from('weekly_feedback')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (logsResult.data && logsResult.data.length > 0) {
        setProgressions(buildProgressions(logsResult.data as LogRow[]))
      }

      if (feedbackResult.data) {
        setWeeklyFeedback(feedbackResult.data as WeeklyFeedback)
      }

      setLoading(false)
    }
    load()
  }, [router])

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <svg className="animate-spin w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </main>
    )
  }

  const improving = progressions.filter(p => p.trend === 'up')
  const rest = progressions.filter(p => p.trend !== 'up')

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-8">

        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest text-accent uppercase mb-1">Training</p>
          <h1 className="text-2xl font-bold text-foreground">Progression</h1>
        </div>

        {/* ─── Weekly Feedback Box ─── */}
        {weeklyFeedback && (
          <div className="bg-secondary/50 rounded-2xl p-5 mb-8 flex flex-col gap-4">

            <p className="text-sm text-foreground leading-relaxed">{weeklyFeedback.analysis.summary}</p>

            {weeklyFeedback.analysis.ready_to_progress.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold tracking-widest text-emerald-600 uppercase mb-2">Ready to progress</p>
                <div className="flex flex-wrap gap-2">
                  {weeklyFeedback.analysis.ready_to_progress.map(ex => (
                    <span key={ex} className="text-xs font-medium text-emerald-700 bg-emerald-500/10 px-2.5 py-1 rounded-full">{ex}</span>
                  ))}
                </div>
              </div>
            )}

            {weeklyFeedback.analysis.plateaued.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold tracking-widest text-amber-600 uppercase mb-2">Plateaued</p>
                <div className="flex flex-col gap-1.5">
                  {weeklyFeedback.analysis.plateaued.map(p => (
                    <div key={p.exercise} className="flex items-start gap-2">
                      <span className="text-xs font-medium text-amber-700 bg-amber-500/10 px-2.5 py-1 rounded-full whitespace-nowrap">{p.exercise}</span>
                      <span className="text-xs text-muted-foreground pt-1">{p.recommendation}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {weeklyFeedback.analysis.needs_regression.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold tracking-widest text-red-500 uppercase mb-2">Needs easier variation</p>
                <div className="flex flex-wrap gap-2">
                  {weeklyFeedback.analysis.needs_regression.map(ex => (
                    <span key={ex} className="text-xs font-medium text-red-600 bg-red-500/10 px-2.5 py-1 rounded-full">{ex}</span>
                  ))}
                </div>
              </div>
            )}

            {weeklyFeedback.analysis.insights.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Insights</p>
                <ul className="flex flex-col gap-1">
                  {weeklyFeedback.analysis.insights.map((insight, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-2">
                      <span className="text-accent mt-0.5">·</span>
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border-t border-border/60 pt-4 flex flex-col gap-3">
              {weeklyFeedback.action === 'new_plan' ? (
                <>
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-0.5">Plan updated for next week</p>
                    <p className="text-xs text-muted-foreground">{weeklyFeedback.reason}</p>
                  </div>
                  {weeklyFeedback.changes && weeklyFeedback.changes.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">What changes</p>
                      <div className="flex flex-col gap-2">
                        {weeklyFeedback.changes.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs flex-wrap">
                            <span className="font-medium text-foreground">{c.exercise}</span>
                            <span className="text-muted-foreground line-through">{c.from}</span>
                            <svg className="w-3 h-3 text-primary shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                            <span className="font-semibold text-primary">{c.to}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">Keep going</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{weeklyFeedback.reason}</p>
                  {weeklyFeedback.weeks_to_continue && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Next check-in in <span className="font-semibold text-foreground">{weeklyFeedback.weeks_to_continue} week{weeklyFeedback.weeks_to_continue !== 1 ? 's' : ''}</span>.
                    </p>
                  )}
                </div>
              )}
            </div>

          </div>
        )}

        {progressions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">No sessions logged yet.</p>
            <p className="text-muted-foreground/70 text-xs mt-1">Accept your plan and start logging sets to track your progression.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">

            {improving.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <p className="text-xs font-semibold tracking-widest text-emerald-600 uppercase">Getting stronger</p>
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">{improving.length} exercise{improving.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex flex-col gap-3">
                  {improving.map(ex => <ExerciseCard key={ex.name} ex={ex} />)}
                </div>
              </div>
            )}

            {rest.length > 0 && (
              <div>
                {improving.length > 0 && (
                  <div className="flex items-center gap-3 mb-4">
                    <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">All exercises</p>
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">{rest.length}</span>
                  </div>
                )}
                <div className="flex flex-col gap-3">
                  {rest.map(ex => <ExerciseCard key={ex.name} ex={ex} />)}
                </div>
              </div>
            )}

          </div>
        )}

      </div>
    </main>
  )
}
