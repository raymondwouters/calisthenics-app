'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Exercise } from '@/lib/types'

interface RecoveryResult {
  intro: string
  exercises: Exercise[]
}

function isTimed(reps: string) {
  return /\d+\s*(s|sec|seconds?)\b/i.test(reps)
}

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
            <div className="relative">
              <Textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. Tight hamstrings and lower back stiffness after sitting all day… or sore shoulders from last week's push session…"
                rows={4}
                className="bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-teal-600/50 focus-visible:border-teal-600 resize-none"
              />
            </div>

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
              {result.exercises.map((ex, i) => {
                const timed = isTimed(ex.reps)
                return (
                  <div key={i} className="bg-card rounded-xl border border-border p-4 flex flex-col gap-2">
                    <p className="font-semibold text-foreground leading-tight">{ex.name}</p>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span><span className="text-foreground font-medium">{ex.sets}</span> sets</span>
                      <span><span className="text-foreground font-medium">{ex.reps}</span>{!timed && ' reps'}</span>
                      {ex.rest_seconds > 0 && (
                        <span><span className="text-foreground font-medium">{ex.rest_seconds}s</span> rest</span>
                      )}
                    </div>
                    {ex.notes && (
                      <p className="text-xs text-muted-foreground leading-relaxed">{ex.notes}</p>
                    )}
                  </div>
                )
              })}
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
