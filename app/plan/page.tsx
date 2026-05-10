'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlanResponse, Session, Block, Exercise, SetLog, ExerciseLog, GenerateRequest, NextWeekPlanResponse, ProgressionAnalysis } from '@/lib/types'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

// ─── Constants ────────────────────────────────────────────────────────────────

const UNDO_SECONDS = 10

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

function getCurrentWeekStart(): string {
  return getCurrentWeekRange().start.toISOString()
}

function getTodayDayName(): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()]
}

function getInitialActiveDay(sessions: Session[], finishedDays?: Set<string>): number {
  const today = getTodayDayName()
  const todayIdx = sessions.findIndex(s => s.day === today)
  if (todayIdx !== -1) return todayIdx
  if (finishedDays && finishedDays.size > 0) {
    const firstUnfinished = sessions.findIndex(s => !finishedDays.has(s.day))
    if (firstUnfinished !== -1) return firstUnfinished
  }
  return 0
}

const SESSION_DAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
}

// Returns the Monday of the calendar week a log actually belongs to,
// using session_day (plan day) rather than the raw logged_at date.
// Tolerates up to 3 days late (e.g., logging Sunday's session on Monday–Wednesday).
function getLogWeekMonday(sessionDay: string, loggedAt: Date): Date {
  const targetIdx = SESSION_DAY_INDEX[sessionDay]
  if (targetIdx === undefined) return getCalendarMonday(loggedAt)
  const logIdx = loggedAt.getDay()
  let daysBack = (logIdx - targetIdx + 7) % 7
  // More than 3 days back means the user likely logged it early for the upcoming session
  if (daysBack > 3) daysBack = 0
  const sessionDate = new Date(loggedAt)
  sessionDate.setDate(loggedAt.getDate() - daysBack)
  return getCalendarMonday(sessionDate)
}

function getCalendarMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function getUserWeekInfo(planCreatedAt: Date): { weekNumber: number; start: Date; end: Date } {
  const currentMonday = getCalendarMonday(new Date())
  const registrationMonday = getCalendarMonday(planCreatedAt)
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const weekNumber = Math.floor((currentMonday.getTime() - registrationMonday.getTime()) / msPerWeek) + 1
  const end = new Date(currentMonday.getTime() + 6 * 24 * 60 * 60 * 1000)
  end.setHours(23, 59, 59, 999)
  return { weekNumber: Math.max(1, weekNumber), start: currentMonday, end }
}

function getUserPrevWeekInfo(planCreatedAt: Date): { weekNumber: number; start: Date; end: Date } | null {
  const { weekNumber, start } = getUserWeekInfo(planCreatedAt)
  if (weekNumber <= 1) return null
  const prevStart = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000)
  const prevEnd = new Date(start.getTime() - 1)
  prevEnd.setHours(23, 59, 59, 999)
  return { weekNumber: weekNumber - 1, start: prevStart, end: prevEnd }
}

function formatWeekLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}

function formatPrevLog(log: SetLog | null | undefined): string {
  if (!log) return '✓'
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
  weekNumber: number
  initialLogs: SetLog[]
  prevSetsData?: SetLog[]
  onReplace: (updated: Exercise) => void
  onLogsChange: (logs: SetLog[]) => void
  onSetLogged: (restSeconds: number) => void
  onAdjusted: (oldExerciseName: string, sessionDay: string) => void
  onUndone: () => void
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
  weekNumber,
  initialLogs,
  prevSetsData,
  onReplace,
  onLogsChange,
  onSetLogged,
  onAdjusted,
  onUndone,
  isPreview,
}: ExerciseCardProps) {
  const [adjusting, setAdjusting] = useState<'regression' | 'progression' | null>(null)
  const [limitMessage, setLimitMessage] = useState('')
  const [previousExercise, setPreviousExercise] = useState<Exercise | null>(null)
  const [undoCountdown, setUndoCountdown] = useState<number | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [setLogs, setSetLogs] = useState<(SetLog | null)[]>(() => {
    const arr: (SetLog | null)[] = Array(exercise.sets).fill(null)
    initialLogs.forEach((log, i) => { if (i < exercise.sets) arr[i] = log })
    return arr
  })

  // Sync setLogs when initialLogs or exercise.sets changes (handles DB load completing after mount)
  useEffect(() => {
    setSetLogs(() => {
      const arr: (SetLog | null)[] = Array(exercise.sets).fill(null)
      initialLogs.forEach((log, i) => { if (i < exercise.sets) arr[i] = log })
      return arr
    })
  }, [initialLogs, exercise.sets])

  const [selectedSetIndex, setSelectedSetIndex] = useState<number | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [weightValue, setWeightValue] = useState('')
  const [timer, setTimer] = useState<TimerPhase>({ phase: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentLogsRef = useRef<SetLog[]>([])
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    }
  }, [])

  function schedulePersist(filledLogs: SetLog[]) {
    currentLogsRef.current = filledLogs
    if (!planId || !userId) return
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      const logs = currentLogsRef.current
      const supabase = createSupabaseBrowser()
      const weekStart = getCurrentWeekStart()
      supabase.from('exercise_logs')
        .delete()
        .eq('plan_id', planId)
        .eq('session_day', sessionDay)
        .eq('exercise_name', exercise.name)
        .gte('logged_at', weekStart)
        .then(({ error }) => {
          if (error) { console.error('Log delete error:', error.message); return }
          if (logs.length > 0) {
            supabase.from('exercise_logs').insert({
              user_id: userId,
              plan_id: planId,
              session_day: sessionDay,
              exercise_name: exercise.name,
              sets_data: logs,
              week_number: weekNumber,
            }).then(({ error: e }) => {
              if (e) console.error('Log save error:', e.message)
            })
          }
        })
    }, 400)
  }

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
    schedulePersist(filledLogs)
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

    schedulePersist(filledLogs)
  }

  const adjust = async (direction: 'regression' | 'progression') => {
    setAdjusting(direction)
    setLimitMessage('')
    setPreviousExercise(null)
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
        setPreviousExercise(exercise)   // save before replacing
        onReplace(data)
        setSetLogs(Array(data.sets).fill(null))
        closePanel()
        onLogsChange([])
        if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
        setUndoCountdown(UNDO_SECONDS)
        let remaining = UNDO_SECONDS
        undoIntervalRef.current = setInterval(() => {
          remaining -= 1
          if (remaining <= 0) {
            clearInterval(undoIntervalRef.current!)
            undoIntervalRef.current = null
            setUndoCountdown(null)
            setPreviousExercise(null)
          } else {
            setUndoCountdown(remaining)
          }
        }, 1000)
        onAdjusted(exercise.name, sessionDay)
      }
    } catch {
      setLimitMessage('Could not adjust exercise. Try again.')
    } finally {
      setAdjusting(null)
    }
  }

  const handleUndo = () => {
    if (!previousExercise) return
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    undoIntervalRef.current = null
    setUndoCountdown(null)
    onUndone()
    onReplace(previousExercise)
    setSetLogs(Array(previousExercise.sets).fill(null))
    onLogsChange([])
    setPreviousExercise(null)
  }

  const activeTimerSet = (timer.phase === 'countdown' || timer.phase === 'running' || timer.phase === 'logged')
    ? timer.setIndex : -1
  const timerActive = timer.phase !== 'idle'

  return (
    <div className={`bg-card rounded-xl p-4 flex flex-col gap-2 transition-all ${atTarget ? 'ring-1 ring-emerald-600/50 dark:ring-emerald-400/40' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <p className="font-semibold text-foreground leading-tight">{exercise.name}</p>
          {atTarget && (
            <span className="shrink-0 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded-md font-medium">✓ Goal hit</span>
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


      {/* Read-only set display — shown in preview mode when logs exist */}
      {isPreview && setLogs.some(l => l !== null) && (
        <div className="grid gap-2 pt-1" style={{ gridTemplateColumns: `repeat(${exercise.sets}, 1fr)` }}>
          {setLogs.map((log, i) => (
            <div
              key={i}
              className={`rounded-xl border py-2 ${
                log !== null
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {log !== null ? (
                <div className="flex flex-col items-center leading-none gap-0.5">
                  <span className="text-[10px] font-semibold uppercase opacity-70">S{i + 1}</span>
                  <span className="text-sm font-bold">{setLogDisplay(log)}</span>
                </div>
              ) : (
                <span className="text-sm font-semibold text-center block">Set {i + 1}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Rep logger — hidden in preview mode */}
      {!isPreview && (
        <div className="flex flex-col gap-2 pt-1">

          {/* Set buttons row */}
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${exercise.sets}, 1fr)` }}>
            {Array.from({ length: exercise.sets }).map((_, i) => {
              const isRunningThis = activeTimerSet === i
              const isSelected = selectedSetIndex === i && !timerActive
              const log = setLogs[i] ?? null
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

      {/* Difficulty adjustment — hidden in preview/history mode */}
      {!isPreview && (
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
          {previousExercise && (
            <button
              onClick={handleUndo}
              className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>↩</span>
              Undo — back to {previousExercise.name}{undoCountdown !== null ? ` (${undoCountdown}s)` : ''}
            </button>
          )}
        </div>
      )}
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
  weekNumber: number
  logsForDay: Map<string, SetLog[]>
  prevLogsForDay: Map<string, SetLog[]>
  onReplaceExercise: (exerciseIndex: number, updated: Exercise) => void
  onLogsChange: (exerciseName: string, logs: SetLog[]) => void
  onSetLogged: (restSeconds: number) => void
  onAdjusted: (oldExerciseName: string, sessionDay: string) => void
  onUndone: () => void
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
  weekNumber,
  logsForDay,
  prevLogsForDay,
  onReplaceExercise,
  onLogsChange,
  onSetLogged,
  onAdjusted,
  onUndone,
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
            key={i}
            exercise={ex}
            level={level}
            equipment={equipment}
            goal={goal}
            sessionDay={sessionDay}
            planId={planId}
            userId={userId}
            weekNumber={weekNumber}
            initialLogs={logsForDay.get(ex.name) ?? []}
            prevSetsData={prevLogsForDay.get(ex.name)}
            onReplace={(updated) => onReplaceExercise(i, updated)}
            onLogsChange={(logs) => onLogsChange(ex.name, logs)}
            onSetLogged={onSetLogged}
            onAdjusted={onAdjusted}
            onUndone={onUndone}
            isPreview={isPreview}
          />
        ))}
      </div>
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

// ─── FinishWeekConfirmSheet ───────────────────────────────────────────────────

interface FinishWeekConfirmSheetProps {
  onConfirm: () => void
  onDismiss: () => void
}

function FinishWeekConfirmSheet({ onConfirm, onDismiss }: FinishWeekConfirmSheetProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-card border-t border-border rounded-t-3xl px-6 pt-6 pb-12 flex flex-col gap-5">
        <div className="w-10 h-1 bg-border rounded-full mb-1 mx-auto" />

        <div>
          <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-1">Finish your week</p>
          <h2 className="text-2xl font-black text-foreground leading-tight">Ready to wrap up?</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            We&apos;ll look at everything you trained this week, spot where you&apos;re making progress and where to ease off, and set up your Monday automatically.
          </p>
          <p className="text-muted-foreground mt-2 text-sm">Your new schedule will be ready to start on Monday.</p>
        </div>

        <div className="flex flex-col gap-3 mt-2">
          <Button
            onClick={onConfirm}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base h-12"
          >
            Analyse my week →
          </Button>
          <button
            onClick={onDismiss}
            className="w-full text-sm text-muted-foreground py-2"
          >
            Not yet
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── FinishWeekLoadingOverlay ─────────────────────────────────────────────────

interface FinishWeekLoadingOverlayProps {
  msgIdx: number
}

function FinishWeekLoadingOverlay({ msgIdx }: FinishWeekLoadingOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background px-5">
      <div className="text-center max-w-xs">
        <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-8">Analysing</p>
        <div className="flex justify-center mb-6">
          <svg className="animate-spin w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold mb-3">Looking at your week</h2>
        <p className="text-sm text-muted-foreground leading-relaxed min-h-[2.5rem] transition-all">
          {FINISHING_MESSAGES[msgIdx]}
        </p>
      </div>
    </div>
  )
}

// ─── PlanPage ─────────────────────────────────────────────────────────────────

const GENERATING_MESSAGES = [
  'Analyzing your level and goals…',
  'Selecting the right progressions…',
  'Structuring your weekly schedule…',
  'Balancing push, pull, and recovery…',
  'Almost there…',
]

const FINISHING_MESSAGES = [
  'Checking how your sessions looked this week…',
  'Spotting which exercises you\'re ready to level up…',
  'Finding where to take it a little slower…',
  'Building your schedule for next week…',
  'Almost there…',
]

export default function PlanPage() {
  const router = useRouter()
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planId, setPlanId] = useState<string | null>(null)
  const [inputs, setInputs] = useState<GenerateRequest | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [activeDay, setActiveDay] = useState(0)
  const [allLogs, setAllLogs] = useState<Map<string, Map<string, SetLog[]>>>(new Map())
  const [prevLogs, setPrevLogs] = useState<Map<string, Map<string, SetLog[]>>>(new Map())
  const [prevPlan, setPrevPlan] = useState<PlanResponse | null>(null)
  const [planCreatedAt, setPlanCreatedAt] = useState<Date | null>(null)
  const [isAccepted, setIsAccepted] = useState(false)
  const [restTimer, setRestTimer] = useState<{ remaining: number; total: number; minimized: boolean } | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [generatingMsgIdx, setGeneratingMsgIdx] = useState(0)
  const [generateError, setGenerateError] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const [sessionUndo, setSessionUndo] = useState<{ sessionIndex: number; session: Session } | null>(null)
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)
  const [isFinishingWeek, setIsFinishingWeek] = useState(false)
  const [finishingMsgIdx, setFinishingMsgIdx] = useState(0)
  const [finishWeekError, setFinishWeekError] = useState('')
  const [weekFinishAnalysis, setWeekFinishAnalysis] = useState<ProgressionAnalysis | null>(null)
  const [viewingPreviousWeek, setViewingPreviousWeek] = useState(false)
  const [weekIsFinished, setWeekIsFinished] = useState(false)

  const planRef = useRef(plan)
  useEffect(() => { planRef.current = plan }, [plan])
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedulePlanSave = (oldExerciseName: string, sessionDay: string) => {
    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current)
    pendingSaveRef.current = setTimeout(() => {
      pendingSaveRef.current = null
      const currentPlanId = planId
      const currentPlan = planRef.current
      if (!currentPlanId || !currentPlan) return
      const supabase = createSupabaseBrowser()
      supabase.from('plans').update({ plan: currentPlan }).eq('id', currentPlanId).then(({ error }) => {
        if (error) console.error('Plan save error:', error.message)
      })
      supabase.from('exercise_logs')
        .delete()
        .eq('plan_id', currentPlanId)
        .eq('session_day', sessionDay)
        .eq('exercise_name', oldExerciseName)
        .then(({ error }) => {
          if (error) console.error('Log cleanup error:', error.message)
        })
    }, UNDO_SECONDS * 1000)
  }

  const cancelPlanSave = () => {
    if (pendingSaveRef.current) {
      clearTimeout(pendingSaveRef.current)
      pendingSaveRef.current = null
    }
  }

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

  // Rotate generating message every 3s while loading
  useEffect(() => {
    if (!isGenerating) return
    const t = setInterval(() => {
      setGeneratingMsgIdx(i => (i + 1) % GENERATING_MESSAGES.length)
    }, 3000)
    return () => clearInterval(t)
  }, [isGenerating])

  // Rotate finishing message every 3s while analysing
  useEffect(() => {
    if (!isFinishingWeek) return
    const t = setInterval(() => {
      setFinishingMsgIdx(i => (i + 1) % FINISHING_MESSAGES.length)
    }, 3000)
    return () => clearInterval(t)
  }, [isFinishingWeek])

  // Kick off generation when isGenerating becomes true and inputs are available
  useEffect(() => {
    if (!isGenerating || !inputs) return
    let cancelled = false

    const generate = async () => {
      try {
        const res = await fetch('/api/generate-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(inputs),
        })
        if (!res.ok) throw new Error('Generation failed')
        const data = await res.json()
        if (cancelled) return
        sessionStorage.setItem('workout-plan', JSON.stringify(data))
        sessionStorage.removeItem('plan-generating')
        setPlan(data as PlanResponse)
        setActiveDay(getInitialActiveDay((data as PlanResponse).plan.sessions))
        setIsAccepted(false)
        setIsGenerating(false)
      } catch {
        if (cancelled) return
        setGenerateError('Something went wrong. Please try again.')
        setIsGenerating(false)
      }
    }

    generate()
    return () => { cancelled = true }
  }, [isGenerating, inputs])

  useEffect(() => {
    const supabase = createSupabaseBrowser()

    const loadData = async () => {
      try {
        const isGeneratingFlag = sessionStorage.getItem('plan-generating') === '1'
        const rawInputs = sessionStorage.getItem('workout-inputs')
        const rawPlan = sessionStorage.getItem('workout-plan')
        const storedPlanId = sessionStorage.getItem('plan-id')
        const storedAccepted = sessionStorage.getItem('plan-accepted')

        // ── Path 1: onboarding generation in progress ──────────────────────────
        if (isGeneratingFlag && rawInputs) {
          const parsedInputs = JSON.parse(rawInputs) as GenerateRequest
          setInputs(parsedInputs)
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            setUserId(user.id)
            setDisplayName(user.user_metadata?.display_name ?? user.email ?? null)
          }
          setIsGenerating(true)
          return
        }

        // ── Path 2: fresh unaccepted plan in sessionStorage (from account or ──
        // ── onboarding after generation finished) — show it before Supabase  ──
        if (rawPlan && !storedPlanId && !storedAccepted) {
          const sessionPlan = JSON.parse(rawPlan) as PlanResponse
          setPlan(sessionPlan)
          if (rawInputs) setInputs(JSON.parse(rawInputs))
          setIsAccepted(false)
          setActiveDay(getInitialActiveDay(sessionPlan.plan.sessions))
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            setUserId(user.id)
            setDisplayName(user.user_metadata?.display_name ?? user.email ?? null)
          }
          return
        }

        // ── Path 3: load from Supabase (returning user) ───────────────────────
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          setUserId(user.id)
          setDisplayName(user.user_metadata?.display_name ?? user.email ?? null)

          const { data: planRow } = await supabase
            .from('plans')
            .select('id, plan, inputs, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (planRow) {
            // Use the oldest plan's created_at as program start so the week counter
            // never resets to 1 after a new plan is generated.
            const { data: firstPlanRow } = await supabase
              .from('plans')
              .select('created_at')
              .eq('user_id', user.id)
              .order('created_at', { ascending: true })
              .limit(1)
              .single()

            const { data: logsData } = await supabase
              .from('exercise_logs')
              .select('session_day, exercise_name, sets_data, logged_at')
              .eq('user_id', user.id)
              .order('logged_at', { ascending: false })

            const logsMap = new Map<string, Map<string, SetLog[]>>()
            const prevLogsMap = new Map<string, Map<string, SetLog[]>>()

            const registrationDate = new Date(firstPlanRow?.created_at ?? planRow.created_at)
            const { start: currWeekMonday } = getUserWeekInfo(registrationDate)

            const nextWeekLoadedAt = localStorage.getItem('next-week-loaded-at')
            const weekOverridden = nextWeekLoadedAt
              ? new Date(nextWeekLoadedAt) >= currWeekMonday
              : false

            const { data: weekFeedback } = await supabase
              .from('weekly_feedback')
              .select('id')
              .eq('user_id', user.id)
              .gte('created_at', currWeekMonday.toISOString())
              .limit(1)
              .maybeSingle()
            setWeekIsFinished(!weekOverridden && !!weekFeedback)

            if (logsData) {
              const prevWeekMonday = new Date(currWeekMonday.getTime() - 7 * 24 * 60 * 60 * 1000)

              ;[...logsData].reverse().forEach(log => {
                const loggedAt = new Date(log.logged_at)
                const logMonday = getLogWeekMonday(log.session_day, loggedAt)
                if (logMonday.getTime() === currWeekMonday.getTime()) {
                  if (!logsMap.has(log.session_day)) logsMap.set(log.session_day, new Map())
                  logsMap.get(log.session_day)!.set(log.exercise_name, log.sets_data)
                } else if (logMonday.getTime() === prevWeekMonday.getTime()) {
                  if (!prevLogsMap.has(log.session_day)) prevLogsMap.set(log.session_day, new Map())
                  const dayMap = prevLogsMap.get(log.session_day)!
                  if (!dayMap.has(log.exercise_name)) dayMap.set(log.exercise_name, log.sets_data)
                }
              })
            }

            // Load the plan that was active during the previous week (for viewing historical exercises)
            const { data: prevPlanRow } = await supabase
              .from('plans')
              .select('id, plan')
              .eq('user_id', user.id)
              .neq('id', planRow.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()

            // Set plan + logs together so ExerciseCards mount with correct initialLogs
            setPlan(planRow.plan as PlanResponse)
            setPlanId(planRow.id)
            setInputs(planRow.inputs as GenerateRequest)
            setPlanCreatedAt(registrationDate)
            setAllLogs(logsMap)
            setPrevLogs(prevLogsMap)
            if (prevPlanRow) setPrevPlan(prevPlanRow.plan as PlanResponse)
            setActiveDay(getInitialActiveDay((planRow.plan as PlanResponse).plan.sessions, new Set(logsMap.keys())))
            setIsAccepted(true)
            return
          }
        }

        // ── Path 4: sessionStorage plan with plan-id (previously accepted) ─────
        if (rawPlan) {
          const sessionPlan = JSON.parse(rawPlan) as PlanResponse
          setPlan(sessionPlan)
          if (rawInputs) setInputs(JSON.parse(rawInputs))
          if (storedPlanId) setPlanId(storedPlanId)
          setIsAccepted(storedAccepted === '1')
          setActiveDay(getInitialActiveDay(sessionPlan.plan.sessions))
          return
        }

        router.replace('/')
      } finally {
        setIsLoadingData(false)
      }
    }

    loadData()
  }, [router, loadKey])

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
      const dayLogs = new Map(next.get(sessionDay) ?? [])
      if (logs.length === 0) {
        dayLogs.delete(exerciseName)
      } else {
        dayLogs.set(exerciseName, logs)
      }
      if (dayLogs.size === 0) {
        next.delete(sessionDay)
      } else {
        next.set(sessionDay, dayLogs)
      }
      return next
    })
  }

  const handleDiscardNewPlan = () => {
    sessionStorage.removeItem('workout-plan')
    sessionStorage.removeItem('workout-inputs')
    sessionStorage.removeItem('plan-generating')
    setPlan(null)
    setPlanId(null)
    setIsAccepted(false)
    setAllLogs(new Map())
    setPrevLogs(new Map())
    setIsLoadingData(true)
    setLoadKey(k => k + 1)
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

  const handleConfirmFinishWeek = async () => {
    if (!plan || !inputs) return
    setShowFinishConfirm(false)
    setFinishWeekError('')
    setIsFinishingWeek(true)
    setFinishingMsgIdx(0)
    try {
      const analysisRes = await fetch('/api/analyse-progressions', { method: 'POST' })
      if (!analysisRes.ok) {
        const body = await analysisRes.json().catch(() => ({ error: String(analysisRes.status) }))
        throw new Error(body.error ?? 'Analysis failed')
      }
      const analysis: ProgressionAnalysis = await analysisRes.json()
      setWeekFinishAnalysis(analysis)

      const nextRes = await fetch('/api/plan-next-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPlan: plan.plan, inputs, analysis }),
      })
      if (!nextRes.ok) throw new Error('Plan generation failed')
      const result: NextWeekPlanResponse = await nextRes.json()
      sessionStorage.setItem('week-summary', JSON.stringify({ result, analysis }))
      router.push('/plan/week-summary')
    } catch (err) {
      console.error('Finish week error:', err)
      setFinishWeekError('Something went wrong. Try again.')
    } finally {
      setIsFinishingWeek(false)
    }
  }

  if (isGenerating) {
    return (
      <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-5">
        <div className="text-center max-w-xs">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-8">Calisthenics</p>
          {/* Steps indicator — step 4 of 4 complete + generating */}
          <div className="flex gap-1 mb-10 justify-center">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className={`h-1 w-10 rounded-full ${i < 4 ? 'bg-primary' : 'bg-primary/30'}`} />
            ))}
          </div>
          {generateError ? (
            <div className="flex flex-col items-center gap-4">
              <div className="text-center">
                <h2 className="text-xl font-bold mb-2">We had a problem generating your program.</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Something went wrong on our end. Hit try again — it usually works straight away.
                </p>
              </div>
              <button
                onClick={() => { setGenerateError(''); setIsGenerating(true) }}
                className="px-6 py-3 rounded-full bg-primary text-primary-foreground font-semibold text-sm"
              >
                Try again
              </button>
              <button
                onClick={() => router.replace('/')}
                className="text-xs text-muted-foreground underline underline-offset-2"
              >
                Start over
              </button>
            </div>
          ) : (
            <>
              <div className="flex justify-center mb-6">
                <svg className="animate-spin w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold mb-3">Building your program</h2>
              <p className="text-sm text-muted-foreground leading-relaxed min-h-[2.5rem] transition-all">
                {GENERATING_MESSAGES[generatingMsgIdx]}
              </p>
            </>
          )}
        </div>
      </main>
    )
  }

  if (!isGenerating && isLoadingData) {
    return (
      <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-5">
        <svg className="animate-spin w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </main>
    )
  }

  if (!plan) return null

  const { level, goal, days_per_week, sessions } = plan.plan
  const equipment = inputs?.equipment ?? []

  // When viewing a previous week, show that week's exercises (different plan version)
  const prevSessions = prevPlan?.plan.sessions ?? sessions
  const activeSession: Session = viewingPreviousWeek
    ? (prevSessions.find(s => s.day === sessions[activeDay]?.day) ?? prevSessions[activeDay] ?? sessions[activeDay] ?? sessions[0])
    : (sessions[activeDay] ?? sessions[0])
  const isRestDay = activeSession.type === 'rest'

  const displayLogs = viewingPreviousWeek ? prevLogs : allLogs
  const logsForActiveDay = displayLogs.get(activeSession.day) ?? new Map<string, SetLog[]>()
  const prevLogsForActiveDay = prevLogs.get(activeSession.day) ?? new Map<string, SetLog[]>()

  const currWeekInfo = planCreatedAt ? getUserWeekInfo(planCreatedAt) : null
  const prevWeekInfo = planCreatedAt ? getUserPrevWeekInfo(planCreatedAt) : null
  const weekNumber = currWeekInfo?.weekNumber ?? 1

  const firstName = displayName ? displayName.split('@')[0].split(' ')[0] : null
  const todayDayName = getTodayDayName()
  const todaySessionIdx = sessions.findIndex(s => s.day === todayDayName)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className={`max-w-2xl mx-auto px-5 sm:px-8 py-8 ${!isAccepted ? 'pb-36' : isAccepted && activeSession.day === 'Sunday' && allLogs.size > 0 ? 'pb-28' : ''}`}>

        {/* Header */}
        {!isAccepted ? (
          <div className="mb-8">
            {/* Onboarding steps — step 5 of 5 */}
            <div className="flex gap-1 mb-6">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="h-1 flex-1 rounded-full bg-primary" />
              ))}
            </div>
            <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-1">Your plan</p>
            <h1 className="text-2xl font-bold text-foreground">Review and accept to start training.</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {level} · {goal.toLowerCase()}
            </p>
            {userId && (
              <button
                onClick={handleDiscardNewPlan}
                className="mt-2 text-xs text-muted-foreground/60 hover:text-muted-foreground underline underline-offset-2 transition-colors"
              >
                Discard and keep previous plan
              </button>
            )}
          </div>
        ) : (
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
        )}

        {/* Week tabs */}
        {(() => {
          return (
            <>
              <div className="flex items-center gap-2 mb-3 pl-1">
                {viewingPreviousWeek ? (
                  <>
                    <button
                      onClick={() => setViewingPreviousWeek(false)}
                      className="text-muted-foreground/50 hover:text-muted-foreground text-base leading-none"
                      aria-label="View previous week"
                    >
                      ‹
                    </button>
                    <h2 className="text-[12px] font-semibold text-muted-foreground/60 flex-1">
                      {prevWeekInfo
                        ? `Week ${prevWeekInfo.weekNumber} · ${formatWeekLabel(prevWeekInfo.start, prevWeekInfo.end)}`
                        : 'Previous week'}
                    </h2>
                    <button
                      onClick={() => setViewingPreviousWeek(false)}
                      className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                      aria-label="Return to current week"
                    >
                      Today →
                    </button>
                  </>
                ) : (
                  <>
                    {prevWeekInfo && (
                      <button
                        onClick={() => setViewingPreviousWeek(true)}
                        className="text-muted-foreground/30 hover:text-muted-foreground/60 text-base leading-none"
                        aria-label="View previous week"
                      >
                        ‹
                      </button>
                    )}
                    <h2 className="text-[12px] font-semibold text-muted-foreground/60">
                      {currWeekInfo
                        ? `Week ${weekNumber} · ${formatWeekLabel(currWeekInfo.start, currWeekInfo.end)}`
                        : `Week ${weekNumber}`}
                    </h2>
                  </>
                )}
              </div>
              <div className="bg-card rounded-2xl p-1 flex gap-0.5 mb-1">
                {sessions.map((session, i) => {
                  const isRest = session.type === 'rest'
                  const isActive = activeDay === i
                  const isToday = !viewingPreviousWeek && todaySessionIdx === i
                  const isDone = !isRest && displayLogs.has(session.day)
                  const abbr = DAY_ABBR[session.day] ?? session.day.slice(0, 2).toUpperCase()
                  return (
                    <button
                      key={i}
                      onClick={() => { setActiveDay(i); setSessionUndo(null) }}
                      className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all ${
                        isDone && isActive
                          ? 'bg-primary shadow-sm ring-1 ring-primary'
                          : isDone
                          ? 'bg-primary/75'
                          : isActive
                          ? 'bg-foreground shadow-sm'
                          : 'hover:bg-secondary/40'
                      }`}
                    >
                      <span className={`text-[11px] font-bold tracking-wide ${
                        isDone
                          ? 'text-white/90'
                          : isActive
                          ? 'text-background'
                          : 'text-muted-foreground'
                      }`}>
                        {abbr}
                      </span>
                      {isDone ? (
                        <svg className="w-3 h-3 text-white/80" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : isRest ? (
                        <div className={`w-1.5 h-1.5 rounded-full border ${
                          isActive ? 'border-background' : 'border-border'
                        }`} />
                      ) : (
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          isActive ? 'bg-background' : 'bg-muted-foreground/40'
                        }`} />
                      )}
                      <div className={`w-1 h-1 rounded-full transition-colors ${
                        isToday && !isDone ? 'bg-amber-400' : 'bg-transparent'
                      }`} />
                    </button>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground/40 mt-2 mb-5 pl-1">
                On sunday your weekly schema will be updated.
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
              weekNumber={weekNumber}
              logsForDay={logsForActiveDay}
              prevLogsForDay={prevLogsForActiveDay}
              onReplaceExercise={(ei, updated) =>
                replaceExercise(activeDay, bi, ei, updated)
              }
              onLogsChange={(exerciseName, logs) =>
                updateLogs(activeSession.day, exerciseName, logs)
              }
              onSetLogged={handleSetLogged}
              onAdjusted={schedulePlanSave}
              onUndone={cancelPlanSave}
              isPreview={!isAccepted || isRestDay || viewingPreviousWeek || weekIsFinished}
            />
          ))}
        </div>

        {/* Session undo notice — shown after progression until dismissed or day changes */}
        {sessionUndo && sessionUndo.sessionIndex === activeDay && !viewingPreviousWeek && !weekIsFinished && (
          <div className="mt-6 flex items-center justify-between rounded-xl border border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">Session updated with harder exercises.</p>
            <button
              onClick={() => {
                replaceSession(sessionUndo.sessionIndex, sessionUndo.session)
                setSessionUndo(null)
              }}
              className="shrink-0 ml-4 flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>↩</span> Undo
            </button>
          </div>
        )}

        {/* Refine this day — only on accepted workout days, not when viewing previous week */}
        {inputs && isAccepted && !isRestDay && !viewingPreviousWeek && !weekIsFinished && (
          <RefineDayForm
            session={activeSession}
            inputs={inputs}
            onRefined={(updated) => replaceSession(activeDay, updated)}
          />
        )}

      </div>

      {/* Sticky bottom bar — accept plan only */}
      {inputs && !isAccepted && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto px-5 sm:px-8 py-4">
            <p className="text-xs text-muted-foreground mb-3 text-center">
              Review the plan above, then accept it to start logging your workouts.
            </p>
            <Button
              onClick={handleAcceptPlan}
              className="w-full h-12 text-base bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
            >
              Accept plan →
            </Button>
          </div>
        </div>
      )}

      {/* Sticky bottom bar — finish week (Sunday only) */}
      {isAccepted && activeSession.day === 'Sunday' && allLogs.size > 0 && !viewingPreviousWeek && !weekIsFinished && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto px-5 sm:px-8 py-2 sm:py-4">
            <Button
              onClick={() => setShowFinishConfirm(true)}
              className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Finish week →
            </Button>
          </div>
        </div>
      )}

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

      {/* Finish week — confirmation sheet */}
      {showFinishConfirm && (
        <FinishWeekConfirmSheet
          onConfirm={handleConfirmFinishWeek}
          onDismiss={() => setShowFinishConfirm(false)}
        />
      )}

      {/* Finish week — loading overlay */}
      {isFinishingWeek && <FinishWeekLoadingOverlay msgIdx={finishingMsgIdx} />}

      {/* Finish week — error overlay */}
      {finishWeekError && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl bg-card border-t border-border rounded-t-3xl px-6 pt-6 pb-12 flex flex-col gap-5">
            <div className="w-10 h-1 bg-border rounded-full mb-1 mx-auto" />
            <div>
              <p className="text-xs font-semibold tracking-widest text-destructive uppercase mb-1">Something went wrong</p>
              <h2 className="text-2xl font-black text-foreground leading-tight">Couldn&apos;t analyse your week</h2>
              <p className="text-muted-foreground mt-2 text-sm font-mono break-all">{finishWeekError}</p>
            </div>
            <div className="flex flex-col gap-3 mt-2">
              <Button
                onClick={() => { setFinishWeekError(''); handleConfirmFinishWeek() }}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-base h-12"
              >
                Try again
              </Button>
              <button
                onClick={() => setFinishWeekError('')}
                className="w-full text-sm text-muted-foreground py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  )
}
