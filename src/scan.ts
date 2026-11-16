import type { EngineInterface as Engine } from 'claude-code'

import type { Skill } from '../types'
import { categorize } from './categories'
import { parseFrontmatter } from './frontmatter'

type Ref = { folder: string; name: string; description: string; plugin?: string; source: Skill['source']; mtime: number }
type Ctx = { stamps: Record<string, number> }
type Entry = { name: string; kind: 'file' | 'dir' | 'other' }

type Catalog = { version: 1; cwd: string; skills: Skill[]; stamps: Record<string, number> }

const CATALOG_VERSION = 1
const CONCURRENCY = 8
const MAX_READ_BYTES = 4 * 1024 * 1024
const PRUNE = new Set(['node_modules', '.git', 'skills', '.claude-plugin'])
const WALK_MAX_DEPTH = 12
const WALK_MAX_DIRS = 20000

async function pmap<T, R>(items: T[], fn: (item: T) => Promise<R>, limit = CONCURRENCY): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const asMap = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** The user's home folder: HOME, or USERPROFILE on Windows; forward slashes, no trailing slash. */
export async function homeDir($: Engine): Promise<string> {
  const home = ((await $.env.get('HOME')) as string | undefined) || ((await $.env.get('USERPROFILE')) as string | undefined) || ''
  return home.replace(/\\/g, '/').replace(/\/+$/, '')
}

async function readJson($: Engine, path: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

const ABSENT = -1
// A root that exists but could not be listed: never matches a real mtime, so the next check rescans.
const UNREADABLE = -2

/** Record a path's mtime, or -1 when it is absent, so a path that appears later reads as a change. */
async function stamp($: Engine, ctx: Ctx, path: string): Promise<void> {
  try {
    ctx.stamps[path] = (await $.fs.stat(path)).mtimeMs
  } catch {
    ctx.stamps[path] = ABSENT
  }
}

async function tryList($: Engine, path: string): Promise<Entry[] | null> {
  try {
    return (await $.fs.list(path)).slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  } catch {
    return null
  }
}

async function listDir($: Engine, path: string): Promise<Entry[]> {
  return (await tryList($, path)) ?? []
}

/** Child folders of `dir`, following links (a `kind: 'other'` entry is stat-ed). */
async function childDirs($: Engine, dir: string, listed?: Entry[]): Promise<string[]> {
  const entries = listed ?? (await listDir($, dir))
  const keep = await pmap(entries, async e => {
    if (e.kind === 'dir') return true
    if (e.kind !== 'other') return false
    try {
      return (await $.fs.stat(`${dir}/${e.name}`)).kind === 'dir'
    } catch {
      return false
    }
  })
  return entries.filter((_, i) => keep[i]).map(e => e.name)
}

async function skillsIn($: Engine, ctx: Ctx, root: string, source: Skill['source'], plugin?: string): Promise<Ref[]> {
  const listed = await tryList($, root)
  if (listed === null) {
    // Absent reads as a change when it appears; present but unreadable must not read as fresh.
    try {
      await $.fs.stat(root)
      ctx.stamps[root] = UNREADABLE
    } catch {
      ctx.stamps[root] = ABSENT
    }
    return []
  }
  await stamp($, ctx, root)
  const refs = await pmap(await childDirs($, root, listed), async (folder): Promise<Ref | null> => {
    const path = `${root}/${folder}/SKILL.md`
    try {
      const stat = await $.fs.stat(path)
      if (stat.kind !== 'file' || stat.size > MAX_READ_BYTES) return null
      ctx.stamps[path] = stat.mtimeMs // an in-place edit moves this, not the root's mtime
      const fm = parseFrontmatter(await $.fs.read(path))
      const ref: Ref = { folder, name: fm?.name || folder, description: (fm?.description ?? '').trim(), source, mtime: stat.mtimeMs }
      if (plugin) ref.plugin = plugin
      return ref
    } catch {
      return null
    }
  })
  return refs.filter((r): r is Ref => r !== null)
}

const asList = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Folders holding a plugin's skill folders: the manifest's `skills`, `skills/`, `.claude/skills/`, else a bounded walk. */
async function pluginSkillRoots($: Engine, installPath: string): Promise<string[]> {
  const roots = new Set<string>([`${installPath}/skills`, `${installPath}/.claude/skills`])
  for (const mf of [`${installPath}/.claude-plugin/plugin.json`, `${installPath}/plugin.json`]) {
    for (const rel of asList(asMap(await readJson($, mf)).skills)) roots.add(`${installPath}/${rel.replace(/^\.\//, '').replace(/\/$/, '')}`)
  }
  const found: string[] = []
  for (const r of roots) {
    const has = await pmap(await childDirs($, r), async d => {
      try {
        return (await $.fs.stat(`${r}/${d}/SKILL.md`)).kind === 'file'
      } catch {
        return false
      }
    })
    if (has.some(Boolean)) found.push(r)
  }
  if (found.length > 0) return found
  const out = new Set<string>()
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await listDir($, dir)
    if (entries.some(e => e.name === 'SKILL.md' && e.kind === 'file')) {
      out.add(dir.slice(0, dir.lastIndexOf('/')))
      return
    }
    if (depth >= 4) return
    for (const e of entries) if (e.kind === 'dir' && e.name !== 'node_modules' && e.name !== '.git') await walk(`${dir}/${e.name}`, depth + 1)
  }
  await walk(installPath, 0)
  return [...out].sort()
}

async function desktopPluginRoots($: Engine, appSupport: string): Promise<{ dir: string; manifest: string }[]> {
  const found: { dir: string; manifest: string }[] = []
  let visited = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (visited++ >= WALK_MAX_DIRS) return
    const entries = await listDir($, dir)
    const names = new Map(entries.map(e => [e.name, e]))
    let manifest: string | null = null
    if (names.get('plugin.json')?.kind === 'file') manifest = `${dir}/plugin.json`
    else if (names.get('.claude-plugin')?.kind === 'dir') {
      const inner = await listDir($, `${dir}/.claude-plugin`)
      if (inner.some(e => e.name === 'plugin.json' && e.kind === 'file')) manifest = `${dir}/.claude-plugin/plugin.json`
    }
    if (manifest && names.get('skills')?.kind === 'dir') {
      found.push({ dir, manifest })
      return
    }
    if (depth >= WALK_MAX_DEPTH) return
    await pmap(entries.filter(e => e.kind === 'dir' && !PRUNE.has(e.name)), e => walk(`${dir}/${e.name}`, depth + 1))
  }
  await walk(appSupport, 0)
  return found.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
}

/** One copy per (plugin, folder): the one with the newest SKILL.md. */
function dedupe(refs: Ref[]): Ref[] {
  const best = new Map<string, Ref>()
  for (const r of refs) {
    const key = `${r.plugin ?? ''}\u0000${r.folder}`
    const cur = best.get(key)
    if (!cur || r.mtime > cur.mtime) best.set(key, r)
  }
  return [...best.values()]
}

async function discover($: Engine, ctx: Ctx, home: string, cwd: string): Promise<Ref[]> {
  const refs = await skillsIn($, ctx, `${home}/.claude/skills`, 'personal')
  if (cwd && cwd !== home) refs.push(...(await skillsIn($, ctx, `${cwd}/.claude/skills`, 'project')))

  const settingsPath = `${home}/.claude/settings.json`
  await stamp($, ctx, settingsPath)
  const enabled = asMap(asMap(await readJson($, settingsPath)).enabledPlugins)

  const installedPath = `${home}/.claude/plugins/installed_plugins.json`
  await stamp($, ctx, installedPath)
  for (const [pid, records] of Object.entries(asMap(asMap(await readJson($, installedPath)).plugins))) {
    if (enabled[pid] === false || !Array.isArray(records)) continue
    const prefix = pid.split('@')[0]!
    for (const rec of records) {
      const installPath = asMap(rec).installPath
      if (typeof installPath !== 'string' || !installPath) continue
      for (const root of await pluginSkillRoots($, installPath)) refs.push(...(await skillsIn($, ctx, root, 'plugin', prefix)))
    }
  }

  const appSupport = `${home}/Library/Application Support/Claude/local-agent-mode-sessions`
  await stamp($, ctx, appSupport)
  for (const { dir, manifest } of await desktopPluginRoots($, appSupport)) {
    const name = asMap(await readJson($, manifest)).name
    if (typeof name === 'string' && name) refs.push(...(await skillsIn($, ctx, `${dir}/skills`, 'plugin', name)))
  }
  return refs
}

/** Walk every skill root; never throws. */
export async function scanSkills($: Engine, home: string, cwd: string): Promise<{ skills: Skill[]; stamps: Record<string, number> }> {
  const ctx: Ctx = { stamps: {} }
  let refs: Ref[] = []
  try {
    refs = dedupe(await discover($, ctx, home, cwd))
  } catch {
    refs = []
  }
  const overridesPath = `${home}/.claude/skills-picker/overrides.json`
  await stamp($, ctx, overridesPath)
  const overrides = asMap(await readJson($, overridesPath))
  const skills = refs.map((r): Skill => {
    const invoke = r.plugin ? `${r.plugin}:${r.folder}` : r.folder
    const o = overrides[invoke]
    const skill: Skill = {
      name: r.name,
      invoke,
      description: r.description,
      source: r.source,
      category: categorize(r.name, r.description, typeof o === 'string' ? o : undefined),
    }
    if (r.plugin) skill.plugin = r.plugin
    return skill
  })
  skills.sort((a, b) => (a.invoke < b.invoke ? -1 : a.invoke > b.invoke ? 1 : 0))
  return { skills, stamps: ctx.stamps }
}

async function isFresh($: Engine, stamps: Record<string, number>): Promise<boolean> {
  const checks = await pmap(Object.entries(stamps), async ([path, mtime]) => {
    if (mtime === UNREADABLE) return false
    try {
      return (await $.fs.stat(path)).mtimeMs === mtime
    } catch {
      return mtime === ABSENT
    }
  })
  return checks.every(Boolean)
}

/** The stored catalog while every stamp still matches; otherwise a rescan, stored. */
export async function loadCatalog($: Engine, cwd: string, opts?: { force?: boolean }): Promise<Skill[]> {
  if (!opts?.force) {
    const raw = (await $.store.get('catalog')) as Partial<Catalog> | undefined
    if (raw && raw.version === CATALOG_VERSION && raw.cwd === cwd && Array.isArray(raw.skills) && raw.stamps && (await isFresh($, raw.stamps))) return raw.skills
  }
  const { skills, stamps } = await scanSkills($, await homeDir($), cwd)
  const catalog: Catalog = { version: CATALOG_VERSION, cwd, skills, stamps }
  await $.store.set('catalog', catalog)
  return skills
}

// The catalog the pane draws from, kept in memory so a render never touches the disk.
let memory: { cwd: string; skills: Skill[] } | null = null
let inflight: { cwd: string; force: boolean; promise: Promise<Skill[]> } | null = null

/**
 * Bring the in-memory catalog up to date (stored copy if fresh, else a rescan). Concurrent callers
 * for the same folder share one run.
 */
export function refreshCatalog($: Engine, cwd: string, opts?: { force?: boolean }): Promise<Skill[]> {
  const force = opts?.force === true
  if (inflight && inflight.cwd === cwd && (inflight.force || !force)) return inflight.promise
  const promise = loadCatalog($, cwd, { force }).then(skills => {
    memory = { cwd, skills }
    return skills
  })
  const mine = { cwd, force, promise }
  inflight = mine
  const clear = () => {
    if (inflight === mine) inflight = null
  }
  promise.then(clear, clear)
  return promise
}

/** The catalog from memory for this folder; when memory has none, wait for the shared load once. */
export async function getCatalog($: Engine, cwd: string): Promise<Skill[]> {
  if (memory && memory.cwd === cwd) return memory.skills
  return refreshCatalog($, cwd)
}

/** The in-memory skills for this folder, or undefined. */
export function peekCatalog(cwd: string): Skill[] | undefined {
  return memory && memory.cwd === cwd ? memory.skills : undefined
}
