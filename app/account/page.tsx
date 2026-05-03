'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { GenerateRequest } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const LEVELS = ['Beginner', 'Early Intermediate', 'Intermediate', 'Advanced']

const EQUIPMENT_OPTIONS = [
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
  { id: 'General fitness', label: 'General fitness' },
  { id: 'Build strength', label: 'Build strength' },
  { id: 'Learn skills', label: 'Learn skills' },
  { id: 'Muscle gain', label: 'Muscle gain' },
]

export default function AccountPage() {
  const router = useRouter()

  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)

  const [originalInputs, setOriginalInputs] = useState<GenerateRequest | null>(null)
  const [level, setLevel] = useState('')
  const [equipment, setEquipment] = useState<string[]>(['floor'])
  const [daysPerWeek, setDaysPerWeek] = useState(3)
  const [goal, setGoal] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const [planChangesText, setPlanChangesText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createSupabaseBrowser()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.replace('/login'); return }

      setDisplayName(user.user_metadata?.display_name ?? '')

      const { data: planRow } = await supabase
        .from('plans')
        .select('inputs')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (planRow?.inputs) {
        const inputs = planRow.inputs as GenerateRequest
        setOriginalInputs(inputs)
        setLevel(inputs.level ?? '')
        setEquipment(inputs.equipment ?? ['floor'])
        setDaysPerWeek(inputs.daysPerWeek ?? 3)
        setGoal(inputs.goal ?? '')
      }
      setLoading(false)
    })
  }, [router])

  const checkDirty = (
    newLevel: string,
    newEquipment: string[],
    newDays: number,
    newGoal: string
  ) => {
    if (!originalInputs) return
    const changed =
      newLevel !== originalInputs.level ||
      newDays !== originalInputs.daysPerWeek ||
      newGoal !== originalInputs.goal ||
      JSON.stringify([...newEquipment].sort()) !== JSON.stringify([...originalInputs.equipment].sort())
    setIsDirty(changed)
  }

  const toggleEquipment = (id: string) => {
    if (id === 'floor') return
    const next = equipment.includes(id)
      ? equipment.filter(e => e !== id)
      : [...equipment, id]
    setEquipment(next)
    checkDirty(level, next, daysPerWeek, goal)
  }

  const updateLevel = (l: string) => { setLevel(l); checkDirty(l, equipment, daysPerWeek, goal) }
  const updateDays = (d: number) => { setDaysPerWeek(d); checkDirty(level, equipment, d, goal) }
  const updateGoal = (g: string) => { setGoal(g); checkDirty(level, equipment, daysPerWeek, g) }

  const handleSaveName = async () => {
    setSavingName(true)
    const supabase = createSupabaseBrowser()
    await supabase.auth.updateUser({ data: { display_name: displayName } })
    setSavingName(false)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  const handleApplySettings = () => {
    if (isDirty) setShowConfirmDialog(true)
  }

  const handleGenerateWithSettings = async () => {
    setShowConfirmDialog(false)
    await generatePlan({ level, equipment, daysPerWeek, goal })
  }

  const handleGenerateNewPlan = async () => {
    if (!planChangesText.trim() && !isDirty) return
    await generatePlan({ level, equipment, daysPerWeek, goal, changes: planChangesText.trim() || undefined })
  }

  const generatePlan = async (inputs: GenerateRequest) => {
    setGenerating(true)
    setError('')
    try {
      const res = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      })
      if (!res.ok) throw new Error('Generation failed')
      const data = await res.json()
      sessionStorage.setItem('workout-plan', JSON.stringify(data))
      sessionStorage.setItem('workout-inputs', JSON.stringify(inputs))
      if (data.planId) sessionStorage.setItem('plan-id', data.planId)
      sessionStorage.removeItem('plan-accepted')
      router.push('/plan')
    } catch {
      setError('Something went wrong. Please try again.')
      setGenerating(false)
    }
  }

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
          <p className="text-xs font-semibold tracking-widest text-orange-400 uppercase mb-1">Settings</p>
          <h1 className="text-2xl font-bold text-white">Account</h1>
        </div>

        {/* Profile */}
        <Card className="bg-zinc-900 border-zinc-800 mb-5">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-base">Profile</CardTitle>
            <CardDescription className="text-zinc-500 text-sm">Your display name shown in the app.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Label htmlFor="display-name" className="text-zinc-400 text-xs mb-2 block">Display name</Label>
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-600 focus-visible:ring-orange-400/50 focus-visible:border-orange-400"
                />
              </div>
              <Button
                onClick={handleSaveName}
                disabled={savingName || !displayName.trim()}
                className="bg-orange-400 hover:bg-orange-300 text-zinc-950 font-semibold shrink-0"
              >
                {nameSaved ? '✓ Saved' : savingName ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Training settings */}
        <Card className="bg-zinc-900 border-zinc-800 mb-5">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-base">Training settings</CardTitle>
            <CardDescription className="text-zinc-500 text-sm">Changing these will prompt you to generate a new plan.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">

            {/* Level */}
            <div>
              <Label className="text-zinc-400 text-xs mb-3 block">Fitness level</Label>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map(l => (
                  <button
                    key={l}
                    onClick={() => updateLevel(l)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                      level === l
                        ? 'border-orange-400 bg-orange-400/10 text-orange-400'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <Separator className="bg-zinc-800" />

            {/* Equipment */}
            <div>
              <Label className="text-zinc-400 text-xs mb-3 block">Equipment available</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {EQUIPMENT_OPTIONS.map(e => (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 cursor-pointer"
                    onClick={() => toggleEquipment(e.id)}
                  >
                    <Checkbox
                      id={`eq-${e.id}`}
                      checked={equipment.includes(e.id)}
                      disabled={e.id === 'floor'}
                      className="border-zinc-600 data-[state=checked]:bg-orange-400 data-[state=checked]:border-orange-400"
                      onCheckedChange={() => toggleEquipment(e.id)}
                    />
                    <label
                      htmlFor={`eq-${e.id}`}
                      className={`text-sm cursor-pointer select-none ${
                        e.id === 'floor' ? 'text-zinc-600' : 'text-zinc-300'
                      }`}
                    >
                      {e.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <Separator className="bg-zinc-800" />

            {/* Days per week */}
            <div>
              <Label className="text-zinc-400 text-xs mb-3 block">Training days per week</Label>
              <div className="flex gap-2">
                {DAYS.map(d => (
                  <button
                    key={d}
                    onClick={() => updateDays(d)}
                    className={`w-12 h-12 rounded-xl border text-base font-bold transition-all ${
                      daysPerWeek === d
                        ? 'border-orange-400 bg-orange-400/10 text-orange-400'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <Separator className="bg-zinc-800" />

            {/* Goal */}
            <div>
              <Label className="text-zinc-400 text-xs mb-3 block">Primary goal</Label>
              <div className="flex flex-wrap gap-2">
                {GOALS.map(g => (
                  <button
                    key={g.id}
                    onClick={() => updateGoal(g.id)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                      goal === g.id
                        ? 'border-orange-400 bg-orange-400/10 text-orange-400'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {isDirty && (
              <Button
                onClick={handleApplySettings}
                className="bg-orange-400 hover:bg-orange-300 text-zinc-950 font-semibold w-full"
              >
                Apply settings & generate new plan →
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Generate new plan */}
        <Card className="bg-zinc-900 border-zinc-800 mb-5">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-base">Generate a new plan</CardTitle>
            <CardDescription className="text-zinc-500 text-sm">
              Describe what you want to change, or just hit generate for a fresh start.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              value={planChangesText}
              onChange={e => setPlanChangesText(e.target.value)}
              placeholder="e.g. I want more pulling work, less core volume, and I'd like to try ring work…"
              rows={3}
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-600 focus-visible:ring-orange-400/50 focus-visible:border-orange-400 resize-none"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <Button
              onClick={handleGenerateNewPlan}
              disabled={generating}
              className="bg-orange-400 hover:bg-orange-300 text-zinc-950 font-semibold self-end flex items-center gap-2"
            >
              {generating ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Generating…
                </>
              ) : 'Generate plan →'}
            </Button>
          </CardContent>
        </Card>

      </div>

      {/* Confirm dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Generate a new plan?</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Your training settings changed. Generate a fresh plan with these updated settings?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setShowConfirmDialog(false)}
              className="text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleGenerateWithSettings}
              className="bg-orange-400 hover:bg-orange-300 text-zinc-950 font-semibold"
            >
              Yes, generate new plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
