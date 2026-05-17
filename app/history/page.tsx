'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { Session, SetLog, WeeklyFeedback } from '@/lib/types'

interface WeekLog {
  weekNumber: number
  weekStart: Date
  weekEnd: Date
  feedback: WeeklyFeedback
  sessions: Session[] | null // null when no snapshot exists
  logs: Map<string, Map<string, SetLog[]>> // day → exercise → sets
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatSetLog(log: SetLog): string {
  if (log.duration_s !== undefined) return `${log.duration_s}s`
  if (log.reps !== undefined) {
    if (log.weight_kg) return `${log.reps}×${log.weight_kg}kg`
    return String(log.reps)
  }
  return '✓'
}

function getCalendarMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

export default function HistoryPage() {
  const router = useRouter()
  const [weeks, setWeeks] = useState<WeekLog[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowser()

    const load = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.replace('/login'); return }

        const [
          { data: firstPlan },
          { data: feedbackData },
          { data: snapshots },
          { data: logsData },
        ] = await Promise.all([
          supabase.from('plans').select('created_at').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1).single(),
          supabase.from('weekly_feedback').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
          supabase.from('plan_week_snapshots').select('week_monday, sessions').eq('user_id', user.id),
          supabase.from('exercise_logs').select('session_day, exercise_name, sets_data, week_number').eq('user_id', user.id),
        ])

        if (!feedbackData || feedbackData.length === 0) { setLoading(false); return }

        const registrationDate = firstPlan ? new Date(firstPlan.created_at) : new Date()
        const registrationMonday = getCalendarMonday(registrationDate)
        const msPerWeek = 7 * 24 * 60 * 60 * 1000

        // snapshot map: week_monday string → sessions
        const snapshotMap = new Map<string, Session[]>()
        if (snapshots) {
          for (const snap of snapshots) {
            snapshotMap.set(snap.week_monday, snap.sessions as Session[])
          }
        }

        // logs map: week_number → day → exercise → sets
        const logsByWeek = new Map<number, Map<string, Map<string, SetLog[]>>>()
        if (logsData) {
          for (const log of logsData) {
            const wn = log.week_number as number
            if (wn == null) continue
            if (!logsByWeek.has(wn)) logsByWeek.set(wn, new Map())
            const dayMap = logsByWeek.get(wn)!
            if (!dayMap.has(log.session_day)) dayMap.set(log.session_day, new Map())
            const exMap = dayMap.get(log.session_day)!
            if (!exMap.has(log.exercise_name)) exMap.set(log.exercise_name, log.sets_data as SetLog[])
          }
        }

        // Build one entry per weekly_feedback row (de-duplicate by week)
        const seenWeeks = new Set<number>()
        const result: WeekLog[] = []

        for (const fb of feedbackData) {
          const weekStart = getCalendarMonday(new Date(fb.created_at))
          const weekNumber = Math.floor((weekStart.getTime() - registrationMonday.getTime()) / msPerWeek) + 1
          if (seenWeeks.has(weekNumber)) continue
          seenWeeks.add(weekNumber)

          const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)
          weekEnd.setHours(23, 59, 59, 999)

          const mondayStr = weekStart.toISOString().split('T')[0]
          const sessions = snapshotMap.get(mondayStr) ?? null
          const logs = logsByWeek.get(weekNumber) ?? new Map()

          result.push({ weekNumber, weekStart, weekEnd, feedback: fb as WeeklyFeedback, sessions, logs })
        }

        setWeeks(result)
        if (result.length > 0) setExpandedWeek(result[0].weekNumber)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [router])

  if (loading) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <svg className="animate-spin w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </main>
    )
  }

  if (weeks.length === 0) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="max-w-2xl mx-auto w-full px-5 sm:px-8 pt-10 pb-20">
          <div className="mb-8">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-1">History</p>
            <h1 className="text-3xl font-bold text-foreground">Past weeks</h1>
          </div>
          <p className="text-muted-foreground text-sm">No completed weeks yet. Finish your first week to see history here.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto w-full px-5 sm:px-8 pt-10 pb-20">

        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-1">History</p>
          <h1 className="text-3xl font-bold text-foreground">Past weeks</h1>
        </div>

        <div className="flex flex-col gap-4">
          {weeks.map(week => {
            const isExpanded = expandedWeek === week.weekNumber
            const workoutDays = week.sessions?.filter(s => s.type === 'workout') ?? []
            const loggedDayCount = [...week.logs.keys()].length

            return (
              <div key={week.weekNumber} className="border border-border rounded-2xl overflow-hidden">
                <button
                  onClick={() => setExpandedWeek(isExpanded ? null : week.weekNumber)}
                  className="w-full flex items-center justify-between px-5 py-4 bg-card hover:bg-secondary/30 transition-colors text-left"
                >
                  <div>
                    <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                      Week {week.weekNumber}
                    </p>
                    <p className="text-base font-bold text-foreground mt-0.5">
                      {formatDate(week.weekStart)} – {formatDate(week.weekEnd)}
                    </p>
                    {loggedDayCount > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {loggedDayCount} day{loggedDayCount !== 1 ? 's' : ''} logged
                      </p>
                    )}
                  </div>
                  <svg
                    className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="border-t border-border">

                    {/* Week update */}
                    <div className="px-5 py-4 border-b border-border bg-secondary/20">
                      <p className="text-[11px] font-semibold tracking-widest text-primary uppercase mb-1.5">
                        {week.feedback.action === 'new_plan' ? 'Plan updated after this week' : 'Plan continued'}
                      </p>
                      <p className="text-sm text-foreground leading-relaxed">{week.feedback.reason}</p>
                      {week.feedback.action === 'new_plan' && week.feedback.changes && week.feedback.changes.length > 0 && (
                        <div className="mt-3 flex flex-col gap-1.5">
                          {week.feedback.changes.map((c, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-x-2 text-sm">
                              <span className="font-semibold text-foreground">{c.exercise}</span>
                              <span className="text-muted-foreground text-xs">{c.from}</span>
                              <span className="text-muted-foreground">→</span>
                              <span className="font-semibold text-primary">{c.to}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Workout days — shown when a snapshot is available */}
                    {workoutDays.length > 0 ? workoutDays.map(session => {
                      const dayLogs = week.logs.get(session.day)
                      const hasLogs = !!dayLogs && dayLogs.size > 0

                      return (
                        <div key={session.day} className="px-5 py-4 border-b border-border last:border-b-0">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">{session.day}</p>
                              <p className="text-sm font-bold text-foreground">{session.label}</p>
                            </div>
                            {hasLogs ? (
                              <svg className="w-4 h-4 text-[var(--sage)]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">Not logged</span>
                            )}
                          </div>

                          {hasLogs && (
                            <div className="flex flex-col gap-2.5 mt-2">
                              {session.blocks.flatMap(b => b.exercises).map((ex, i) => {
                                const sets = dayLogs?.get(ex.name)
                                if (!sets || sets.length === 0) return null
                                return (
                                  <div key={i} className="flex items-start justify-between gap-3">
                                    <p className="text-sm text-foreground">{ex.name}</p>
                                    <p className="text-sm text-muted-foreground shrink-0">{sets.map(formatSetLog).join(' · ')}</p>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    }) : week.logs.size > 0 ? (
                      /* No snapshot but logs exist — show logs grouped by day */
                      [...week.logs.entries()].map(([day, exMap]) => (
                        <div key={day} className="px-5 py-4 border-b border-border last:border-b-0">
                          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-2">{day}</p>
                          <div className="flex flex-col gap-2.5">
                            {[...exMap.entries()].map(([exName, sets], i) => (
                              <div key={i} className="flex items-start justify-between gap-3">
                                <p className="text-sm text-foreground">{exName}</p>
                                <p className="text-sm text-muted-foreground shrink-0">{sets.map(formatSetLog).join(' · ')}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </main>
  )
}
