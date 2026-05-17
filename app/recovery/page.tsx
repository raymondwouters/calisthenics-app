'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Exercise } from '@/lib/types'

interface RecoveryResult {
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

// ─── RecoveryExerciseCard ─────────────────────────────────────────────────────

function RecoveryExerciseCard({ exercise }: { exercise: Exercise }) {
  const timed = isTimed(exercise.reps)
  const [setLogs, setSetLogs] = useState<(SetLog | null)[]>(() => Array(exercise.sets).fill(null))
  const [selectedSetIndex, setSelectedSetIndex] = useState<number | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [timer, setTimer] = useState<TimerPhase>({ phase: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Sync slots if exercise.sets changes (shouldn't happen but defensive)
  useEffect(() => {
    setSetLogs(Array(exercise.sets).fill(null))
  }, [exercise.sets])

  // Running timer tick
  useEffect(() => {
    if (timer.phase === 'running') {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - timer.startTime) / 1000))
      }, 200)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [timer])

  // Countdown tick
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

  function commitLog(setIndex: number, log: SetLog) {
    setSetLogs(prev => {
      const next = [...prev]
      next[setIndex] = log
      return next
    })
    setSelectedSetIndex(null)
    setInputValue('')
  }

  function removeLog(setIndex: number) {
    setSetLogs(prev => { const next = [...prev]; next[setIndex] = null; return next })
    setSelectedSetIndex(null)
  }

  function logReps() {
    if (selectedSetIndex === null) return
    const reps = parseInt(inputValue)
    if (isNaN(reps) || reps < 0) return
    commitLog(selectedSetIndex, { reps })
  }

  function stopTimer() {
    if (timer.phase !== 'running') return
    setTimer({ phase: 'logged', value: elapsed, unit: 's', setIndex: timer.setIndex })
  }

  const doneCount = setLogs.filter(l => l !== null).length
  const allDone = doneCount === exercise.sets

  return (
    <div className={`bg-card rounded-xl border p-4 flex flex-col gap-3 transition-colors ${allDone ? 'border-teal-600/40' : 'border-border'}`}>
      {/* Header */}
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

      {/* Set bubbles */}
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

      {/* Context panel */}
      {(selectedSetIndex !== null || timerActive) && (
        <div className="bg-background rounded-2xl px-5 pt-4 pb-5 flex flex-col gap-4">

          {/* Rep input */}
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
                  onKeyDown={e => { if (e.key === 'Enter') logReps(); if (e.key === 'Escape') { setSelectedSetIndex(null); setInputValue('') } }}
                  placeholder="Reps"
                  className="flex-1 bg-secondary border border-border rounded-xl px-3 py-3 text-lg text-foreground text-center focus:outline-none focus:border-teal-600"
                />
                <button
                  onClick={logReps}
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

          {/* Timed — already-logged set tapped */}
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

          {/* Countdown */}
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

          {/* Running */}
          {timer.phase === 'running' && (
            <>
              <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">
                Active · Target: {exercise.reps}
              </p>
              <p className="text-8xl font-black text-foreground text-center leading-none py-2">{elapsed}</p>
              <button
                onClick={stopTimer}
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

          {/* Confirm logged time */}
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
                    commitLog(timer.setIndex, { duration_s: timer.value })
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RecoveryPage() {
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RecoveryResult | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description.trim()) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      })
      if (!res.ok) throw new Error('Failed to generate session')
      const data = await res.json()
      setResult(data)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

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

        {!result ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
        ) : (
          <div className="flex flex-col gap-6">
            <div className="bg-card border border-border rounded-2xl p-5">
              <p className="text-xs font-semibold tracking-widest text-teal-600 uppercase mb-2">Session focus</p>
              <p className="text-sm text-foreground leading-relaxed">{result.intro}</p>
            </div>

            <div className="flex flex-col gap-4">
              {result.exercises.map((ex, i) => (
                <RecoveryExerciseCard key={i} exercise={ex} />
              ))}
            </div>

            <button
              onClick={() => { setResult(null); setDescription('') }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors self-start"
            >
              ← Generate a new session
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
