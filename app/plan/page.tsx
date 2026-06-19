'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PlanResponse, Session, Block, Exercise, SetLog, ExerciseLog, GenerateRequest, NextWeekPlanResponse, ProgressionAnalysis, WeeklyFeedback, HolidayConfig, LockWorkoutConfig } from '@/lib/types'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
  Monday: 'MON',
  Tuesday: 'TUE',
  Wednesday: 'WED',
  Thursday: 'THU',
  Friday: 'FRI',
  Saturday: 'SAT',
  Sunday: 'SUN',
}

const EQUIPMENT_LABELS: Record<string, string> = {
  'pull-up bar': 'Pull-up bar',
  'resistance bands': 'Bands',
  'rings': 'Rings',
  'parallettes': 'Parallettes',
  'barbell & plates': 'Barbell',
  'full gym access': 'Full gym',
}


const EMPTY_LOGS: SetLog[] = []

// ─── Helpers ──────────────────────────────────────────────────────────────────

function youtubeUrl(exerciseName: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(exerciseName + ' calisthenics tutorial')}`
}

function isTimed(reps: string) {
  return /\d+\s*(s|sec|seconds?)\b/i.test(reps)
}

function eachSide(reps: string) {
  return /\b(each|per)\s+(side|leg|arm|limb)\b/i.test(reps)
}

function suggestsBand(exercise: { notes?: string; name?: string }): boolean {
  const text = `${exercise.notes ?? ''} ${exercise.name ?? ''}`.toLowerCase()
  return /resistance band|band[-\s]assist/i.test(text)
}

// ─── Workout session tracking ──────────────────────────────────────────────────

type WorkoutSessionInfo = {
  startedAt: string
  endedAt: string | null
  isComplete: boolean
}

function isAllSetsDone(session: Session, logs: Map<string, SetLog[]>): boolean {
  return session.blocks.flatMap(b => b.exercises).every(ex => {
    const expected = eachSide(ex.reps) ? ex.sets * 2 : ex.sets
    return (logs.get(ex.name) ?? []).length >= expected
  })
}

function parseTargetReps(reps: string): number | null {
  const rangeMatch = reps.match(/(\d+)-(\d+)/)
  if (rangeMatch) return parseInt(rangeMatch[2])
  const singleMatch = reps.match(/^(\d+)$/)
  if (singleMatch) return parseInt(singleMatch[1])
  return null
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

function getWeekInfoByOffset(planCreatedAt: Date, offset: number): { weekNumber: number; start: Date; end: Date } {
  const curr = getUserWeekInfo(planCreatedAt)
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const start = new Date(curr.start.getTime() - offset * msPerWeek)
  const end = new Date(curr.end.getTime() - offset * msPerWeek)
  return { weekNumber: Math.max(1, curr.weekNumber - offset), start, end }
}

function formatWeekLabel(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString('en-US', opts)} - ${end.toLocaleDateString('en-US', opts)}`
}

function formatPrevLog(log: SetLog | null | undefined): string {
  if (!log) return '✓'
  if (log.duration_s !== undefined) return `${log.duration_s}s`
  if (log.reps !== undefined) {
    let s = log.weight_kg ? `${log.reps}×${log.weight_kg}kg` : String(log.reps)
    if (log.band_reps) s += `+${log.band_reps}rb`
    else if (log.resistance_band) s += 'rb'
    return s
  }
  return '✓'
}

// ─── RestTimerOverlay ─────────────────────────────────────────────────────────

interface RestTimerOverlayProps {
  remaining: number
  total: number
  nextExercise: Exercise | null
  onDismiss: () => void
  onMinimize: () => void
}

function RestTimerOverlay({ remaining, total, nextExercise, onDismiss, onMinimize }: RestTimerOverlayProps) {
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
  onSetLogged: (restSeconds: number, exerciseName: string | null) => void
  onAdjusted: (oldExerciseName: string, sessionDay: string) => void
  onUndone: () => void
  isPreview: boolean
  hideAdjust?: boolean
  hideLogger?: boolean
  isHighlighted?: boolean
}

const ExerciseCard = memo(function ExerciseCard({
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
  hideAdjust = false,
  hideLogger = false,
  isHighlighted = false,
}: ExerciseCardProps) {
  const [adjusting, setAdjusting] = useState<'regression' | 'progression' | 'injury' | null>(null)
  const [limitMessage, setLimitMessage] = useState('')
  const [previousExercise, setPreviousExercise] = useState<Exercise | null>(null)
  const [undoCountdown, setUndoCountdown] = useState<number | null>(null)
  const [showSwap, setShowSwap] = useState(false)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isEachSide = eachSide(exercise.reps)
  const totalSlots = isEachSide ? exercise.sets * 2 : exercise.sets

  const [setLogs, setSetLogs] = useState<(SetLog | null)[]>(() => {
    const arr: (SetLog | null)[] = Array(totalSlots).fill(null)
    initialLogs.forEach((log, i) => { if (i < totalSlots) arr[i] = log })
    return arr
  })

  // Sync setLogs when initialLogs or exercise changes (handles DB load completing after mount)
  useEffect(() => {
    const each = eachSide(exercise.reps)
    const slots = each ? exercise.sets * 2 : exercise.sets
    setSetLogs(() => {
      const arr: (SetLog | null)[] = Array(slots).fill(null)
      initialLogs.forEach((log, i) => { if (i < slots) arr[i] = log })
      return arr
    })
  }, [initialLogs, exercise.sets, exercise.reps])

  const [selectedSetIndex, setSelectedSetIndex] = useState<number | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [weightValue, setWeightValue] = useState('')
  const [bandAssisted, setBandAssisted] = useState(false)
  const [bandRepsValue, setBandRepsValue] = useState('')
  const bandRepsRef = useRef<HTMLInputElement>(null)
  const isBandExercise = suggestsBand(exercise)
  const [timer, setTimer] = useState<TimerPhase>({ phase: 'idle' })
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const currentLogsRef = useRef<SetLog[]>([])
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
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

  const focusRef = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
    el?.focus()
  }, [])

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
        setBandAssisted(existing.resistance_band ?? false)
        setBandRepsValue(existing.band_reps !== undefined ? String(existing.band_reps) : '')
      } else {
        setInputValue('')
        setWeightValue('')
        setBandAssisted(false)
        setBandRepsValue('')
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
    setBandAssisted(false)
    setBandRepsValue('')
  }

  function logReps() {
    if (selectedSetIndex === null) return
    const reps = parseInt(inputValue)
    if (isNaN(reps) || reps < 0) return
    const log: SetLog = { reps }
    const w = parseFloat(weightValue)
    if (!isNaN(w) && w > 0) log.weight_kg = w
    if (isBandExercise) {
      const br = parseInt(bandRepsValue)
      if (!isNaN(br) && br > 0) {
        log.band_reps = br
      } else if (bandAssisted) {
        log.resistance_band = true
      }
    }
    commitLog(selectedSetIndex, log)
    closePanel()
  }

  function setLogDisplay(log: SetLog): string {
    if (log.duration_s !== undefined) return `${log.duration_s}s`
    if (log.reps !== undefined) {
      let s = log.weight_kg ? `${log.reps}·${log.weight_kg}kg` : String(log.reps)
      if (log.band_reps) s += `+${log.band_reps}rb`
      else if (log.resistance_band) s += 'rb'
      return s
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
      const allSetsDone = updated.every(l => l !== null)
      onSetLogged(exercise.rest_seconds, allSetsDone ? exercise.name : null)
    }

    schedulePersist(filledLogs)
  }

  const adjust = async (direction: 'regression' | 'progression', reason?: 'injury') => {
    setAdjusting(reason === 'injury' ? 'injury' : direction)
    setLimitMessage('')
    setPreviousExercise(null)
    try {
      const res = await fetch('/api/adjust-exercise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseName: exercise.name, direction, level, equipment, goal, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.at_limit) {
        setLimitMessage(data.notes)
      } else {
        setPreviousExercise(exercise)   // save before replacing
        onReplace(data)
        const newSlots = eachSide(data.reps) ? data.sets * 2 : data.sets
        setSetLogs(Array(newSlots).fill(null))
        closePanel()
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
    const prevSlots = eachSide(previousExercise.reps) ? previousExercise.sets * 2 : previousExercise.sets
    setSetLogs(Array(prevSlots).fill(null))
    setPreviousExercise(null)
  }

  const activeTimerSet = (timer.phase === 'countdown' || timer.phase === 'running' || timer.phase === 'logged')
    ? timer.setIndex : -1
  const timerActive = timer.phase !== 'idle'

  const panelIdx: number = selectedSetIndex !== null
    ? selectedSetIndex
    : (timer.phase === 'countdown' || timer.phase === 'running' || timer.phase === 'logged')
      ? timer.setIndex
      : 0
  const panelSetNum = isEachSide ? Math.floor(panelIdx / 2) + 1 : panelIdx + 1
  const panelSide = isEachSide ? ` · ${panelIdx % 2 === 0 ? 'Left' : 'Right'}` : ''
  const panelTitle = `Set ${panelSetNum}${panelSide}`

  return (
    <div id={`exercise-${exercise.name}`} className={`bg-card rounded-xl border border-border p-4 flex flex-col gap-2 transition-all${isHighlighted ? ' ring-2 ring-primary' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <p className="font-semibold text-foreground leading-tight">{exercise.name}</p>
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
        <div className="grid gap-2 pt-1" style={{ gridTemplateColumns: isEachSide ? 'repeat(2, 1fr)' : `repeat(${exercise.sets}, 1fr)` }}>
          {setLogs.map((log, i) => {
            const shortLabel = isEachSide
              ? (exercise.sets > 1 ? `S${Math.floor(i / 2) + 1}·${i % 2 === 0 ? 'L' : 'R'}` : (i % 2 === 0 ? 'L' : 'R'))
              : `S${i + 1}`
            const emptyLabel = isEachSide ? (i % 2 === 0 ? 'Left' : 'Right') : `Set ${i + 1}`
            return (
              <div
                key={i}
                className={`rounded-xl border py-2 ${
                  log !== null
                    ? 'bg-[var(--sage)] border-[var(--sage)] text-white'
                    : 'border-border bg-card text-muted-foreground'
                }`}
              >
                {log !== null ? (
                  <div className="flex flex-col items-center leading-none gap-0.5">
                    <span className="text-[10px] font-semibold uppercase text-white/70">{shortLabel}</span>
                    <span className="text-sm font-bold">{setLogDisplay(log)}</span>
                  </div>
                ) : (
                  <span className="text-sm font-semibold text-center block">{emptyLabel}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Rep logger — hidden in preview mode and during plan review */}
      {!isPreview && !hideLogger && (
        <div className="flex flex-col gap-2 pt-1">

          {/* Set buttons row */}
          <div className="grid gap-2" style={{ gridTemplateColumns: isEachSide ? 'repeat(2, 1fr)' : `repeat(${exercise.sets}, 1fr)` }}>
            {Array.from({ length: totalSlots }).map((_, i) => {
              const isRunningThis = activeTimerSet === i
              const isSelected = selectedSetIndex === i && !timerActive
              const log = setLogs[i] ?? null
              const isDone = log !== null
              const shortLabel = isEachSide
                ? (exercise.sets > 1 ? `S${Math.floor(i / 2) + 1}·${i % 2 === 0 ? 'L' : 'R'}` : (i % 2 === 0 ? 'L' : 'R'))
                : `S${i + 1}`
              const emptyLabel = isEachSide ? (i % 2 === 0 ? 'Left' : 'Right') : `Set ${i + 1}`
              return (
                <button
                  key={i}
                  onClick={() => openSet(i)}
                  disabled={timerActive}
                  className={`rounded-xl border transition-all disabled:cursor-default ${
                    isRunningThis
                      ? 'bg-[var(--sage)] border-[var(--sage)] text-white py-2'
                      : isDone
                      ? 'bg-[var(--sage)] border-[var(--sage)] text-white py-2'
                      : isSelected
                      ? 'border-foreground/20 bg-background text-foreground py-2.5'
                      : 'border-border bg-card text-muted-foreground py-2.5'
                  }`}
                >
                  {isDone || isRunningThis ? (
                    <div className="flex flex-col items-center leading-none gap-0.5">
                      <span className="text-[10px] font-semibold uppercase text-white/70">{shortLabel}</span>
                      <span className="text-sm font-bold">
                        {isRunningThis ? `${elapsed}s` : setLogDisplay(log!)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm font-semibold">{emptyLabel}</span>
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
                    {panelTitle} · Target: {exercise.reps}
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
                    {panelTitle} · Target: {exercise.reps}
                  </p>
                  <form onSubmit={e => { e.preventDefault(); logManualSeconds(); }} className="flex items-center gap-3 w-full">
                    <input
                      ref={focusRef}
                      type="number"
                      inputMode="numeric"
                      enterKeyHint="done"
                      min={0}
                      max={9999}
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') logManualSeconds(); if (e.key === 'Escape') setShowManual(false) }}
                      placeholder="seconds"
                      className="flex-1 bg-secondary border border-border rounded-xl px-4 py-3 text-lg text-foreground text-center focus:outline-none focus:border-primary"
                      style={{ fontSize: '16px' }}
                    />
                    <button type="submit" className="px-5 py-3 rounded-full bg-primary text-primary-foreground font-bold text-sm">
                      {setLogs[selectedSetIndex!] !== null ? 'Update' : 'Log'}
                    </button>
                    {setLogs[selectedSetIndex!] !== null && (
                      <button type="button" onClick={() => removeLog(selectedSetIndex!)} className="text-muted-foreground hover:text-red-400 text-xs px-1 transition-colors">
                        Remove
                      </button>
                    )}
                    <button type="button" onClick={() => setShowManual(false)} className="text-muted-foreground text-sm px-1">✕</button>
                  </form>
                </>
              )}

              {/* idle + reps */}
              {timer.phase === 'idle' && !timed && (
                <>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground text-center">
                    {panelTitle}
                  </p>
                  <form onSubmit={e => { e.preventDefault(); logReps(); }} className="flex items-center gap-2 w-full">
                    <input
                      ref={focusRef}
                      type="number"
                      inputMode="numeric"
                      enterKeyHint="done"
                      min={0}
                      max={999}
                      value={inputValue}
                      onChange={e => setInputValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') logReps(); if (e.key === 'Escape') closePanel() }}
                      placeholder="Reps"
                      className="flex-1 bg-secondary border border-border rounded-xl px-3 py-3 text-lg text-foreground text-center focus:outline-none focus:border-primary"
                      style={{ fontSize: '16px' }}
                    />
                    <div className="relative">
                      <input
                        type="number"
                        inputMode="decimal"
                        enterKeyHint="done"
                        min={0}
                        max={999}
                        step={0.5}
                        value={weightValue}
                        onChange={e => setWeightValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') logReps() }}
                        placeholder="kg"
                        className="w-20 bg-secondary border border-border rounded-xl px-3 py-3 text-lg text-foreground text-center focus:outline-none focus:border-primary pr-7"
                        style={{ fontSize: '16px' }}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">kg</span>
                    </div>
                    <button type="submit" className="px-5 py-3 rounded-full bg-primary text-primary-foreground font-bold text-sm">
                      {setLogs[selectedSetIndex!] !== null ? 'Update' : 'Log'}
                    </button>
                  </form>
                  {/* Band assistance controls — shown when exercise notes mention resistance band */}
                  {isBandExercise && (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => { setBandAssisted(b => { if (!b) setTimeout(() => bandRepsRef.current?.focus(), 50); return !b }); setBandRepsValue('') }}
                        className={`self-start flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                          bandAssisted
                            ? 'bg-violet-500/15 border-violet-500/40 text-violet-400'
                            : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                        }`}
                      >
                        <span className={`w-3 h-3 rounded-full border flex items-center justify-center ${bandAssisted ? 'border-violet-400 bg-violet-400' : 'border-muted-foreground'}`}>
                          {bandAssisted && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </span>
                        Band-assisted
                      </button>
                      {bandAssisted && (
                        <div className="flex items-center gap-2">
                          <input
                            ref={bandRepsRef}
                            type="number"
                            inputMode="numeric"
                            enterKeyHint="done"
                            min={0}
                            max={99}
                            value={bandRepsValue}
                            onChange={e => setBandRepsValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') logReps() }}
                            placeholder="Band reps"
                            className="w-28 bg-secondary border border-border rounded-xl px-3 py-2 text-sm text-foreground text-center focus:outline-none focus:border-violet-500"
                            style={{ fontSize: '16px' }}
                          />
                          <p className="text-xs text-muted-foreground leading-tight">extra reps<br/>with band</p>
                        </div>
                      )}
                    </div>
                  )}
                  {setLogs[selectedSetIndex!] !== null && (
                    <button
                      type="button"
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

      {/* Swap exercise — hidden in preview/history mode and on stretch days */}
      {!isPreview && !hideAdjust && (
        <div className="mt-2 pt-3 border-t border-border/50">
          {!showSwap ? (
            <button
              onClick={() => setShowSwap(true)}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Too hard or easy? Swap exercise
            </button>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <p className="text-xs text-muted-foreground">Swap this exercise:</p>
                <button
                  onClick={() => setShowSwap(false)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  ✕
                </button>
              </div>
              <div className="flex gap-2">
                {([
                  { label: 'Too hard', key: 'regression', dir: 'regression' as const, reason: undefined },
                  { label: 'Injury', key: 'injury', dir: 'regression' as const, reason: 'injury' as const },
                  { label: 'Too easy', key: 'progression', dir: 'progression' as const, reason: undefined },
                ] as const).map(({ label, key, dir, reason: r }) => (
                  <button
                    key={key}
                    onClick={() => adjust(dir, r)}
                    disabled={adjusting !== null}
                    className="flex-1 flex items-center justify-center gap-1.5 text-sm py-2 rounded-full bg-secondary text-foreground/70 font-medium hover:bg-secondary/70 hover:text-foreground disabled:opacity-40 transition-all"
                  >
                    {adjusting === key ? (
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                    ) : null}
                    {label}
                  </button>
                ))}
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
      )}
    </div>
  )
}

, (prev, next) =>
  prev.exercise === next.exercise &&
  prev.initialLogs === next.initialLogs &&
  prev.prevSetsData === next.prevSetsData &&
  prev.isPreview === next.isPreview &&
  prev.isHighlighted === next.isHighlighted &&
  prev.weekNumber === next.weekNumber &&
  prev.planId === next.planId
)

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
  onSetLogged: (restSeconds: number, exerciseName: string | null) => void
  onAdjusted: (oldExerciseName: string, sessionDay: string) => void
  onUndone: () => void
  isPreview: boolean
  hideAdjust?: boolean
  hideLogger?: boolean
  highlightedExercise?: string | null
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
  hideAdjust = false,
  hideLogger = false,
  highlightedExercise,
}: BlockSectionProps) {
  return (
    <div className="mb-5">
      <p className={`text-xs font-semibold tracking-widest uppercase mb-3 ${BLOCK_COLORS[block.type] ?? 'text-muted-foreground'}`}>
        {BLOCK_LABELS[block.type] ?? block.type}
      </p>
      <div className="flex flex-col gap-6">
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
            initialLogs={logsForDay.get(ex.name) ?? EMPTY_LOGS}
            prevSetsData={prevLogsForDay.get(ex.name)}
            onReplace={(updated) => onReplaceExercise(i, updated)}
            onLogsChange={(logs) => onLogsChange(ex.name, logs)}
            onSetLogged={onSetLogged}
            onAdjusted={onAdjusted}
            onUndone={onUndone}
            isPreview={isPreview}
            hideAdjust={hideAdjust}
            hideLogger={hideLogger}
            isHighlighted={highlightedExercise === ex.name}
          />
        ))}
      </div>
    </div>
  )
}

// ─── RefineDayForm ────────────────────────────────────────────────────────────

type RefineTiming = 'now' | 'next-week'
type RefineSwapMode = 'keep-logged' | 'swap-mentioned-only'

interface RefineDayFormProps {
  session: Session
  inputs: GenerateRequest
  logsForDay: Map<string, SetLog[]>
  onRefined: (updated: Session) => void
  onRefinedNextWeek: (updated: Session) => void
}

function RefineDayForm({ session, inputs, logsForDay, onRefined, onRefinedNextWeek }: RefineDayFormProps) {
  const isRestSession = session.type === 'rest'
  const [open, setOpen] = useState(false)
  const [timing, setTiming] = useState<RefineTiming | null>(null)
  const [swapMode, setSwapMode] = useState<RefineSwapMode | null>(null)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savedNextWeek, setSavedNextWeek] = useState(false)

  const completedExercises = Array.from(logsForDay.keys())
  const hasLogs = completedExercises.length > 0

  function reset() {
    setOpen(false)
    setTiming(null)
    setSwapMode(null)
    setFeedback('')
    setError('')
    setSavedNextWeek(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedback.trim()) return
    setLoading(true)
    setError('')
    try {
      const effectiveSwapMode: RefineSwapMode | undefined =
        timing === 'now' && hasLogs
          ? (swapMode ?? 'keep-logged')
          : undefined

      const res = await fetch('/api/refine-day', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session,
          inputs,
          feedback,
          completedExercises: effectiveSwapMode === 'keep-logged' ? completedExercises : undefined,
          swapMode: effectiveSwapMode,
        }),
      })
      if (!res.ok) throw new Error('Refinement failed')
      const data = await res.json()

      if (timing === 'next-week') {
        onRefinedNextWeek(data.session)
        setSavedNextWeek(true)
        setLoading(false)
        return
      }

      onRefined(data.session)
      reset()
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

  // Saved for next week confirmation
  if (savedNextWeek) {
    return (
      <div className="mt-6 border border-border rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-foreground">Saved for next week</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">Your changes have been applied to the plan. They&apos;ll be there when this day comes up next week.</p>
        <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground transition-colors self-start underline underline-offset-2">Dismiss</button>
      </div>
    )
  }

  // Step 1: timing
  if (timing === null) {
    return (
      <div className="mt-6 border border-border rounded-xl p-4">
        <p className="text-xs font-semibold tracking-widest text-teal-400 uppercase mb-1">Refine this day</p>
        <p className="text-sm text-muted-foreground mb-4">When should the changes apply?</p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setTiming('now')}
            className="flex items-start gap-3 text-left px-4 py-3 rounded-xl border border-border hover:border-primary/40 hover:bg-secondary/40 transition-colors"
          >
            <div className="w-5 h-5 rounded-full border-2 border-primary/50 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Right now</p>
              <p className="text-xs text-muted-foreground mt-0.5">Apply to today&apos;s session immediately.</p>
            </div>
          </button>
          <button
            onClick={() => setTiming('next-week')}
            className="flex items-start gap-3 text-left px-4 py-3 rounded-xl border border-border hover:border-primary/40 hover:bg-secondary/40 transition-colors"
          >
            <div className="w-5 h-5 rounded-full border-2 border-border mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Next week</p>
              <p className="text-xs text-muted-foreground mt-0.5">Save the change for next week — today stays as-is.</p>
            </div>
          </button>
        </div>
        <button onClick={reset} className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
      </div>
    )
  }

  // Step 2: if timing=now and there are logs, ask swap mode
  if (timing === 'now' && hasLogs && swapMode === null) {
    return (
      <div className="mt-6 border border-border rounded-xl p-4">
        <p className="text-xs font-semibold tracking-widest text-teal-400 uppercase mb-1">Refine this day</p>
        <p className="text-sm text-muted-foreground mb-1">You&apos;ve already logged {completedExercises.length} exercise{completedExercises.length > 1 ? 's' : ''}. How should we handle that?</p>
        <p className="text-xs text-muted-foreground mb-4 opacity-70">Logged: {completedExercises.join(', ')}</p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setSwapMode('keep-logged')}
            className="flex items-start gap-3 text-left px-4 py-3 rounded-xl border border-border hover:border-primary/40 hover:bg-secondary/40 transition-colors"
          >
            <div className="w-5 h-5 rounded-full border-2 border-primary/50 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Keep completed, adjust the rest</p>
              <p className="text-xs text-muted-foreground mt-0.5">Logged exercises stay in place. Only upcoming exercises are changed.</p>
            </div>
          </button>
          <button
            onClick={() => setSwapMode('swap-mentioned-only')}
            className="flex items-start gap-3 text-left px-4 py-3 rounded-xl border border-border hover:border-primary/40 hover:bg-secondary/40 transition-colors"
          >
            <div className="w-5 h-5 rounded-full border-2 border-border mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-foreground">Only swap exercises I mention</p>
              <p className="text-xs text-muted-foreground mt-0.5">Everything stays as-is except exercises you name in your feedback.</p>
            </div>
          </button>
        </div>
        <button onClick={() => setTiming(null)} className="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors">← Back</button>
      </div>
    )
  }

  // Final step: feedback form
  const subtitle = timing === 'next-week'
    ? 'These changes will apply next time this day comes up.'
    : swapMode === 'keep-logged'
    ? 'Logged exercises are kept. Describe what to change in the remaining exercises.'
    : swapMode === 'swap-mentioned-only'
    ? 'Name the exercises you want swapped, and describe the change.'
    : 'Describe what you want to change about today\'s session.'

  return (
    <div className="mt-6 border border-border rounded-xl p-4">
      <p className="text-xs font-semibold tracking-widest text-teal-400 uppercase mb-1">Refine this day</p>
      <p className="text-sm text-muted-foreground mb-4">{subtitle}</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Textarea
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder={isRestSession
            ? 'e.g. Focus on hip flexors and thoracic mobility… or add some wrist prep…'
            : 'e.g. Swap the ring rows for pull-ups, and make the warm-up shorter…'}

          rows={2}
          className="bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/50 focus-visible:border-primary resize-none"
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (timing === 'now' && hasLogs) setSwapMode(null)
              else setTiming(null)
            }}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary text-sm"
          >
            ← Back
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
            ) : timing === 'next-week' ? 'Save for next week →' : 'Refine →'}
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

// ─── WeeklyFeedbackCard ───────────────────────────────────────────────────────

function weekLabel(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

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

// ─── SignUpModal ──────────────────────────────────────────────────────────────

interface SignUpModalProps {
  plan: PlanResponse
  inputs: GenerateRequest
  onSuccess: (planId: string, userId: string, displayName: string | null) => void
  onClose: () => void
}

function SignUpModal({ plan, inputs, onSuccess, onClose }: SignUpModalProps) {
  const supabase = createSupabaseBrowser()
  const [name, setName] = useState('')
  const [email, setEmail] = useState(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('guest-email') ?? ''
    return ''
  })
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name.trim() || undefined } },
    })

    if (signUpError || !data.user) {
      setError(signUpError?.message ?? 'Sign-up failed. Please try again.')
      setLoading(false)
      return
    }

    const res = await fetch('/api/save-guest-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: data.user.id, plan, inputs }),
    })

    if (!res.ok) {
      setError('Your account was created but we couldn\'t save your plan. Please sign in and try again.')
      setLoading(false)
      return
    }

    const { planId } = await res.json()
    sessionStorage.setItem('plan-id', planId)
    sessionStorage.setItem('plan-accepted', '1')
    sessionStorage.removeItem('guest-email')
    setSaved(true)
    setLoading(false)
    onSuccess(planId, data.user.id, name.trim() || (data.user.email ?? null))
  }

  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-xl">
        {saved ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-bold mb-1">Plan saved!</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">Check your email to confirm your account — your plan will be waiting when you sign in.</p>
            <Button onClick={onClose} className="mt-5 w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold h-10">Done</Button>
          </div>
        ) : (
          <>
            <div className="mb-5">
              <h2 className="text-lg font-bold">Save your plan</h2>
              <p className="text-sm text-muted-foreground mt-1">Create a free account to save your program and track your progress.</p>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sm-name" className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Your name</Label>
                <Input id="sm-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Raymond" autoComplete="name"
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/30 focus-visible:border-primary" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sm-email" className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Email</Label>
                <Input id="sm-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" autoComplete="email"
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/30 focus-visible:border-primary" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sm-password" className="text-xs text-muted-foreground font-medium uppercase tracking-widest">Password</Label>
                <Input id="sm-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="new-password"
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/30 focus-visible:border-primary" />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" disabled={loading} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold disabled:opacity-40 flex items-center justify-center gap-2 mt-1 h-10">
                {loading ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>Saving…</>
                ) : 'Create account & save plan'}
              </Button>
              <button type="button" onClick={onClose} className="text-xs text-muted-foreground text-center mt-1 hover:text-foreground transition-colors">Maybe later</button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ─── OnboardingTooltip ────────────────────────────────────────────────────────

interface OnboardingTooltipProps {
  onDismiss: () => void
}

const TOOLTIP_STEPS = [
  {
    icon: (
      <div className="flex gap-2 justify-center">
        {[1, 2, 3].map(i => (
          <div key={i} className="w-10 h-10 rounded-full border-2 border-primary bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">{i}</div>
        ))}
      </div>
    ),
    title: 'Tap a bubble to log a set',
    body: 'Each circle represents one set. Tap it after you finish — fill in your reps and you\'re done.',
  },
  {
    icon: (
      <div className="flex justify-center">
        <div className="w-14 h-14 rounded-full border-4 border-emerald-500 bg-emerald-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>
    ),
    title: 'Hit your target? You\'ll get a progression hint',
    body: 'When you nail the top of your rep range across all sets, a green ring appears — time to level up.',
  },
  {
    icon: (
      <div className="flex justify-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          <svg className="w-7 h-7 text-primary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
      </div>
    ),
    title: 'Use feedback to evolve your plan',
    body: 'At the bottom of any day, tell us what\'s working or not. It\'ll rebuild the plan around your progress.',
  },
]

function OnboardingTooltip({ onDismiss }: OnboardingTooltipProps) {
  const [step, setStep] = useState(0)
  const isLast = step === TOOLTIP_STEPS.length - 1
  const current = TOOLTIP_STEPS[step]

  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-xl">
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-1.5">
            {TOOLTIP_STEPS.map((_, i) => (
              <div key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-primary' : 'w-1.5 bg-border'}`} />
            ))}
          </div>
          <button onClick={onDismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Skip</button>
        </div>

        <div className="mb-5">{current.icon}</div>
        <h2 className="text-base font-bold mb-2 text-center">{current.title}</h2>
        <p className="text-sm text-muted-foreground text-center leading-relaxed">{current.body}</p>

        <div className="mt-6 flex gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1 h-10 text-sm border-border bg-transparent hover:bg-secondary">Back</Button>
          )}
          {isLast ? (
            <Button onClick={onDismiss} className="flex-1 h-10 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">Got it</Button>
          ) : (
            <Button onClick={() => setStep(s => s + 1)} className="flex-1 h-10 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">Next</Button>
          )}
        </div>
      </div>
    </div>
  )
}

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
  const [showSignUpModal, setShowSignUpModal] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [restTimer, setRestTimer] = useState<{ remaining: number; total: number; minimized: boolean; nextExercise: Exercise | null } | null>(null)
  const [highlightedExercise, setHighlightedExercise] = useState<string | null>(null)
  const nextExerciseAfterRestRef = useRef<Exercise | null>(null)
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
  const [weekOffset, setWeekOffset] = useState(0)
  const [weekLogsMap, setWeekLogsMap] = useState<Map<number, Map<string, Map<string, SetLog[]>>>>(new Map())
  const [weekSessionsMap, setWeekSessionsMap] = useState<Map<string, Session[]>>(new Map())
  const [weekIsFinished, setWeekIsFinished] = useState(false)
  const [hasFeedbackThisWeek, setHasFeedbackThisWeek] = useState(false)
  const [weeklyFeedbacks, setWeeklyFeedbacks] = useState<WeeklyFeedback[]>([])
  const [workoutSessions, setWorkoutSessions] = useState<Map<string, WorkoutSessionInfo>>(new Map())
  const [lastLoggedAt, setLastLoggedAt] = useState<Date | null>(null)
  const [isHolidayMode, setIsHolidayMode] = useState(false)
  const [isLockWorkout, setIsLockWorkout] = useState(false)

  const planRef = useRef(plan)
  useEffect(() => { planRef.current = plan }, [plan])
  // Snapshot of sessions at load time — used as fallback for the previous-week view
  // so that in-session exercise adjustments don't bleed into historical views.
  const loadedSessionsRef = useRef<Session[] | null>(null)
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

  const workoutSessionsKey = `workout-sessions-${getCalendarMonday(new Date()).toISOString().slice(0, 10)}`

  const startWorkout = (sessionDay: string) => {
    setWorkoutSessions(prev => {
      if (prev.get(sessionDay)?.startedAt) return prev
      const next = new Map(prev)
      next.set(sessionDay, { startedAt: new Date().toISOString(), endedAt: null, isComplete: false })
      return next
    })
  }

  const endWorkout = (sessionDay: string) => {
    setWorkoutSessions(prev => {
      const existing = prev.get(sessionDay)
      if (existing?.isComplete) return prev
      const next = new Map(prev)
      next.set(sessionDay, {
        startedAt: existing?.startedAt ?? new Date().toISOString(),
        endedAt: new Date().toISOString(),
        isComplete: true,
      })
      return next
    })
  }

  const resetWorkout = (sessionDay: string) => {
    setWorkoutSessions(prev => {
      const existing = prev.get(sessionDay)
      if (!existing || existing.isComplete) return prev
      const next = new Map(prev)
      next.delete(sessionDay)
      return next
    })
  }

  // Persist workout sessions to localStorage whenever they change
  useEffect(() => {
    if (workoutSessions.size === 0) return
    const obj: Record<string, WorkoutSessionInfo> = {}
    workoutSessions.forEach((v, k) => { obj[k] = v })
    localStorage.setItem(workoutSessionsKey, JSON.stringify(obj))
  }, [workoutSessions, workoutSessionsKey])

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
    if (restTimer !== null) return
    const next = nextExerciseAfterRestRef.current
    if (!next) return
    nextExerciseAfterRestRef.current = null
    const el = document.getElementById(`exercise-${next.name}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedExercise(next.name)
    const t = setTimeout(() => setHighlightedExercise(null), 2000)
    return () => clearTimeout(t)
  }, [restTimer])

  // Rotate generating message every 3s while loading
  useEffect(() => {
    if (!isGenerating) return
    const t = setInterval(() => {
      setGeneratingMsgIdx(i => Math.min(i + 1, GENERATING_MESSAGES.length - 1))
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

  // Detect when all sets for the active day are done and end the workout
  useEffect(() => {
    if (!isAccepted || weekOffset !== 0) return
    const activeSession_ = plan?.plan.sessions?.[activeDay]
    if (!activeSession_ || activeSession_.type === 'rest') return
    const dayLogs = allLogs.get(activeSession_.day)
    if (!dayLogs || dayLogs.size === 0) return
    const ws = workoutSessions.get(activeSession_.day)
    if (ws?.isComplete) return
    if (isAllSetsDone(activeSession_, dayLogs)) endWorkout(activeSession_.day)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLogs])

  // Auto-complete the active workout day after 1 hour of inactivity
  useEffect(() => {
    if (!lastLoggedAt) return
    const activeSession_ = plan?.plan.sessions?.[activeDay]
    if (!activeSession_ || activeSession_.type === 'rest') return
    const ws = workoutSessions.get(activeSession_.day)
    if (!ws?.startedAt || ws.isComplete) return
    const elapsed = Date.now() - lastLoggedAt.getTime()
    const delay = Math.max(0, 60 * 60 * 1000 - elapsed)
    const t = setTimeout(() => endWorkout(activeSession_.day), delay)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLoggedAt])

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

          // Check holiday mode and lock workout before querying plan
          let holidayActive = false
          try {
            const [hRes, lRes] = await Promise.all([
              fetch('/api/holiday-mode'),
              fetch('/api/lock-workout'),
            ])
            if (hRes.ok) {
              const hCfg: HolidayConfig | null = await hRes.json()
              holidayActive = hCfg?.is_active ?? false
              setIsHolidayMode(holidayActive)
            }
            if (lRes.ok) {
              const lCfg: LockWorkoutConfig | null = await lRes.json()
              setIsLockWorkout(lCfg?.is_active ?? false)
            }
          } catch { /* ignore */ }

          const { data: planRow } = await supabase
            .from('plans')
            .select('id, plan, inputs, created_at')
            .eq('user_id', user.id)
            .eq('is_holiday', holidayActive)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (planRow) {
            // Use the oldest non-holiday plan's created_at as program start so the week counter
            // never resets to 1 after a new plan is generated.
            const { data: firstPlanRow } = await supabase
              .from('plans')
              .select('created_at')
              .eq('user_id', user.id)
              .eq('is_holiday', false)
              .order('created_at', { ascending: true })
              .limit(1)
              .single()

            const registrationDate = new Date(firstPlanRow?.created_at ?? planRow.created_at)
            const { weekNumber: currentWeekNumber, start: currWeekMonday } = getUserWeekInfo(registrationDate)

            const { data: logsData } = await supabase
              .from('exercise_logs')
              .select('session_day, exercise_name, sets_data, logged_at, week_number')
              .eq('user_id', user.id)
              .order('logged_at', { ascending: false })

            const logsMap = new Map<string, Map<string, SetLog[]>>()
            const prevLogsMap = new Map<string, Map<string, SetLog[]>>()

            const nextWeekLoadedAt = localStorage.getItem('next-week-loaded-at')
            const weekOverridden = nextWeekLoadedAt
              ? new Date(nextWeekLoadedAt) >= currWeekMonday
              : false

            const [{ data: weekFeedback }, { data: feedbackHistory }] = await Promise.all([
              supabase
                .from('weekly_feedback')
                .select('id')
                .eq('user_id', user.id)
                .gte('created_at', currWeekMonday.toISOString())
                .limit(1)
                .maybeSingle(),
              supabase
                .from('weekly_feedback')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(20),
            ])
            setHasFeedbackThisWeek(!!weekFeedback)
            setWeekIsFinished(!weekOverridden && !!weekFeedback)
            if (feedbackHistory && feedbackHistory.length > 0) {
              setWeeklyFeedbacks(feedbackHistory as WeeklyFeedback[])
            }

            if (logsData) {
              const allWeeksMap = new Map<number, Map<string, Map<string, SetLog[]>>>()
              ;[...logsData].reverse().forEach(log => {
                const logWeekNumber = log.week_number as number | null
                const offset = logWeekNumber != null
                  ? currentWeekNumber - logWeekNumber
                  : (() => {
                      const loggedAt = new Date(log.logged_at)
                      const logMonday = getLogWeekMonday(log.session_day, loggedAt)
                      return Math.round((currWeekMonday.getTime() - logMonday.getTime()) / (7 * 24 * 60 * 60 * 1000))
                    })()
                if (offset < 0) return
                if (!allWeeksMap.has(offset)) allWeeksMap.set(offset, new Map())
                const dayMap = allWeeksMap.get(offset)!
                if (!dayMap.has(log.session_day)) dayMap.set(log.session_day, new Map())
                const exMap = dayMap.get(log.session_day)!
                if (!exMap.has(log.exercise_name)) exMap.set(log.exercise_name, log.sets_data)
              })
              setWeekLogsMap(allWeeksMap)
              allWeeksMap.get(0)?.forEach((dayMap, day) => {
                logsMap.set(day, dayMap)
              })
              allWeeksMap.get(1)?.forEach((dayMap, day) => {
                prevLogsMap.set(day, dayMap)
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

            // Load all per-week session snapshots so historical weeks show the correct exercises
            const currWeekMondayStr = currWeekMonday.toISOString().split('T')[0]
            const { data: snapshotsData } = await supabase
              .from('plan_week_snapshots')
              .select('week_monday, sessions')
              .eq('user_id', user.id)
              .order('week_monday', { ascending: false })

            const snapshotsMap = new Map<string, Session[]>()
            if (snapshotsData) {
              for (const row of snapshotsData) {
                snapshotsMap.set(row.week_monday, row.sessions as Session[])
              }
            }

            // Snapshot the current week's sessions on first load this week (ignoreDuplicates
            // means it never overwrites, so exercises are frozen at the start of each week)
            if (!snapshotsMap.has(currWeekMondayStr)) {
              const currentSessions = (planRow.plan as PlanResponse).plan.sessions
              supabase.from('plan_week_snapshots').upsert(
                { user_id: user.id, week_monday: currWeekMondayStr, sessions: currentSessions },
                { onConflict: 'user_id,week_monday', ignoreDuplicates: true }
              ).then(({ error }) => {
                if (error) console.error('Snapshot save error:', error.message)
              })
              snapshotsMap.set(currWeekMondayStr, currentSessions)
            }

            setWeekSessionsMap(snapshotsMap)

            // Set plan + logs together so ExerciseCards mount with correct initialLogs
            loadedSessionsRef.current = (planRow.plan as PlanResponse).plan.sessions
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
        // Load workout sessions from localStorage (keyed by current week Monday)
        const sessionsKey = `workout-sessions-${getCalendarMonday(new Date()).toISOString().slice(0, 10)}`
        const raw = localStorage.getItem(sessionsKey)
        if (raw) {
          try {
            const obj = JSON.parse(raw) as Record<string, WorkoutSessionInfo>
            setWorkoutSessions(new Map(Object.entries(obj)))
          } catch { /* ignore corrupt data */ }
        }
        setIsLoadingData(false)
      }
    }

    loadData()
  }, [router, loadKey])

  // Show onboarding tooltip once when a new plan loads for the first time
  useEffect(() => {
    if (isLoadingData || !plan || isAccepted) return
    if (typeof window === 'undefined') return
    if (!localStorage.getItem('onboarding-seen')) {
      setShowTooltip(true)
    }
  }, [isLoadingData, plan, isAccepted])

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
      const hadNoLogs = !prev.has(sessionDay) || prev.get(sessionDay)!.size === 0
      const next = new Map(prev)
      const dayLogs = new Map(next.get(sessionDay) ?? [])
      if (logs.length === 0) {
        dayLogs.delete(exerciseName)
      } else {
        dayLogs.set(exerciseName, logs)
      }
      if (dayLogs.size === 0) {
        next.delete(sessionDay)
        resetWorkout(sessionDay)
      } else {
        next.set(sessionDay, dayLogs)
      }
      if (hadNoLogs && logs.length > 0) startWorkout(sessionDay)
      if (logs.length > 0) setLastLoggedAt(new Date())
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
    if (!userId) {
      setShowSignUpModal(true)
      return
    }
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

  const handleSetLogged = (restSeconds: number, exerciseName: string | null) => {
    let nextExercise: Exercise | null = null
    if (exerciseName) {
      const allExercises = activeSession.blocks.flatMap(b => b.exercises)
      const idx = allExercises.findIndex(e => e.name === exerciseName)
      nextExercise = idx >= 0 && idx < allExercises.length - 1 ? allExercises[idx + 1] : null
    }
    nextExerciseAfterRestRef.current = nextExercise
    setRestTimer({ remaining: restSeconds, total: restSeconds, minimized: false, nextExercise })
  }

  const handleConfirmFinishWeek = async () => {
    if (!plan || !inputs) return
    setShowFinishConfirm(false)
    setFinishWeekError('')
    setIsFinishingWeek(true)
    setFinishingMsgIdx(0)
    try {
      if (isLockWorkout) {
        // Skip AI progressions — same plan repeats next week
        const lockedResult: NextWeekPlanResponse = {
          action: 'continue',
          reason: 'Workout is locked — same plan repeats next week.',
          weeks_to_continue: 1,
        }
        const lockedAnalysis: ProgressionAnalysis = {
          ready_to_progress: [],
          needs_regression: [],
          plateaued: [],
          insights: ['Workout locked — progressions skipped.'],
        }
        sessionStorage.setItem('week-summary', JSON.stringify({ result: lockedResult, analysis: lockedAnalysis }))
        localStorage.setItem('next-week-loaded-at', new Date().toISOString())
        router.push('/plan/week-summary')
        return
      }

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
            <div className="w-full max-w-xs text-left">
              <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-6">Building your program</p>
              <div className="flex flex-col gap-4">
                {GENERATING_MESSAGES.map((msg, i) => {
                  const done = i < generatingMsgIdx
                  const active = i === generatingMsgIdx
                  return (
                    <div key={i} className={`flex items-center gap-3 transition-opacity ${i > generatingMsgIdx ? 'opacity-30' : 'opacity-100'}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all ${
                        done ? 'bg-primary/20' : active ? 'bg-primary/10 ring-2 ring-primary/40' : 'bg-secondary'
                      }`}>
                        {done ? (
                          <svg className="w-3.5 h-3.5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        ) : active ? (
                          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                        )}
                      </div>
                      <span className={`text-sm ${active ? 'text-foreground font-medium' : done ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>{msg}</span>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground/50 mt-8">This can take up to 5 minutes.</p>
            </div>
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

  // When viewing a previous week, look up the per-week session snapshot first, then fall
  // back to prevPlan, then the load-time ref so in-session adjustments never bleed through.
  const viewingWeekMondayStr = weekOffset >= 1 && planCreatedAt
    ? new Date(getUserWeekInfo(planCreatedAt).start.getTime() - weekOffset * 7 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0]
    : null
  const prevSessions =
    (viewingWeekMondayStr ? weekSessionsMap.get(viewingWeekMondayStr) : undefined)
    ?? prevPlan?.plan.sessions
    ?? loadedSessionsRef.current
    ?? sessions
  const activeSession: Session = weekOffset >= 1
    ? (prevSessions.find(s => s.day === sessions[activeDay]?.day) ?? prevSessions[activeDay] ?? sessions[activeDay] ?? sessions[0])
    : (sessions[activeDay] ?? sessions[0])
  const isRestDay = activeSession.type === 'rest'

  const displayLogs = weekOffset === 0
    ? allLogs
    : (weekLogsMap.get(weekOffset) ?? new Map<string, Map<string, SetLog[]>>())
  const logsForActiveDay = displayLogs.get(activeSession.day) ?? new Map<string, SetLog[]>()
  const prevLogsForActiveDay = (weekLogsMap.get(weekOffset + 1) ?? new Map<string, Map<string, SetLog[]>>()).get(activeSession.day) ?? new Map<string, SetLog[]>()

  const currWeekInfo = planCreatedAt ? getUserWeekInfo(planCreatedAt) : null
  const prevWeekInfo = planCreatedAt ? getUserPrevWeekInfo(planCreatedAt) : null
  const weekNumber = currWeekInfo?.weekNumber ?? 1
  const viewingWeekInfo = planCreatedAt ? getWeekInfoByOffset(planCreatedAt, weekOffset) : null
  const maxOffset = currWeekInfo ? currWeekInfo.weekNumber - 1 : 0

  const firstName = displayName ? displayName.split('@')[0].split(' ')[0] : null
  const todayDayName = getTodayDayName()
  const todaySessionIdx = sessions.findIndex(s => s.day === todayDayName)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className={`max-w-2xl mx-auto px-5 sm:px-8 py-8 ${!isAccepted ? 'pb-36' : isAccepted && activeSession.day === 'Sunday' && allLogs.size > 0 ? 'pb-28' : ''}`}>

        {/* Header */}
        {!isAccepted ? (
          <div className="mb-8">
            <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-1">Your plan</p>
            <h1 className="text-2xl font-bold text-foreground">Review and accept to start training.</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {level} · {goal.toLowerCase()}
            </p>
            <button
              onClick={handleDiscardNewPlan}
              className="mt-2 text-xs text-muted-foreground/60 hover:text-muted-foreground underline underline-offset-2 transition-colors"
            >
              Discard, build a new plan
            </button>
          </div>
        ) : (
          <div className="mb-8">
            {firstName && (
              <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-2">Back at it, {firstName}</p>
            )}
            <h1 className="text-3xl font-bold text-foreground">
              {activeSession.day} · {activeSession.label}
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              {level} · {days_per_week} days per week · {goal.toLowerCase()}
            </p>
            <button
              onClick={() => router.push('/account?highlight=training-settings')}
              className="mt-1 text-xs text-muted-foreground/60 hover:text-muted-foreground underline underline-offset-2 transition-colors"
            >
              My training settings
            </button>
          </div>
        )}

        {/* Holiday mode banner */}
        {isHolidayMode && isAccepted && (
          <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 mb-5">
            <span className="text-lg">🏖️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Holiday mode active</p>
              <p className="text-xs text-amber-600/80 dark:text-amber-500/80">Your normal plan is paused. Turn it off in settings when you&apos;re back.</p>
            </div>
            <button
              onClick={() => router.push('/account')}
              className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline shrink-0"
            >
              Settings
            </button>
          </div>
        )}

        {/* Day tabs */}
        <div className="flex gap-2 mb-5">
          {sessions.map((session, i) => {
            const isRest = session.type === 'rest'
            const isActive = activeDay === i
            const isToday = weekOffset === 0 && todaySessionIdx === i
            const isDone = displayLogs.has(session.day)
            const ws = workoutSessions.get(session.day)
            const isInProgress = !!ws?.startedAt && !ws.isComplete
            const isComplete = ws?.isComplete ?? false
            const abbr = DAY_ABBR[session.day] ?? session.day.slice(0, 2).toUpperCase()
            return (
              <button
                key={i}
                onClick={() => { setActiveDay(i); setSessionUndo(null) }}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all ${
                  isActive || isInProgress
                    ? 'ring-2 ring-[var(--sage)] bg-background'
                    : 'ring-1 ring-border hover:bg-secondary/40'
                }`}
              >
                <span className={`text-[11px] font-bold tracking-wide ${
                  isActive || isInProgress ? 'text-[var(--sage)]' : isDone || isComplete ? 'text-foreground' : 'text-muted-foreground'
                }`}>
                  {abbr}
                </span>
                {isComplete || isDone ? (
                  <svg className="w-3 h-3 text-foreground/50" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : isInProgress ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--sage)] animate-pulse" />
                ) : isRest ? (
                  <div className={`w-1.5 h-1.5 rounded-full border ${
                    isActive ? 'border-[var(--sage)]' : 'border-border'
                  }`} />
                ) : (
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    isActive ? 'bg-[var(--sage)]' : 'bg-muted-foreground/40'
                  }`} />
                )}
                <div className={`w-1 h-1 rounded-full transition-colors ${
                  isToday && !isDone && !isComplete ? 'bg-amber-400' : 'bg-transparent'
                }`} />
              </button>
            )
          })}
        </div>

        {!isAccepted && (
          <p className="text-sm font-semibold text-foreground mb-4">{activeSession.label}</p>
        )}

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
              isPreview={weekOffset >= 1 || hasFeedbackThisWeek}
              hideAdjust={isRestDay}
              hideLogger={!isAccepted}
              highlightedExercise={highlightedExercise}
            />
          ))}
        </div>

        {/* Session undo notice — shown after progression until dismissed or day changes */}
        {sessionUndo && sessionUndo.sessionIndex === activeDay && weekOffset === 0 && !hasFeedbackThisWeek && (
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

        {/* Workout complete celebration */}
        {isAccepted && !isRestDay && weekOffset === 0 && workoutSessions.get(activeSession.day)?.isComplete && (
          <div className="mt-6 rounded-2xl bg-[var(--sage)]/10 border border-[var(--sage)]/20 px-5 py-4 text-center">
            <p className="text-base font-bold text-foreground">Workout done — great job!</p>
            <p className="text-sm text-muted-foreground mt-1">All sets completed.</p>
          </div>
        )}

        {/* Refine this day — on accepted days (workout + rest), not when viewing previous week */}
        {inputs && isAccepted && weekOffset === 0 && !hasFeedbackThisWeek && (
          <RefineDayForm
            session={activeSession}
            inputs={inputs}
            logsForDay={logsForActiveDay}
            onRefined={(updated) => replaceSession(activeDay, updated)}
            onRefinedNextWeek={(updated) => {
              // Update plan in Supabase only — don't update UI so today's session is undisturbed
              if (!planId || !plan) return
              const updatedPlan: PlanResponse = {
                plan: {
                  ...plan.plan,
                  sessions: plan.plan.sessions.map((s, si) => si === activeDay ? updated : s),
                },
              }
              const supabase = createSupabaseBrowser()
              supabase.from('plans').update({ plan: updatedPlan }).eq('id', planId).then(({ error }) => {
                if (error) console.error('Next-week refine save error:', error.message)
              })
            }}
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

      {/* Sticky bottom bar — week finished nudge */}
      {isAccepted && weekOffset === 0 && hasFeedbackThisWeek && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto px-5 sm:px-8 py-4">
            <div className="flex items-center justify-center gap-1">
              <p className="text-base text-muted-foreground">Next week loads Sunday evening.</p>
              <Link href="/history" className="text-base text-primary underline underline-offset-2">View updates</Link>
            </div>
          </div>
        </div>
      )}

      {/* Sticky bottom bar — finish week (Sunday only) */}
      {isAccepted && activeSession.day === 'Sunday' && allLogs.size > 0 && weekOffset === 0 && !hasFeedbackThisWeek && (
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

      {/* Sign-up modal for guest users accepting plan */}
      {showSignUpModal && plan && inputs && (
        <SignUpModal
          plan={plan}
          inputs={inputs}
          onSuccess={(id, uid, name) => {
            setPlanId(id)
            setUserId(uid)
            setDisplayName(name)
            setIsAccepted(true)
            setShowSignUpModal(false)
          }}
          onClose={() => setShowSignUpModal(false)}
        />
      )}

      {/* First-visit onboarding tooltip */}
      {showTooltip && (
        <OnboardingTooltip
          onDismiss={() => {
            localStorage.setItem('onboarding-seen', '1')
            setShowTooltip(false)
          }}
        />
      )}

    </main>
  )
}
