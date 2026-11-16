export type CategoryId =
  | 'design' | 'frontend' | 'mobile' | 'backend' | 'debug-test' | 'review' | 'docs'
  | 'planning' | 'research' | 'analytics' | 'security' | 'devops' | 'other'

/** One installed skill shown in the pane. `invoke` is the text inserted into the prompt, for example `/name`. */
export type Skill = {
  name: string
  invoke: string
  description: string
  plugin?: string
  source: 'personal' | 'project' | 'plugin'
  category: CategoryId
}

declare module 'claude-code' {
  interface PluginState {
    'skills-picker': {
      query: Shaped<string>
      expanded: Shaped<CategoryId[]>
      /** The `invoke` of each ticked skill. */
      selected: Shaped<string[]>
      /** Bumped when the catalog changes in the background, so the pane redraws. */
      version: Shaped<number>
      /** The `invoke` of each skill whose full description is shown. */
      details: Shaped<string[]>
      /** True while the pane's Refresh button rescans. */
      refreshing: Shaped<boolean>
    }
  }
}
