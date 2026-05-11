'use client'

import { useEffect, useState, useRef } from 'react'
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

// ─── Progression chain node ───────────────────────────────────────────────────

function NodePopover({
  history,
  onClose,
}: {
  history: ExerciseHistory
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const recent = history.sessions.slice(-5)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-20 w-56 bg-card border border-border rounded-xl shadow-lg p-3"
    >
      <p className="text-xs font-semibold text-foreground mb-2">{history.name}</p>

      {recent.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-2">
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
      )}

      <p className="text-xs text-muted-foreground">{formatSets(recent[recent.length - 1].sets)}</p>
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-border" />
    </div>
  )
}

interface ChainNodeProps {
  name: string
  assisted: boolean
  notes?: string
  history: ExerciseHistory | undefined
}

function ChainNode({ name, assisted, notes, history }: ChainNodeProps) {
  const [open, setOpen] = useState(false)
  const logged = !!history

  const dotBase = 'relative flex flex-col items-center gap-1.5 cursor-default'
  const circleBase = 'rounded-full flex items-center justify-center transition-all'

  let circleClass: string
  let labelClass: string

  if (logged && history!.trend === 'up') {
    circleClass = `w-8 h-8 ${circleBase} bg-emerald-500 shadow-sm shadow-emerald-500/30 cursor-pointer`
    labelClass = 'text-[10px] font-semibold text-emerald-600 text-center leading-tight'
  } else if (logged) {
    circleClass = `w-8 h-8 ${circleBase} bg-primary cursor-pointer`
    labelClass = 'text-[10px] font-medium text-foreground text-center leading-tight'
  } else if (assisted) {
    circleClass = `w-6 h-6 ${circleBase} border-2 border-dashed border-border bg-background`
    labelClass = 'text-[9px] text-muted-foreground/60 text-center leading-tight'
  } else {
    circleClass = `w-7 h-7 ${circleBase} border-2 border-border bg-background`
    labelClass = 'text-[10px] text-muted-foreground text-center leading-tight'
  }

  return (
    <div className={dotBase}>
      <div className="relative">
        <button
          className={circleClass}
          onClick={() => logged && setOpen(o => !o)}
          aria-label={name}
        >
          {logged && (
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {!logged && assisted && (
            <span className="text-[9px] text-muted-foreground/50">+</span>
          )}
        </button>
        {open && history && (
          <NodePopover history={history} onClose={() => setOpen(false)} />
        )}
      </div>

      <span className={labelClass} style={{ maxWidth: 64 }}>{name}</span>

      {assisted && notes && (
        <span className="text-[8px] text-muted-foreground/50 text-center leading-tight" style={{ maxWidth: 64 }}>{notes}</span>
      )}
    </div>
  )
}

// ─── Full progression line row ─────────────────────────────────────────────────

function ProgressionLineRow({
  line,
  historyMap,
}: {
  line: ProgressionLine
  historyMap: Map<string, ExerciseHistory>
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Find the rightmost logged node index for initial scroll position
  const lastLoggedIndex = line.nodes.reduce((acc, node, i) => historyMap.has(node.name) ? i : acc, -1)

  useEffect(() => {
    if (scrollRef.current && lastLoggedIndex > 3) {
      const nodeWidth = 96 // approximate px per node
      scrollRef.current.scrollLeft = Math.max(0, (lastLoggedIndex - 2) * nodeWidth)
    }
  }, [lastLoggedIndex])

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase mb-4">{line.family}</p>

      <div ref={scrollRef} className="overflow-x-auto pb-2 -mx-1 px-1">
        <div className="flex items-start gap-0 min-w-max">
          {line.nodes.map((node, i) => {
            const isLast = i === line.nodes.length - 1
            const history = historyMap.get(node.name)
            const nextLogged = !isLast && historyMap.has(line.nodes[i + 1].name)
            const currentLogged = !!history

            return (
              <div key={node.name} className="flex items-center">
                <ChainNode
                  name={node.name}
                  assisted={node.assisted}
                  notes={node.notes}
                  history={history}
                />
                {!isLast && (
                  <div className={`h-px w-6 shrink-0 mt-[-20px] ${
                    currentLogged && nextLogged
                      ? 'bg-primary'
                      : 'bg-border'
                  }`} />
                )}
              </div>
            )
          })}
        </div>
      </div>
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
        const cacheKey = `progression-lines:${uniqueNames.join(',')}`
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
            <div className="flex flex-col gap-10">
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
