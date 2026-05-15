'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createSupabaseBrowser } from '@/lib/supabase-browser'

export default function Nav() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowser()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsLoggedIn(!!user)
      if (user) {
        setDisplayName(user.user_metadata?.display_name ?? user.email ?? null)
      }
      setLoaded(true)
    })
  }, [pathname])

  // Close drawer on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close drawer on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const navigate = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  if (pathname === '/login') return null

  // Logo + sign in during onboarding
  if (pathname === '/') {
    return (
      <header className="h-14 bg-background flex items-center justify-between px-5">
        <span className="text-sm font-semibold text-foreground tracking-tight">A Fresh Training Week</span>
        <button
          onClick={() => router.push('/login')}
          className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign in
        </button>
      </header>
    )
  }

  if (!loaded) {
    return (
      <header className="h-14 bg-background flex items-center px-5">
        <span className="text-sm font-semibold text-foreground tracking-tight">A Fresh Training Week</span>
      </header>
    )
  }
  if (!isLoggedIn) return null

  return (
    <>
      <header className="h-14 bg-background flex items-center px-5">
        <div className="flex-1 flex items-center">
          <button
            onClick={() => router.push('/plan')}
            className="text-sm font-semibold text-foreground tracking-tight hover:opacity-70 transition-opacity"
          >
            A Fresh Training Week
          </button>
        </div>

        {/* Desktop inline nav */}
        <nav className="hidden sm:flex items-center gap-1 mr-2">
          <DesktopNavItem
            label="Account"
            active={pathname === '/account'}
            onClick={() => router.push('/account')}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            }
          />
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setOpen(v => !v)}
          aria-label="Open menu"
          className="sm:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        className={`fixed top-0 right-0 z-50 h-full w-72 bg-background border-l border-border flex flex-col shadow-xl transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div>
            {displayName ? (
              <p className="text-sm text-muted-foreground">
                Hi, <span className="text-foreground font-semibold">{displayName.split('@')[0]}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Menu</p>
            )}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="h-px bg-border mx-6" />

        {/* Nav links */}
        <nav className="flex flex-col gap-1 px-3 py-4 flex-1">
          <DrawerNavItem
            label="Account"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            }
            active={pathname === '/account'}
            onClick={() => navigate('/account')}
          />
        </nav>

      </div>
    </>
  )
}

function DesktopNavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-primary/8 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function DrawerNavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
        active
          ? 'bg-primary/8 text-primary font-medium'
          : 'text-foreground/80 hover:bg-secondary hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
