import { expect, test } from 'claude-code/testing'

import { filterSkills, groupSkills } from '../src/filter'
import type { CategoryId, Skill } from '../types'

const s = (name: string, description = '', category: CategoryId = 'other', plugin?: string): Skill =>
  ({ name, invoke: plugin ? `${plugin}:${name}` : name, description, category, source: plugin ? 'plugin' : 'personal', ...(plugin ? { plugin } : {}) })

test('matches description, any case', async () =>
  expect(filterSkills([s('a', 'Polish UI'), s('b')], 'polish').map(x => x.name)).toEqual(['a']))
test('matches plugin prefix', async () =>
  expect(filterSkills([s('x', '', 'other', 'figma'), s('y')], 'figma:').map(x => x.invoke)).toEqual(['figma:x']))
test('regex characters are literal', async () => {
  expect(filterSkills([s('cpp', 'c++ helpers'), s('d')], 'c++').map(x => x.name)).toEqual(['cpp'])
  expect(() => filterSkills([s('a')], '(.*')).not.toThrow()
})
test('blank query returns all', async () => expect(filterSkills([s('a'), s('b')], '  ')).toHaveLength(2))
test('groups in category order, empty dropped, sorted', async () => {
  const g = groupSkills([s('z', '', 'docs'), s('a', '', 'docs'), s('m', '', 'design')])
  expect(g.map(x => x.id)).toEqual(['design', 'docs'])
  expect(g[1]!.skills.map(x => x.name)).toEqual(['a', 'z'])
})
