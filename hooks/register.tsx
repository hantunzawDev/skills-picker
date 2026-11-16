import type { Register } from 'claude-code'

import { registerPane } from '../src/pane'

export const register: Register = on => {
  registerPane(on)
}
