// Real-disk category report. Read-only. Run: node scripts/category-report.ts [--other] [--sample N] [--extra DIR]
// The test harness fakes fs, so this reads the real skill folders with the scanner's rules
// and calls the same categorize() and parseFrontmatter().
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'

import { categorize, CATEGORIES } from '../src/categories.ts'
import { parseFrontmatter } from '../src/frontmatter.ts'

type Row = { invoke: string; description: string; category: string; mtime: number }
const home = homedir()
const rows = new Map<string, Row>()

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }
const list = (p: string) => { try { return readdirSync(p).sort() } catch { return [] } }
function skillsIn(root: string, plugin?: string): void {
  for (const f of list(root)) {
    const p = `${root}/${f}/SKILL.md`
    try {
      const st = statSync(p)
      if (!st.isFile()) continue
      const fm = parseFrontmatter(readFileSync(p, 'utf8'))
      const name = fm?.name || f
      const description = (fm?.description ?? '').trim()
      const invoke = plugin ? `${plugin}:${name}` : name
      const cur = rows.get(invoke)
      if (!cur || st.mtimeMs > cur.mtime) rows.set(invoke, { invoke, description, category: categorize(name, description), mtime: st.mtimeMs })
    } catch {}
  }
}

skillsIn(`${home}/.claude/skills`)
try {
  const inst = JSON.parse(readFileSync(`${home}/.claude/plugins/installed_plugins.json`, 'utf8'))
  for (const [pid, recs] of Object.entries<any>(inst.plugins ?? {})) for (const r of recs) for (const sub of ['skills', '.claude/skills']) skillsIn(`${r.installPath}/${sub}`, pid.split('@')[0])
} catch {}
let visited = 0
const walk = (dir: string, depth: number): void => {
  if (visited++ > 20000 || depth > 12) return
  const names = list(dir)
  const manifest = names.includes('plugin.json') ? `${dir}/plugin.json` : existsSync(`${dir}/.claude-plugin/plugin.json`) ? `${dir}/.claude-plugin/plugin.json` : ''
  if (manifest && isDir(`${dir}/skills`)) {
    try { skillsIn(`${dir}/skills`, JSON.parse(readFileSync(manifest, 'utf8')).name) } catch {}
    return
  }
  for (const n of names) if (!['node_modules', '.git', 'skills', '.claude-plugin'].includes(n) && isDir(`${dir}/${n}`)) walk(`${dir}/${n}`, depth + 1)
}
walk(`${home}/Library/Application Support/Claude/local-agent-mode-sessions`, 0)
const extra = process.argv.indexOf('--extra')
if (extra > 0) skillsIn(process.argv[extra + 1]!, 'extra')

const all = [...rows.values()].sort((a, b) => (a.invoke < b.invoke ? -1 : 1))
const counts: Record<string, number> = {}
for (const r of all) counts[r.category] = (counts[r.category] ?? 0) + 1
console.log(`total ${all.length}`)
for (const c of CATEGORIES) console.log(`${c.id.padEnd(12)} ${counts[c.id] ?? 0}`)
console.log(`other% ${(((counts.other ?? 0) / all.length) * 100).toFixed(1)}`)
if (process.argv.includes('--other')) for (const r of all.filter(r => r.category === 'other')) console.log(`OTHER ${r.invoke} | ${r.description.slice(0, 110)}`)
const si = process.argv.indexOf('--sample')
if (si > 0) {
  let seed = 42
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const pool = [...all]
  for (let i = 0; i < Math.min(Number(process.argv[si + 1]), pool.length); i++) {
    const r = pool.splice(Math.floor(rnd() * pool.length), 1)[0]!
    console.log(`SAMPLE ${r.category} | ${r.invoke} | ${r.description.slice(0, 120)}`)
  }
}
