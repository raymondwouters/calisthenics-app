'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PlanError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('[plan error]', error)
  }, [error])

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-5">
      <div className="text-center max-w-xs">
        <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-8">Calisthenics</p>
        <h2 className="text-xl font-bold mb-3">Something went wrong</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {error.message || 'An unexpected error occurred loading your plan.'}
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full py-3 rounded-full bg-foreground text-background font-semibold text-sm"
          >
            Try again
          </button>
          <button
            onClick={() => router.replace('/')}
            className="text-sm text-muted-foreground underline"
          >
            Go back to home
          </button>
        </div>
      </div>
    </main>
  )
}
