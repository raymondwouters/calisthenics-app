'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { SetLog, WeeklyFeedback, ProgressionLine } from '@/lib/types'

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

interface ExerciseHistory {
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

function weekLabel(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function buildHistoryMap(rows: LogRow[]): Map<string, ExerciseHistory> {
  const byExercise = new Map<string, Map<string, LogRow>>()

  for (const row of rows) {
    const dateKey = new Date(row.logged_at).toISOString().slice(0, 10)
    if (!byExercise.has(row.exercise_name)) byExercise.set(row.exercise_name, new Map())
    const dateMap = byExercise.get(row.exercise_name)!
    if (!dateMap.has(dateKey)) dateMap.set(dateKey, row)
  }

  const result = new Map<string, ExerciseHistory>()

  byExercise.forEach((dateMap, name) => {
    const sessions: Session[] = Array.from(dateMap.entries())
      .map(([dateKey, row]) => {
        const best = getBest(row.sets_data)
        return { date: new Date(row.logged_at), dateKey, sets: row.sets_data, best: best?.value ?? null, unit: best?.unit ?? null }
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    const last = sessions[sessions.length - 1]
    const prev = sessions[sessions.length - 2]
    let trend: ExerciseHistory['trend'] = 'new'
    let delta: number | null = null
    if (prev && last.best !== null && prev.best !== null) {
      delta = last.best - prev.best
      trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'stable'
    }
    result.set(name, { name, sessions, trend, delta, unit: last.unit })
  })

  return result
}

// ─── Session history inline (shown below current node) ───────────────────────

function SessionHistory({ history }: { history: ExerciseHistory }) {
  const recent = history.sessions.slice(-5)
  return (
    <div className="flex gap-1.5 flex-wrap mt-2">
      {recent.map((s, i) => {
        const isLatest = i === recent.length - 1
        const prev = i > 0 ? recent[i - 1] : null
        const improved = prev && s.best !== null && prev.best !== null && s.best > prev.best
        return (
          <div
            key={s.dateKey}
            className={`flex flex-col items-center px-2 py-1.5 rounded-lg min-w-[40px] ${
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
  )
}

// ─── Vertical progression line accordion ─────────────────────────────────────

function ProgressionLineRow({
  line,
  historyMap,
}: {
  line: ProgressionLine
  historyMap: Map<string, ExerciseHistory>
}) {
  const lastLoggedIndex = line.nodes.reduce((acc, node, i) => historyMap.has(node.name) ? i : acc, -1)
  const [open, setOpen] = useState(false)
  const currentNode = lastLoggedIndex >= 0 ? line.nodes[lastLoggedIndex] : null

  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      {/* Accordion header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3.5 bg-card hover:bg-secondary/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground">{line.family}</span>
          {currentNode && (
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
              {currentNode.name}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Accordion body */}
      {open && (
        <div className="px-4 pt-2 pb-4 bg-card border-t border-border">
          <div className="relative">
            {/* Vertical connecting line */}
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" />

            <div className="flex flex-col gap-0">
              {line.nodes.map((node, i) => {
                const history = historyMap.get(node.name)
                const logged = !!history
                const isCurrent = i === lastLoggedIndex
                const isPast = i < lastLoggedIndex

                let dotClass: string
                if (isCurrent) {
                  dotClass = 'w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0 relative z-10'
                } else if (isPast) {
                  dotClass = 'w-6 h-6 rounded-full bg-primary/30 flex items-center justify-center shrink-0 relative z-10'
                } else if (node.assisted) {
                  dotClass = 'w-4 h-4 rounded-full border border-dashed border-border bg-background mx-1 shrink-0 relative z-10'
                } else {
                  dotClass = 'w-6 h-6 rounded-full border-2 border-border bg-background flex items-center justify-center shrink-0 relative z-10'
                }

                return (
                  <div key={node.name} className={`flex items-start gap-3 py-2 bg-card relative`}>
                    {/* Dot */}
                    <div className={dotClass}>
                      {(isCurrent || isPast) && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>

                    {/* Row content */}
                    {isCurrent ? (
                      <div className="flex-1 bg-secondary rounded-xl px-3 py-2.5 -mt-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">{node.name}</span>
                          {history && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              history.trend === 'up'
                                ? 'text-emerald-700 bg-emerald-500/10'
                                : 'text-muted-foreground bg-background'
                            }`}>
                              {history.trend === 'up' ? `+${history.delta}${history.unit === 's' ? 's' : ' reps'}` :
                               history.trend === 'down' ? `${history.delta}${history.unit === 's' ? 's' : ' reps'}` :
                               'Stable'}
                            </span>
                          )}
                        </div>
                        {history && <SessionHistory history={history} />}
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-between gap-2 min-h-[24px]">
                        <div>
                          <span className={`text-sm ${
                            logged ? 'text-foreground/70' :
                            node.assisted ? 'text-muted-foreground/50 text-xs' :
                            'text-muted-foreground'
                          }`}>
                            {node.name}
                          </span>
                          {node.assisted && node.notes && (
                            <span className="text-[10px] text-muted-foreground/40 ml-1.5">{node.notes}</span>
                          )}
                        </div>
                        {logged && history && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {history.sessions[history.sessions.length - 1].best !== null
                              ? formatBest(history.sessions[history.sessions.length - 1].best!, history.unit!)
                              : '✓'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Weekly feedback card ──────────────────────────────────────────────────────

function toExStr(item: unknown): string {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object' && 'exercise' in item) return (item as Record<string, string>).exercise
  return String(item)
}

function WeeklyFeedbackCard({ fb }: { fb: WeeklyFeedback }) {
  const needsWork = [
    ...(fb.analysis.needs_regression ?? []).map(toExStr),
    ...fb.analysis.plateaued.map(p => p.exercise),
  ]
  const readyToProgress = (fb.analysis.ready_to_progress ?? []).map(toExStr)

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold tracking-widest text-primary uppercase">
            {fb.action === 'new_plan' ? 'Plan updated' : 'Same plan'}
          </p>
          <p className="text-[11px] text-muted-foreground">{weekLabel(fb.created_at)}</p>
        </div>
        <p className="text-sm text-foreground leading-relaxed">{fb.reason}</p>

        {fb.action === 'continue' && fb.weeks_to_continue && (
          <p className="text-xs text-muted-foreground mt-2">
            Next check-in in{' '}
            <span className="font-semibold text-foreground">
              {fb.weeks_to_continue} week{fb.weeks_to_continue !== 1 ? 's' : ''}
            </span>.
          </p>
        )}

        {fb.action === 'new_plan' && fb.changes && fb.changes.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border flex flex-col gap-2.5">
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">What changed</p>
            {fb.changes.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-semibold text-foreground">{c.exercise}</span>
                <span className="text-muted-foreground text-xs">{c.from}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-semibold text-primary">{c.to}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-secondary/50 rounded-2xl p-5 flex flex-col gap-4">
        {readyToProgress.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-emerald-600 uppercase mb-2">Progressing well</p>
            <div className="flex flex-wrap gap-2">
              {readyToProgress.map((ex, i) => (
                <span key={i} className="text-xs font-medium text-emerald-700 bg-emerald-500/10 px-2.5 py-1 rounded-full">{ex}</span>
              ))}
            </div>
          </div>
        )}

        {needsWork.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Need more time</p>
            <div className="flex flex-wrap gap-2">
              {needsWork.map((ex, i) => (
                <span key={i} className="text-xs font-medium text-muted-foreground bg-secondary px-2.5 py-1 rounded-full">{ex}</span>
              ))}
            </div>
          </div>
        )}

        {fb.analysis.plateaued.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-amber-600 uppercase mb-2">Plateaued</p>
            <div className="flex flex-col gap-1.5">
              {fb.analysis.plateaued.map(p => (
                <div key={p.exercise} className="flex items-start gap-2">
                  <span className="text-xs font-medium text-amber-700 bg-amber-500/10 px-2.5 py-1 rounded-full whitespace-nowrap">{p.exercise}</span>
                  <span className="text-xs text-muted-foreground pt-1">
                    {p.plateau_strategy.action === 'increase_volume' && `Increase to ${p.plateau_strategy.target_sets} sets × ${p.plateau_strategy.target_reps}`}
                    {p.plateau_strategy.action === 'change_tempo' && `Slow the tempo: ${p.plateau_strategy.tempo}`}
                    {p.plateau_strategy.action === 'add_pause' && `Add ${p.plateau_strategy.pause_seconds}s pause at hardest point`}
                    {p.plateau_strategy.action === 'regress_and_rebuild' && `Regress — ${p.plateau_strategy.reason}`}
                    {p.plateau_strategy.action === 'deload' && `Deload for ${p.plateau_strategy.duration_weeks} week`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {fb.analysis.insights.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Key takeaways</p>
            <ul className="flex flex-col gap-1.5">
              {fb.analysis.insights.map((insight, i) => (
                <li key={i} className="text-xs text-muted-foreground flex gap-2">
                  <span className="text-primary mt-0.5 shrink-0">·</span>
                  {insight}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'skills' | 'weekly'

export default function ProgressionPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('skills')
  const [historyMap, setHistoryMap] = useState<Map<string, ExerciseHistory>>(new Map())
  const [progressionLines, setProgressionLines] = useState<ProgressionLine[]>([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [weeklyFeedbacks, setWeeklyFeedbacks] = useState<WeeklyFeedback[]>([])

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
          .limit(20),
      ])

      if (logsResult.data && logsResult.data.length > 0) {
        const map = buildHistoryMap(logsResult.data as LogRow[])
        setHistoryMap(map)

        // Fetch progression lines, using sessionStorage as cache keyed on sorted exercise names
        const uniqueNames = Array.from(map.keys()).sort()
        const cacheKey = `progression-lines:v2:${uniqueNames.join(',')}`
        const cached = sessionStorage.getItem(cacheKey)
        if (cached) {
          setProgressionLines(JSON.parse(cached))
        } else {
          setLinesLoading(true)
          try {
            const res = await fetch('/api/progression-lines', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ exerciseNames: uniqueNames }),
            })
            if (res.ok) {
              const data = await res.json()
              const lines = data.lines ?? []
              setProgressionLines(lines)
              sessionStorage.setItem(cacheKey, JSON.stringify(lines))
            }
          } finally {
            setLinesLoading(false)
          }
        }
      }

      if (feedbackResult.data && feedbackResult.data.length > 0) {
        setWeeklyFeedbacks(feedbackResult.data as WeeklyFeedback[])
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-8 pb-24">

        <div className="mb-6">
          <p className="text-xs font-semibold tracking-widest text-accent uppercase mb-1">Training</p>
          <h1 className="text-2xl font-bold text-foreground">Progression</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-secondary rounded-xl p-1 mb-8">
          <button
            onClick={() => setTab('skills')}
            className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-colors ${
              tab === 'skills'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Skills
          </button>
          <button
            onClick={() => setTab('weekly')}
            className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${
              tab === 'weekly'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Weekly
            {weeklyFeedbacks.length > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                tab === 'weekly' ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground'
              }`}>
                {weeklyFeedbacks.length}
              </span>
            )}
          </button>
        </div>

        {/* ─── Skills tab ─── */}
        {tab === 'skills' && (
          historyMap.size === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground text-sm">No sessions logged yet.</p>
              <p className="text-muted-foreground/70 text-xs mt-1">Accept your plan and start logging sets to track your progression.</p>
            </div>
          ) : linesLoading ? (
            <div className="flex justify-center py-16">
              <svg className="animate-spin w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
          ) : progressionLines.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground text-sm">Could not load progression lines.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {progressionLines.map(line => (
                <ProgressionLineRow key={line.family} line={line} historyMap={historyMap} />
              ))}
            </div>
          )
        )}

        {/* ─── Weekly tab ─── */}
        {tab === 'weekly' && (
          weeklyFeedbacks.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground text-sm">No weekly updates yet.</p>
              <p className="text-muted-foreground/70 text-xs mt-1">Finish a week to see your analysis and plan updates here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              {weeklyFeedbacks.map((fb, i) => (
                <div key={fb.id}>
                  {i > 0 && <div className="h-px bg-border mb-10" />}
                  <WeeklyFeedbackCard fb={fb} />
                </div>
              ))}
            </div>
          )
        )}

      </div>
    </main>
  )
}
