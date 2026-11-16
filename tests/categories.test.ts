import { expect, test } from 'claude-code/testing'

import { CATEGORIES, categorize } from '../src/categories'

test('name hits beat description hits', async () =>
  expect(categorize('flutter-fix-layout-issues', 'debug overflow errors')).toBe('mobile'))
test('description decides when the name says nothing', async () =>
  expect(categorize('tastemaker', 'Pick a visual direction: color palette and typography')).toBe('design'))
test('no hit is other', async () => expect(categorize('zzz', '')).toBe('other'))
test('valid override wins', async () => expect(categorize('tastemaker', 'palette', 'docs')).toBe('docs'))
test('unknown override is ignored', async () => expect(categorize('tastemaker', 'palette', 'nope')).toBe('design'))
test('every category id appears once, other last', async () => {
  expect(CATEGORIES.map(c => c.id)).toEqual(['design','frontend','mobile','backend','debug-test','review','docs','planning','research','analytics','security','devops','other'])
})
test('labels match the spec in order', async () => {
  expect(CATEGORIES.map(c => c.label)).toEqual(['Design & UI', 'Frontend', 'Mobile', 'Backend & Data', 'Debugging & Testing', 'Code Review & Quality', 'Docs & Writing', 'Planning & Process', 'Research', 'Data & Analytics', 'Security', 'DevOps & Tooling', 'Other'])
})

test('a plural token matches its keyword: errors hits error', async () =>
  expect(categorize('zzz', 'the errors')).toBe('debug-test'))
test('the plural rule does not turn class or process into other words', async () =>
  expect(categorize('zzz', 'class process')).toBe('other'))
test('a description that only says this skill helps gives other', async () =>
  expect(categorize('zzz', 'this skill helps')).toBe('other'))
