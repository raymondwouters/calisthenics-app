import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { GenerateRequest, PlanResponse } from '@/lib/types'

export async function POST(req: NextRequest) {
  const { userId, plan, inputs }: { userId: string; plan: PlanResponse; inputs: GenerateRequest } = await req.json()

  if (!userId || !plan || !inputs) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('plans')
    .insert({ user_id: userId, plan, inputs })
    .select('id')
    .single()

  if (error) {
    console.error('save-guest-plan error:', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ planId: data.id })
}
