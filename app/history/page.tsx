'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { SetLog } from '@/lib/types'

interface LogRow {
  session_day: string
  exercise_name: string
  sets_data: SetLog[]
  logged_at: string
}

interface WeekGroup {
  weekLabel: string
  weekStart: Date
  days: DayGroup[]
}

interface DayGroup {
  day: string
  exercises: ExerciseGroup[]
}

interface ExerciseGroup {
  name: string
  sets: SetLog[]
  loggedAt: string
}

function getISOWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const offset = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + offset)
  d.setHours(0, 0, 0, 0)
  return d
}

function formatWeekLabel(weekStart: Date): string {
  const end = new Date(weekStart)
  end.setDate(weekStart.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${weekStart.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
}

function formatSetsSummary(sets: SetLog[]): string {
  return sets.map(s => {
    if (s.duration_s !== undefined) return `${s.duration_s}s`
    if (s.reps !== undefined) {
      if (s.weight_kg) return `${s.reps}×${s.weight_kg}kg`
      return String(s.reps)
    }
    return '✓'
  }).join(', ')
}

function groupLogs(rows: LogRow[]): WeekGroup[] {
  const weekMap = new Map<string, Map<string, ExerciseGroup[]>>()
  const weekStartMap = new Map<string, Date>()

  rows.forEach(row => {
    const loggedAt = new Date(row.logged_at)
    const weekStart = getISOWeekStart(loggedAt)
    const weekKey = weekStart.toISOString()

    if (!weekMap.has(weekKey)) {
      weekMap.set(weekKey, new Map())
      weekStartMap.set(weekKey, weekStart)
    }

    const dayMap = weekMap.get(weekKey)!
    if (!dayMap.has(row.session_day)) {
      dayMap.set(row.session_day, [])
    }
    dayMap.get(row.session_day)!.push({
      name: row.exercise_name,
      sets: row.sets_data,
      loggedAt: row.logged_at,
    })
  })

  const weeks: WeekGroup[] = []
  weekMap.forEach((dayMap, weekKey) => {
    const days: DayGroup[] = []
    dayMap.forEach((exercises, day) => {
      days.push({ day, exercises })
    })
    days.sort((a, b) => {
      const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      return order.indexOf(a.day) - order.indexOf(b.day)
    })
    weeks.push({
      weekLabel: formatWeekLabel(weekStartMap.get(weekKey)!),
      weekStart: weekStartMap.get(weekKey)!,
      days,
    })
  })

  weeks.sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime())
  return weeks
}

export default function HistoryPage() {
  const router = useRouter()
  const [weeks, setWeeks] = useState<WeekGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [planId, setPlanId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowser()
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }

      const { data: planRow } = await supabase
        .from('plans')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!planRow) { setLoading(false); return }
      setPlanId(planRow.id)

      const { data: logsData } = await supabase
        .from('exercise_logs')
        .select('session_day, exercise_name, sets_data, logged_at')
        .eq('plan_id', planRow.id)
        .order('logged_at', { ascending: false })
        .limit(500)

      if (logsData) {
        setWeeks(groupLogs(logsData as LogRow[]))
      }
      setLoading(false)
    }
    load()
  }, [router])

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <svg className="animate-spin w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-8">

        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest text-orange-400 uppercase mb-1">Progress</p>
          <h1 className="text-2xl font-bold text-white">History</h1>
        </div>

        {weeks.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-zinc-500 text-sm">No sessions logged yet.</p>
            <p className="text-zinc-600 text-xs mt-1">Accept your plan and start logging sets to see your history here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {weeks.map((week, wi) => (
              <div key={wi}>
                <div className="flex items-center gap-3 mb-4">
                  <p className="text-xs font-semibold tracking-widest text-orange-400 uppercase">{week.weekLabel}</p>
                  <div className="flex-1 h-px bg-zinc-800" />
                  <span className="text-xs text-zinc-600">
                    {week.days.reduce((sum, d) => sum + d.exercises.length, 0)} exercises
                  </span>
                </div>

                <div className="flex flex-col gap-4">
                  {week.days.map((day, di) => (
                    <div key={di} className="bg-zinc-900 rounded-xl p-4">
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">{day.day}</p>
                      <div className="flex flex-col gap-2">
                        {day.exercises.map((ex, ei) => (
                          <div key={ei} className="flex items-start justify-between gap-3">
                            <p className="text-sm text-white font-medium leading-snug">{ex.name}</p>
                            <p className="text-xs text-zinc-500 shrink-0 text-right leading-snug">
                              {ex.sets.length} set{ex.sets.length !== 1 ? 's' : ''} · {formatSetsSummary(ex.sets)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}
