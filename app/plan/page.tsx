'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlanResponse, Session, Block, Exercise, SetLog, ExerciseLog, GenerateRequest } from '@/lib/types'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

// ─── Constants ────────────────────────────────────────────────────────────────

const BLOCK_LABELS: Record<string, string> = {
  warmup: 'Warm-up',
  skill: 'Skill Practice',
  strength: 'Strength',
  accessory: 'Accessories',
  core: 'Core',
  cooldown: 'Cooldown',
  stretch: 'Stretch',
}

const BLOCK_COLORS: Record<string, string> = {
  warmup: 'text-amber-600',
  skill: 'text-violet-600',
  strength: 'text-primary',
  accessory: 'text-blue-600',
  core: 'text-emerald-600',
  cooldown: 'text-muted-foreground',
  stretch: 'text-teal-600',
}

const FEEDBACK_PLACEHOLDERS = [
  'The push-ups feel too easy, swap for something harder…',
  'My wrists hurt during ring dips…',
  'I want more pulling work in my sessions…',
  'Ready to try a harder progression on squats…',
  'I completed all sets easily this week…',
]

const DAY_ABBR: Record<string, string> = {
  Monday: 'MA',
  Tuesday: 'DI',
  Wednesday: 'WO',
  Thursday: 'DO',
  Friday: 'VR',
  Saturday: 'ZA',
  Sunday: 'ZO',
}

const EQUIPMENT_LABELS: Record<string, string> = {
  'pull-up bar': 'Pull-up bar',
  'resistance bands': 'Bands',
  'rings': 'Rings',
  'parallettes': 'Parallettes',
  'barbell & plates': 'Barbell',
  'full gym access': 'Full gym',
}

const FINISH_MESSAGES = [
  "That's how it's done.",
  "Another session in the books.",
  "You showed up. That's everything.",
  "Strong session.",
  "Progress made.",
  "Keep stacking sessions like this.",
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function youtubeUrl(exerciseName: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(exerciseName + ' calisthenics tutorial')}`
}

function isTimed(reps: string) {
  return /\d+\s*(s|sec|seconds?)\b/i.test(reps)
}

function parseTargetReps(reps: string): number | null {
  const rangeMatch = reps.match(/(\d+)-(\d+)/)
  if (rangeMatch) return parseInt(rangeMatch[2])
  const singleMatch = reps.match(/^(\d+)$/)
  if (singleMatch) return parseInt(singleMatch[1])
  return null
}

function isAtTarget(exercise: Exercise, logs: (SetLog | null)[]): boolean {
  if (logs.length < exercise.sets) return false
  if (logs.some(l => l === null)) return false
  const target = parseTargetReps(exercise.reps)
  if (target === null) {
    return logs.every(l => l !== null && (l.reps !== undefined || l.duration_s !== undefined))
  }
  return logs.every(l => l !== null && l.reps !== undefined && l.reps >= target)
}

function estimateDuration(session: Session): number {
  let totalSeconds = 0
  for (const block of session.blocks) {
    for (const ex of block.exercises) {
      const secMatch = ex.reps.match(/(\d+)\s*s/i)
      const setTime = secMatch ? parseInt(secMatch[1]) : 35
      totalSeconds += ex.sets * (setTime + ex.rest_seconds)
    }
  }
  const minutes = Math.round(totalSeconds / 60)
  return Math.max(5, Math.round(minutes / 5) * 5)
}

function getCurrentWeekRange(): { start: Date; end: Date } {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { start: monday, end: sunday }
}

function getTodayDayName(): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()]
}

function getInitialActiveDay(sessions: Session[]): number {
  const today = getTodayDayName()
  const todayIdx = sessions.findIndex(s => s.day === today)
  if (todayIdx === -1) return 0
  if (sessions[todayIdx].type !== 'rest') return todayIdx
  for (let i = 1; i <= 6; i++) {
    const idx = (todayIdx + i) % sessions.length
    if (sessions[idx].type !== 'rest') return idx
  }
  return 0
}

function getWeekNumber(planCreatedAt: Date): number {
  const { start: currentWeekStart } = getCurrentWeekRange()
  const d = planCreatedAt.getDay()
  const offset = d === 0 ? -6 : 1 - d
  const planWeekStart = new Date(planCreatedAt)
  planWeekStart.setDate(planCreatedAt.getDate() + offset)
  planWeekStart.setHours(0, 0, 0, 0)
  return Math.floor((currentWeekStart.getTime() - planWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1
}

function formatPrevLog(log: SetLog): string {
  if (log.duration_s !== undefined) return `${log.duration_s}s`
  if (log.reps !== undefined) {
    if (log.weight_kg) return `${log.reps}×${log.weight_kg}kg`
    return String(log.reps)
  }
  return '✓'
}

// ─── RestTimerOverlay ─────────────────────────────────────────────────────────

interface RestTimerOverlayProps {
  remaining: number
  total: number
  onDismiss: () => void
  onMinimize: () => void
}

function RestTimerOverlay({ remaining, total, onDismiss, onMinimize }: RestTimerOverlayProps) {
  const circumference = 2 * Math.PI * 56
  const progress = total > 0 ? remaining / total : 0
  const strokeDashoffset = circumference * (1 - progress)

  return (
    <div className="fixed inset-0 z-50 bg-background/96 backdrop-blur-sm flex flex-col items-center justify-center">
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
      <button
        onClick={onDismiss}
        className="px-8 py-3 rounded-full border border-border text-foreground/80 text-sm font-semibold hover:border-foreground/40 hover:text-foreground transition-colors"
      >
        Skip rest
      </button>
    </div>
  )
}

// ─── RestTimerMini ────────────────────────────────────────────────────────────

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
    <div className="fixed bottom-6 right-5 z-50 flex items-center gap-2 bg-card border border-border rounded-2xl px-3 py-2.5 shadow-2xl">
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

// ─── FinishWorkoutOverlay ─────────────────────────────────────────────────────

interface FinishWorkoutOverlayProps {
  displayName: string | null
  setsLogged: number
  exercisesLogged: number
  onClose: () => void
}

function FinishWorkoutOverlay({ displayName, setsLogged, exercisesLogged, onClose }: FinishWorkoutOverlayProps) {
  const [message] = useState(() => FINISH_MESSAGES[Math.floor(Math.random() * FINISH_MESSAGES.length)])
  const firstName = displayName ? displayName.split('@')[0].split(' ')[0] : null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-card border-t border-border rounded-t-3xl px-6 pt-6 pb-12 flex flex-col items-center gap-5">
        <div className="w-10 h-1 bg-border rounded-full mb-1" />
        <div className="text-center">
          <p className="text-3xl font-black text-foreground leading-tight">
            {firstName ? `Great session, ${firstName}!` : 'Great session!'}
          </p>
          <p className="text-muted-foreground mt-2 text-base">{message}</p>
        </div>
        {setsLogged > 0 && (
          <div className="flex gap-8 py-4 border-t border-b border-border w-full justify-center">
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{setsLogged}</p>
              <p className="text-xs text-muted-foreground mt-0.5">sets logged</p>
            </div>
            <div className="w-px bg-border" />
            <div className="text-center">
              <p className="text-2xl font-bold text-primary">{exercisesLogged}</p>
              <p className="text-xs text-muted-foreground mt-0.5">exercises</p>
            </div>
          </div>
        )}
        <Button
          onClick={onClose}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base h-12"
        >
          Done
        </Button>
      </div>
    </div>
  )
}

// ─── AnimatedPlaceholder ──────────────────────────────────────────────────────

function AnimatedPlaceholder({ visible }: { visible: boolean }) {
  const [index, setIndex] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true)
      setTimeout(() => {
        setIndex(i => (i + 1) % FEEDBACK_PLACEHOLDERS.length)
        setFading(false)
      }, 300)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  if (!visible) return null
  return (
    <span
      className={`pointer-events-none absolute left-4 top-3.5 text-sm text-muted-foreground transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-100'}`}
    >
      {FEEDBACK_PLACEHOLDERS[index]}
    </span>
  )
}

// ─── ExerciseCard ─────────────────────────────────────────────────────────────

type TimerPhase =
  | { phase: 'idle' }
  | { phase: 'countdown'; count: number; setIndex: number }
  | { phase: 'running'; startTime: number; setIndex: number }
  | { phase: 'logged'; value: number; unit: 's' | 'reps'; setIndex: number }

interface ExerciseCardProps {
  exercise: Exercise
  level: string
  equipment: string[]
  goal: string
  sessionDay: string
  planId: string | null
  userId: string | null
  initialLogs: SetLog[]
  prevSetsData?: SetLog[]
  onReplace: (updated: Exercise) => void
  onLogsChange: (logs: SetLog[]) => void
  onSetLogged: (restSeconds: number) => void
  isPreview: boolean
}

function ExerciseCard({
  exercise,
  level,
  equipment,
  goal,
  sessionDay,
  planId,
  userId,
  initialLogs,
  prevSetsData,
  onReplace,
  onLogsChange,
  onSetLogged,
  isPreview,
}: ExerciseCardProps) {
  const [adjusting, setAdjusting] = useState<'regression' | 'progression' | null>(null)
  const [limitMessage, setLimitMessage] = useState('')

  const [setLogs, setSetLogs] = useState<(SetLog | null)[]>(() => {
    const arr: (SetLog | null)[] = Array(exercise.sets).fill(null)
    initialLogs.forEach((log, i) => { if (i < exercise.sets) arr[i] = log })
    return arr
  })
  const [selectedSetIndex, setSelectedSetIndex] = useState<number | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [weightValue, setWeightValue] = useState('')
  const [timer, setTimer] = useState<TimerPhase>({ phase: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const timed = isTimed(exercise.reps)
  const atTarget = isAtTarget(exercise, setLogs)

  useEffect(() => {
    if (timer.phase === 'running') {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - timer.startTime) / 1000))
      }, 200)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
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

  useEffect(() => {
    if (selectedSetIndex !== null && (!timed || showManual)) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [selectedSetIndex, showManual, timed])

  function openSet(i: number) {
    if (timerActive) return
    if (selectedSetIndex === i) {
      setSelectedSetIndex(null)
    } else {
      setSelectedSetIndex(i)
      setShowManual(false)
      const existing = setLogs[i]
      if (existing) {
        setInputValue(existing.duration_s !== undefined ? String(existing.duration_s) : existing.reps !== undefined ? String(existing.reps) : '')
        setWeightValue(existing.weight_kg !== undefined ? String(existing.weight_kg) : '')
      } else {
        setInputValue('')
        setWeightValue('')
      }
    }
  }

  function removeLog(setIndex: number) {
    const updated = [...setLogs]
    updated[setIndex] = null
    setSetLogs(updated)
    const filledLogs = updated.filter((l): l is SetLog => l !== null)
    onLogsChange(filledLogs)
    closePanel()
  }

  function closePanel() {
    setSelectedSetIndex(null)
    setShowManual(false)
    setInputValue('')
    setWeightValue('')
  }

  function logReps() {
    if (selectedSetIndex === null) return
    const reps = parseInt(inputValue)
    if (isNaN(reps) || reps < 0) return
    const log: SetLog = { reps }
    const w = parseFloat(weightValue)
    if (!isNaN(w) && w > 0) log.weight_kg = w
    commitLog(selectedSetIndex, log)
    closePanel()
  }

  function setLogDisplay(log: SetLog): string {
    if (log.duration_s !== undefined) return `${log.duration_s}s`
    if (log.reps !== undefined) {
      if (log.weight_kg) return `${log.reps}·${log.weight_kg}kg`
      return String(log.reps)
    }
    return '✓'
  }

  function logManualSeconds() {
    if (selectedSetIndex === null) return
    const seconds = parseInt(inputValue)
    if (isNaN(seconds) || seconds < 0) return
    commitLog(selectedSetIndex, { duration_s: seconds })
    closePanel()
  }

  function stopTimer() {
    if (timer.phase !== 'running') return
    const setIndex = timer.setIndex
    setTimer({ phase: 'logged', value: elapsed, unit: 's', setIndex })
  }

  function commitLog(setIndex: number, log: SetLog) {
    const updated = [...setLogs]
    updated[setIndex] = log
    setSetLogs(updated)

    const filledLogs = updated.filter((l): l is SetLog => l !== null)
    onLogsChange(filledLogs)

    if (exercise.rest_seconds > 0) {
      onSetLogged(exercise.rest_seconds)
    }

    if (planId && userId) {
      const supabase = createSupabaseBrowser()
      supabase.from('exercise_logs').insert({
        user_id: userId,
        plan_id: planId,
        session_day: sessionDay,
        exercise_name: exercise.name,
        sets_data: filledLogs,
      }).then(({ error }) => {
        if (error) console.error('Log save error:', error.message)
      })
    }
  }

  const adjust = async (direction: 'regression' | 'progression') => {
    setAdjusting(direction)
    setLimitMessage('')
    try {
      const res = await fetch('/api/adjust-exercise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseName: exercise.name, direction, level, equipment, goal }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.at_limit) {
        setLimitMessage(data.notes)
      } else {
        onReplace(data)
        setSetLogs(Array(data.sets).fill(null))
        closePanel()
        onLogsChange([])
      }
    } catch {
      setLimitMessage('Could not adjust exercise. Try again.')
    } finally {
      setAdjusting(null)
    }
  }

  const activeTimerSet = (timer.phase === 'countdown' || timer.phase === 'running' || timer.phase === 'logged')
    ? timer.setIndex : -1
  const timerActive = timer.phase !== 'idle'

  return (
    <div className={`bg-card rounded-xl p-4 flex flex-col gap-2 transition-all ${atTarget ? 'ring-1 ring-green-400/60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <p className="font-semibold text-foreground leading-tight">{exercise.name}</p>
          {atTarget && (
            <span className="shrink-0 text-xs text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-md font-medium">✓ Goal hit</span>
          )}
        </div>
        <a
          href={youtubeUrl(exercise.name)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 flex items-center gap-1 text-xs text-red-400 hover:text-red-300 bg-red-400/10 px-2 py-1 rounded-lg transition-colors"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
          Watch
        </a>
      </div>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <span><span className="text-foreground font-medium">{exercise.sets}</span> sets</span>
        <span><span className="text-foreground font-medium">{exercise.reps}</span>{!timed && ' reps'}</span>
        <span><span className="text-foreground font-medium">{exercise.rest_seconds}s</span> rest</span>
      </div>

      {prevSetsData && prevSetsData.length > 0 && (
        <p className="text-xs text-muted-foreground/70">
          Last: {prevSetsData.map(formatPrevLog).join(' · ')}
        </p>
      )}

      {exercise.notes && (
        <p className="text-xs text-muted-foreground leading-relaxed">{exercise.notes}</p>
      )}


      {/* Rep logger — hidden in preview mode */}
      {!isPreview && (
        <div className="flex flex-col gap-2 pt-1">

          {/* Set buttons row */}
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${exercise.sets}, 1fr)` }}>
            {Array.from({ length: exercise.sets }).map((_, i) => {
              const isRunningThis = activeTimerSet === i
              const isSelected = selectedSetIndex === i && !timerActive
              const log = setLogs[i]
              const isDone = log !== null
              return (
                <button
                  key={i}
                  onClick={() => openSet(i)}
                  disabled={timerActive}
                  className={`rounded-xl border transition-all disabled:cursor-default ${
                    isRunningThis
                      ? 'bg-primary border-primary text-primary-foreground py-2'
                      : isDone
                      ? 'bg-primary border-primary text-primary-foreground py-2'
                      : isSelected
                      ? 'border-foreground/20 bg-background text-foreground py-2.5'
                      : 'border-border bg-card text-muted-foreground py-2.5'
                  }`}
                >
                  {isDone || isRunningThis ? (
                    <div className="flex flex-col items-center leading-none gap-0.5">
                      <span className="text-[10px] font-semibold uppercase opacity-70">S{i + 1}</span>
                      <span className="text-sm font-bold">
                        {isRunningThis ? `${elapsed}s` : setLogDisplay(log!)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm font-semibold">Set {i + 1}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Context panel */}
          {(selectedSetIndex !== null || timerActive) && (
            <div className="bg-background rounded-2xl px-5 pt-4 pb-5 flex flex-col gap-4">

              {/* idle + timed: start timer or manual */}
              {timer.phase === 'idle' && timed && !showManual && (
                <>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">
                    Set {(selectedSetIndex ?? 0) + 1} · Target: {exercise.reps}
                  </p>
                  {setLogs[selectedSetIndex!] !== null ? (
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowManual(true)}
                        className="flex-1 py-3 rounded-full bg-secondary text-foreground/80 font-semibold text-sm uppercase tracking-wide"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => removeLog(selectedSetIndex!)}
                        className="px-5 py-3 rounded-full border border-border text-muted-foreground font-semibold text-sm uppercase tracking-wide hover:border-red-500/50 hover:text-red-400 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => setTimer({ phase: 'countdown', count: 3, setIndex: selectedSetIndex! })}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-primary text-primary-foreground font-semibold text-sm uppercase tracking-wide"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10"/><path strokeLinecap="round" d="M12 6v6l4 2"/>
                        </svg>
                        Start timer
                      </button>
                      <button
                        onClick={() => { setInputValue(''); setShowManual(true) }}
                        className="px-5 py-3 rounded-full bg-secondary text-foreground/80 font-semibold text-sm uppercase tracking-wide"
                      >
                        Manual
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* idle + timed + manual input */}
              {timer.phase === 'idle' && timed && showManual && (
                <>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">
                    Set {(selectedSetIndex ?? 0) + 1} · Target: {exercise.reps}
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      ref={inputRef}
                      type="number"
                      min={0}
                      max={9999}
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') logManualSeconds(); if (e.key === 'Escape') setShowManual(false) }}
                      placeholder="seconds"
                      className="flex-1 bg-secondary border border-border rounded-xl px-4 py-3 text-lg text-foreground text-center focus:outline-none focus:border-primary"
                    />
                    <button onClick={logManualSeconds} className="px-5 py-3 rounded-full bg-primary text-primary-foreground font-bold text-sm">
                      {setLogs[selectedSetIndex!] !== null ? 'Update' : 'Log'}
                    </button>
                    {setLogs[selectedSetIndex!] !== null && (
                      <button onClick={() => removeLog(selectedSetIndex!)} className="text-muted-foreground hover:text-red-400 text-xs px-1 transition-colors">
                        Remove
                      </button>
                    )}
                    <button onClick={() => setShowManual(false)} className="text-muted-foreground text-sm px-1">✕</button>
                  </div>
                </>
              )}

              {/* idle + reps */}
              {timer.phase === 'idle' && !timed && (
                <>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">
                    Set {(selectedSetIndex ?? 0) + 1}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      ref={inputRef}
                      type="number"
                      min={0}
                      max={999}
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') logReps(); if (e.key === 'Escape') closePanel() }}
                      placeholder="Reps"
                      className="flex-1 bg-secondary border border-border rounded-xl px-3 py-3 text-lg text-foreground text-center focus:outline-none focus:border-primary"
                    />
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={999}
                        step={0.5}
                        value={weightValue}
                        onChange={e => setWeightValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') logReps() }}
                        placeholder="kg"
                        className="w-20 bg-secondary border border-border rounded-xl px-3 py-3 text-lg text-foreground text-center focus:outline-none focus:border-primary pr-7"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">kg</span>
                    </div>
                    <button onClick={logReps} className="px-5 py-3 rounded-full bg-primary text-primary-foreground font-bold text-sm">
                      {setLogs[selectedSetIndex!] !== null ? 'Update' : 'Log'}
                    </button>
                  </div>
                  {setLogs[selectedSetIndex!] !== null && (
                    <button
                      onClick={() => removeLog(selectedSetIndex!)}
                      className="text-xs text-muted-foreground hover:text-red-400 transition-colors self-center"
                    >
                      Remove set
                    </button>
                  )}
                </>
              )}

              {/* countdown */}
              {timer.phase === 'countdown' && (
                <>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">Get ready…</p>
                  <p className="text-8xl font-black text-primary text-center leading-none py-2">
                    {timer.count === 0 ? 'GO' : timer.count}
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => setTimer({ phase: 'idle' })}
                      className="px-6 py-2.5 rounded-full border border-border text-foreground/80 text-sm font-medium"
                    >
                      Pause
                    </button>
                    <button onClick={() => { setTimer({ phase: 'idle' }); closePanel() }} className="text-muted-foreground text-sm px-3">
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {/* running */}
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
                      <circle cx="12" cy="12" r="10" fill="currentColor"/>
                      <rect x="9" y="9" width="6" height="6" fill="currentColor" className="text-background" rx="1"/>
                    </svg>
                    Stop & log
                  </button>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => setTimer({ phase: 'idle' })}
                      className="px-6 py-2.5 rounded-full border border-border text-foreground/80 text-sm font-medium"
                    >
                      Pause
                    </button>
                    <button onClick={() => { setTimer({ phase: 'idle' }); closePanel() }} className="text-muted-foreground text-sm px-3">
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {/* logged confirmation */}
              {timer.phase === 'logged' && (
                <>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">Logged</p>
                  <p className="text-8xl font-black text-primary text-center leading-none py-2">
                    {timer.value}{timer.unit}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { setTimer({ phase: 'idle' }); closePanel() }}
                      className="flex-1 text-muted-foreground font-semibold text-xs uppercase tracking-widest py-3 text-center"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        commitLog(
                          timer.setIndex,
                          timer.unit === 's' ? { duration_s: timer.value } : { reps: timer.value }
                        )
                        setTimer({ phase: 'idle' })
                        closePanel()
                      }}
                      className="flex-1 py-3 rounded-full bg-primary text-primary-foreground font-bold text-sm uppercase tracking-wide"
                    >
                      Log {timer.value}{timer.unit}
                    </button>
                  </div>
                </>
              )}

            </div>
          )}
        </div>
      )}

      {/* Difficulty adjustment */}
      <div className="mt-2 pt-3 border-t border-border/50">
        <p className="text-xs text-muted-foreground mb-2.5">How did this feel?</p>
        <div className="flex gap-2">
          <button
            onClick={() => adjust('regression')}
            disabled={adjusting !== null}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm py-2 rounded-full bg-secondary text-foreground/70 font-medium hover:bg-secondary/70 hover:text-foreground disabled:opacity-40 transition-all"
          >
            {adjusting === 'regression' ? (
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            ) : <span className="text-base leading-none">↓</span>}
            Too hard
          </button>
          <button
            onClick={() => adjust('progression')}
            disabled={adjusting !== null}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm py-2 rounded-full bg-secondary text-foreground/70 font-medium hover:bg-secondary/70 hover:text-foreground disabled:opacity-40 transition-all"
          >
            {adjusting === 'progression' ? (
              <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            ) : <span className="text-base leading-none">↑</span>}
            Too easy
          </button>
        </div>
        {limitMessage && (
          <p className="text-xs text-amber-400 mt-2 leading-relaxed">{limitMessage}</p>
        )}
      </div>
    </div>
  )
}

// ─── BlockSection ─────────────────────────────────────────────────────────────

interface BlockSectionProps {
  block: Block
  level: string
  equipment: string[]
  goal: string
  sessionDay: string
  planId: string | null
  userId: string | null
  logsForDay: Map<string, SetLog[]>
  prevLogsForDay: Map<string, SetLog[]>
  onReplaceExercise: (exerciseIndex: number, updated: Exercise) => void
  onLogsChange: (exerciseName: string, logs: SetLog[]) => void
  onSetLogged: (restSeconds: number) => void
  isPreview: boolean
}

function BlockSection({
  block,
  level,
  equipment,
  goal,
  sessionDay,
  planId,
  userId,
  logsForDay,
  prevLogsForDay,
  onReplaceExercise,
  onLogsChange,
  onSetLogged,
  isPreview,
}: BlockSectionProps) {
  return (
    <div className="mb-5">
      <p className={`text-xs font-semibold tracking-widest uppercase mb-3 ${BLOCK_COLORS[block.type] ?? 'text-muted-foreground'}`}>
        {BLOCK_LABELS[block.type] ?? block.type}
      </p>
      <div className="flex flex-col gap-3">
        {block.exercises.map((ex, i) => (
          <ExerciseCard
            key={`${ex.name}-${i}`}
            exercise={ex}
            level={level}
            equipment={equipment}
            goal={goal}
            sessionDay={sessionDay}
            planId={planId}
            userId={userId}
            initialLogs={logsForDay.get(ex.name) ?? []}
            prevSetsData={prevLogsForDay.get(ex.name)}
            onReplace={(updated) => onReplaceExercise(i, updated)}
            onLogsChange={(logs) => onLogsChange(ex.name, logs)}
            onSetLogged={onSetLogged}
            isPreview={isPreview}
          />
        ))}
      </div>
    </div>
  )
}

// ─── ProgressionBanner ───────────────────────────────────────────────────────

interface ProgressionBannerProps {
  exerciseNames: string[]
  session: Session
  inputs: GenerateRequest
  onProgressed: (updated: Session) => void
}

function ProgressionBanner({ exerciseNames, session, inputs, onProgressed }: ProgressionBannerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleProgress = async () => {
    setLoading(true)
    setError('')
    const feedback = `I hit my target reps on all sets for: ${exerciseNames.join(', ')}. Progress each of these to the next harder variation.`
    try {
      const res = await fetch('/api/refine-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, inputs, feedback }),
      })
      if (!res.ok) throw new Error('Refinement failed')
      const data = await res.json()
      onProgressed(data.session)
    } catch {
      setError('Something went wrong. Try again.')
      setLoading(false)
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-green-400/30 bg-green-400/5 px-4 py-3.5 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-green-400 leading-snug">
          Ready to progress on {exerciseNames.length} exercise{exerciseNames.length > 1 ? 's' : ''}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {exerciseNames.join(', ')}
        </p>
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
      <button
        onClick={handleProgress}
        disabled={loading}
        className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-green-400/15 text-green-400 text-xs font-semibold hover:bg-green-400/25 disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        ) : (
          <>Update session →</>
        )}
      </button>
    </div>
  )
}

// ─── RefineDayForm ────────────────────────────────────────────────────────────

interface RefineDayFormProps {
  session: Session
  inputs: GenerateRequest
  onRefined: (updated: Session) => void
}

function RefineDayForm({ session, inputs, onRefined }: RefineDayFormProps) {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedback.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/refine-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, inputs, feedback }),
      })
      if (!res.ok) throw new Error('Refinement failed')
      const data = await res.json()
      onRefined(data.session)
      setFeedback('')
      setOpen(false)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <div className="mt-6">
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          Refine this day
        </button>
      </div>
    )
  }

  return (
    <div className="mt-6 border border-border rounded-xl p-4">
      <p className="text-xs font-semibold tracking-widest text-teal-400 uppercase mb-1">Refine this day</p>
      <p className="text-sm text-muted-foreground mb-4">Describe what you want to change about today&apos;s session. Only this day will be updated.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Textarea
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder="e.g. Swap the ring rows for pull-ups, and make the warm-up shorter…"
          rows={2}
          className="bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/50 focus-visible:border-primary resize-none"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => { setOpen(false); setFeedback('') }}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary text-sm"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!feedback.trim() || loading}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Refining…
              </>
            ) : 'Refine →'}
          </Button>
        </div>
      </form>
    </div>
  )
}

// ─── PlanPage ─────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const router = useRouter()
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planId, setPlanId] = useState<string | null>(null)
  const [inputs, setInputs] = useState<GenerateRequest | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [activeDay, setActiveDay] = useState(0)
  const [allLogs, setAllLogs] = useState<Map<string, SetLog[]>>(new Map())
  const [prevLogs, setPrevLogs] = useState<Map<string, SetLog[]>>(new Map())
  const [planCreatedAt, setPlanCreatedAt] = useState<Date | null>(null)
  const [isAccepted, setIsAccepted] = useState(false)
  const [restTimer, setRestTimer] = useState<{ remaining: number; total: number; minimized: boolean } | null>(null)
  const [showFinish, setShowFinish] = useState(false)

  useEffect(() => {
    if (!restTimer) return
    if (restTimer.remaining <= 0) { setRestTimer(null); return }
    const t = setTimeout(() => {
      setRestTimer(prev => {
        if (!prev || prev.remaining <= 1) return null
        return { ...prev, remaining: prev.remaining - 1 }
      })
    }, 1000)
    return () => clearTimeout(t)
  }, [restTimer])

  useEffect(() => {
    const supabase = createSupabaseBrowser()

    const loadData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setUserId(user.id)
        setDisplayName(user.user_metadata?.display_name ?? user.email ?? null)
      }

      if (user) {
        const { data: planRow } = await supabase
          .from('plans')
          .select('id, plan, inputs, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        if (planRow) {
          setPlan(planRow.plan as PlanResponse)
          setPlanId(planRow.id)
          setInputs(planRow.inputs as GenerateRequest)
          setPlanCreatedAt(new Date(planRow.created_at))

          const { data: logsData } = await supabase
            .from('exercise_logs')
            .select('session_day, exercise_name, sets_data, logged_at')
            .eq('plan_id', planRow.id)
            .order('logged_at', { ascending: false })

          if (logsData) {
            const { start, end } = getCurrentWeekRange()

            // Current week: iterate ASC so most recent per exercise wins
            const logsMap = new Map<string, SetLog[]>()
            ;[...logsData].reverse().forEach(log => {
              const loggedAt = new Date(log.logged_at)
              if (loggedAt >= start && loggedAt <= end) {
                logsMap.set(`${log.session_day}:${log.exercise_name}`, log.sets_data)
              }
            })
            setAllLogs(logsMap)

            // Prev logs: logsData is DESC so first occurrence = most recent
            const prevLogsMap = new Map<string, SetLog[]>()
            logsData.forEach(log => {
              const loggedAt = new Date(log.logged_at)
              if (loggedAt < start) {
                const key = `${log.session_day}:${log.exercise_name}`
                if (!prevLogsMap.has(key)) prevLogsMap.set(key, log.sets_data)
              }
            })
            setPrevLogs(prevLogsMap)
          }

          const planSessions = (planRow.plan as PlanResponse).plan.sessions
          setActiveDay(getInitialActiveDay(planSessions))
          setIsAccepted(true)
          return
        }
      }

      const raw = sessionStorage.getItem('workout-plan')
      const rawInputs = sessionStorage.getItem('workout-inputs')
      const storedPlanId = sessionStorage.getItem('plan-id')
      if (!raw) { router.replace('/'); return }
      const sessionPlan = JSON.parse(raw) as PlanResponse
      setPlan(sessionPlan)
      if (rawInputs) setInputs(JSON.parse(rawInputs))
      if (storedPlanId) setPlanId(storedPlanId)
      setIsAccepted(sessionStorage.getItem('plan-accepted') === '1')
      setActiveDay(getInitialActiveDay(sessionPlan.plan.sessions))
    }

    loadData()
  }, [router])

  const replaceExercise = (
    sessionIndex: number,
    blockIndex: number,
    exerciseIndex: number,
    updated: Exercise
  ) => {
    setPlan(prev => {
      if (!prev) return prev
      const sessions = prev.plan.sessions.map((s, si) => {
        if (si !== sessionIndex) return s
        return {
          ...s,
          blocks: s.blocks.map((b, bi) => {
            if (bi !== blockIndex) return b
            return {
              ...b,
              exercises: b.exercises.map((e, ei) => ei === exerciseIndex ? updated : e),
            }
          }),
        }
      })
      return { plan: { ...prev.plan, sessions } }
    })
  }

  const replaceSession = (sessionIndex: number, updated: Session) => {
    setPlan(prev => {
      if (!prev) return prev
      const sessions = prev.plan.sessions.map((s, si) => si === sessionIndex ? updated : s)
      return { plan: { ...prev.plan, sessions } }
    })
  }

  const updateLogs = (sessionDay: string, exerciseName: string, logs: SetLog[]) => {
    setAllLogs(prev => {
      const next = new Map(prev)
      next.set(`${sessionDay}:${exerciseName}`, logs)
      return next
    })
  }

  const handleAcceptPlan = async () => {
    if (plan && inputs && userId && !planId) {
      const supabase = createSupabaseBrowser()
      const { data } = await supabase
        .from('plans')
        .insert({ user_id: userId, plan, inputs })
        .select('id')
        .single()
      if (data) {
        setPlanId(data.id)
        sessionStorage.setItem('plan-id', data.id)
      }
    }
    sessionStorage.setItem('plan-accepted', '1')
    setIsAccepted(true)
  }

  const handleSetLogged = (restSeconds: number) => {
    setRestTimer({ remaining: restSeconds, total: restSeconds, minimized: false })
  }

  if (!plan) return null

  const { level, goal, days_per_week, sessions } = plan.plan
  const equipment = inputs?.equipment ?? []
  const activeSession: Session = sessions[activeDay] ?? sessions[0]
  const isRestDay = activeSession.type === 'rest'

  const logsForActiveDay = new Map<string, SetLog[]>()
  allLogs.forEach((logs, key) => {
    const [day, exerciseName] = key.split(':')
    if (day === activeSession.day) logsForActiveDay.set(exerciseName, logs)
  })

  const prevLogsForActiveDay = new Map<string, SetLog[]>()
  prevLogs.forEach((logs, key) => {
    const [day, exerciseName] = key.split(':')
    if (day === activeSession.day) prevLogsForActiveDay.set(exerciseName, logs)
  })

  const setsLoggedToday = Array.from(logsForActiveDay.values()).reduce((sum, logs) => sum + logs.length, 0)
  const exercisesLoggedToday = logsForActiveDay.size

  const exercisesAtTarget = isAccepted && !isRestDay
    ? activeSession.blocks.flatMap(b => b.exercises).filter(ex =>
        isAtTarget(ex, logsForActiveDay.get(ex.name) ?? [])
      )
    : []

  const sessionsThisWeek = new Set(Array.from(allLogs.keys()).map(k => k.split(':')[0])).size
  const weekNumber = planCreatedAt ? getWeekNumber(planCreatedAt) : 1

  const firstName = displayName ? displayName.split('@')[0].split(' ')[0] : null
  const todayDayName = getTodayDayName()
  const todaySessionIdx = sessions.findIndex(s => s.day === todayDayName)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">
            {firstName ? `${firstName}'s` : 'My'} program — {goal.toLowerCase()}.
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {level}
            {equipment.filter(e => e !== 'floor').length > 0 && (
              <> · {equipment.filter(e => e !== 'floor').map(e => EQUIPMENT_LABELS[e] ?? e).join(', ')}</>
            )}
            {' · '}
            <a href="/account" className="underline underline-offset-2 hover:text-foreground transition-colors">
              Change
            </a>
          </p>
        </div>

        {/* Week tabs */}
        {(() => {
          const completedDays = new Set(Array.from(allLogs.keys()).map(k => k.split(':')[0]))
          return (
            <>
              <div className="bg-card rounded-2xl p-1 flex mb-1">
                {sessions.map((session, i) => {
                  const isRest = session.type === 'rest'
                  const isActive = activeDay === i
                  const isToday = todaySessionIdx === i
                  const isDone = !isRest && completedDays.has(session.day)
                  const abbr = DAY_ABBR[session.day] ?? session.day.slice(0, 2).toUpperCase()
                  return (
                    <button
                      key={i}
                      onClick={() => setActiveDay(i)}
                      className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all ${
                        isActive ? 'bg-secondary shadow-sm' : 'hover:bg-secondary/40'
                      }`}
                    >
                      <span className={`text-[11px] font-bold tracking-wide ${
                        isActive
                          ? isRest ? 'text-teal-400' : 'text-primary'
                          : 'text-muted-foreground'
                      }`}>
                        {abbr}
                      </span>
                      {isDone ? (
                        <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : isRest ? (
                        <div className={`w-1.5 h-1.5 rounded-full border ${
                          isActive ? 'border-teal-400' : 'border-border'
                        }`} />
                      ) : (
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          isActive ? 'bg-primary' : 'bg-muted-foreground/40'
                        }`} />
                      )}
                      <div className={`w-1 h-1 rounded-full transition-colors ${
                        isToday ? 'bg-amber-400' : 'bg-transparent'
                      }`} />
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground/50 mb-5 pl-1">
                Week {weekNumber} · new week starts Sunday night
              </p>
            </>
          )
        })()}

        {/* Day heading */}
        <h2 className="text-base font-bold text-foreground mb-5">
          {activeSession.day}
          <span className="text-muted-foreground font-normal">
            {' — '}{isRestDay ? 'Stretch and recover' : activeSession.label}
          </span>
          {!isRestDay && (
            <span className="text-muted-foreground font-normal">
              {' — '}{estimateDuration(activeSession)} min
            </span>
          )}
        </h2>

        {/* Active session content */}
        <div>
          {activeSession.blocks.map((block, bi) => (
            <BlockSection
              key={bi}
              block={block}
              level={level}
              equipment={equipment}
              goal={goal}
              sessionDay={activeSession.day}
              planId={planId}
              userId={userId}
              logsForDay={logsForActiveDay}
              prevLogsForDay={prevLogsForActiveDay}
              onReplaceExercise={(ei, updated) =>
                replaceExercise(activeDay, bi, ei, updated)
              }
              onLogsChange={(exerciseName, logs) =>
                updateLogs(activeSession.day, exerciseName, logs)
              }
              onSetLogged={handleSetLogged}
              isPreview={!isAccepted || isRestDay}
            />
          ))}
        </div>

        {/* Progression banner — appears when 2+ exercises hit target */}
        {inputs && exercisesAtTarget.length >= 2 && (
          <ProgressionBanner
            exerciseNames={exercisesAtTarget.map(ex => ex.name)}
            session={activeSession}
            inputs={inputs}
            onProgressed={(updated) => replaceSession(activeDay, updated)}
          />
        )}

        {/* Refine this day — only on accepted workout days */}
        {inputs && isAccepted && !isRestDay && (
          <RefineDayForm
            session={activeSession}
            inputs={inputs}
            onRefined={(updated) => replaceSession(activeDay, updated)}
          />
        )}

        {/* Bottom actions */}
        {inputs && (
          <div className="mt-8 pb-6">
            {!isAccepted ? (
              <Button
                onClick={handleAcceptPlan}
                className="h-9 px-5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                Accept plan →
              </Button>
            ) : !isRestDay ? (
              <Button
                onClick={() => setShowFinish(true)}
                variant="outline"
                className="h-9 px-5 text-sm border-border text-foreground/80 bg-transparent hover:bg-secondary hover:text-foreground font-semibold"
              >
                Finish workout
              </Button>
            ) : null}
          </div>
        )}

      </div>

      {/* Rest timer overlay */}
      {restTimer && !restTimer.minimized && (
        <RestTimerOverlay
          remaining={restTimer.remaining}
          total={restTimer.total}
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

      {/* Finish workout overlay */}
      {showFinish && (
        <FinishWorkoutOverlay
          displayName={displayName}
          setsLogged={setsLoggedToday}
          exercisesLogged={exercisesLoggedToday}
          onClose={() => setShowFinish(false)}
        />
      )}
    </main>
  )
}
