'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlanResponse, Session, Block, Exercise } from '@/lib/types'

const BLOCK_LABELS: Record<string, string> = {
  warmup: 'Warm-up',
  skill: 'Skill Practice',
  strength: 'Strength',
  accessory: 'Accessories',
  core: 'Core',
  cooldown: 'Cooldown',
}

const BLOCK_COLORS: Record<string, string> = {
  warmup: 'text-yellow-400',
  skill: 'text-purple-400',
  strength: 'text-orange-400',
  accessory: 'text-blue-400',
  core: 'text-green-400',
  cooldown: 'text-zinc-400',
}

function youtubeUrl(exerciseName: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(exerciseName + ' calisthenics tutorial')}`
}

function ExerciseCard({ exercise }: { exercise: Exercise }) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-white leading-tight">{exercise.name}</p>
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
      <div className="flex gap-4 text-sm text-zinc-400">
        <span><span className="text-white font-medium">{exercise.sets}</span> sets</span>
        <span><span className="text-white font-medium">{exercise.reps}</span> reps</span>
        <span><span className="text-white font-medium">{exercise.rest_seconds}s</span> rest</span>
      </div>
      {exercise.notes && (
        <p className="text-xs text-zinc-500 leading-relaxed">{exercise.notes}</p>
      )}
    </div>
  )
}

function BlockSection({ block }: { block: Block }) {
  return (
    <div className="mb-5">
      <p className={`text-xs font-semibold tracking-widest uppercase mb-3 ${BLOCK_COLORS[block.type] ?? 'text-zinc-400'}`}>
        {BLOCK_LABELS[block.type] ?? block.type}
      </p>
      <div className="flex flex-col gap-3">
        {block.exercises.map((ex, i) => (
          <ExerciseCard key={i} exercise={ex} />
        ))}
      </div>
    </div>
  )
}

function SessionCard({ session, isOpen, onToggle }: { session: Session; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="border border-zinc-800 rounded-2xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 bg-zinc-900 hover:bg-zinc-800 transition-colors"
      >
        <div className="text-left">
          <p className="text-xs text-zinc-500 uppercase tracking-widest">{session.day}</p>
          <p className="font-semibold text-white">{session.label}</p>
        </div>
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-5 py-4 border-t border-zinc-800">
          {session.blocks.map((block, i) => (
            <BlockSection key={i} block={block} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function PlanPage() {
  const router = useRouter()
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [openSessions, setOpenSessions] = useState<Set<number>>(new Set([0]))

  useEffect(() => {
    const raw = sessionStorage.getItem('workout-plan')
    if (!raw) {
      router.replace('/')
      return
    }
    setPlan(JSON.parse(raw))
  }, [router])

  const toggleSession = (i: number) => {
    setOpenSessions(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  if (!plan) return null

  const { level, goal, days_per_week, sessions } = plan.plan

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-lg mx-auto px-5 py-8">

        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300 mb-4 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            New plan
          </button>
          <p className="text-xs font-semibold tracking-widest text-orange-400 uppercase mb-1">Your plan</p>
          <h1 className="text-2xl font-bold text-white">{goal}</h1>
          <div className="flex gap-3 mt-2">
            <span className="text-xs bg-zinc-800 text-zinc-400 px-3 py-1 rounded-full">{level}</span>
            <span className="text-xs bg-zinc-800 text-zinc-400 px-3 py-1 rounded-full">{days_per_week}×/week</span>
          </div>
        </div>

        {/* Sessions */}
        <div className="flex flex-col gap-3">
          {sessions.map((session, i) => (
            <SessionCard
              key={i}
              session={session}
              isOpen={openSessions.has(i)}
              onToggle={() => toggleSession(i)}
            />
          ))}
        </div>

        {/* Regenerate */}
        <button
          onClick={() => router.push('/')}
          className="w-full mt-8 py-3 rounded-xl border border-zinc-700 text-zinc-300 font-medium hover:border-zinc-500 transition-all"
        >
          Generate a new plan
        </button>

      </div>
    </main>
  )
}
