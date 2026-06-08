'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase-browser'
import { GenerateRequest } from '@/lib/types'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { HolidayConfig, HolidayGoal } from '@/lib/types'

const LEVELS = ['Beginner', 'Early Intermediate', 'Intermediate', 'Advanced']

const EQUIPMENT_OPTIONS = [
  { id: 'floor', label: 'Floor only' },
  { id: 'pull-up bar', label: 'Pull-up bar' },
  { id: 'resistance bands', label: 'Resistance bands' },
  { id: 'rings', label: 'Rings' },
  { id: 'parallettes', label: 'Parallettes' },
  { id: 'bench (flat)', label: 'Flat bench' },
  { id: 'bench (adjustable)', label: 'Bench (adjustable / multi-angle)' },
  { id: 'barbell & plates', label: 'Barbell & plates' },
  { id: 'full gym access', label: 'Full gym access' },
]

const DAYS = [2, 3, 4, 5, 6]

const GOALS = [
  { id: 'calisthenics-foundation', label: 'Build a calisthenics foundation', requiresSkills: false },
  { id: 'skill-progression', label: 'Improve skill progression', requiresSkills: true },
  { id: 'general-strength', label: 'General strength building', requiresSkills: false },
  { id: 'lose-weight', label: 'Lose weight, maintain muscle', requiresSkills: false },
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

function AccountPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const trainingSettingsRef = useRef<HTMLDivElement>(null)
  const [highlightTraining, setHighlightTraining] = useState(false)

  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)

  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [originalInputs, setOriginalInputs] = useState<GenerateRequest | null>(null)
  const [level, setLevel] = useState('')
  const [equipment, setEquipment] = useState<string[]>(['floor'])
  const [daysPerWeek, setDaysPerWeek] = useState(3)
  const [goal, setGoal] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [isDirty, setIsDirty] = useState(false)

  const [planChangesText, setPlanChangesText] = useState('')

  const [holidayActive, setHolidayActive] = useState(false)
  const [holidayEquipment, setHolidayEquipment] = useState<string[]>(['floor'])
  const [holidayGoal, setHolidayGoal] = useState<HolidayGoal>('maintain-strength')
  const [holidayOriginal, setHolidayOriginal] = useState<HolidayConfig | null>(null)
  const [holidayLoading, setHolidayLoading] = useState(false)
  const [holidaySaving, setHolidaySaving] = useState(false)
  const [holidayDirty, setHolidayDirty] = useState(false)
  const [holidayError, setHolidayError] = useState('')

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
        setSkills(inputs.skills ?? [])
      }

      // Load holiday config
      fetch('/api/holiday-mode').then(r => r.json()).then((cfg: HolidayConfig | null) => {
        if (cfg) {
          setHolidayActive(cfg.is_active)
          setHolidayEquipment(cfg.equipment)
          setHolidayGoal(cfg.goal)
          setHolidayOriginal(cfg)
        }
      }).catch(() => {})

      setLoading(false)
      if (searchParams.get('highlight') === 'training-settings') {
        setTimeout(() => {
          trainingSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          setHighlightTraining(true)
          setTimeout(() => setHighlightTraining(false), 2000)
        }, 100)
      }
    })
  }, [router, searchParams])

  const checkDirty = (
    newLevel: string,
    newEquipment: string[],
    newDays: number,
    newGoal: string,
    newSkills: string[]
  ) => {
    if (!originalInputs) return
    const changed =
      newLevel !== originalInputs.level ||
      newDays !== originalInputs.daysPerWeek ||
      newGoal !== originalInputs.goal ||
      JSON.stringify([...newEquipment].sort()) !== JSON.stringify([...originalInputs.equipment].sort()) ||
      JSON.stringify([...newSkills].sort()) !== JSON.stringify([...(originalInputs.skills ?? [])].sort())
    setIsDirty(changed)
  }

  const toggleEquipment = (id: string) => {
    if (id === 'floor') return
    const next = equipment.includes(id)
      ? equipment.filter(e => e !== id)
      : [...equipment, id]
    setEquipment(next)
    checkDirty(level, next, daysPerWeek, goal, skills)
  }

  const toggleSkill = (skill: string) => {
    const next = skills.includes(skill) ? skills.filter(s => s !== skill) : [...skills, skill]
    setSkills(next)
    checkDirty(level, equipment, daysPerWeek, goal, next)
  }

  const updateLevel = (l: string) => { setLevel(l); checkDirty(l, equipment, daysPerWeek, goal, skills) }
  const updateDays = (d: number) => { setDaysPerWeek(d); checkDirty(level, equipment, d, goal, skills) }
  const updateGoal = (g: string) => {
    setGoal(g)
    const nextSkills = GOALS.find(go => go.id === g)?.requiresSkills ? skills : []
    if (!GOALS.find(go => go.id === g)?.requiresSkills) setSkills([])
    checkDirty(level, equipment, daysPerWeek, g, nextSkills)
  }

  const checkHolidayDirty = (eq: string[], g: HolidayGoal) => {
    if (!holidayOriginal || !holidayActive) { setHolidayDirty(false); return }
    const changed =
      g !== holidayOriginal.goal ||
      JSON.stringify([...eq].sort()) !== JSON.stringify([...holidayOriginal.equipment].sort())
    setHolidayDirty(changed)
  }

  const toggleHolidayEquipment = (id: string) => {
    if (id === 'floor') return
    const next = holidayEquipment.includes(id)
      ? holidayEquipment.filter(e => e !== id)
      : [...holidayEquipment, id]
    setHolidayEquipment(next)
    checkHolidayDirty(next, holidayGoal)
  }

  const updateHolidayGoal = (g: HolidayGoal) => {
    setHolidayGoal(g)
    checkHolidayDirty(holidayEquipment, g)
  }

  const handleHolidayToggle = async (on: boolean) => {
    setHolidayLoading(true)
    setHolidayError('')
    try {
      const res = await fetch('/api/holiday-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: on, equipment: holidayEquipment, goal: holidayGoal }),
      })
      if (!res.ok) throw new Error('Failed')
      setHolidayActive(on)
      setHolidayOriginal({ is_active: on, equipment: holidayEquipment, goal: holidayGoal })
      setHolidayDirty(false)
      sessionStorage.removeItem('workout-plan')
      sessionStorage.removeItem('plan-id')
      sessionStorage.removeItem('plan-accepted')
      if (on) {
        router.push('/plan?holiday=1')
      } else {
        router.push('/plan')
      }
    } catch {
      setHolidayError('Something went wrong. Please try again.')
    } finally {
      setHolidayLoading(false)
    }
  }

  const handleSaveHolidaySettings = async () => {
    setHolidaySaving(true)
    setHolidayError('')
    try {
      const res = await fetch('/api/holiday-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: true, equipment: holidayEquipment, goal: holidayGoal }),
      })
      if (!res.ok) throw new Error('Failed')
      setHolidayOriginal({ is_active: true, equipment: holidayEquipment, goal: holidayGoal })
      setHolidayDirty(false)
      sessionStorage.removeItem('workout-plan')
      sessionStorage.removeItem('plan-id')
      sessionStorage.removeItem('plan-accepted')
    } catch {
      setHolidayError('Something went wrong. Please try again.')
    } finally {
      setHolidaySaving(false)
    }
  }

  const handleSaveName = async () => {
    setSavingName(true)
    const supabase = createSupabaseBrowser()
    await supabase.auth.updateUser({ data: { display_name: displayName } })
    setSavingName(false)
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  const handleUpdatePlan = () => {
    const inputs: GenerateRequest = { level, equipment, daysPerWeek, goal, ...(skills.length ? { skills } : {}), changes: planChangesText.trim() || undefined }
    sessionStorage.setItem('workout-inputs', JSON.stringify(inputs))
    sessionStorage.setItem('plan-generating', '1')
    sessionStorage.removeItem('workout-plan')
    sessionStorage.removeItem('plan-id')
    sessionStorage.removeItem('plan-accepted')
    router.push('/plan')
  }

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowser()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch('/api/delete-account', { method: 'POST' })
      if (!res.ok) throw new Error('Delete failed')
      sessionStorage.clear()
      router.push('/login')
    } catch {
      setDeleteError('Something went wrong. Please try again.')
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <svg className="animate-spin w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-2xl mx-auto px-5 sm:px-8 py-8">

        <div className="mb-8">
          <p className="text-xs font-semibold tracking-widest text-accent uppercase mb-1">Settings</p>
          <h1 className="text-2xl font-bold text-foreground">Account</h1>
        </div>

        {/* Profile */}
        <Card className="bg-card border-border mb-5">
          <CardHeader className="pb-4">
            <CardTitle className="text-foreground text-base">Profile</CardTitle>
            <CardDescription className="text-muted-foreground text-sm">Your display name shown in the app.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Label htmlFor="display-name" className="text-muted-foreground text-xs mb-2 block">Display name</Label>
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/30 focus-visible:border-primary"
                />
              </div>
              <Button
                onClick={handleSaveName}
                disabled={savingName || !displayName.trim()}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shrink-0"
              >
                {nameSaved ? '✓ Saved' : savingName ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Training settings */}
        <Card ref={trainingSettingsRef} className={`bg-card border-border mb-5 transition-all${highlightTraining ? ' ring-2 ring-primary' : ''}`}>
          <CardHeader className="pb-4">
            <CardTitle className="text-foreground text-base">Training settings</CardTitle>
            <CardDescription className="text-muted-foreground text-sm">Changing these will rebuild your plan around your new settings.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">

            {/* Level */}
            <div>
              <Label className="text-muted-foreground text-xs mb-3 block">Fitness level</Label>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map(l => (
                  <button
                    key={l}
                    onClick={() => updateLevel(l)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                      level === l
                        ? 'border-primary bg-primary/8 text-primary'
                        : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Equipment */}
            <div>
              <Label className="text-muted-foreground text-xs mb-3 block">Equipment available</Label>
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
                      className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                      onCheckedChange={() => toggleEquipment(e.id)}
                    />
                    <label
                      htmlFor={`eq-${e.id}`}
                      className={`text-sm cursor-pointer select-none ${
                        e.id === 'floor' ? 'text-muted-foreground/50' : 'text-foreground/80'
                      }`}
                    >
                      {e.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Days per week */}
            <div>
              <Label className="text-muted-foreground text-xs mb-3 block">Training days per week</Label>
              <div className="flex gap-2">
                {DAYS.map(d => (
                  <button
                    key={d}
                    onClick={() => updateDays(d)}
                    className={`w-12 h-12 rounded-xl border text-base font-bold transition-all ${
                      daysPerWeek === d
                        ? 'border-primary bg-primary/8 text-primary'
                        : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Goal */}
            <div>
              <Label className="text-muted-foreground text-xs mb-3 block">Primary goal</Label>
              <div className="flex flex-wrap gap-2">
                {GOALS.map(g => (
                  <button
                    key={g.id}
                    onClick={() => updateGoal(g.id)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                      goal === g.id
                        ? 'border-primary bg-primary/8 text-primary'
                        : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>

              {goal === 'skill-progression' && (
                <div className="mt-4">
                  <p className="text-xs text-muted-foreground mb-2">Target skills</p>
                  <div className="flex flex-wrap gap-2">
                    {SKILL_OPTIONS.map(skill => (
                      <button
                        key={skill}
                        onClick={() => toggleSkill(skill)}
                        className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                          skills.includes(skill)
                            ? 'border-primary bg-primary/8 text-primary'
                            : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                        }`}
                      >
                        {skill}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Program customization */}
            <div>
              <Label className="text-muted-foreground text-xs mb-1 block">Program customization</Label>
              <p className="text-xs text-muted-foreground/70 mb-3">
                Tell us anything specific you want in your program — exercises to include, movements to avoid, or focus areas. We&apos;ll swap or add accordingly.
              </p>
              <Textarea
                value={planChangesText}
                onChange={e => setPlanChangesText(e.target.value)}
                placeholder="e.g. I want to include deadlifts in my leg day. No ring work for now, my shoulder is tender."
                rows={3}
                className="bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/30 focus-visible:border-primary resize-none"
              />
            </div>

            {(isDirty || planChangesText.trim()) && (
              <Button
                onClick={handleUpdatePlan}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold w-full"
              >
                Update my plan →
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Holiday mode */}
        <Card className="bg-card border-border mb-5">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-foreground text-base">Holiday mode</CardTitle>
                <CardDescription className="text-muted-foreground text-sm mt-1">
                  {holidayActive
                    ? 'Active — your normal plan is paused while you\'re away.'
                    : 'Temporarily swap to a holiday-friendly plan without affecting your normal program.'}
                </CardDescription>
              </div>
              <Switch
                checked={holidayActive}
                disabled={holidayLoading}
                onCheckedChange={handleHolidayToggle}
                className="shrink-0 ml-4"
              />
            </div>
          </CardHeader>

          {holidayActive && (
            <CardContent className="flex flex-col gap-6 pt-0">
              <Separator />

              <div>
                <Label className="text-muted-foreground text-xs mb-3 block">Equipment available on holiday</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {EQUIPMENT_OPTIONS.map(e => (
                    <div
                      key={e.id}
                      className="flex items-center gap-3 cursor-pointer"
                      onClick={() => toggleHolidayEquipment(e.id)}
                    >
                      <Checkbox
                        id={`heq-${e.id}`}
                        checked={holidayEquipment.includes(e.id)}
                        disabled={e.id === 'floor'}
                        className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        onCheckedChange={() => toggleHolidayEquipment(e.id)}
                      />
                      <label
                        htmlFor={`heq-${e.id}`}
                        className={`text-sm cursor-pointer select-none ${
                          e.id === 'floor' ? 'text-muted-foreground/50' : 'text-foreground/80'
                        }`}
                      >
                        {e.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <Label className="text-muted-foreground text-xs mb-3 block">Holiday goal</Label>
                <div className="flex flex-col gap-2">
                  {([
                    { id: 'maintain-strength', label: 'Maintain strength', description: 'Keep your strength base during a short break' },
                    { id: 'active-recovery', label: 'Active recovery', description: 'Minimal work, mobility focus, low fatigue' },
                    { id: 'high-intensity-bodyweight', label: 'High intensity bodyweight', description: 'HIIT, high-rep conditioning with what you have' },
                  ] as { id: HolidayGoal; label: string; description: string }[]).map(g => (
                    <button
                      key={g.id}
                      onClick={() => updateHolidayGoal(g.id)}
                      className={`flex flex-col items-start text-left px-4 py-3 rounded-xl border transition-all ${
                        holidayGoal === g.id
                          ? 'border-primary bg-primary/8'
                          : 'border-border hover:border-foreground/30'
                      }`}
                    >
                      <span className={`text-sm font-medium ${holidayGoal === g.id ? 'text-primary' : 'text-foreground'}`}>{g.label}</span>
                      <span className="text-xs text-muted-foreground mt-0.5">{g.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              {holidayError && <p className="text-destructive text-sm">{holidayError}</p>}

              {holidayDirty && (
                <Button
                  onClick={handleSaveHolidaySettings}
                  disabled={holidaySaving}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold w-full"
                >
                  {holidaySaving ? 'Generating holiday plan…' : 'Save & regenerate holiday plan →'}
                </Button>
              )}
            </CardContent>
          )}
        </Card>

        {/* Sign out */}
        <Card className="bg-card border-border mb-5">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Sign out</p>
                <p className="text-xs text-muted-foreground mt-0.5">Sign out of your account on this device.</p>
              </div>
              <Button
                variant="outline"
                onClick={handleSignOut}
                className="border-border text-foreground/70 hover:text-foreground hover:bg-secondary bg-transparent shrink-0"
              >
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card className="bg-card border-destructive/20 mb-5">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-destructive">Delete account</p>
                <p className="text-xs text-muted-foreground mt-0.5">Permanently remove your account and all data.</p>
              </div>
              <Button
                variant="outline"
                onClick={() => { setShowDeleteDialog(true); setDeleteConfirmText(''); setDeleteError('') }}
                className="border-destructive/40 text-destructive hover:text-destructive hover:bg-destructive/10 hover:border-destructive/60 bg-transparent shrink-0"
              >
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Delete account dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-popover border-border text-popover-foreground">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This will permanently delete your account, all plans, and all logged data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-muted-foreground">Type <span className="text-foreground font-mono">delete</span> to confirm.</p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder="delete"
              className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-destructive/60"
            />
            {deleteError && <p className="text-destructive text-sm">{deleteError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setShowDeleteDialog(false)}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteAccount}
              disabled={deleteConfirmText !== 'delete' || deleting}
              className="bg-destructive hover:bg-destructive/90 text-white font-semibold disabled:opacity-40"
            >
              {deleting ? 'Deleting…' : 'Yes, delete everything'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

export default function AccountPageWrapper() {
  return (
    <Suspense>
      <AccountPage />
    </Suspense>
  )
}
