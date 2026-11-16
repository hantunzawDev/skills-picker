import { expect, test } from 'claude-code/testing'

import { parseFrontmatter } from '../src/frontmatter'

test('folded description', async () =>
  expect(parseFrontmatter('---\nname: a\ndescription: >\n  one\n  two\n---\nbody')?.description).toBe('one two'))
test('no frontmatter is null', async () => expect(parseFrontmatter('# hi')).toBeNull())
