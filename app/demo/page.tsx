'use client'

// Temporary demo page — shows the generate-plan error state UI. Delete after review.

import { useRouter } from 'next/navigation'

export default function DemoPage() {
  const router = useRouter()

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-5">
      <div className="text-center max-w-xs">
        <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-8">Calisthenics</p>
        <div className="flex gap-1 mb-10 justify-center">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className={`h-1 w-10 rounded-full ${i < 4 ? 'bg-primary' : 'bg-primary/30'}`} />
          ))}
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="text-center">
            <h2 className="text-xl font-bold mb-2">We had a problem generating your program.</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Something went wrong on our end. Hit try again — it usually works straight away.
            </p>
          </div>
          <button
            onClick={() => {}}
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
      </div>
    </main>
  )
}
