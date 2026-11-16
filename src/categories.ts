import type { CategoryId } from '../types'

export const CATEGORIES: readonly { id: CategoryId; label: string; keywords: string[] }[] = [
  { id: 'design', label: 'Design & UI', keywords: ['design', 'ui', 'ux', 'visual', 'color', 'colour', 'typography', 'palette', 'figma', 'brand', 'logo', 'icon', 'accessibility', 'alignment', 'spacing', 'journey', 'blueprint', 'empathy', 'persona', 'illustration', 'mockup', 'prototype'] },
  { id: 'frontend', label: 'Frontend', keywords: ['frontend', 'react', 'css', 'html', 'tailwind', 'web', 'component', 'nextjs', 'vue', 'landing', 'threejs', '3d', 'webgl', 'glsl', 'shader', 'animation', 'loader', 'parallax'] },
  { id: 'mobile', label: 'Mobile', keywords: ['mobile', 'flutter', 'dart', 'ios', 'android', 'swift', 'swiftui', 'app-store', 'expo'] },
  { id: 'backend', label: 'Backend & Data', keywords: ['backend', 'api', 'database', 'sql', 'supabase', 'server', 'postgres', 'schema'] },
  { id: 'debug-test', label: 'Debugging & Testing', keywords: ['debug', 'debugging', 'bug', 'test', 'testing', 'tdd', 'e2e', 'crash', 'error'] },
  { id: 'review', label: 'Code Review & Quality', keywords: ['review', 'critique', 'audit', 'quality', 'lint', 'refactor', 'simplify'] },
  { id: 'docs', label: 'Docs & Writing', keywords: ['docs', 'documentation', 'writing', 'copy', 'readme', 'humanizer', 'docx', 'pdf', 'pptx'] },
  { id: 'planning', label: 'Planning & Process', keywords: ['plan', 'planning', 'brainstorm', 'brainstorming', 'spec', 'roadmap', 'task', 'project', 'handoff', 'goal', 'goals', 'standup', 'automate', 'onboard', 'onboarding', 'subagent', 'verification', 'branch', 'prs', 'finishing'] },
  { id: 'research', label: 'Research', keywords: ['research', 'search', 'scrape', 'web-search', 'discover', 'interview', 'jobs-to-be-done', 'synthesis', 'survey', 'customers', 'pricing', 'validate', 'fundraise', 'hire'] },
  { id: 'analytics', label: 'Data & Analytics', keywords: ['data', 'analytics', 'chart', 'visualization', 'dataviz', 'metrics', 'xlsx'] },
  { id: 'security', label: 'Security', keywords: ['security', 'secret', 'vulnerability', 'auth', 'hardening'] },
  { id: 'devops', label: 'DevOps & Tooling', keywords: ['deploy', 'ci', 'git', 'docker', 'infrastructure', 'monitoring', 'hook', 'plugin', 'config', 'mcp', 'statusline', 'settings', 'shell', 'opencode', 'codex', 'automation'] },
  { id: 'other', label: 'Other', keywords: [] },
]

const tokenize = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** A token equals the word, or is its plural (`errors` for `error`). */
const same = (t: string | undefined, p: string): boolean => t === p || (t !== undefined && t.length > 3 && t.endsWith('s') && t.slice(0, -1) === p)

/** True when the keyword's words appear as consecutive tokens (so `app-store` matches "app store"). */
function hasKeyword(tokens: string[], keyword: string): boolean {
  const parts = keyword.split('-')
  for (let i = 0; i + parts.length <= tokens.length; i++) {
    if (parts.every((p, j) => same(tokens[i + j], p))) return true
  }
  return false
}

/** Name hits score 3, description hits 1. Ties go to the earlier category; no hit is `other`. */
export function categorize(name: string, description: string, override?: string): CategoryId {
  const known = CATEGORIES.find(c => c.id === override)
  if (known) return known.id
  const nameTokens = tokenize(name)
  const descTokens = tokenize(description)
  let best: CategoryId = 'other'
  let bestScore = 0
  for (const c of CATEGORIES) {
    let score = 0
    for (const k of c.keywords) {
      if (hasKeyword(nameTokens, k)) score += 3
      if (hasKeyword(descTokens, k)) score += 1
    }
    if (score > bestScore) {
      best = c.id
      bestScore = score
    }
  }
  return best
}
