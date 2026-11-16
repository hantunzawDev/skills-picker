import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Skill } from '../types'
type Fake = { text: string; mtimeMs?: number }
type Opts = { links?: Record<string, string>; throwList?: Set<string> }

const fm = (name: string, desc: string) => `---\nname: ${name}\ndescription: ${desc}\n---\nbody`

// An in-memory file tree answering fs.*; `links` maps a link path to the dir it leads to.
function fakeFs(on: On, files: Record<string, Fake>, opts: Opts = {}, counts = { reads: 0 }) {
  const links = opts.links ?? {}
  // Computed per call so a test can add files between scans.
  const dirsNow = () => {
    const d = new Set<string>()
    for (const p of [...Object.keys(files), ...Object.values(links).map(x => x + '/x')]) {
      const parts = p.split('/')
      for (let i = 1; i < parts.length; i++) d.add(parts.slice(0, i).join('/') || '/')
    }
    return d
  }
  const resolve = (p: string): string => {
    for (const [l, t] of Object.entries(links)) if (p === l || p.startsWith(l + '/')) return t + p.slice(l.length)
    return p
  }
  const missing = (p: string) => new Error(`ENOENT: ${p}`)
  on('fs.read', (_, e) => {
    counts.reads++
    const f = files[resolve(e.path)]
    if (!f) throw missing(e.path)
    return { value: f.text }
  })
  on('fs.stat', (_, e) => {
    const p = resolve(e.path)
    const f = files[p]
    const dirs = dirsNow()
    if (f) return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs ?? 1000, isLink: false } }
    if (dirs.has(p)) return { value: { kind: 'dir', size: 0, mtimeMs: files[p + '/.m']?.mtimeMs ?? 1000, isLink: e.path in links } }
    throw missing(e.path)
  })
  on('fs.exists', (_, e) => ({ value: resolve(e.path) in files || dirsNow().has(resolve(e.path)) }))
  on('fs.list', (_, e) => {
    if (opts.throwList?.has(e.path)) throw new Error('EACCES')
    const dir = resolve(e.path)
    if (!dirsNow().has(dir)) throw missing(e.path)
    const out = new Map<string, { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const p of Object.keys(files)) {
      if (!p.startsWith(dir + '/')) continue
      const rest = p.slice(dir.length + 1)
      const name = rest.split('/')[0]!
      out.set(name, { name, kind: rest.includes('/') ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false })
    }
    for (const l of Object.keys(links)) {
      if (l.startsWith(dir + '/') && !l.slice(dir.length + 1).includes('/')) {
        const name = l.slice(dir.length + 1)
        out.set(name, { name, kind: 'other', size: 0, mtimeMs: 0, isLink: true })
      }
    }
    return { value: [...out.values()] }
  })
}

const settle = async (ms = 30) => new Promise<void>(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(r, ms))

let currentCwd = '/work'
const restart = async ($: Parameters<Parameters<typeof test>[1]>[0], cwd: string) => {
  currentCwd = cwd
  await $.session.start({ cwd, surface: 'terminal', isInteractive: false })
}

type Saved = { catalog?: { version: number; skills: Skill[]; stamps: Record<string, number> } }

// The scan runs from the plugin's own session.start hook (the engine only lets a registered hooks module call fs and store).
async function boot($: Parameters<Parameters<typeof test>[1]>[0], on: On, files: Record<string, Fake>, opts: Opts = {}, cwd = '/work', saved: Saved = {}, counts = { reads: 0 }) {
  mock.env(on, { HOME: '/h' })
  fakeFs(on, files, opts, counts)
  on('store.get', (_, e) => ({ value: (saved as Record<string, unknown>)[e.key] }))
  on('store.set', (_, e) => {
    ;(saved as Record<string, unknown>)[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: currentCwd }))
  await restart($, cwd)
  await settle()
  return saved
}
const skillsOf = (saved: Saved): Skill[] => saved.catalog?.skills ?? []

const INSTALLED = (plugins: Record<string, string[]>) => ({
  text: JSON.stringify({ plugins: Object.fromEntries(Object.entries(plugins).map(([id, ps]) => [id, ps.map(installPath => ({ installPath }))])) }),
})

test('a personal skill gets its frontmatter and a category', async ($, on) => {
  const saved = await boot($, on, { '/h/.claude/skills/foo/SKILL.md': { text: fm('foo', 'Pick a color palette and typography') } })
  expect(skillsOf(saved)).toEqual([{ name: 'foo', invoke: 'foo', description: 'Pick a color palette and typography', source: 'personal', category: 'design' }])
})

test('a link entry that leads to a skill folder is included', async ($, on) => {
  const saved = await boot($, on, { '/elsewhere/lnk/SKILL.md': { text: fm('lnk', 'linked') }, '/h/.claude/skills/README': { text: 'x' } }, { links: { '/h/.claude/skills/lnk': '/elsewhere/lnk' } })
  expect(skillsOf(saved).map(s => s.invoke)).toEqual(['lnk'])
})

test('SKILL.md without frontmatter is named after its folder', async ($, on) => {
  const saved = await boot($, on, { '/h/.claude/skills/bare/SKILL.md': { text: 'just text' } })
  expect(skillsOf(saved)[0]).toMatchObject({ name: 'bare', description: '' })
})

test('a personal and a plugin skill sharing a name both stay', async ($, on) => {
  const saved = await boot($, on, {
    '/h/.claude/skills/foo/SKILL.md': { text: fm('foo', 'mine') },
    '/h/.claude/plugins/installed_plugins.json': INSTALLED({ 'figma@mk': ['/p/figma'] }),
    '/p/figma/skills/foo/SKILL.md': { text: fm('foo', 'theirs') },
  })
  expect(skillsOf(saved).map(s => s.invoke)).toEqual(['figma:foo', 'foo'])
  expect(skillsOf(saved).find(s => s.invoke === 'figma:foo')).toMatchObject({ plugin: 'figma', source: 'plugin' })
})

test('the same plugin in two install records is one entry, the newest', async ($, on) => {
  const saved = await boot($, on, {
    '/h/.claude/plugins/installed_plugins.json': INSTALLED({ 'figma@mk': ['/p/old', '/p/new'] }),
    '/p/old/skills/foo/SKILL.md': { text: fm('foo', 'old'), mtimeMs: 1 },
    '/p/new/skills/foo/SKILL.md': { text: fm('foo', 'new'), mtimeMs: 2 },
  })
  expect(skillsOf(saved).map(s => [s.invoke, s.description])).toEqual([['figma:foo', 'new']])
})

test('a plugin disabled in settings is absent', async ($, on) => {
  const saved = await boot($, on, {
    '/h/.claude/settings.json': { text: JSON.stringify({ enabledPlugins: { 'figma@mk': false } }) },
    '/h/.claude/plugins/installed_plugins.json': INSTALLED({ 'figma@mk': ['/p/figma'], 'ok@mk': ['/p/ok'] }),
    '/p/figma/skills/foo/SKILL.md': { text: fm('foo', 'x') },
    '/p/ok/skills/bar/SKILL.md': { text: fm('bar', 'y') },
  })
  expect(skillsOf(saved).map(s => s.invoke)).toEqual(['ok:bar'])
})

test('overrides set the category by invoke', async ($, on) => {
  const saved = await boot($, on, {
    '/h/.claude/skills/foo/SKILL.md': { text: fm('foo', 'palette') },
    '/h/.claude/skills-picker/overrides.json': { text: JSON.stringify({ foo: 'docs' }) },
  })
  expect(skillsOf(saved)[0]!.category).toBe('docs')
})

test('project skills are scanned', async ($, on) => {
  const saved = await boot($, on, { '/w/.claude/skills/p/SKILL.md': { text: fm('p', 'proj') }, '/h/.claude/skills/q/SKILL.md': { text: fm('q', 'x') } }, {}, '/w')
  expect(skillsOf(saved).map(s => [s.invoke, s.source])).toEqual([['p', 'project'], ['q', 'personal']])
})

test('project root is skipped when cwd is home', async ($, on) => {
  const saved = await boot($, on, { '/h/.claude/skills/q/SKILL.md': { text: fm('q', 'x') } }, {}, '/h')
  expect(skillsOf(saved).map(s => [s.invoke, s.source])).toEqual([['q', 'personal']])
  expect(Object.keys(saved.catalog!.stamps)).not.toContain('/h/.claude/skills/.claude/skills') // no project root under home
  expect(skillsOf(saved)).toHaveLength(1) // scanned once, not twice
})

test('a root whose listing throws is skipped, the others stay', async ($, on) => {
  const saved = await boot(
    $,
    on,
    { '/h/.claude/skills/a/SKILL.md': { text: fm('a', 'x') }, '/w/.claude/skills/b/SKILL.md': { text: fm('b', 'y') } },
    { throwList: new Set(['/h/.claude/skills']) },
    '/w',
  )
  expect(skillsOf(saved).map(s => s.invoke)).toEqual(['b'])
})

test('stamps cover every root and config path checked, absent ones as -1', async ($, on) => {
  const saved = await boot($, on, { '/h/.claude/skills/a/SKILL.md': { text: fm('a', 'x') }, '/h/.claude/settings.json': { text: '{}' } })
  const st = saved.catalog!.stamps
  expect(st['/h/.claude/skills']).toBe(1000)
  expect(st['/h/.claude/settings.json']).toBe(1000)
  expect(st['/work/.claude/skills']).toBe(-1)
  expect(st['/h/.claude/skills-picker/overrides.json']).toBe(-1)
  expect(saved.catalog!.version).toBe(1)
})

test('loadCatalog reuses an unchanged cache and rescans when a stamp moves', async ($, on) => {
  const counts = { reads: 0 }
  const files: Record<string, Fake> = { '/h/.claude/skills/a/SKILL.md': { text: fm('a', 'x') } }
  await boot($, on, files, {}, '/w', {}, counts)
  const afterFirst = counts.reads
  expect(afterFirst).toBeGreaterThan(0)

  await restart($, '/w')
  await settle()
  expect(counts.reads).toBe(afterFirst) // fresh: no fs.read

  files['/h/.claude/skills/.m'] = { text: '', mtimeMs: 7 } // the folder's mtime moves
  await restart($, '/w')
  await settle()
  expect(counts.reads).toBeGreaterThan(afterFirst)
})

test('a project root created after a scan triggers a rescan', async ($, on) => {
  const counts = { reads: 0 }
  const files: Record<string, Fake> = { '/h/.claude/skills/a/SKILL.md': { text: fm('a', 'x') } }
  const saved = await boot($, on, files, {}, '/w', {}, counts)
  expect(skillsOf(saved).map(s => s.invoke)).toEqual(['a'])

  files['/w/.claude/skills/p/SKILL.md'] = { text: fm('p', 'proj') }
  await restart($, '/w')
  await settle()
  expect(skillsOf(saved).map(s => [s.invoke, s.source])).toEqual([['a', 'personal'], ['p', 'project']])
})

test('a different cwd rescans instead of serving the old project', async ($, on) => {
  const files: Record<string, Fake> = {
    '/h/.claude/skills/z/SKILL.md': { text: fm('z', 'x') },
    '/a/.claude/skills/a/SKILL.md': { text: fm('a', 'proj a') },
    '/b/.claude/skills/b/SKILL.md': { text: fm('b', 'proj b') },
  }
  const saved = await boot($, on, files, {}, '/a')
  expect(skillsOf(saved).map(s => s.invoke)).toEqual(['a', 'z'])
  await restart($, '/b')
  await settle()
  expect(skillsOf(saved).map(s => s.invoke)).toEqual(['b', 'z'])
})

test('an in-place SKILL.md edit rescans', async ($, on) => {
  const files: Record<string, Fake> = { '/h/.claude/skills/a/SKILL.md': { text: fm('a', 'old'), mtimeMs: 1 } }
  const saved = await boot($, on, files)
  expect(skillsOf(saved)[0]!.description).toBe('old')
  files['/h/.claude/skills/a/SKILL.md'] = { text: fm('a', 'new'), mtimeMs: 2 }
  await restart($, '/work')
  await settle()
  expect(skillsOf(saved)[0]!.description).toBe('new')
})

test('invoke and the dedupe key come from the folder; the frontmatter name is only displayed', async ($, on) => {
  const saved = await boot($, on, {
    '/h/.claude/plugins/installed_plugins.json': INSTALLED({ 'x@mk': ['/p/x'] }),
    '/p/x/skills/proxy/SKILL.md': { text: fm('brightdata-proxy', 'Route requests') },
  })
  expect(skillsOf(saved).map(s => [s.invoke, s.name])).toEqual([['x:proxy', 'brightdata-proxy']])
})

test('two folders with the same frontmatter name both stay', async ($, on) => {
  const saved = await boot($, on, {
    '/h/.claude/skills/a/SKILL.md': { text: fm('same', 'one') },
    '/h/.claude/skills/b/SKILL.md': { text: fm('same', 'two') },
  })
  expect(skillsOf(saved).map(s => s.invoke)).toEqual(['a', 'b'])
})

test('concurrent session starts share one scan', async ($, on) => {
  const counts = { reads: 0 }
  const saved: Saved = {}
  mock.env(on, { HOME: '/h' })
  fakeFs(on, { '/h/.claude/skills/a/SKILL.md': { text: fm('a', 'x') } }, {}, counts)
  on('store.get', (_, e) => ({ value: (saved as Record<string, unknown>)[e.key] }))
  on('store.set', (_, e) => {
    ;(saved as Record<string, unknown>)[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/w' }))
  await Promise.all([
    $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: false }),
    $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: false }),
  ])
  await settle()
  expect(skillsOf(saved).map(s => s.invoke)).toEqual(['a'])
  expect(counts.reads).toBe(4) // SKILL.md + settings + installed_plugins + overrides, once
})

test('a root that exists but cannot be listed is not stamped fresh', async ($, on) => {
  const saved = await boot($, on, { '/h/.claude/skills/a/SKILL.md': { text: fm('a', 'x') } }, { throwList: new Set(['/h/.claude/skills']) })
  expect(saved.catalog!.stamps['/h/.claude/skills']).toBe(-2)
})
