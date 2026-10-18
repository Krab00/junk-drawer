# junkd

The frame over the junk-drawer marketplace, for Claude Code only (a mod: a hooks module, no shell). `/junkd`,
or a click on the `✚ junkd` segment under the prompt, toggles one pane with three sections:

- **Plugins** — every plugin of the marketplace (`.claude-plugin/marketplace.json`), on or off at user scope
  as `enabledPlugins` in `~/.claude/settings.json` (`$CLAUDE_CONFIG_DIR/settings.json`) says. A plugin on in
  this project only is marked. Keys `1`–`9` flip one; the pane then says to run `/reload-plugins`.
- **Settings** — for each enabled plugin that exposes a noun on the engine's `$` (today `handoff`, `orch` and
  `tldr`), the fields its `schema()` marks `main`, with their current values from `get`. A letter flips a
  boolean through that plugin's `set`; a number is typed and saved with `enter`, a choice (orch's `guard`) is
  picked with `tab` and `enter`. The plugin validates what it gets, and a refusal shows in the note line.
  `settings ▸` calls the plugin's `open()`: handoff opens on its Settings tab, orch opens its pane; tldr has
  no pane and no button. A plugin that is off, or whose hooks are not loaded, shows no section.
- **Commands** — the enabled plugins' slash commands with their one-line descriptions, as the engine lists
  them (`$.command.list()`, filtered to the plugins on in this session).

Every feature plugin works without junkd: handoff, orch and tldr keep their own commands, panes and `/config`
rows. junkd only calls what they export, and it opens with none of them installed: Plugins and Commands are
drawn, Settings says no settings, none of handoff, orch, tldr is loaded.

## Install

```text
/plugin marketplace add Krab00/junk-drawer
/plugin install junkd@junk-drawer
```

`plugin.json` lists `handoff`, `orch` and `tldr` under `dependencies` (the manifest has no optional form),
so an install brings them along and the engine lays their typed contracts beside the API reference. At run
time each noun is called inside a try: a plugin that is missing or off is a call that throws, and the pane
goes on without it.

## Keys

| Key | Does |
|---|---|
| `1`–`9` | Flip the n-th plugin on or off at user scope, then `/reload-plugins` |
| `a`… | Flip the n-th boolean setting through its plugin's `set` (letters follow the drawn order; `q` is skipped) |
| `tab` | Move between the number fields and the choice buttons |
| `enter` | Save the number field, or pick the focused choice |
| `settings ▸` | Open that plugin's own pane (`open()`); junkd closes so it can take the keys |
| `q` | Close the pane (`/junkd` or the `✚ junkd` segment toggles it) |

## Files

- `hooks/index.tsx` — the module: the pane's data, the noun calls, the toggles; `hooks/junkd-views.tsx` the
  drawing.
- `commands/junkd.md` — `/junkd:junkd`, intercepted by the module like the registered `/junkd`.
- `hooks/junkd.test.tsx` — the pane over a fake config tree and fake handoff/orch/tldr plugins:
  `claude plugin test plugins/junkd`.
