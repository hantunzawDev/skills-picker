// Minimal YAML frontmatter parser for SKILL.md files.

const KEY_RE = /^([A-Za-z0-9_-]+)\s*:(?:\s+(.*)|\s*)$/
// Python's str.splitlines() boundaries.
const LINE_BREAK = new RegExp('\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]')

function unquote(raw: string): string {
  let v = raw.trim()
  if (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'")) {
    const q = v[0]
    v = v.slice(1, -1)
    v = q === '"' ? v.split('\\"').join('"').split('\\\\').join('\\') : v.split("''").join("'")
  }
  return v
}

const isIndented = (line: string): boolean => line === '' || line[0] === ' ' || line[0] === '\t'

/** Parse the leading `---` block into key/value strings; null when absent. */
export function parseFrontmatter(text: string): Record<string, string> | null {
  const lines = text.replace(/^\uFEFF+/, '').split(LINE_BREAK)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0 || lines[0]!.trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) return null
  const body = lines.slice(1, end)
  const out: Record<string, string> = {}
  let i = 0
  while (i < body.length) {
    const line = body[i]!
    const m = line !== '' && !isIndented(line) ? KEY_RE.exec(line) : null
    if (!m) {
      i++
      continue
    }
    const key = m[1]!
    const val = (m[2] ?? '').trim()
    i++
    const cont: string[] = []
    while (i < body.length && (isIndented(body[i]!) || body[i]!.trim() === '')) {
      cont.push(body[i]!)
      i++
    }
    while (cont.length > 0 && cont[cont.length - 1]!.trim() === '') cont.pop()
    if (val[0] === '>' || val[0] === '|') {
      const parts = cont.map(c => c.trim())
      out[key] =
        val[0] === '>'
          ? parts.filter(p => p).join(' ')
          : parts.join('\n').replace(/^\n+|\n+$/g, '')
    } else {
      const extra = cont.map(c => c.trim()).filter(c => c)
      const first = unquote(val)
      out[key] = (first ? [first, ...extra] : extra).join(' ')
    }
  }
  return out
}
