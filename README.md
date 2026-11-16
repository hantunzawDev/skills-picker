# skills-picker

A Claude Code mod that lists every skill you have installed, by category, in a side pane. Search, press **Add** on the skills you want, then **Insert into prompt**: it types `/skill-a /skill-b ` at your cursor. Nothing is sent until you send it.

It runs locally and costs **zero tokens**: no hooks on your messages, no model calls, and its commands reply with no text, so nothing it does reaches the model.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install skills-picker --marketplace hantunzawDev/skills-picker
```

Answer `y` to add the marketplace, then choose a scope (user is the default).

From a shell:

```bash
claude plugin install skills-picker --marketplace hantunzawDev/skills-picker
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `hantunzawDev/skills-picker`, then **Add plugin**.

## Use

- `/skills-picker` opens the **Skills** pane.
- Type in the search box to filter by name, description or plugin. The row shows how many match; **Clear search** empties it.
- Press a category to open or close it. Each skill shows its name, the plugin it comes from, and its first sentence; **Show more** reveals the full description.
- **Add** picks a skill (it turns into **✓ Added**); press it again to drop it.
- The tray at the top lists your picks. **Insert into prompt** types them at your cursor; **Clear** drops them all.
- **↻ Refresh** (beside the search box) rescans every skill folder, for when you have just installed skills or one is missing, and says how many are new or gone. `/skills-picker refresh` does the same. The list also refreshes by itself when skills are added, removed or edited.

## What it reads

Read-only, on your machine:

- `~/.claude/skills`
- `<project>/.claude/skills`
- `~/.claude/plugins/installed_plugins.json`, and the skill folders of each plugin it lists that is not disabled in `~/.claude/settings.json`
- `~/Library/Application Support/Claude/local-agent-mode-sessions` (macOS only: the desktop app's plugin folders)

A skill is inserted by its **folder name** (`/folder`, or `/plugin:folder` for a plugin skill), which is what Claude Code calls it. The `name` inside `SKILL.md` is only shown and searched.

## Categories and overrides

Skills are sorted into 13 categories by keywords in their name and description, with no AI involved. To move a skill, create `~/.claude/skills-picker/overrides.json`, mapping the skill's invoke text (its folder name, or `plugin:folder`) to a category id:

```json
{
  "tastemaker": "design",
  "superpowers:brainstorming": "planning"
}
```

Category ids: `design`, `frontend`, `mobile`, `backend`, `debug-test`, `review`, `docs`, `planning`, `research`, `analytics`, `security`, `devops`, `other`. An unknown id is ignored.

## Develop

```bash
claude --plugin-dir /path/to/skills-picker
```

```bash
claude plugin test /path/to/skills-picker
```

`scripts/category-report.ts` prints how your skills fall into categories. It needs a Node version that runs `.ts` files directly.

## License

MIT
