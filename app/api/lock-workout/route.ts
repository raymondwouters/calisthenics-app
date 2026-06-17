import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'
import { supabase } from '@/lib/supabase'
import { LockWorkoutConfig } from '@/lib/types'

export async function GET() {
  const serverClient = await createSupabaseServer()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('lock_workout_config')
    .select('is_active')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json(null)
  return NextResponse.json(data as LockWorkoutConfig)
}

export async function PUT(req: NextRequest) {
  const serverClient = await createSupabaseServer()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body: LockWorkoutConfig = await req.json()
  const { is_active } = body

  const { error } = await supabase
    .from('lock_workout_config')
    .upsert(
      { user_id: user.id, is_active, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )

  if (error) {
    console.error('Lock workout config upsert error:', error.message)
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
