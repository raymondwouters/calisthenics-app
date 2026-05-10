'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { NextWeekPlanResponse, ProgressionAnalysis } from '@/lib/types'

interface WeekSummaryData {
  result: NextWeekPlanResponse
  analysis: ProgressionAnalysis
}

export default function WeekSummaryPage() {
  const router = useRouter()
  const [data, setData] = useState<WeekSummaryData | null>(null)
  const dataRef = useRef<WeekSummaryData | null>(null)

  useEffect(() => {
    const raw = sessionStorage.getItem('week-summary')
    if (!raw) { router.replace('/plan'); return }
    try {
      const parsed = JSON.parse(raw)
      dataRef.current = parsed
      setData(parsed)
    } catch {
      router.replace('/plan')
    }
  }, [router])

  // On unmount: clean up sessionStorage and stamp localStorage so the plan
  // page treats the new week as active (overrides weekIsFinished check)
  useEffect(() => {
    return () => {
      sessionStorage.removeItem('week-summary')
      if (dataRef.current) {
        localStorage.setItem('next-week-loaded-at', new Date().toISOString())
      }
    }
  }, [])

  if (!data) return null

  const { result, analysis } = data
  const isContinue = result.action === 'continue'
  const needsWork = [
    ...analysis.needs_regression,
    ...analysis.plateaued.map(p => p.exercise),
  ]

  const handleLoadNextWeek = () => {
    router.replace('/plan')
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-12 pb-32">

        {/* Header */}
        <div className="mb-10">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-2">Week done</p>
          <h1 className="text-3xl font-black text-foreground leading-tight">
            {isContinue ? 'Same schedule next week.' : 'New plan ready.'}
          </h1>
        </div>

        {/* Progressing well */}
        {analysis.ready_to_progress.length > 0 && (
          <section className="mb-8">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-3">Progressing well</p>
            <ul className="flex flex-col gap-3">
              {analysis.ready_to_progress.map((ex, i) => (
                <li key={i} className="text-sm text-muted-foreground leading-relaxed flex gap-3">
                  <span className="text-primary mt-0.5 shrink-0">·</span>
                  <span>{ex}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Need more time */}
        {needsWork.length > 0 && (
          <section className="mb-8">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-3">Need more time</p>
            <ul className="flex flex-col gap-3">
              {needsWork.map((ex, i) => (
                <li key={i} className="text-sm text-muted-foreground leading-relaxed flex gap-3">
                  <span className="text-primary mt-0.5 shrink-0">·</span>
                  <span>{ex}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Key takeaways */}
        {analysis.insights.length > 0 && (
          <section className="mb-8">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-3">Key takeaways</p>
            <ul className="flex flex-col gap-3">
              {analysis.insights.map((insight, i) => (
                <li key={i} className="text-sm text-muted-foreground leading-relaxed flex gap-3">
                  <span className="text-primary mt-0.5 shrink-0">·</span>
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Continue info */}
        {isContinue && (
          <section className="mb-8">
            <div className="bg-secondary rounded-2xl px-5 py-4">
              <p className="text-sm text-foreground">
                {result.weeks_to_continue
                  ? <>Next week uses the same schedule. We&apos;ll check in again in{' '}
                      <span className="font-bold">{result.weeks_to_continue}</span>{' '}
                      week{result.weeks_to_continue !== 1 ? 's' : ''}.
                    </>
                  : 'Next week uses the same schedule.'}
              </p>
            </div>
          </section>
        )}

        {/* What changed */}
        {!isContinue && result.changes && result.changes.length > 0 && (
          <section className="mb-8">
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-3">What changed</p>
            <div className="flex flex-col gap-3">
              {result.changes.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-foreground font-semibold">{c.exercise}</span>
                  <span className="text-muted-foreground text-xs">{c.from}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-primary font-semibold">{c.to}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Sticky CTA bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 py-4">
          <Button
            onClick={handleLoadNextWeek}
            className="w-full h-12 text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {isContinue ? 'Got it — start Monday' : 'Load next week →'}
          </Button>
        </div>
      </div>
    </main>
  )
}
