'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { GenerateRequest } from '@/lib/types'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const LEVELS = [
  { id: 'Beginner', label: 'Beginner' },
  { id: 'Early Intermediate', label: 'Early Intermediate' },
  { id: 'Intermediate', label: 'Intermediate' },
  { id: 'Advanced', label: 'Advanced' },
]

const EQUIPMENT = [
  { id: 'floor', label: 'Floor only', icon: '🏠', always: true },
  { id: 'pull-up bar', label: 'Pull-up bar', icon: '🔩' },
  { id: 'resistance bands', label: 'Resistance bands', icon: '〰️' },
  { id: 'rings', label: 'Rings', icon: '⭕' },
  { id: 'parallettes', label: 'Parallettes', icon: '⏸' },
  { id: 'bench (flat)', label: 'Flat bench', icon: '🪑' },
  { id: 'bench (adjustable)', label: 'Adjustable bench', icon: '🪑' },
  { id: 'barbell & plates', label: 'Barbell & plates', icon: '🏋️' },
  { id: 'full gym access', label: 'Full gym', icon: '🏟' },
]

const DAYS = [2, 3, 4, 5, 6]

const GOALS = [
  { id: 'calisthenics-foundation', label: 'Build a calisthenics foundation', desc: 'Beginner / early intermediate', requiresSkills: false },
  { id: 'skill-progression', label: 'Improve skill progression', desc: 'Intermediate / advanced — pick your target skills', requiresSkills: true },
  { id: 'general-strength', label: 'General strength building', desc: 'Compound movements + progressive overload', requiresSkills: false },
  { id: 'lose-weight', label: 'Lose weight, maintain muscle', desc: 'Higher volume, conditioning, calorie burn', requiresSkills: false },
]

const SKILL_OPTIONS = [
  'Handstand',
  'Handstand push-up',
  'Planche',
  'Front lever',
  'Back lever',
  'Muscle-up',
  'L-sit / V-sit',
  'One-arm pull-up',
]

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [checking, setChecking] = useState(true)

  const [email, setEmail] = useState('')
  const [level, setLevel] = useState('Beginner')
  const [equipment, setEquipment] = useState<string[]>(['floor', 'pull-up bar'])
  const [days, setDays] = useState(3)
  const [goal, setGoal] = useState('calisthenics-foundation')
  const [skills, setSkills] = useState<string[]>([])

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

  const toggleSkill = (skill: string) => {
    setSkills(prev => prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill])
  }

  const canGenerate = goal !== 'skill-progression' || skills.length > 0

  const handleGenerate = () => {
    if (email.trim()) sessionStorage.setItem('guest-email', email.trim())
    const inputs: GenerateRequest = {
      level, equipment, daysPerWeek: days, goal,
      ...(skills.length ? { skills } : {}),
    }
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
      <div className="max-w-2xl mx-auto w-full px-5 sm:px-8 pt-10 pb-20">

        {/* Header */}
        <div className="mb-10">
          <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-1">Calisthenics</p>
          <h1 className="text-2xl font-bold text-foreground">Tell me where you are —<br />I&apos;ll build your program.</h1>
        </div>

        <div className="flex flex-col gap-10">

          {/* Email */}
          <section>
            <Label htmlFor="email" className="text-sm font-semibold text-foreground mb-1 block">Your email</Label>
            <p className="text-xs text-muted-foreground mb-3">We&apos;ll save your plan here once you&apos;re done.</p>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="bg-card border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/30 focus-visible:border-primary max-w-sm"
            />
          </section>

          {/* Level */}
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-1">Your current level</h2>
            <p className="text-xs text-muted-foreground mb-3">Be honest — the plan adapts to where you actually are.</p>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map(l => (
                <button
                  key={l.id}
                  onClick={() => setLevel(l.id)}
                  className={`px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                    level === l.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-foreground/70 hover:border-foreground/30'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </section>

          {/* Equipment */}
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-1">Equipment you have access to</h2>
            <p className="text-xs text-muted-foreground mb-3">Select everything available to you — we&apos;ll only use what you have.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {EQUIPMENT.map(e => {
                const selected = equipment.includes(e.id)
                return (
                  <button
                    key={e.id}
                    onClick={() => !e.always && toggleEquipment(e.id)}
                    className={`flex items-center gap-2.5 px-3 py-3 rounded-xl border text-sm transition-all ${
                      selected
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-card text-foreground/70 hover:border-foreground/30'
                    } ${e.always ? 'opacity-60 cursor-default' : ''}`}
                  >
                    <span className="text-base leading-none">{e.icon}</span>
                    <span className="font-medium leading-tight text-left">{e.label}</span>
                    {selected && (
                      <svg className="w-3.5 h-3.5 text-primary ml-auto shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Days per week */}
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-1">Days per week</h2>
            <p className="text-xs text-muted-foreground mb-3">Pick a number you can realistically stick to.</p>
            <div className="flex gap-2">
              {DAYS.map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`w-12 h-12 rounded-xl border text-base font-bold transition-all ${
                    days === d
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-foreground/70 hover:border-foreground/30'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </section>

          {/* Goal */}
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-1">Primary goal</h2>
            <p className="text-xs text-muted-foreground mb-3">This shapes the structure and focus of every session.</p>
            <div className="flex flex-col gap-2">
              {GOALS.map(g => (
                <button
                  key={g.id}
                  onClick={() => { setGoal(g.id); if (!g.requiresSkills) setSkills([]) }}
                  className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all ${
                    goal === g.id
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border bg-card text-foreground/70 hover:border-foreground/30'
                  }`}
                >
                  <p className="font-medium text-sm">{g.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{g.desc}</p>
                </button>
              ))}
            </div>

            {goal === 'skill-progression' && (
              <div className="mt-4">
                <p className="text-xs font-medium mb-2 text-foreground/80">Which skills do you want to target? <span className="text-muted-foreground font-normal">(select all that apply)</span></p>
                <div className="flex flex-col gap-1.5">
                  {SKILL_OPTIONS.map(skill => (
                    <button
                      key={skill}
                      onClick={() => toggleSkill(skill)}
                      className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${
                        skills.includes(skill)
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-card text-foreground/70 hover:border-foreground/30'
                      }`}
                    >
                      <span className="font-medium text-sm">{skill}</span>
                      {skills.includes(skill) && (
                        <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

        </div>

        {/* Generate CTA */}
        <div className="mt-10">
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full sm:w-auto h-11 px-8 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-semibold disabled:opacity-30"
          >
            Generate my plan
          </Button>
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
