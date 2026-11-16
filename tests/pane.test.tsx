import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { Skill } from '../types'

const skills: Skill[] = [
  { name: 'polish', invoke: 'polish', description: 'Polish a UI until it shines.\nSecond line.', source: 'personal', category: 'design' },
  { name: 'foo', invoke: 'foo', description: 'Does foo things', source: 'personal', category: 'debug-test' },
  { name: 'bar', invoke: 'figma:bar', description: 'Bar', plugin: 'figma', source: 'plugin', category: 'debug-test' },
]

const PANE = {
  plugin: 'skills-picker',
  component: 'Pane',
  requestId: 'skills-picker',
  props: { title: 'Skills', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

// The pane reads the catalog through store.get; an unchanged stamp answers fs.stat.
type Extra = { toasts?: string[]; stats?: { n: number }; openResult?: () => unknown; whileFilling?: () => Promise<void> }
function seed(on: On, list: Skill[], fills: unknown[] = [], opens: unknown[] = [], isFilled = true, extra: Extra = {}) {
  on('env.get', () => ({ value: '/h' }))
  on('store.get', () => ({ value: { version: 1, cwd: '/work', skills: list, stamps: { '/x': 5 } } }))
  on('store.set', () => ({ value: undefined }))
  on('fs.stat', () => {
    if (extra.stats) extra.stats.n++
    return { value: { kind: 'file', size: 1, mtimeMs: 5, isLink: false } }
  })
  on('ui.toast', (_, e) => {
    extra.toasts?.push(e.text)
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'skills-picker' } }))
  on('ui.open', (_, e) => {
    opens.push(e)
    return extra.openResult ? (extra.openResult() as { value: { isPlaced: true } }) : { value: { isPlaced: true } }
  })
  on('prompt.fill', async (_, e) => {
    fills.push(e)
    await extra.whileFilling?.()
    return { isFilled }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work' }))
}

const surfaces = ['desktop', 'terminal'] as const

test('groups are collapsed by default', async ($, on) => {
  seed(on, skills)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  for (const surface of surfaces) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'cat:design' })).toBeDefined()
    expect((await ui.find({ key: 'cat:design' }))?.text).toContain('▸ Design & UI')
    expect(await ui.find({ key: 'skill:polish' })).toBeUndefined()
    await ui.unmount()
  }
})

test('pressing a group expands it', async ($, on) => {
  seed(on, skills)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  for (const surface of surfaces) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'cat:design' })
    expect((await ui.find({ key: 'cat:design' }))?.text).toContain('▾ Design & UI')
    const row = await ui.find({ key: 'skill:polish' })
    expect(row?.text).toBe('Add')
    expect(await ui.find({ type: 'Text', text: /^Polish a UI until it shines\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Second line/ })).toBeUndefined()
    await ui.press({ key: 'cat:design' })
    expect(await ui.find({ key: 'skill:polish' })).toBeUndefined()
    await ui.unmount()
  }
})

test('searching shows only matching rows, groups expanded', async ($, on) => {
  seed(on, skills)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  for (const surface of surfaces) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.input({ key: 'search', text: 'polish', kind: 'change' })
    expect(await ui.find({ key: 'skill:polish' })).toBeDefined()
    expect(await ui.find({ key: 'skill:foo' })).toBeUndefined()
    expect(await ui.find({ key: 'cat:debug-test' })).toBeUndefined()
    await ui.input({ key: 'search', text: 'zzzz', kind: 'change' })
    expect(await ui.find({ type: 'Text', text: /No skills match "zzzz"\./ })).toBeDefined()
    await ui.input({ key: 'search', text: '', kind: 'change' })
    await ui.unmount()
  }
})

test('Use inserts the selected skills and clears the selection', async ($, on) => {
  const fills: unknown[] = []
  seed(on, skills, fills)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'cat:debug-test' })
  await ui.press({ key: 'skill:foo' })
  await ui.press({ key: 'skill:figma:bar' })
  expect(await ui.find({ type: 'Text', text: /2 selected/ })).toBeDefined()
  await ui.press({ key: 'use' })
  expect(fills).toHaveLength(1)
  expect(fills[0]).toMatchObject({ text: '/foo /figma:bar ', mode: 'insert' })
  expect(await ui.find({ type: 'Text', text: /^0 selected$/ })).toBeDefined()
  await ui.unmount()
})

test('with nothing selected Use is not offered; Clear empties', async ($, on) => {
  const fills: unknown[] = []
  seed(on, skills, fills)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'use' })).toBeUndefined()
  expect(await ui.find({ key: 'clear' })).toBeUndefined()
  expect(fills).toHaveLength(0)
  await ui.press({ key: 'cat:debug-test' })
  await ui.press({ key: 'skill:foo' })
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /^0 selected$/ })).toBeDefined()
  await ui.unmount()
})

test('the command opens the pane; session.start alone does not', async ($, on) => {
  const opens: { id?: string }[] = []
  seed(on, skills, [], opens)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  expect(opens).toHaveLength(0)
  await $.command.run({ command: 'skills-picker', args: '' })
  expect(opens).toHaveLength(1)
  expect(opens[0]).toMatchObject({ id: 'skills-picker' })
})

test('an empty catalog says so', async ($, on) => {
  seed(on, [])
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /No skills found\. Run \/skills-picker refresh\./ })).toBeDefined()
  await ui.unmount()
})

test('a refused fill keeps the selection', async ($, on) => {
  const fills: unknown[] = []
  seed(on, skills, fills, [], false)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'cat:debug-test' })
  await ui.press({ key: 'skill:foo' })
  await ui.press({ key: 'skill:figma:bar' })
  await ui.press({ key: 'use' })
  expect(fills).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^2 selected$/ })).toBeDefined()
  await ui.unmount()
})

test('command replies carry no text, so nothing reaches the model', async ($, on) => {
  const toasts: string[] = []
  seed(on, skills, [], [], true, { toasts })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const opened = await $.command.run({ command: 'skills-picker', args: '' })
  expect(opened.text).toBeUndefined()
  expect(opened.context).toBeUndefined()
  const refreshed = await $.command.run({ command: 'skills-picker', args: 'refresh' })
  expect(refreshed.text).toBeUndefined()
  expect(refreshed.context).toBeUndefined()
  expect(toasts.some(t => /refreshed: \d+ skills/.test(t))).toBe(true)
})

test('a pane that is not placed is reported by toast, without text', async ($, on) => {
  const toasts: string[] = []
  seed(on, skills, [], [], true, { toasts, openResult: () => ({ value: { isPlaced: false, reason: 'narrow' } }) })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const r = await $.command.run({ command: 'skills-picker', args: '' })
  expect(r.text).toBeUndefined()
  expect(toasts).toHaveLength(1)
})

test('a pane that fails to open is reported by toast, without text', async ($, on) => {
  const toasts: string[] = []
  seed(on, skills, [], [], true, {
    toasts,
    openResult: () => {
      throw new Error('boom')
    },
  })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const r = await $.command.run({ command: 'skills-picker', args: '' })
  expect(r.text).toBeUndefined()
  expect(toasts).toHaveLength(1)
})

test('group presses are ignored while a search is active', async ($, on) => {
  seed(on, skills)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'cat:debug-test' }) // open it
  await ui.input({ key: 'search', text: 'foo', kind: 'change' })
  await ui.press({ key: 'cat:debug-test' }) // must not collapse it behind the search
  await ui.input({ key: 'search', text: '', kind: 'change' })
  expect((await ui.find({ key: 'cat:debug-test' }))?.text).toContain('▾')
  await ui.unmount()
})

test('a pick made while Use inserts stays selected', async ($, on) => {
  let press: () => Promise<void> = async () => {}
  seed(on, skills, [], [], true, { whileFilling: () => press() })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  press = () => ui.press({ key: 'skill:figma:bar' }) // picked while the insert is in flight
  await ui.press({ key: 'cat:debug-test' })
  await ui.press({ key: 'skill:foo' })
  await ui.press({ key: 'use' })
  expect(await ui.find({ type: 'Text', text: /^1 selected$/ })).toBeDefined()
  expect((await ui.find({ key: 'skill:figma:bar' }))?.text).toBe('✓ Added')
  expect((await ui.find({ key: 'skill:foo' }))?.text).toBe('Add')
  await ui.unmount()
})

test('typing in the search never touches the disk', async ($, on) => {
  const stats = { n: 0 }
  seed(on, skills, [], [], true, { stats })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const before = stats.n
  for (const text of ['p', 'po', 'pol', '']) await ui.input({ key: 'search', text, kind: 'change' })
  expect(stats.n).toBe(before)
  await ui.unmount()
})

test('Show more reveals the whole description; the plugin is named in full', async ($, on) => {
  seed(on, skills)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  for (const surface of surfaces) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'cat:design' })
    expect((await ui.find({ key: 'more:polish' }))?.text).toBe('Show more')
    await ui.press({ key: 'more:polish' })
    expect(await ui.find({ type: 'Text', text: /Polish a UI until it shines\. Second line\./ })).toBeDefined()
    expect((await ui.find({ key: 'more:polish' }))?.text).toBe('Show less')
    await ui.press({ key: 'more:polish' })
    await ui.press({ key: 'cat:debug-test' })
    expect(await ui.find({ type: 'Text', text: /^from figma$/ })).toBeDefined()
    expect(await ui.find({ key: 'more:foo' })).toBeUndefined() // short text: nothing to expand
    await ui.press({ key: 'cat:design' }) // close both groups for the next surface
    await ui.press({ key: 'cat:debug-test' })
    await ui.unmount()
  }
})

test('the search row shows the count, and Clear search empties the query', async ($, on) => {
  seed(on, skills)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^3 skills$/ })).toBeDefined()
  expect(await ui.find({ key: 'clear-search' })).toBeUndefined()
  await ui.input({ key: 'search', text: 'foo', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /^1 of 3$/ })).toBeDefined()
  await ui.press({ key: 'clear-search' })
  expect(await ui.find({ type: 'Text', text: /^3 skills$/ })).toBeDefined()
  await ui.unmount()
})
