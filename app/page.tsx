'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { GenerateRequest } from '@/lib/types'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { Button } from '@/components/ui/button'

const LEVELS = ['Beginner', 'Early Intermediate', 'Intermediate', 'Advanced']

const EQUIPMENT = [
  { id: 'floor', label: 'Floor only' },
  { id: 'pull-up bar', label: 'Pull-up bar' },
  { id: 'resistance bands', label: 'Resistance bands' },
  { id: 'rings', label: 'Rings' },
  { id: 'parallettes', label: 'Parallettes' },
  { id: 'barbell & plates', label: 'Barbell & plates' },
  { id: 'full gym access', label: 'Full gym access' },
]

const DAYS = [2, 3, 4, 5, 6]

const GOALS = [
  { id: 'General fitness', label: 'General fitness', desc: 'Stay active and build a solid base' },
  { id: 'Build strength', label: 'Build strength', desc: 'Get stronger in key movements' },
  { id: 'Learn skills', label: 'Learn skills', desc: 'Handstands, levers, muscle-ups' },
  { id: 'Muscle gain', label: 'Muscle gain', desc: 'Build muscle through bodyweight' },
]

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [step, setStep] = useState(0)
  const [checking, setChecking] = useState(true)

  const [level, setLevel] = useState('')
  const [equipment, setEquipment] = useState<string[]>(['floor'])
  const [days, setDays] = useState(3)
  const [goal, setGoal] = useState('')

  useEffect(() => {
    const isNew = searchParams.get('new') === '1'
    if (isNew) {
      sessionStorage.removeItem('plan-generating')
      setChecking(false)
      return
    }
    const supabase = createSupabaseBrowser()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setChecking(false); return }
      const { data } = await supabase
        .from('plans')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (data) {
        router.replace('/plan')
      } else {
        setChecking(false)
      }
    })
  }, [router, searchParams])

  const toggleEquipment = (id: string) => {
    setEquipment(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
    )
  }

  const canAdvance = () => {
    if (step === 0) return level !== ''
    if (step === 1) return equipment.length > 0
    if (step === 2) return true
    if (step === 3) return goal !== ''
    return false
  }

  const handleGenerate = () => {
    const inputs: GenerateRequest = { level, equipment, daysPerWeek: days, goal }
    sessionStorage.setItem('workout-inputs', JSON.stringify(inputs))
    sessionStorage.setItem('plan-generating', '1')
    sessionStorage.removeItem('workout-plan')
    sessionStorage.removeItem('plan-id')
    sessionStorage.removeItem('plan-accepted')
    router.push('/plan')
  }

  if (checking) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <svg className="animate-spin w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </main>
    )
  }

  return (
    <main className="bg-background text-foreground">
      <div className="max-w-2xl mx-auto w-full px-5 sm:px-8 pt-8 pb-16">

        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-1">Calisthenics</p>
          <h1 className="text-2xl font-bold text-foreground">Tell me where you are —<br />I'll build your program.</h1>
          <div className="flex gap-1 mt-4">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-primary' : 'bg-secondary'}`}
              />
            ))}
          </div>
        </div>

        {/* Step 0: Level */}
        {step === 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-1">What&apos;s your current level?</h2>
            <p className="text-sm text-muted-foreground mb-6">Be honest — the plan adapts to where you actually are.</p>
            <div className="flex flex-col gap-3">
              {LEVELS.map(l => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`w-full text-left px-4 py-4 rounded-xl border transition-all ${
                    level === l
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-foreground/80 hover:border-foreground/30'
                  }`}
                >
                  <span className="font-medium">{l}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Equipment */}
        {step === 1 && (
          <div>
            <h2 className="text-lg font-semibold mb-1">What equipment do you have?</h2>
            <p className="text-sm text-muted-foreground mb-6">Select everything available to you. Floor is always included.</p>
            <div className="flex flex-col gap-3">
              {EQUIPMENT.map(e => (
                <button
                  key={e.id}
                  onClick={() => e.id !== 'floor' && toggleEquipment(e.id)}
                  className={`w-full text-left px-4 py-4 rounded-xl border transition-all flex items-center justify-between ${
                    equipment.includes(e.id)
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-foreground/80 hover:border-foreground/30'
                  } ${e.id === 'floor' ? 'opacity-50 cursor-default' : ''}`}
                >
                  <span className="font-medium">{e.label}</span>
                  {equipment.includes(e.id) && (
                    <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Days */}
        {step === 2 && (
          <div>
            <h2 className="text-lg font-semibold mb-1">How many days per week?</h2>
            <p className="text-sm text-muted-foreground mb-6">Pick a number you can realistically stick to.</p>
            <div className="flex gap-3 flex-wrap">
              {DAYS.map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`w-16 h-16 rounded-xl border text-lg font-bold transition-all ${
                    days === d
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-foreground/80 hover:border-foreground/30'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Goal */}
        {step === 3 && (
          <div>
            <h2 className="text-lg font-semibold mb-1">What&apos;s your primary goal?</h2>
            <p className="text-sm text-muted-foreground mb-6">This shapes the structure and focus of every session.</p>
            <div className="flex flex-col gap-3">
              {GOALS.map(g => (
                <button
                  key={g.id}
                  onClick={() => setGoal(g.id)}
                  className={`w-full text-left px-4 py-4 rounded-xl border transition-all ${
                    goal === g.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-foreground/80 hover:border-foreground/30'
                  }`}
                >
                  <p className="font-medium">{g.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{g.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex gap-2">
          {step > 0 && (
            <Button
              variant="outline"
              onClick={() => setStep(s => s - 1)}
              className="h-9 px-4 text-sm border-border text-foreground/80 bg-transparent hover:bg-secondary hover:text-foreground"
            >
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button
              onClick={() => setStep(s => s + 1)}
              disabled={!canAdvance()}
              className="h-9 px-5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold disabled:opacity-30"
            >
              Continue
            </Button>
          ) : (
            <Button
              onClick={handleGenerate}
              disabled={!canAdvance()}
              className="h-9 px-5 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold disabled:opacity-30"
            >
              Generate my plan
            </Button>
          )}
        </div>

      </div>
    </main>
  )
}

export default function Home() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-background flex items-center justify-center">
        <svg className="animate-spin w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </main>
    }>
      <HomeContent />
    </Suspense>
  )
}
