'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Exercise } from '@/lib/types'
import { SavedRecoverySession } from '@/app/api/recovery-sessions/route'

interface RecoveryResult {
  title: string
  intro: string
  exercises: Exercise[]
}

interface SetLog {
  reps?: number
  duration_s?: number
}

type TimerPhase =
  | { phase: 'idle' }
  | { phase: 'countdown'; count: number; setIndex: number }
  | { phase: 'running'; startTime: number; setIndex: number }
  | { phase: 'logged'; value: number; unit: 's' | 'reps'; setIndex: number }

function isTimed(reps: string) {
  return /\d+\s*(s|sec|seconds?)\b/i.test(reps)
}

function setLogDisplay(log: SetLog): string {
  if (log.duration_s !== undefined) return `${log.duration_s}s`
  if (log.reps !== undefined) return String(log.reps)
  return '✓'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── RestTimerOverlay ─────────────────────────────────────────────────────────

function RestTimerOverlay({ remaining, total, nextExercise, onDismiss, onMinimize }: {
  remaining: number
  total: number
  nextExercise: Exercise | null
  onDismiss: () => void
  onMinimize: () => void
}) {
  const circumference = 2 * Math.PI * 56
  const progress = total > 0 ? remaining / total : 0
  const strokeDashoffset = circumference * (1 - progress)

  return (
    <div className="fixed inset-0 z-50 bg-background/96 backdrop-blur-sm flex flex-col items-center justify-center px-5">
      <button
        onClick={onMinimize}
        aria-label="Minimize"
        className="absolute top-5 right-5 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-10">Rest</p>
      <div className="relative w-44 h-44 flex items-center justify-center mb-10">
        <svg className="w-full h-full -rotate-90 absolute inset-0" viewBox="0 0 128 128">
          <circle cx="64" cy="64" r="56" fill="none" stroke="currentColor" strokeWidth="4" className="text-secondary" />
          <circle
            cx="64" cy="64" r="56"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className="text-primary transition-all duration-1000"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <p className="text-7xl font-black text-foreground leading-none relative z-10">{remaining}</p>
      </div>
      {nextExercise && (
        <div className="w-full max-w-xs bg-card border border-border rounded-2xl px-5 py-4 mb-6">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-2">Next up</p>
          <p className="text-base font-bold text-foreground">{nextExercise.name}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{nextExercise.sets} sets · {nextExercise.reps}</p>
          {nextExercise.notes && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed border-t border-border pt-2">{nextExercise.notes}</p>
          )}
        </div>
      )}
      <button
        onClick={onDismiss}
        className="px-8 py-3 rounded-full border border-border text-foreground/80 text-sm font-semibold hover:border-foreground/40 hover:text-foreground transition-colors"
      >
        Skip rest
      </button>
    </div>
  )
}

// ─── RestTimerMini ─────────────────────────────────────────────────────────────

function RestTimerMini({ remaining, total, onExpand, onDismiss }: {
  remaining: number
  total: number
  onExpand: () => void
  onDismiss: () => void
}) {
  const r = 18
  const circumference = 2 * Math.PI * r
  const progress = total > 0 ? remaining / total : 0
  const strokeDashoffset = circumference * (1 - progress)

  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-card border border-border rounded-2xl px-3 py-2.5 shadow-2xl">
      <button onClick={onExpand} className="flex items-center gap-2.5">
        <div className="relative w-9 h-9 flex items-center justify-center shrink-0">
          <svg className="w-full h-full -rotate-90 absolute inset-0" viewBox="0 0 44 44">
            <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-border" />
            <circle
              cx="22" cy="22" r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="text-primary transition-all duration-1000"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
            />
          </svg>
          <p className="text-xs font-bold text-foreground relative z-10">{remaining}</p>
        </div>
        <span className="text-sm font-semibold text-foreground/80">Rest</span>
      </button>
      <button
        onClick={onDismiss}
        aria-label="Skip rest"
        className="ml-1 p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ─── RecoveryExerciseCard ─────────────────────────────────────────────────────

function RecoveryExerciseCard({
  exercise,
  onSetLogged,
}: {
  exercise: Exercise
  onSetLogged: (restSeconds: number, nextExercise: Exercise | null) => void
}) {
  const timed = isTimed(exercise.reps)
  const [setLogs, setSetLogs] = useState<(SetLog | null)[]>(() => Array(exercise.sets).fill(null))
  const [selectedSetIndex, setSelectedSetIndex] = useState<number | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [timer, setTimer] = useState<TimerPhase>({ phase: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setSetLogs(Array(exercise.sets).fill(null))
  }, [exercise.sets])

  useEffect(() => {
    if (timer.phase === 'running') {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - timer.startTime) / 1000))
      }, 200)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [timer])

  useEffect(() => {
    if (timer.phase !== 'countdown') return
    if (timer.count === 0) {
      setTimer({ phase: 'running', startTime: Date.now(), setIndex: timer.setIndex })
      setElapsed(0)
      return
    }
    const t = setTimeout(() => {
      setTimer(prev => prev.phase === 'countdown' ? { ...prev, count: prev.count - 1 } : prev)
    }, 1000)
    return () => clearTimeout(t)
  }, [timer])

  const focusRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
    el?.focus()
  }, [])

  const timerActive = timer.phase !== 'idle'
  const activeTimerSet = (timer.phase === 'countdown' || timer.phase === 'running' || timer.phase === 'logged')
    ? timer.setIndex : -1

  function openSet(i: number) {
    if (timerActive) return
    setSelectedSetIndex(prev => prev === i ? null : i)
    setInputValue(setLogs[i]?.reps !== undefined ? String(setLogs[i]!.reps) : '')
  }

  function commitLog(setIndex: number, log: SetLog, nextEx: Exercise | null) {
    setSetLogs(prev => {
      const next = [...prev]
      next[setIndex] = log
      const allDone = next.every(l => l !== null)
      if (exercise.rest_seconds > 0) {
        onSetLogged(exercise.rest_seconds, allDone ? nextEx : null)
      }
      return next
    })
    setSelectedSetIndex(null)
    setInputValue('')
  }

  function removeLog(setIndex: number) {
    setSetLogs(prev => { const next = [...prev]; next[setIndex] = null; return next })
    setSelectedSetIndex(null)
  }

  function logReps(nextEx: Exercise | null) {
    if (selectedSetIndex === null) return
    const reps = parseInt(inputValue)
    if (isNaN(reps) || reps < 0) return
    commitLog(selectedSetIndex, { reps }, nextEx)
  }

  function stopTimer(nextEx: Exercise | null) {
    if (timer.phase !== 'running') return
    setTimer({ phase: 'logged', value: elapsed, unit: 's', setIndex: timer.setIndex })
    void nextEx
  }

  const doneCount = setLogs.filter(l => l !== null).length
  const allDone = doneCount === exercise.sets

  return (
    <div className={`bg-card rounded-xl border p-4 flex flex-col gap-3 transition-colors ${allDone ? 'border-teal-600/40' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`font-semibold leading-tight ${allDone ? 'text-teal-600' : 'text-foreground'}`}>{exercise.name}</p>
        {allDone && (
          <svg className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span><span className="text-foreground font-medium">{exercise.sets}</span> sets</span>
        <span><span className="text-foreground font-medium">{exercise.reps}</span>{!timed && ' reps'}</span>
        {exercise.rest_seconds > 0 && (
          <span><span className="text-foreground font-medium">{exercise.rest_seconds}s</span> rest</span>
        )}
      </div>

      {exercise.notes && (
        <p className="text-xs text-muted-foreground leading-relaxed">{exercise.notes}</p>
      )}

      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${exercise.sets}, 1fr)` }}>
        {Array.from({ length: exercise.sets }).map((_, i) => {
          const isRunningThis = activeTimerSet === i
          const isSelected = selectedSetIndex === i && !timerActive
          const log = setLogs[i]
          const isDone = log !== null

          return (
            <button
              key={i}
              onClick={() => timed && !isDone ? setTimer({ phase: 'countdown', count: 3, setIndex: i }) : openSet(i)}
              disabled={timerActive && !isRunningThis}
              className={`rounded-xl border py-2.5 transition-all disabled:cursor-default text-sm font-semibold ${
                isRunningThis
                  ? 'bg-teal-600 border-teal-600 text-white'
                  : isDone
                  ? 'bg-teal-600/15 border-teal-600/40 text-teal-600'
                  : isSelected
                  ? 'border-foreground/20 bg-background text-foreground'
                  : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {isDone || isRunningThis ? (
                <div className="flex flex-col items-center leading-none gap-0.5">
                  <span className="text-[10px] font-semibold uppercase opacity-60">S{i + 1}</span>
                  <span>{isRunningThis ? `${elapsed}s` : setLogDisplay(log!)}</span>
                </div>
              ) : (
                `Set ${i + 1}`
              )}
            </button>
          )
        })}
      </div>

      {(selectedSetIndex !== null || timerActive) && (
        <div className="bg-background rounded-2xl px-5 pt-4 pb-5 flex flex-col gap-4">

          {timer.phase === 'idle' && !timed && selectedSetIndex !== null && (
            <>
              <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">Set {selectedSetIndex + 1}</p>
              <div className="flex items-center gap-3">
                <input
                  ref={focusRef}
                  type="number"
                  min={0}
                  max={9999}
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') logReps(null); if (e.key === 'Escape') { setSelectedSetIndex(null); setInputValue('') } }}
                  placeholder="Reps"
                  className="flex-1 bg-secondary border border-border rounded-xl px-3 py-3 text-lg text-foreground text-center focus:outline-none focus:border-teal-600"
                />
                <button
                  onClick={() => logReps(null)}
                  className="px-5 py-3 rounded-full bg-teal-600 text-white font-bold text-sm"
                >
                  {setLogs[selectedSetIndex] !== null ? 'Update' : 'Log'}
                </button>
              </div>
              {setLogs[selectedSetIndex] !== null && (
                <button
                  onClick={() => removeLog(selectedSetIndex)}
                  className="text-xs text-muted-foreground hover:text-red-400 transition-colors self-center"
                >
                  Remove set
                </button>
              )}
            </>
          )}

          {timer.phase === 'idle' && timed && selectedSetIndex !== null && setLogs[selectedSetIndex] !== null && (
            <>
              <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">Set {selectedSetIndex + 1} · Logged</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setTimer({ phase: 'countdown', count: 3, setIndex: selectedSetIndex })}
                  className="flex-1 py-3 rounded-full bg-secondary text-foreground/80 font-semibold text-sm uppercase tracking-wide"
                >
                  Redo
                </button>
                <button
                  onClick={() => removeLog(selectedSetIndex)}
                  className="px-5 py-3 rounded-full border border-border text-muted-foreground font-semibold text-sm uppercase tracking-wide hover:border-red-500/50 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
              </div>
            </>
          )}

          {timer.phase === 'countdown' && (
            <>
              <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">Get ready…</p>
              <p className="text-8xl font-black text-teal-600 text-center leading-none py-2">
                {timer.count === 0 ? 'GO' : timer.count}
              </p>
              <button
                onClick={() => setTimer({ phase: 'idle' })}
                className="px-6 py-2.5 rounded-full border border-border text-foreground/80 text-sm font-medium self-center"
              >
                Cancel
              </button>
            </>
          )}

          {timer.phase === 'running' && (
            <>
              <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">
                Active · Target: {exercise.reps}
              </p>
              <p className="text-8xl font-black text-foreground text-center leading-none py-2">{elapsed}</p>
              <button
                onClick={() => stopTimer(null)}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full bg-foreground text-background font-semibold text-sm"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" fill="currentColor" />
                  <rect x="9" y="9" width="6" height="6" fill="currentColor" className="text-background" rx="1" />
                </svg>
                Stop & log
              </button>
              <button
                onClick={() => setTimer({ phase: 'idle' })}
                className="px-6 py-2 rounded-full border border-border text-foreground/80 text-sm font-medium self-center"
              >
                Cancel
              </button>
            </>
          )}

          {timer.phase === 'logged' && (
            <>
              <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">Logged</p>
              <p className="text-8xl font-black text-teal-600 text-center leading-none py-2">
                {timer.value}{timer.unit}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setTimer({ phase: 'idle' }); setSelectedSetIndex(null) }}
                  className="flex-1 text-muted-foreground font-semibold text-xs uppercase tracking-widest py-3 text-center"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    commitLog(timer.setIndex, { duration_s: timer.value }, null)
                    setTimer({ phase: 'idle' })
                  }}
                  className="flex-1 py-3 rounded-full bg-teal-600 text-white font-bold text-sm uppercase tracking-wide"
                >
                  Log {timer.value}s
                </button>
              </div>
            </>
          )}

        </div>
      )}
    </div>
  )
}

// ─── WorkoutView ──────────────────────────────────────────────────────────────

function WorkoutView({
  title,
  intro,
  exercises,
  onBack,
  onSave,
  saving,
  saved,
}: {
  title: string
  intro: string
  exercises: Exercise[]
  onBack: () => void
  onSave?: () => void
  saving?: boolean
  saved?: boolean
}) {
  const [restTimer, setRestTimer] = useState<{ remaining: number; total: number; minimized: boolean; nextExercise: Exercise | null } | null>(null)

  useEffect(() => {
    if (!restTimer) return
    if (restTimer.remaining <= 0) { setRestTimer(null); return }
    const t = setInterval(() => {
      setRestTimer(prev => {
        if (!prev) return null
        const next = prev.remaining - 1
        return next <= 0 ? null : { ...prev, remaining: next }
      })
    }, 1000)
    return () => clearInterval(t)
  }, [restTimer])

  function handleSetLogged(restSeconds: number, nextExercise: Exercise | null) {
    if (restSeconds > 0) {
      setRestTimer({ remaining: restSeconds, total: restSeconds, minimized: false, nextExercise })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-card border border-border rounded-2xl p-5">
        <p className="text-xs font-semibold tracking-widest text-teal-600 uppercase mb-1">{title}</p>
        <p className="text-sm text-foreground leading-relaxed">{intro}</p>
      </div>

      <div className="flex flex-col gap-4">
        {exercises.map((ex, i) => (
          <RecoveryExerciseCard
            key={i}
            exercise={ex}
            onSetLogged={(restSeconds, nextEx) => handleSetLogged(restSeconds, nextEx)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </button>
        {onSave && !saved && (
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-sm font-medium text-foreground/80 hover:border-teal-600/50 hover:text-teal-600 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5h11l3 3v11a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 21v-6h6v6M9 5v4h6V5" />
                </svg>
                Save session
              </>
            )}
          </button>
        )}
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-teal-600 font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Saved
          </span>
        )}
      </div>

      {restTimer && !restTimer.minimized && (
        <RestTimerOverlay
          remaining={restTimer.remaining}
          total={restTimer.total}
          nextExercise={restTimer.nextExercise}
          onDismiss={() => setRestTimer(null)}
          onMinimize={() => setRestTimer(prev => prev ? { ...prev, minimized: true } : null)}
        />
      )}
      {restTimer && restTimer.minimized && (
        <RestTimerMini
          remaining={restTimer.remaining}
          total={restTimer.total}
          onExpand={() => setRestTimer(prev => prev ? { ...prev, minimized: false } : null)}
          onDismiss={() => setRestTimer(null)}
        />
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type View =
  | { type: 'list' }
  | { type: 'new-result'; result: RecoveryResult }
  | { type: 'saved'; session: SavedRecoverySession }

export default function RecoveryPage() {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>({ type: 'list' })

  const [savedSessions, setSavedSessions] = useState<SavedRecoverySession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)

  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/recovery-sessions')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setSavedSessions(data) })
      .finally(() => setSessionsLoading(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      })
      if (!res.ok) throw new Error('Failed to generate session')
      const data = await res.json()
      setSavedId(null)
      setView({ type: 'new-result', result: data })
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (view.type !== 'new-result') return
    setSaving(true)
    try {
      const res = await fetch('/api/recovery-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: view.result.title,
          intro: view.result.intro,
          exercises: view.result.exercises,
        }),
      })
      if (!res.ok) throw new Error()
      const saved: SavedRecoverySession = await res.json()
      setSavedSessions(prev => [saved, ...prev])
      setSavedId(saved.id)
    } catch {
      // silently fail — user can retry
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await fetch(`/api/recovery-sessions?id=${id}`, { method: 'DELETE' })
      setSavedSessions(prev => prev.filter(s => s.id !== id))
      if (view.type === 'saved' && view.session.id === id) {
        setView({ type: 'list' })
      }
    } finally {
      setDeletingId(null)
    }
  }

  // ── New result view ──
  if (view.type === 'new-result') {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="max-w-2xl mx-auto w-full px-5 sm:px-8 pt-10 pb-20">
          <WorkoutView
            title={view.result.title}
            intro={view.result.intro}
            exercises={view.result.exercises}
            onBack={() => { setView({ type: 'list' }); setDescription('') }}
            onSave={savedId ? undefined : handleSave}
            saving={saving}
            saved={!!savedId}
          />
        </div>
      </main>
    )
  }

  // ── Saved session view ──
  if (view.type === 'saved') {
    const session = view.session
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="max-w-2xl mx-auto w-full px-5 sm:px-8 pt-10 pb-20">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-xs font-semibold tracking-widest text-teal-600 uppercase mb-1">Recovery</p>
              <h1 className="text-2xl font-bold text-foreground">{session.title}</h1>
              <p className="text-xs text-muted-foreground mt-1">{formatDate(session.created_at)}</p>
            </div>
            <button
              onClick={() => handleDelete(session.id)}
              disabled={deletingId === session.id}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-border text-xs font-medium text-muted-foreground hover:border-red-500/40 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              {deletingId === session.id ? (
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
              Remove
            </button>
          </div>
          <WorkoutView
            title={session.title}
            intro={session.intro}
            exercises={session.exercises}
            onBack={() => setView({ type: 'list' })}
          />
        </div>
      </main>
    )
  }

  // ── List view ──
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto w-full px-5 sm:px-8 pt-10 pb-20">

        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest text-teal-600 uppercase mb-1">Recovery</p>
          <h1 className="text-3xl font-bold text-foreground">What&apos;s bothering you?</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Describe your injury, stiffness, or area of fatigue and we&apos;ll build a targeted session to help.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 mb-10">
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Tight hamstrings and lower back stiffness after sitting all day… or sore shoulders from last week's push session…"
            rows={4}
            className="bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-teal-600/50 focus-visible:border-teal-600 resize-none"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <Button
            type="submit"
            disabled={!description.trim() || loading}
            className="w-full h-12 text-base font-bold bg-teal-600 hover:bg-teal-600/90 text-white"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Building your session…
              </span>
            ) : 'Build recovery session →'}
          </Button>
        </form>

        {/* Saved sessions */}
        {!sessionsLoading && savedSessions.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Saved sessions</p>
            {savedSessions.map(session => (
              <div
                key={session.id}
                className="bg-card border border-border rounded-2xl p-4 flex items-start gap-3 group"
              >
                <button
                  onClick={() => setView({ type: 'saved', session })}
                  className="flex-1 text-left"
                >
                  <p className="font-semibold text-foreground group-hover:text-teal-600 transition-colors">{session.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{session.intro}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1.5">{formatDate(session.created_at)}</p>
                </button>
                <button
                  onClick={() => handleDelete(session.id)}
                  disabled={deletingId === session.id}
                  aria-label="Remove session"
                  className="shrink-0 p-1.5 rounded-lg text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40 mt-0.5"
                >
                  {deletingId === session.id ? (
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}

        {sessionsLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading saved sessions…
          </div>
        )}

      </div>
    </main>
  )
}
