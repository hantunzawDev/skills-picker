import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, On } from 'claude-code'

import type { CategoryId, Skill } from '../types'
import { filterSkills, groupSkills } from './filter'
import { getCatalog, peekCatalog, refreshCatalog } from './scan'

export const PANE_ID = 'skills-picker'

// Theme keys: the accent for what is picked, a quiet line for card edges.
const ACCENT = 'suggestion'
const LINE = 'subtle'

// Change a tag when the value's fields change: a stored value under an older tag reads as absent.
const query = atom({ plugin: 'skills-picker', key: 'query' } as const, '', { shape: 'query-1' })
const expanded = atom({ plugin: 'skills-picker', key: 'expanded' } as const, [] as CategoryId[], { shape: 'expanded-1' })
const selected = atom({ plugin: 'skills-picker', key: 'selected' } as const, [] as string[], { shape: 'selected-1' })

// Bumped when a background scan changes the list; the render reads it, so a write redraws the pane.
const version = atom({ plugin: 'skills-picker', key: 'version' } as const, 0, { shape: 'version-1' })

const toggle = <T,>(list: T[], item: T): T[] => (list.includes(item) ? list.filter(x => x !== item) : [...list, item])
// Rows whose full description is shown.
const details = atom({ plugin: 'skills-picker', key: 'details' } as const, [] as string[], { shape: 'details-1' })

const SUMMARY_MAX = 140
// The first sentence, or the first ~140 characters cut at a word, with an ellipsis when cut.
export const summary = (text: string): string => {
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text
  if (sentence.length <= SUMMARY_MAX) return sentence
  const cut = sentence.slice(0, SUMMARY_MAX)
  const space = cut.lastIndexOf(' ')
  return `${(space > 80 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`
}

// Check the catalog's freshness; redraw the pane when the list changed. Never throws.
async function refresh($: Engine, cwd: string, force = false): Promise<Skill[] | undefined> {
  const before = peekCatalog(cwd)
  try {
    const skills = await refreshCatalog($, cwd, { force })
    if (JSON.stringify(skills) !== JSON.stringify(before)) await update($, version, n => n + 1)
    return skills
  } catch {
    return undefined
  }
}

export function registerPane(on: On): void {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'skills-picker', description: 'Open the skills picker pane' })
    } catch {}
    // Warm the catalog for the pane; a failure must not stop the session.
    void refresh($, await $.session.cwd())
    return next(e)
  })

  // Replies carry no `text`: a plugin command's text stays in model requests, and this must cost no tokens.
  on('command.run', { command: 'skills-picker' }, async ($, e) => {
    const cwd = await $.session.cwd()
    if ((e.args ?? '').trim() === 'refresh') {
      const list = await refresh($, cwd, true)
      $.ui.toast(list ? `Skills list refreshed: ${list.length} skills.` : 'Could not refresh the skills list.')
      return {}
    }
    void refresh($, cwd) // freshness check when the pane opens; it redraws if the list moved
    try {
      const opened = await $.ui.open({ id: PANE_ID, title: 'Skills' })
      if (!opened.isPlaced) $.ui.toast('The skills pane is open but not drawn yet. Widen the window or reopen it.')
    } catch {
      $.ui.toast('Could not open the skills pane.')
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const q = await read($, query)
    const open = await read($, expanded)
    const picked = await read($, selected)
    const shown = await read($, details)
    await read($, version)
    const cwd = await $.session.cwd()

    let all: Skill[] = []
    let failed = false
    try {
      all = await getCatalog($, cwd)
    } catch {
      failed = true
    }
    const searching = q.trim() !== ''
    const matches = filterSkills(all, q)
    const groups = groupSkills(matches)
    const pickedSet = new Set(picked)
    const togglePick = (invoke: string) => update($, selected, list => toggle(list, invoke))

    const use = async () => {
      const inserted = await read($, selected)
      if (inserted.length === 0) return
      const filled = await $.prompt.fill({ text: inserted.map(i => '/' + i).join(' ') + ' ', mode: 'insert' })
      // Keep the picks when nothing was inserted (no composer, or a dialog is open); drop only what went in.
      if (filled.isFilled) await update($, selected, list => list.filter(i => !inserted.includes(i)))
    }

    // One skill as a card: name and plugin beside an Add button whose label says its state (a screen
    // reader hears "Add" or "Added", not a glyph), then a readable summary with the whole text behind
    // Show more. Colours are terminal theme keys, which every surface maps for light and dark alike.
    const row = (skill: Skill) => {
      const isPicked = pickedSet.has(skill.invoke)
      const isOpen = shown.includes(skill.invoke)
      const full = skill.description.replace(/\s+/g, ' ').trim()
      const short = summary(full)
      const hasMore = short !== full
      return (
        <Box
          key={`row:${skill.invoke}`}
          flexDirection="column"
          gap="sm"
          padding="md"
          borderStyle="round"
          borderColor={isPicked ? ACCENT : LINE}
          borderDimColor={!isPicked}
          hover={{ borderColor: ACCENT, borderDimColor: false }}
        >
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="md">
            <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
              <Text weight="semibold" color={isPicked ? ACCENT : undefined} wrap="wrap">
                {skill.name}
              </Text>
              {skill.plugin && (
                <Text size="caption" dimColor wrap="wrap">{`from ${skill.plugin}`}</Text>
              )}
            </Box>
            <Button
              key={`skill:${skill.invoke}`}
              variant={isPicked ? 'primary' : 'secondary'}
              label={isPicked ? '✓ Added' : 'Add'}
              onPress={() => togglePick(skill.invoke)}
            />
          </Box>
          {full !== '' && (
            <Text size="footnote" dimColor wrap="wrap">
              {isOpen || !hasMore ? full : short}
            </Text>
          )}
          {hasMore && (
            <Box flexDirection="row">
              <Button
                key={`more:${skill.invoke}`}
                plain
                dimColor
                label={isOpen ? 'Show less' : 'Show more'}
                onPress={() => update($, details, list => toggle(list, skill.invoke))}
              />
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" alignItems="stretch" gap="md" paddingX="xs" paddingY="sm">
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="md">
          <Input
            key="search"
            placeholder="Search skills…"
            value={q}
            onInput={value => update($, query, () => value)}
            onSubmit={value => update($, query, () => value)}
          />
          <Box flexDirection="row" alignItems="center" gap="sm">
            <Text size="caption" tabular dimColor>
              {searching ? `${matches.length} of ${all.length}` : `${all.length} skills`}
            </Text>
            {searching && <Button key="clear-search" plain dimColor label="Clear search" onPress={() => update($, query, () => '')} />}
          </Box>
        </Box>

        <Box
          key="tray"
          flexDirection="column"
          gap="sm"
          padding="md"
          borderStyle="round"
          borderColor={picked.length > 0 ? ACCENT : LINE}
          borderDimColor={picked.length === 0}
        >
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="md">
            <Text weight="semibold" color={picked.length > 0 ? ACCENT : undefined} dimColor={picked.length === 0}>
              {`${picked.length} selected`}
            </Text>
            {picked.length > 0 && (
              <Box flexDirection="row" alignItems="center" gap="sm">
                <Button key="clear" plain dimColor label="Clear" onPress={() => update($, selected, () => [])} />
                <Button key="use" variant="primary" label="Insert into prompt" onPress={use} />
              </Box>
            )}
          </Box>
          {picked.length > 0 ? (
            <Text size="footnote" mono wrap="wrap">
              {picked.map(i => '/' + i).join('  ')}
            </Text>
          ) : (
            <Text size="footnote" dimColor wrap="wrap">
              Press Add on the skills you want, then insert them into your prompt.
            </Text>
          )}
        </Box>

        {failed && <Text color="error">Could not read skills. Run /skills-picker refresh.</Text>}
        {!failed && all.length === 0 && <Text dimColor>No skills found. Run /skills-picker refresh.</Text>}
        {!failed && all.length > 0 && groups.length === 0 && <Text dimColor>{`No skills match "${q}".`}</Text>}

        <Box flexDirection="column" gap="xs">
          {groups.map(group => {
            const isOpen = searching || open.includes(group.id)
            const pickedHere = group.skills.filter(s => pickedSet.has(s.invoke)).length
            return (
              <Box key={group.id} flexDirection="column" gap="sm">
                <Box
                  key={`head:${group.id}`}
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  gap="md"
                  paddingX="xs"
                >
                  <Button
                    key={`cat:${group.id}`}
                    plain
                    label={`${isOpen ? '▾' : '▸'} ${group.label}`}
                    onPress={() => {
                      if (!searching) return update($, expanded, list => toggle(list, group.id))
                    }}
                  />
                  <Text size="caption" tabular color={pickedHere > 0 ? ACCENT : undefined} dimColor={pickedHere === 0}>
                    {pickedHere > 0 ? `${pickedHere} / ${group.skills.length}` : String(group.skills.length)}
                  </Text>
                </Box>
                {isOpen && (
                  <Box flexDirection="column" gap="sm" paddingLeft="md" paddingBottom="sm">
                    {group.skills.map(row)}
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
