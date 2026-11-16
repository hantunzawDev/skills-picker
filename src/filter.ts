import type { CategoryId, Skill } from '../types'

import { CATEGORIES } from './categories'

/** Case-insensitive literal substring match on name, invoke and description. A blank query matches everything. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase()
  if (q === '') return skills
  return skills.filter(
    skill =>
      skill.name.toLowerCase().includes(q) ||
      skill.invoke.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q),
  )
}

const byNameThenInvoke = (a: Skill, b: Skill): number => {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  if (a.invoke !== b.invoke) return a.invoke < b.invoke ? -1 : 1
  return 0
}

/** Groups skills in CATEGORIES order, drops empty groups, and sorts each group by name then invoke. */
export function groupSkills(skills: Skill[]): { id: CategoryId; label: string; skills: Skill[] }[] {
  return CATEGORIES.flatMap(({ id, label }) => {
    const members = skills.filter(skill => skill.category === id).sort(byNameThenInvoke)
    return members.length > 0 ? [{ id, label, skills: members }] : []
  })
}
