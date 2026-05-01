import { readFileSync } from 'fs'
import { join } from 'path'

let cached: string | null = null

export function getSkillPrompt(): string {
  if (cached) return cached
  cached = readFileSync(join(process.cwd(), 'prompts', 'skill.md'), 'utf-8')
  return cached
}
