# junkd

The frame over the junk-drawer marketplace, for Claude Code only (a mod: a hooks module, plus one shell
SessionStart hook, `scripts/setup.sh`, for the output style below). `/junkd`, or a click on the `✚ junkd`
segment under the prompt, opens a set of panes as tabs and closes them together:

1. **junkd** — focused, the frame below.
2. **handoff** — handoff's own pane.
3. **orch** — orch's own pane.

The feature panes open through their plugin's noun (`$.handoff.show`, `$.orch.show`), marked as the set's.
A feature pane already open on its own closes first and opens again behind junkd's tab, so its tab never
comes first, and from then on it is the set's. `q`, a second `/junkd`, or closing junkd's tab by hand (`×`)
closes all three, but only a feature pane that is still the set's: one you closed and opened again on your own
(`/handoff panel`, `/orch panel`, `/ahandoff`, the 🪃 click) stays.
A plugin that is off or not installed is left out of the set.

Where the set sits depends on the layout. Only in the fullscreen layout (`"tui": "fullscreen"` in
`settings.json`), from 110 terminal columns, it docks beside the transcript; narrower, and always on the main
screen, it sits above the prompt. The feature panes are opened by their own plugins, and Claude Code does not
count an open made through another plugin as yours: until you have opened that pane by hand once
(`/handoff panel`, `/orch panel`), its tab waits undrawn below 144 columns. After that, 110 columns are enough.

The header reads `✚ junkd  junk-drawer <sha>`: the short sha of the marketplace checkout (none where it is not
a git checkout). The junkd pane has three sections, their titles in junk-drawer's orange (the theme's accent):

- **Plugins** — every plugin of the marketplace (`.claude-plugin/marketplace.json`), on or off at user scope
  as `enabledPlugins` in `~/.claude/settings.json` (`$CLAUDE_CONFIG_DIR/settings.json`) says; the title names
  the file it writes. A plugin on in this project only is marked. Keys `1`–`9` flip one; the pane then says to
  run `/reload-plugins`.
- **Settings** — for each enabled plugin that exposes a noun on the engine's `$` (today `handoff`, `orch` and
  `tldr`), the fields its `schema()` marks `main`, with their current values from `get`. A letter flips a
  boolean through that plugin's `set`; a number is typed and saved with `enter`, a choice (orch's `guard`) is
  picked with `tab` and `enter`. The plugin validates what it gets, and a refusal shows in the note line.
  Each row: the key, its title, the control on the right (a switch as an `on`/`off` pill and its letter, a
  choice as its options with the current one inverse, a number as a field). `settings ▸` opens the plugin's
  pane (`show()`: handoff on its Settings tab, orch its pane), closes junkd and the set's other feature pane
  (while it is still the set's), then asks again with `focus`, so the feature pane ends alone with the keys; it
  is yours from then on. tldr has no pane and no button. A plugin that is off, or whose hooks
  are not loaded, shows no section.
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
| `settings ▸` | Open that plugin's own pane (`show()`); junkd and the set's other pane close so it can take the keys |
| `q` | Close the set (`/junkd` or the `✚ junkd` segment toggles it; closing junkd's tab closes it too) |

## Settings

One row in `/config` under plugin `junkd` (`userConfig` in the manifest):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `output_style` | string (`ste`, `off`) | `ste` | Run the output-style step below at session start (`ste`), or skip it (`off`) |

Scope: user-global; project/session overrides: planned.

## Output style (STE)

junkd ships one output style, `junkd:STE` (`output-styles/STE.md`): Simplified Technical English, ASD-STE100.
Short declarative sentences, one word for one meaning, the active voice, a procedure as a numbered list, no
preamble, a two-sentence summary at the end of a turn. Code, logs and paths stay as they are. It is listed by
`/output-style` like any other style once the plugin is on.

A setup step makes it the default for a person who never chose a style, and for nobody else. At session start,
in the main session only, `scripts/setup.sh` looks at `~/.claude/settings.json` (`$CLAUDE_CONFIG_DIR/settings.json`):

- no `outputStyle` key → the key is set to `junkd:STE` (temp file, then `mv`; the other keys and their order
  stay) and one line, `junkd: outputStyle set to junkd:STE in …`, goes into the model's context (a
  SessionStart hook's stdout; it is not shown on screen). A missing or empty file becomes
  `{"outputStyle": "junkd:STE"}`.
- an `outputStyle` key with any value → nothing is written, nothing is added to the context.
- a file that does not parse, or is not a JSON object → nothing is written, nothing is added to the context,
  and the step looks again next session.

The step runs once per plugin version: a stamp, `~/.claude/junkd/setup-<version>.stamp`, is written once the
key is there (set or found). Delete the key later and it stays deleted until the next version. A `/clear`, a
compaction and every subagent are skipped. The hook always exits 0.

**Keep your own style.** Pick it once with `/output-style` (that writes the key) — the step never touches a
key that exists, whatever its value, and `/output-style` changes it any time, `junkd:STE` included.

**Turn the step off.** Set `output_style` to `off` in `/config` (the junkd row; `ste` is the default). The
shell hook reads the row where Claude Code stores it (`pluginConfigs` in `settings.json`), and the hooks
module also mirrors it into the flag file `~/.claude/junkd/output-style-off`, at every write of the row and at
session start, so the step is off from the first session on. The row in `settings.json` wins when it names a
value (a hand edit from `off` to `ste` applies at the next session start); the flag file only stands in where
it names none. While it is off no stamp is written, so `ste`
again applies the step at the next session start. The step needs `jq`; without it nothing is written and
nothing is stamped. Removing the plugin stops the
step too; a `junkd:STE` already in `settings.json` then names a style that is gone, so pick another with
`/output-style`.

## Files

- `hooks/index.tsx` — the module: the pane's data, the noun calls, the set and its toggles, the `output_style` mirror;
  `hooks/junkd-views.tsx` the drawing.
- `commands/junkd.md` — `/junkd:junkd`, intercepted by the module like the registered `/junkd`.
- `output-styles/STE.md` — the `junkd:STE` output style.
- `scripts/setup.sh` — the SessionStart step above (the real file is `skills/junkd/scripts/setup.sh`, the
  plugin-root `scripts` a symlink to it, as the layout invariant of `tests/smoke.sh` asks).
- `hooks/junkd.test.tsx` — the pane over a fake config tree and fake handoff/orch/tldr plugins, and the
  `output_style` mirror: `claude plugin test plugins/junkd`. `tests/junkd.sh` — the style file and the setup
  step over a temp `CLAUDE_CONFIG_DIR`: `bash tests/junkd.sh`.
