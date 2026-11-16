import { expect, test } from 'claude-code/testing'

import { summary } from '../src/pane'

test('summary keeps the first sentence', async () => {
  expect(summary('One thing. Two things.')).toBe('One thing.')
})
test('summary cuts a long sentence at a word with an ellipsis', async () => {
  const long = 'word '.repeat(60).trim()
  const s = summary(long)
  expect(s.endsWith('…')).toBe(true)
  expect(s.length).toBeLessThanOrEqual(141)
  expect(s).not.toContain('wor…')
})
test('summary leaves short text alone', async () => {
  expect(summary('Bar')).toBe('Bar')
})
