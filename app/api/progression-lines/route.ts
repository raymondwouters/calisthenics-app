import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { getSkillPrompt } from '@/lib/skill'
import { createSupabaseServer } from '@/lib/supabase-server'
import { ProgressionLinesResponse } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const serverClient = await createSupabaseServer()
  const { data: { user } } = await serverClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { exerciseNames }: { exerciseNames: string[] } = await req.json()
  if (!exerciseNames || exerciseNames.length === 0) {
    return NextResponse.json({ lines: [] })
  }

  const userMessage = `The user has logged the following exercises: ${exerciseNames.join(', ')}.

Using your calisthenics coaching knowledge, group these exercises into their movement family progression lines and return the complete progression chain for each family — from easiest to hardest.

Rules:
- Include the FULL progression line for each family, not just the exercises the user has done. Show the complete path from beginner to advanced.
- Between main progression steps, insert any assisted or transitional variants that would fit there (e.g. band-assisted pull-up between Australian pull-up and full pull-up, negative pull-up, jump pull-up). Mark these with "assisted": true.
- If an exercise belongs to multiple families (e.g. dips can be chest or tricep focused), place it in the most appropriate family given the other exercises in the user's list.
- Each node must have a "name" (string), "assisted" (boolean), and optionally "notes" (string — one short phrase explaining the variant or a coaching cue, only for assisted nodes).
- Keep family names short and clear: "Horizontal Push", "Vertical Push", "Horizontal Pull", "Vertical Pull", "Core", "Legs", "Skill" etc.
- Only include families that contain at least one exercise from the user's list.

Return ONLY a single-line compact JSON object — no explanation, no markdown:
{"lines":[{"family":"Horizontal Push","nodes":[{"name":"Wall push-up","assisted":false},{"name":"Incline push-up","assisted":false},{"name":"Knee push-up","assisted":false},{"name":"Push-up","assisted":false},{"name":"Archer push-up","assisted":false}]}]}`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: getSkillPrompt(),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse progression lines' }, { status: 500 })
    }

    const result: ProgressionLinesResponse = JSON.parse(jsonMatch[0])
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Progression lines error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
