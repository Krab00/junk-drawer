# junkd

One plugin for six tools and the frame over them. Every command is a skill of junkd, so on Claude Code each is
`/junkd:<name>`:

| Command | Does |
|---|---|
| `/junkd:handoff` | Save a handoff of the session to disk and print its short id (`panel`, `auto [prompt]`, `off` drive the auto loop on Claude Code) |
| `/junkd:handon [id]` | Resume a handoff in a fresh session (the newest without an id) |
| `/junkd:ahandoff [prompt] \| off \| panel` | Arm the auto handoff loop: at a context threshold handoff, `/clear`, `/junkd:handon`, continue; resume after the 5h rate limit (Claude Code only) |
| `/junkd:orch …` | The orchestration loop: tasks, implementer and verifier subagents, evidence gates, draft PRs (`panel` opens its settings pane) |
| `/junkd:dashboard [close]` | Open the orch dashboard, a local HTML page with the task board, the agents' timeline, the recent events and the lessons; `close` stops its writes (`/junkd:orch dashboard` too) |
| `/junkd:orch-init` | Write the project's `.orch/config.md` once, before the first `/junkd:orch` |
| `/junkd:tldr [N \| on \| off \| status]` | Summarize the last substantive reply in at most N sentences, or keep every reply terse |
| `/junkd:ctx-limit [<tokens> \| on \| off \| status \| action <m> \| cmd <shell>]` | A context-size limit a per-prompt hook enforces: block, warn, or run a command |
| `/junkd:ctx-tokens` | How full the context is, from the session transcript |
| `/junkd:statusline [on \| off \| status]` | The colored status line in settings.json, a switch per segment; no argument toggles its pane (Claude Code only) |
| `/junkd:tools [agents \| tools \| mcp \| skills]` | Open or close the tools pane: this session's agents over the repo's worktrees, and the tools, MCP servers and skills it used (Claude Code only) |
| `/junkd`, `/junkd:junkd` | Open or close the junkd set of panes (Claude Code only) |

On Codex the same skills answer as `$handoff`, `$orch`, `$tldr`, `$ctx-limit`… (the model sees them as `junkd:<name>`), on Kimi
Code as `/skill:<name>`, on OpenCode through the `skill` tool or the `/<name>` wrappers `bin/opencode-commands.sh`
generates. The hooks module (Claude Code only) adds the auto handoff loop, the orch main-loop guard,
the panes, the status line's wiring and `$.junkd` for other mods; the skills, the `bin/` helpers and the shell hooks
work on every host.

handoff, orch, tldr, ctx-limit, ctx-tokens and statusline were six plugins before; see [Moving from the handoff,
orch, tldr, ctx-limit, ctx-tokens and statusline
plugins](#moving-from-the-handoff-orch-tldr-ctx-limit-ctx-tokens-and-statusline-plugins).

## Install

```text
/plugin marketplace add Krab00/junk-drawer
/plugin install junkd@junk-drawer
```

Codex: `codex plugin add junkd@junk-drawer`; after an update of a local marketplace, re-run that command
(`codex plugin marketplace upgrade` refreshes only a Git marketplace). Kimi Code installs from a clone, in the TUI:
`/plugins marketplace /abs/path/to/junk-drawer/kimi-marketplace.json`, choose junkd in the picker, then "Trust and
install" (a GitHub URL and a bare `/plugins install junkd` do not work). OpenCode: `npx skills add Krab00/junk-drawer
-a opencode` (or a local path), then `bin/opencode-commands.sh` for the `/<name>` commands. The root
[README](../../README.md) has the details per host.

### Hosts and data roots

The helpers (`handoff-path`, `handoff-load`, `tldr-flag`, `tldr-hook`, `ctx-limit`, `ctx-limit-hook`, `ctx-tokens`)
detect the host they run on through `skills/handoff/bin/host-lib`, and each host keeps its own data (ctx-limit's
files in a `junkd/` folder beside the terse flag: [ctx-limit and ctx-tokens](#ctx-limit-and-ctx-tokens)):

| Host | Detected by | Handoffs | Terse flag |
|---|---|---|---|
| Claude Code | `CLAUDECODE`, `CLAUDE_PLUGIN_ROOT`, else `CLAUDE_CONFIG_DIR` | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/handoffs/` | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/tldr-on` |
| Codex | `CODEX_THREAD_ID`, a `PLUGIN_ROOT` under `.codex` or `$CODEX_HOME`, else `CODEX_HOME` | `${CODEX_HOME:-$HOME/.codex}/junk-drawer/handoffs/` | `${CODEX_HOME:-$HOME/.codex}/junk-drawer/tldr-on` |
| Kimi Code | `KIMI_PLUGIN_ROOT`, the helper under `plugins/managed/`, else `KIMI_CODE_HOME` | `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/handoffs/` | `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/tldr-on` |
| OpenCode | `OPENCODE`, `OPENCODE_PID`, the helper under `.agents/skills/` or `.opencode/` | `${XDG_DATA_HOME:-$HOME/.local/share}/opencode/junk-drawer/handoffs/` | `${XDG_DATA_HOME:-$HOME/.local/share}/opencode/junk-drawer/tldr-on` |

`JUNK_DRAWER_RUNTIME=claude|codex|kimi|opencode` overrides the detection. The config-dir variables
(`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `KIMI_CODE_HOME`) count only after every host's own signal, so one a shell
profile exports never pulls another host's helper into it. With no signal at all a helper exits 2 with one line
naming `JUNK_DRAWER_RUNTIME` and writes nothing: it never falls back to `~/.claude` (ctx-limit's hook exits 0
instead, so the guard never blocks a prompt on a guess).

Install quirks: Codex drops every symlink (the plugin-root `bin/`, `agents/`, `scripts/` and orch-init's sibling
links), so the skills run their own `./bin`; its hooks (terse mode, ctx-limit) are `.codex-plugin/hooks.json` (Codex refuses the
`modules` key of `hooks/hooks.json`) and runs only after you trust it when a session asks you to review the
plugin's hooks. Kimi Code keeps the symlinks of a local-path install rewritten to absolute paths into your checkout
(the plugin-root `bin/` and `scripts/`, orch-init's `bin/` and `commands/`): moving the checkout breaks them, and
switching its branch changes what they run. Its manifest names no agents (`"agents": []`), so `agents/` is not read
as agent definitions. Skills in `~/.agents/skills` shadow the plugin's on Kimi and on Codex (a stale `npx skills add -g`
copy wins).

## The /junkd frame (Claude Code only)

`/junkd`, `/junkd:junkd`, or a click on the `✚ junkd` segment under the prompt, opens a set of panes as tabs and
closes them together:

1. **junkd** — focused, the frame below.
2. **handoff** — handoff's pane ([below](#handoff)).
3. **orch** — orch's settings pane ([below](#orch)).
4. **statusline** — the status line's pane ([below](#statusline)).
5. **tools** — the tools pane ([below](#tools)), only while `tools_enabled` is on.
6. **lessons** — the pending orch lessons ([below](#lessons)), only while `orch_enabled` and `orch_lessons` are on.

All six are panes of the one hooks module, so the set opens them directly, marked as the set's. A feature pane
already open on its own closes first and opens again behind junkd's tab, so its tab never comes first, and from
then on it is the set's. `q`, a second `/junkd`, or closing junkd's tab by hand (`×`) closes them all, but only a
feature pane that is still the set's: one you closed and opened again on your own (`/junkd:handoff panel`,
`/junkd:orch panel`, `/junkd:ahandoff panel`, `/junkd:statusline`, `/junkd:tools`, `/junkd:lessons`, the 🪃 or 📒
click) stays.

Where the set sits depends on the layout. Only in the fullscreen layout (`"tui": "fullscreen"` in
`settings.json`), from 110 terminal columns, it docks beside the transcript; narrower, and always on the main
screen, it sits above the prompt. The feature panes open after junkd's, and Claude Code counts only the first open
of a press as yours: until you have opened that pane by hand once (`/junkd:handoff panel`, `/junkd:orch panel`),
its tab may wait undrawn below 144 columns. After that, 110 columns are enough.

The header reads `✚ junkd  junk-drawer <sha>`: the short sha of the marketplace checkout (none where it is not
a git checkout). The junkd pane has three sections, their titles in junk-drawer's orange (the theme's accent):

- **Plugins** — every plugin of the marketplace (`.claude-plugin/marketplace.json`: junk-drawer, junkd), on or off at user scope as `enabledPlugins` in `~/.claude/settings.json`
  (`$CLAUDE_CONFIG_DIR/settings.json`) says; the title names the file it writes. A plugin on in this project only
  is marked. Keys `1`–`9` flip one; the pane then says to run `/reload-plugins`. handoff, orch, tldr, ctx-limit and
  statusline are no plugins of their own anymore: each group's `enabled` row in Settings is their on/off.
- **Settings** — the groups core, handoff, orch, tldr, ctx, statusline and tools, in that order, each with its `main` rows and `enabled`
  first, with their current values. A letter flips a boolean; a number is typed and saved with `enter`, a choice
  (`orch_guard`, `core_output_style`, `ctx_action`) is picked with `tab` and `enter`. The group's own rules validate what it
  gets, and a refusal shows in the note line. Each row: the field, its title, the control on the right (a switch
  as an `on`/`off` pill and its letter, a choice as its options with the current one inverse, a number as a
  field). `settings ▸` on handoff, orch, statusline and tools opens that pane (handoff on its Settings tab, tools on
  its Agents tab), closes junkd and the set's other feature panes (while they are still the set's), then asks again
  for the keys, so the feature pane ends alone with them; it is yours from then on. core, tldr and ctx have no pane
  and no button.
- **Commands** — the enabled plugins' slash commands with their one-line descriptions, as the engine lists them
  (`$.command.list()`, filtered to the plugins on in this session), junkd's `/junkd:*` among them.

### Keys

| Key | Does |
|---|---|
| `1`–`9` | Flip the n-th plugin on or off at user scope, then `/reload-plugins` |
| `a`… | Flip the n-th boolean setting (letters follow the drawn order; `q` is skipped) |
| `tab` | Move between the number fields and the choice buttons |
| `enter` | Save the number field, or pick the focused choice |
| `settings ▸` | Open that group's pane; junkd and the set's other pane close so it can take the keys |
| `q` | Close the set (`/junkd` or the `✚ junkd` segment toggles it; closing junkd's tab closes it too) |

## Settings

Every setting is a `userConfig` row of junkd, keyed `<group>_<field>`, and a `/config` row `junkd.<group>_<field>`
(Claude Code takes only identifier keys in a manifest's `userConfig`, so the group and the field are joined by
`_`). Seven groups, each feature group with its `enabled` row first:

| Group | Rows | Details |
|---|---|---|
| core | `core_output_style`, `core_cache_check_sessions` | [Output style](#output-style-ste), [prompt-cache check](#prompt-cache-check-claude-code-only) |
| handoff | `handoff_enabled`, `handoff_threshold`, `handoff_checkEvery`, `handoff_autoOn`, `handoff_resumeAfterLimit`, `handoff_staleDays`, `handoff_segment` | [handoff settings](#settings-1) |
| orch | `orch_enabled`, `orch_guard`, `orch_allow_fable_agents`, `orch_implementer_ctx_k`, `orch_ui_review`, `orch_inject_rules`, `orch_rounds`, `orch_claude_md`, `orch_dashboard_refresh`, `orch_dashboard_window_h`, `orch_watchdog`, `orch_idle_stop`, `orch_idle_stop_minutes`, `orch_stall_minutes`, `orch_lessons` | [orch settings](#settings-2), [dashboard](#dashboard), [watchdog settings](#settings-7), [lessons settings](#settings-8) |
| tldr | `tldr_enabled`, `tldr_terse`, `tldr_sentences` | [tldr settings](#settings-3) |
| ctx | `ctx_enabled`, `ctx_threshold`, `ctx_action`, `ctx_cmd` | [ctx-limit settings](#settings-4) |
| statusline | `statusline_enabled`, `statusline_ctx`, `statusline_branch`, `statusline_worktree`, `statusline_model`, `statusline_effort`, `statusline_limits` | [statusline settings](#settings-5) |
| tools | `tools_enabled`, `tools_refresh`, `tools_agents_only` | [tools settings](#settings-6) |

The `enabled` rows: `handoff_enabled` off is no auto handoff loop and no 🪃 segment (`/junkd:handoff`,
`/junkd:handon` and the pane still work); `orch_enabled` off is no main-loop guard and no rule sheet at session
start (`/junkd:orch` and its pane still work); `tldr_enabled` off keeps the per-turn terse hook silent
(`/junkd:tldr N` still summarizes); `ctx_enabled` off (the default) is no context limit; `statusline_enabled` off
takes junkd's line out of settings.json; `tools_enabled` off closes the tools pane, takes its tab out of the set and
counts nothing. Scope: user-global; project/session overrides: planned.

A shell hook runs before the hooks module at a session start and reads no plugin setting, so each shell hook reads
its row from `settings.json` itself (`pluginConfigs`, the first entry whose key starts with `junkd@`, its
`.options.<row>`), and only where that names no value a flag file the module mirrors the row into decides. The
flag files live under `~/.claude/junkd/` (`$CLAUDE_CONFIG_DIR/junkd/`): `output-style-off`, `tldr-on`,
`tldr-off`, `orch-off`, `orch-rules-off`, ctx-limit's `ctx-limit-threshold`, `ctx-limit-action` and
`ctx-limit-cmd`, the status line's copy `statusline.sh`, and the setup stamps `setup-<version>.stamp`.

## Moving from the handoff, orch, tldr, ctx-limit, ctx-tokens and statusline plugins

handoff, orch, tldr, ctx-limit, ctx-tokens and statusline were separate plugins of this marketplace; they are now
part of junkd, which no longer depends on them. Uninstall the old ones (`/plugin uninstall handoff@junk-drawer`,
`orch@junk-drawer`, `tldr@junk-drawer`, `ctx-limit@junk-drawer`, `ctx-tokens@junk-drawer`,
`statusline@junk-drawer`, and the same plugins on Codex and Kimi Code) and install junkd. Nothing is copied over: set the values you had changed again (`/config`,
the junkd pane, a feature pane), or rename the keys in `~/.claude/settings.json` by hand.

| Before | Now |
|---|---|
| `/handoff`, `/handoff:handoff` | `/junkd:handoff` |
| `/handon`, `/handoff:handon` | `/junkd:handon` |
| `/ahandoff` | `/junkd:ahandoff` |
| `/orch`, `/orch:orch` | `/junkd:orch` |
| `/orch:init` | `/junkd:orch-init` |
| `/tldr`, `/tldr:tldr` | `/junkd:tldr` |
| agent types `orch:<role>` (`orch:implementer`, …) | `junkd:<role>` (`junkd:implementer`, …) |
| `pluginConfigs["handoff@junk-drawer"].options.<field>`: `enabled`, `threshold`, `checkEvery`, `autoOn`, `resumeAfterLimit`, `staleDays`, `segment` | `pluginConfigs["junkd@junk-drawer"].options.handoff_<field>` |
| `pluginConfigs["orch@junk-drawer"].options.<field>`: `guard`, `allow_fable_agents`, `implementer_ctx_k`, `ui_review`, `inject_rules`, `rounds` | `pluginConfigs["junkd@junk-drawer"].options.orch_<field>` |
| `pluginConfigs["tldr@junk-drawer"].options.<field>`: `terse`, `sentences` | `pluginConfigs["junkd@junk-drawer"].options.tldr_<field>` |
| `pluginConfigs["junkd@junk-drawer"].options.output_style` | `pluginConfigs["junkd@junk-drawer"].options.core_output_style` |
| `/config` rows `handoff.<field>`, `orch.<field>`, `tldr.<field>`, `junkd.output_style` | `junkd.handoff_<field>`, `junkd.orch_<field>`, `junkd.tldr_<field>`, `junkd.core_output_style` |
| — | new rows `orch_enabled`, `tldr_enabled` (both on by default), `orch_claude_md` (off by default) |
| `~/.claude/tldr-on` | `~/.claude/junkd/tldr-on` (run `/junkd:tldr on` again; the old file is not read) |
| `~/.claude/orch/rules-off` | `~/.claude/junkd/orch-rules-off` (written by the module at the next session start) |
| `$.handoff`, `$.orch`, `$.tldr` | `$.junkd` ([below](#junkd-for-other-mods)) |
| `/ctx-limit`, `/ctx-limit:ctx-limit` | `/junkd:ctx-limit` |
| `ctx-tokens` (the bare command) | `/junkd:ctx-tokens`; `ctx-tokens` stays on the Bash tool's PATH while junkd is on |
| `/statusline:init` | `/junkd:statusline on` (on by default: the first session start wires it) |
| `~/.claude/ctx-limit-threshold`, `-action`, `-cmd` | `~/.claude/junkd/ctx-limit-*`: the module moves them once at session start where the new ones are missing |
| `<home>/junk-drawer/ctx-limit-*` (Codex, Kimi Code) | `<home>/junk-drawer/junkd/ctx-limit-*`: not moved, set the limit again with the skill |
| `~/.claude/junk-drawer-statusline.sh` | `~/.claude/junkd/statusline.sh`: `statusline-setup on` (the first session start, or `/junkd:statusline on`) moves the statusLine and removes the old copy |
| — | new rows `ctx_*` (the guard off by default) and `statusline_*` (all on by default) |

Saved handoffs stay where they were (`~/.claude/handoffs`) and need nothing. Codex and Kimi Code keep their flags
and handoffs under `<home>/junk-drawer/`.

## $.junkd for other mods

The hooks module adds one noun, `$.junkd`, to the engine's `$` (its contract: `types/index.d.ts`, exported as
`Junkd`; list `junkd` under `dependencies` in your plugin.json and the engine lays it beside the API reference). The
host builds a noun as one flat object of methods and refuses an object member, so the former `$.handoff`,
`$.orch` and `$.tldr` are not nested inside it: their settings are rows of the one schema, their panes are
`open`'s `pane`, and their live reads are `handoffStatus` and `orchGuardState`. Every call resolves
asynchronously and takes one object:

- `schema()` — one entry per row: `{ key, group, field, type, title, default, main, options? }`, in manifest order.
- `config()` — every row's current value, by key.
- `get({ key })`, `set({ key, value, scope? })` — one row; `set` validates by the group's rules, writes
  `junkd.<key>` through `$.config`, applies it (flag files included) and resolves to the stored value.
- `open({ pane, route? })` — toggle a pane: `junkd` (the whole set), `handoff` (`route` `auto`, `handoffs` or
  `settings` opens on that tab, or switches to it while the pane is up), `orch`, `tools` (`route` `agents`,
  `tools`, `mcp` or `skills`, the same way). Each pane takes its own routes only: `open({ pane: 'handoff', route:
  'mcp' })` is `junkd: no tab mcp`. While `tools_enabled` is off, `open({ pane: 'tools' })` rejects with the reason.
- `handoffStatus()` — `{ armed, percent, phase }` of the auto handoff loop.
- `orchGuardState()` — `{ active, model }`: whether the main-loop guard holds right now, and the model it judged.

A refused call rejects with the reason: `junkd: no setting <key>`, `junkd: scope <s> is not supported yet`,
`junkd: no pane <pane>`, `junkd: no tab <route>`, or the group's own refusal of a value. The per-feature sections
below detail each group's part.

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

**Turn the step off.** Set `core_output_style` to `off` in `/config` or in the junkd pane (`ste` is the
default). The shell hook reads the row where Claude Code stores it (`pluginConfigs` in `settings.json`, the first
`junkd@` entry), and the hooks module also mirrors it into the flag file `~/.claude/junkd/output-style-off`, at
every write of the row and at session start, so the step is off from the first session on. The row in
`settings.json` wins when it names a value (a hand edit from `off` to `ste` applies at the next session start);
the flag file only stands in where it names none. While it is off no stamp is written, so `ste` again applies
the step at the next session start. The step needs `jq`; without it nothing is written and nothing is stamped.
Removing the plugin stops the step too; a `junkd:STE` already in `settings.json` then names a style that is
gone, so pick another with `/output-style`.

## Prompt-cache check (Claude Code only)

At every main session start (a new session, `/clear`, a resume; not a compaction, not a subagent) the hooks module
(`hooks/cache.tsx`) runs `scripts/cache-check.sh <N> <project folder>` in the background. The project folder is the
one the session's transcript is in, `~/.claude/projects/<project>/`. The script reads the usage lines of the newest
N main transcripts there that hold a request (the new session's own file has none yet) and of their subagents
(`<session>/subagents/agent-*.jsonl`). A message written as several streaming lines counts once (by its message
id). It prints one suggestion line when a threshold is hit, else nothing:

- **Subagent hit ratio under 60%, over at least 50 subagent requests.** The hit ratio is cache read / (cache read +
  cache write + input). The line suggests to reuse implementers with `SendMessage` instead of spawning new ones.
  Under 50 requests nothing is said: the first request of every agent is nearly all cache write and pulls the
  ratio down by itself.
- **Over 30% of main requests came 5–60 min after the previous one** (more than 300 s, at most 3600 s, in the same
  session), counted over the main requests that follow one on the 5-minute cache TTL (a request that wrote 1-hour
  cache has the long TTL already). The line says a 1-hour cache TTL would pay off. When both are hit, the subagent
  line is the one shown.

The line is drawn in a band above the prompt, bold and in the theme's warning colour, with a `✕` button that
dismisses it; the next session start's check replaces it (or clears it, when that check finds nothing). A
transcript over 50 MB is read from its last 50 MB only. The script caps itself at 3 s: it runs itself again in a
process group of its own that a `perl` alarm kills whole (macOS has no `timeout`); a killed run prints nothing and
exits 142. Without `jq` it prints nothing. A run that fails (a non-zero exit, a run that cannot start) goes to the
debug log (`junkd cache check: …`) and draws nothing; nothing reaches the model.

| Key | Type | Default | What it does |
|---|---|---|---|
| `core_cache_check_sessions` | number | `10` | How many of the project's newest sessions the check reads: a whole number 0–30; `0` turns the check off |

It is a `main` row of the core group: the /junkd pane's Settings draws it as a number field, and `/config` has it
as `junkd.core_cache_check_sessions`. A write (the pane, `/config`, `$.junkd.set`) of anything but a whole number
0–30 is refused. The stored option (a hand edit of `settings.json`) is clamped to 0–30 and rounded at load; the
manifest row carries no `min` or `max`, so an out-of-range value never stops the module from loading. Claude Code
does hold the option to the row's type: a string there stops the module from loading.

`tests/cache-check.sh` (run by `tests/smoke.sh`) covers the script over fixture transcripts: both lines, their
bounds, the nothing cases, the one count per message id, the 50 MB tail read and the 3 s cap.

## handoff

Codex: `$handoff` saves, `$handon <id>` (or `$handoff resume <id>`) restores. Kimi Code: `/skill:handoff` and
`/skill:handon <id>`. Under `codex exec -s workspace-write`, add `--add-dir "${CODEX_HOME:-$HOME/.codex}/junk-drawer"`
or saving a handoff is refused (the folder is outside the workspace). OpenCode: `/handoff` and `/handon <id>` through the generated wrappers, or "use the handon
skill". Each host keeps its handoffs apart (see [Hosts and data roots](#hosts-and-data-roots)); Claude Code retains
the paths below.

Save the state of a session to disk and pick it up in a fresh one — by id, not copy-paste.

- **`/junkd:handoff`** — writes a handoff to `~/.claude/handoffs/<date>_<id>.md`, prints a short session id and copies it to your clipboard.
- **`/junkd:handon <id>`** — in a new session, loads that handoff as context. No id → loads the newest.

Both are skills of the junkd plugin (`skills/handoff`, `skills/handon`); there are no separate command
files. A skills-only install (`npx skills add Krab00/junk-drawer`) has no plugin namespace, so there the
same skills answer as `handoff` and `handon`: `handon` takes the same optional id and runs its own
`bin/handoff-load`, a byte-identical copy of handoff's (kept so by `tests/smoke.sh`), so it works on a host that
drops symlinks.

The short id is 8 hex characters. On Claude Code it is the start of the session id (a UUIDv4, random from the first
character); every other host hashes its session id (a Codex thread id is a UUIDv7, whose start is a timestamp), or,
with none, the time, the pid and random numbers. `handoff-load` with a fragment that matches several handoffs lists
their ids and titles and exits 1 instead of guessing; a whole id loads the newest handoff with exactly that id.

Files live in `~/.claude/handoffs/` (`$CLAUDE_CONFIG_DIR/handoffs/` when that is set; outside the plugin
cache, so they survive updates). The folder did not move with the plugin: handoffs saved before junkd
took handoff over are listed and loaded as before. The date + id in each filename make old handoffs
greppable.

Session id comes from `$CLAUDE_CODE_SESSION_ID`. The helpers are `skills/handoff/bin/handoff-path` and
`handoff-load`, also reachable as `bin/handoff-path` and `bin/handoff-load` at the plugin root.

### Auto handoff and panel (Claude Code only)

The junkd hooks module (`hooks/handoff.tsx`, composed by `hooks/index.tsx`) adds three arguments to
`/junkd:handoff` and, while the loop is armed, resumes a turn that died on the 5h rate limit (below).
Bare `/junkd:handoff` with no argument still saves a handoff as above.

- **`/junkd:handoff auto [prompt]`**: arm the loop and open the pane on the Auto tab. The optional prompt
  is the task to run right now (`/junkd:orch all` runs as a command); without one the loop is only armed.
- **`/junkd:handoff off`**: disarm the loop.
- **`/junkd:handoff panel`**: open the pane, or close it when it is open.
- **`/junkd:ahandoff [prompt] | off | panel`**: the short form of the three above, without the pane
  (`/junkd:ahandoff /junkd:orch all` arms the loop and runs the command). It is a skill
  (`skills/ahandoff`) whose text only runs when the hooks module is not loaded: it then tells you to run
  `/reload-plugins` after enabling `junkd@junk-drawer` (on other hosts, that the loop is a Claude Code
  mod feature).

Loop: every `checkEvery` tool calls the hook reads context usage. Past `threshold` it denies every tool
except the handoff itself and tells the model to call the `junkd:handoff` skill and write one. When that
turn ends it runs `/clear`, then `/junkd:handon <id>`, then sends the continuation prompt — `Continue
after the handoff` unless you change it with `p` on the Auto tab (a `/command` runs as a command). It
repeats until `/junkd:handoff off`. A fresh window that already starts at or over the threshold hands off
again after that many more points of growth.

#### Resume after the 5h rate limit

An armed loop also survives the 5-hour rate limit. When a turn dies with the window at 100%, the mod
sets one timer for 2 minutes after the window resets (the host reports the reset time with every
measurement) and sends the continuation prompt then — your `/junkd:ahandoff` prompt, or `Continue
where the rate limit stopped you`. No handoff is needed: the session keeps its context. The segment
shows `🪃 limit → 14:32` meanwhile. There is no recurring timer: the next limit hit schedules the next
resume. `/junkd:ahandoff off` or the `handoff_resumeAfterLimit` setting (`l` on the Settings tab) turns
it off. The timer lives in the running session; after a restart you only get a toast that a resume was
pending (re-arm with `/junkd:ahandoff`).

#### Status line segment

The prompt line shows `🪃 72%` beside `✚ junkd`: context usage, green below the threshold, yellow within
10 points of it, red past it. It shows `🪃 off` while the loop is disarmed and `🪃 handoff…` /
`🪃 resume…` while a handoff is in flight. Clicking the segment opens or closes the pane. Turn it off
with the `handoff_segment` setting.

#### Pane

Tabs switch with `1`, `2` and `3`. `q` closes the pane. `/junkd` opens it as a tab beside the junkd and
orch panes; it also opens on its own (`/junkd:handoff panel`, the segment).

| Tab | Shows | Keys |
|---|---|---|
| 1 Auto | Armed or off, a context bar against the threshold, the continuation prompt, the last handoff and this session's handoffs | `a` arm or `o` off, `p` set prompt, `n` handoff now, `r` resume last |
| 2 Handoffs | Every file in `~/.claude/handoffs`, newest first, with id, time and title; stale ones in yellow | `j`/`k` move, `enter` handon, `v` view (`b` back), `c` copy id, `x` delete (press twice), `f` filter, `m` show more, `n` save now |
| 3 Settings | The settings below, the handoffs folder and its file count, the version | `u` enabled, `t` threshold, `e` check every, `s` arm at start, `l` resume after 5h limit, `a` stale days, `d` delete stale, `o` open folder, `g` segment |

#### Settings

Set them in the Settings tab, in the junkd pane (`/junkd`, the main rows), or in `/config` under plugin
`junkd`. Each is a `userConfig` row of junkd keyed `handoff_<field>`; its `/config` row is
`junkd.handoff_<field>`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `handoff_enabled` | boolean | `true` | The auto handoff at all. Off: the loop cannot be armed (`/junkd:ahandoff` and `/junkd:handoff auto` say so, `handoff_autoOn` is ignored, an armed loop disarms at once and a pending 5h-limit resume is dropped) and the `🪃` segment is hidden. `/junkd:handoff`, `/junkd:handon` and the pane keep working |
| `handoff_threshold` | number | `85` | Context usage in percent that triggers the handoff; above 0, up to 100 |
| `handoff_checkEvery` | number | `5` | How often, in tool calls, usage is read mid-turn; a whole number, 1 or more (`2.6` is refused, not rounded) |
| `handoff_autoOn` | boolean | `false` | Arm the loop at every session start |
| `handoff_resumeAfterLimit` | boolean | `true` | Send the continuation prompt 2 minutes after the 5h window resets when a turn died on the limit |
| `handoff_staleDays` | number | `30` | Handoffs older than this are marked stale and removed by `d`; above 0 |
| `handoff_segment` | boolean | `true` | Show the `🪃` segment in the prompt line |

A value outside these is refused by `$.junkd.set` and the `/config` menu alike (the Settings tab is
stricter still: whole numbers); a write from either applies at once. A boolean takes `true`, `'true'` and
`'on'` as on, anything else as off. A refused option at load falls back to its default. Scope:
user-global; project/session overrides: planned.

`ctx-limit` stays a separate, manual safeguard.

#### API for other plugins

The junkd hooks module adds `$.junkd` to the engine's `$`, so another mod calls it instead of reading
junkd's files. The host builds a noun as one flat object of methods, hands each method one input and
answers every call asynchronously. List `junkd` under `dependencies` in your plugin.json and the engine
lays its contract (`types/index.d.ts`, exported as `Junkd`) beside the API reference, typed. The handoff
parts of it:

- `schema()` — one entry per setting of every group: `{ key, group, field, type, title, default, main }`;
  handoff's are the rows with `group: 'handoff'` (`key` `handoff_<field>`); `main` marks
  `handoff_enabled`, `handoff_threshold`, `handoff_autoOn`, `handoff_resumeAfterLimit` and
  `handoff_segment`, the five the junkd pane shows (`handoff_enabled` leads).
- `get({ key })` — the current value of a setting (the `/config` row at load, then every write).
- `config()` — every row's current value, by key.
- `set({ key, value, scope? })` — writes `junkd.<key>` through `$.config` and resolves to the stored
  value; refused (`junkd: no setting <key>`, a value that does not fit, a `config.set` hook's deny) it
  rejects with the reason. `scope` takes only `user` today (`junkd: scope <s> is not supported yet`).
- `open({ pane: 'handoff', route? })` — the same path as `/junkd:handoff panel` and the 🪃 click: toggles
  the pane; with a route (`auto`, `handoffs`, `settings`) it opens on that tab, or switches the tab while
  the pane is up. An unknown route is refused with `junkd: no tab <route>`, an unknown pane with
  `junkd: no pane <pane>`.
- `handoffStatus()` — `{ armed, percent, phase }` of the auto loop.

The former `$.handoff.show` and `hide` are gone from the API: the `/junkd` set of panes opens and closes
the handoff pane inside the module, and closes it with the set only while it is still the one the set
opened (any other open or close since, the person's included, makes it the person's).

Can a mod read junkd's `$.config` rows? Yes. There is no `$.config.get`; `$.config.list()` returns every
row of the `/config` menu, the engine's own and each enabled plugin's `userConfig` fields alike, keyed
`<plugin>.<field>` with its current `value`, `kind`, owner and lock, so a mod reads
`junkd.handoff_threshold` by finding that row (a row a `config.describe` hook hides is left out, a
managed one shows `isLocked`). Writing works the same way:
`$.config.set({ key: 'junkd.handoff_threshold', value })` changes the row as the person would in the
menu, through the plugins' hooks, which may deny it. `$.junkd.get` and `set` are the typed, validated
shortcut over those rows, nothing more.

### Support per harness

| | `/junkd:handoff` | `/junkd:handon` | `/junkd:handoff auto`, `/junkd:ahandoff` |
|---|---|---|---|
| Claude Code | yes | yes | yes |
| Codex | `$handoff` | `$handon <id>` | no (manual) |
| Kimi Code | `/skill:handoff` | `/skill:handon <id>` | no (manual) |
| OpenCode | `/handoff` (wrapper) or the skill | `/handon <id>` (wrapper) or the skill | no (manual) |

## orch

Part of the **junkd** plugin. Claude Code: `/junkd:orch-init` once per repository, then `/junkd:orch` with a
task id, free text, `batch`, `chain`, or `all`. Codex: install the plugin, open a new task, run `$orch-init`,
then `$orch` the same way. Kimi Code: `/skill:orch-init`, then `/skill:orch`. OpenCode: `/orch-init`, then `/orch`
(the generated wrappers), or "use the orch skill". Every host shares `.orch/config.md`, task files, worktrees, and
helper scripts.

A **project-agnostic orchestration loop** for Claude Code. Point it at a repo, and it picks tasks
from a canonical store, delegates each to an `implementer` subagent, verifies **every acceptance
criterion against real tool evidence** (not the implementer's word) through a `verify-coordinator`,
round-caps the fix loop, and opens **draft PRs** — while keeping the base branch untouchable and
the heavy build/test/screenshot output out of the orchestrator's own context.

It's a portable extraction of a loop proven on a real product backlog. Every project fact (task
backend, branch naming, dev-server commands, ports, test runners) comes from one config file, so
the same loop fits any stack.

**Docs:** this page is the cheatsheet; the long-form companion — the why, the loop end to end, the
subagents, backends, and config reference — is in [`orch-guide.md`](docs/orch-guide.md)
([HTML](docs/orch-guide.html)).

### Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install junkd@junk-drawer
```

Then, **in the target repo**, generate the adapter once:

```
/junkd:orch-init
```

### Config = the adapter

`/junkd:orch-init` scans the repo and writes `.orch/config.md`. The orchestrator uses it as the primary
config and accepts legacy `.claude/orch.config.md` as a fallback. **No config, no run.** The `capabilities` block **gates**
the checks: declare `web`, `api`, `tests` for exactly the layers you have, and the loop verifies
only those (no api → the malformed-body check is skipped; no web → no browser review; no test
runner → build + behaviour checks stand in).

```markdown
---
backend: adhoc            # adhoc | manifest | github-issues | linear-mcp
tasks_dir: .orch/tasks    # canonical task files live here
default_base: main        # detected git default branch; --base overrides it
branch_prefix: task/      # per-task branch = <branch_prefix><id>-<slug>
capabilities:
  web:  { run: "npm run dev", port_base: 5180, health: "/" }        # omit if no web app
  api:  { run: "npm run start:dev", port_base: 3180, health: "/health" }  # omit if none
  tests: { api: "npm test" }  # use `root` for a repo-level suite; omit absent runners
standing_checks_extra: []     # project lessons promoted to standing checks
github: { label: "orch" }     # github-issues backend only
---
Free-form project notes the orchestrator should know (conventions, gotchas, the visual spec path,
calibration values that must never be guessed).
```

### Modes

| Command | What it does |
|---|---|
| `/junkd:orch <free text>` | **Adhoc single task** — create a task file from the prompt, freeze criteria interactively, then the loop |
| `/junkd:orch <ID> [<ID>…]` | Run explicit tasks from the store |
| `/junkd:orch batch [N]` | Up to N independent tasks in **parallel** (default N=3) |
| `/junkd:orch chain [N]` | Task-by-task, each branch **stacked** on the previous |
| `/junkd:orch all` | Drain the backlog (chain until no `todo` remains) |

Flags (any mode): `--rounds R` (fix-loop cap, default the `rounds` setting) · `--base <branch>` · `--deep` (fan-out a
big task via `lead-implementer`) · `--single-pr[=<branch>]` (one integration branch + one draft PR
for the whole run).

### How a task is driven

1. **Freeze the criteria** before any code: copy a structured DoD / checklist verbatim, else derive
   tool-checkable, traceable criteria (autonomous runs mark them `derived` for review; too-thin
   descriptions go `blocked` with a question — never implemented on vibes).
2. **Implement** on an isolated task branch (`implementer`, or `lead-implementer` for a big task
   that cuts into file-disjoint slices behind a frozen contract).
3. **Verify** the whole task via `verify-coordinator` — it builds the env, spawns `test-planner`
   (diff → mandatory matrix), `ui-reviewer` (browser criteria) and `test-reviewer` (test quality),
   runs the standing checks, and returns one merged verdict. **No PASS without tool evidence.**
4. **Resolve:** all-PASS → `done` + draft PR; any FAIL → fix loop, capped at `--rounds`. Round 1
   builds, middle rounds re-run the same implementer on only the failing criteria, the **final
   round hands a FRESH implementer the diff + a why-it-keeps-failing analysis**; still failing →
   `blocked` and escalated.
5. **Retro:** a resolve with a signal (a fix round, a surviving mutant, a PM-REVIEW that found a bug,
   a dead or stalled agent, a verify FAIL) adds a lesson to `_lessons.md`; a clean round-0 PASS adds
   none. A lesson is promoted toward a test, a standing check, a role file or a wider store, and
   `standing_checks_extra` is never edited without your yes (see `## lessons`).

The base branch is untouchable throughout: all work lands on task branches in worktrees, only draft
PRs are opened, and **humans merge**.

### Autonomous drain

`/junkd:orch` ends every run with exactly one machine-readable line:

```
BACKLOG: DRAINED   — no todo tasks remain
BACKLOG: REMAINING — <count> (<ids>); resume: /junkd:orch <mode> [N] --base <last-finished-branch>
BACKLOG: BLOCKED   — remaining tasks need a human: <ids + reasons>
```

Drive a full drain with **`/loop /junkd:orch all`** — it keys off this line and stops on `DRAINED` or
`BLOCKED`.

### Backends

| Backend | Sync behaviour |
|---|---|
| `adhoc` | No tracker; task files are the whole source of truth (`/junkd:orch <free text>` creates them) |
| `manifest` | Same, but you maintain the task files by hand |
| `github-issues` | Pull labelled issues → task files, push a status comment back (needs `gh`) |
| `linear-mcp` | Pull/push via the Linear MCP **in-conversation** — thin in v0.1 (see limitations) |

### Agents

Each agent pins its model in its frontmatter; spawn them without `model:` and they run on it. Pass
a different model only when the user asked for it.

| Agent | Model | Job |
|---|---|---|
| `orch-ops` | haiku | runs the bin scripts, git, gh and jq reads for the orchestrator; one line back, output in a report file |
| `implementer` | opus | builds one task (or one file-disjoint slice of it) on its own branch in its own worktree, with tests and a mutant sweep |
| `lead-implementer` | opus | one big task: freezes the shared contract, fans out to parallel `implementer` slices, merges them back, runs the final gate |
| `verify-coordinator` | opus | the whole verification of one task: builds the verify env, runs the inline checks, spawns the three reviewers, writes the verdict table |
| `test-planner` | sonnet | derives the mandatory test matrix from the diff (happy + edge rows with real induction recipes) |
| `ui-reviewer` | sonnet | drives the browser (chrome-devtools MCP, agent-browser, playwright MCP, agent-device: first found), a screenshot per UI criterion |
| `test-reviewer` | sonnet | audits the tests a change ships: real assertions, coverage of the change, no over-mocking; `OK` or `GAPS` |

On Claude Code each is the agent type `junkd:<role>` (`junkd:implementer`, …). The real files live in
`skills/orch/roles/`; `agents/` at the plugin root is a symlink to them (see the layout note in the repo
README).

### Orchestrator rules, injected at session start

`skills/orch/ORCHESTRATOR.md` is the rule sheet for the main session: on Fable the main loop only
plans and delegates (no tool use of its own, git and the bin scripts through `orch-ops`, one-line
agent results, no agent chatter in the transcript); on Opus the same rules apply only when the user
asks for orchestrator mode; other models work inline. `hooks/hooks.json` registers
`scripts/orch-context.sh` as a `SessionStart` hook that prints the sheet into the context of the
main session only:

- a subagent never gets it: the hook exits silently when `CLAUDE_AGENT_ID` is set or the hook
  input carries an `agent_id`;
- `ORCH_INJECT_RULES=0` in the environment turns the injection off, and so do the `orch_enabled` and
  `orch_inject_rules` settings below. The hook reads them from `settings.json` itself (`pluginConfigs`,
  the first `junkd@` entry, `.options.orch_enabled` and `.options.orch_inject_rules`; it runs before the
  hooks module at a session start): `true` goes on, any other value skips. Only for a setting with no
  value there (or without `jq`) does its flag file decide, `~/.claude/junkd/orch-off` or
  `~/.claude/junkd/orch-rules-off` (under `CLAUDE_CONFIG_DIR` when set), which the hooks module writes
  while the setting is off;
- the hook always exits 0, so a missing sheet never blocks a session. It is reached through links
  (`scripts/` → `skills/junkd/scripts/`, whose `orch-context.sh` links to `../../orch/scripts/`) and
  follows them to find the sheet beside the real file.

`tests/orch.sh` (run by `tests/smoke.sh`) covers the hook, the agent records hook, the agent roster and the bin scripts.

### The CLAUDE.md pointer block (`orch_claude_md`)

Since the plugin prints the rule sheet itself, a global `CLAUDE.md` that still carries its own
`## Orchestrator mode` section holds the rules twice. The `orch_claude_md` switch (off by default) hands that
section over to the plugin. `scripts/orch-claude-md.sh on|off` works on `~/.claude/CLAUDE.md`
(`$CLAUDE_CONFIG_DIR/CLAUDE.md` when set):

- **on** replaces the `## Orchestrator mode` section (the H2 and its `###` children, up to the next `#` or `##`
  heading) with this block:

  ```markdown
  <!-- junkd:orch start -->
  ## Orchestrator mode
  The junkd plugin prints the orchestrator rules at session start; full text and settings: `/junkd:orch`.
  <!-- junkd:orch end -->
  ```

  A file with neither the section nor the block is left alone; a block already there is written afresh.
- **off** removes the block and the one blank line after it, and nothing else. No block: nothing happens.
  **Off never puts the original section back: the backup does.**

Each change first copies the file to `CLAUDE.md.bak-<date>-<time>-XXXX` beside it; a run that changes nothing
writes nothing and makes no backup. The script never creates `CLAUDE.md` and writes through a symlink to the
real file. Headings and markers inside a ```` ``` ```` or `~~~` fence do not count. A start marker with no end
marker, or (on) a fence left open inside the section, is refused (exit 1) with nothing written. A CRLF file
gets a CRLF block.

It runs at once when the setting is flipped (the pane, `/config`, `$.junkd.set`; the change or the refusal is a
toast), and again at every session start from `scripts/setup.sh`, which reads `orch_claude_md` and
`orch_enabled` from `settings.json` (the first `junkd@` entry of `pluginConfigs`): on while `orch_claude_md` is
`true`, off otherwise. Neither runs while `orch_enabled` is off (or, where the entry names no `orch_enabled`,
while `junkd/orch-off` is there), nor while `settings.json` is missing or does not parse. `tests/claude-md.sh`
(run by `tests/smoke.sh`) covers both modes and the session-start run.

### The main-loop guard (Claude Code only)

`hooks/orch.tsx` is orch's part of junkd's hooks module (`hooks/index.tsx`). On a Fable main loop the rule
sheet says "plan and delegate"; the guard enforces it. It checks the main loop's own tool calls only: a
subagent's calls and another plugin's `$.tool.call` always go through. With `orch_enabled` off there is no
guard at all (every call and spawn passes). Otherwise the `orch_guard` setting says when it is active:

- `fable` (default): while the main-loop model is a Fable. The model is read live, so a `/model`
  switch counts at once (to Opus: the guard is off; back to Fable: on again). A model that cannot
  be read is no Fable: the guard fails open and says so once per session.
- `always`: on every model.
- `off`: never.

Every denial starts with `Orchestrator mode (orch):` and says what to do instead.

| Tool | The main loop may use it… |
|---|---|
| `ListAgents`, `TaskStop`, `AskUserQuestion`, `ToolSearch`, `Skill`, `CronList`, `CronDelete`, `EnterPlanMode`, `ExitPlanMode`, `PushNotification`, `RemoteTrigger` | always |
| `Agent` | with `model: opus\|sonnet\|haiku`, or as a `junkd:` agent type with no `model` (theirs is pinned). Never as a fork or with `inherit`. With a Fable model only when `allow_fable_agents` is on. An `agent.spawn` hook checks the resolved model again (a fork, `inherit`, or no model on a non-`junkd:` type would run on the main loop's model). |
| `SendMessage` | except to a reviewer (`verify-coordinator`, `ui-reviewer`, `test-planner`, `test-reviewer`, bare or `junkd:`: spawn a new one), to an agent past `implementer_ctx_k` k tokens of context, or to an agent nobody knows. A stopped agent is known by its `SubagentStop` record (see [Agent records](#agent-records)): its type and the context tokens of its transcript's last usage record, by id and by name. |
| `Read` | in the session scratchpad, the repo's task store `<repo>/.orch/` (`<repo>` = git's toplevel of the session's cwd; none outside a repo) and, in the config dir (`$CLAUDE_CONFIG_DIR`, else `~/.claude`), `orch/`, `handoffs/` and `projects/*/memory/`. The path must be a plain absolute ASCII path (no `~`, no relative path, no surrounding spaces, no non-ASCII letters) with no `..` segment; symlinks and case aliases are resolved first and where it lands must pass too, and a path that cannot be placed is denied. |
| `Write` | in the same places as `Read`, except that in the task store only a `.md` file (task files, `_lessons.md`) and never an existing `.orch/config.md` (its `tasks_dir` steers the bin scripts; a new one passes as any new `.md` does), or to a new `.md` file. Never a path with a `..` segment, never to settings, Claude Code config (`CLAUDE.md`, `AGENTS.md`, `SKILL.md`, anything in a `.claude/` dir, any plugin's `agents`, `commands`, `skills`, `hooks`, `rules`, `output-styles`, a `.claude-plugin/` dir), the module's own control files `junkd/orch-off` and `junkd/orch-rules-off` (or any path under those names), the agent records `junkd/orch/_agents/` (any case, any path under it) or this plugin. The path must be a plain absolute ASCII path; symlinks and case aliases are resolved first, and a path that cannot be placed (a link to nothing, a folder that does not resolve) is denied. |
| `Bash`, `Monitor` | only to run one of this plugin's own `bin/` scripts, by its path under the plugin root, with plain arguments (no quotes, `$`, backticks, `;`, `&`, `\|`, `<`, `>`) |
| `CronCreate`, `ScheduleWakeup` | only to schedule `/junkd:orch` (or bare `/orch`), `/loop` of an allowed prompt, or a plain prompt, or to stop one |
| anything else (`Edit`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `LSP`, MCP tools, …) | never |

If the guard itself throws, the call is denied (`Orchestrator mode (orch): guard error`). Known
gaps: a `context: fork` skill raises no spawn event, so the guard never sees it; a plugin loaded
from outside a `plugins/` path is not covered by the Write rule. The exact rules are in
`hooks/orch-lib.ts`, the tests in `hooks/orch.test.tsx` (`claude plugin test plugins/junkd`).

#### Agent records

`hooks/hooks.json` registers `scripts/orch-agent-stop.sh` (real file in `skills/orch/scripts/`) as a
`SubagentStop` hook. At every subagent stop it writes the agent's record,
`{"type":"<agent type>","tokens":<n>}`, to
`~/.claude/junkd/orch/_agents/<session id>/<agent id>.json` (under `CLAUDE_CONFIG_DIR` when set), and the same
record to `<name>.json` beside it for a named agent (the name from the `.meta.json` beside its transcript).
`tokens` is the input + cache-write + cache-read tokens of the last usage record in the agent's transcript (its
last iteration when that request ran server tools), `null` when there is none. A session id, agent id or name
that is not plain (`[A-Za-z0-9_-]+`) is ignored, so a record never lands outside its folder. The hook reads
`orch_enabled` and `orch_guard` from `settings.json` (the first `junkd@` entry): with `orch_enabled` anything but
`true`, or `orch_guard` `off`, it writes nothing; no file, no entry or no key counts as on. It always exits 0.

The `SendMessage` rule reads the target's record file first (this session's folder, by the agent's id, or by
the name used when the agent list does not know it) and falls back to what the module itself kept at the
`SubagentStop`. So the context cap still holds after `/reload-plugins`, which empties the module's memory. The
main loop may not write into `junkd/orch/_agents/`. Records are never pruned: each is under 100 bytes, and old
session folders can be removed by hand.

##### Notes on the rules

- **Always allowed:** `advisor` is not on the list, so it is denied. It runs on the server and raises no
  tool call, so nothing changes in practice.
- **`ScheduleWakeup`:** not on the always-allowed list. The `CronCreate` row holds for it: only
  `/junkd:orch`, `/loop` of an allowed prompt, a plain prompt, or a stop.
- **`SendMessage`:** `test-planner` and `test-reviewer` count as reviewers, so they are spawned fresh
  every time and never messaged. The record file on disk is read first, and the module's own
  `SubagentStop` record is the fallback.
- **`Read`, `Write`:** the task store `<repo>/.orch/` is a root of its own. Writes there take a `.md`
  only and never an existing `config.md`. The config dir's `orch/` stays a root for scratch state.
- **`Write`:** refuses anything in any `.claude/` dir, the records folder `junkd/orch/_agents/`, and
  the control files `junkd/orch-off` and `junkd/orch-rules-off` (and any path under them).
- **`Bash`, `Monitor`:** the script name may not hold a `/`, so a `..` cannot lead out of `bin/`. No
  separate `..` check is needed.

#### Settings

`/junkd:orch panel` toggles the pane: one Settings tab with the fifteen rows (`tab` moves, `enter` saves a
field, a letter flips a switch or focuses a field, the guard's options are buttons, `q` closes) and the
`dashboard: open ▸` line, which opens [the dashboard](#dashboard) as `/junkd:dashboard` does.
The same rows are in `/config` under plugin `junkd` (`junkd.orch_<field>`), and the first four,
`orch_claude_md` and `orch_lessons` in the /junkd pane.

| Key | Type | Default | What it does |
|---|---|---|---|
| `orch_enabled` | boolean | `true` | Off: no main-loop guard and no rule sheet at session start, whatever `orch_guard` and `orch_inject_rules` say (the flag file `junkd/orch-off` while off); `/junkd:orch` and its pane still work |
| `orch_guard` | string (`fable`, `always`, `off`) | `fable` | When the guard holds the main loop: on a Fable model, always, or never |
| `orch_allow_fable_agents` | boolean | `false` | Let the main loop spawn a subagent on an explicit Fable model (the user asked) |
| `orch_implementer_ctx_k` | number | `400` | Reuse an implementer for a fix round only while its context is under this many k tokens (50–1000) |
| `orch_ui_review` | boolean | `true` | Run `ui-reviewer` on the UI criteria when the config declares `web`; off, they are `PM-REVIEW` rows |
| `orch_inject_rules` | boolean | `true` | Print `ORCHESTRATOR.md` into the main session at start (the flag file `junkd/orch-rules-off` while off) |
| `orch_rounds` | number | `3` | Fix rounds per task; `--rounds` overrides it for one run (1–10) |
| `orch_claude_md` | boolean | `false` | On: the `## Orchestrator mode` section of `~/.claude/CLAUDE.md` becomes the `junkd:orch` pointer block; off: the block is removed (the original section only from the backup). Runs at once and at every session start while `orch_enabled` is on; see [the CLAUDE.md pointer block](#the-claudemd-pointer-block-orch_claude_md) |
| `orch_dashboard_refresh` | number | `30` | While [the dashboard](#dashboard) is open, write its `status.js` again every N seconds (5–600, clamped and rounded) |
| `orch_dashboard_window_h` | number | `24` | The hours the dashboard's timeline shows, ending now (1–168, clamped and rounded) |
| `orch_watchdog` | boolean | `true` | The [agent watchdog](#watchdog) as a whole; off (or `orch_enabled` off): no timer, no alarms |
| `orch_idle_stop` | boolean | `true` | The watchdog stops idle leftovers; off: it reports them only |
| `orch_idle_stop_minutes` | number | `10` | Idle minutes before a finished agent with no task in progress is stopped (1–120) |
| `orch_stall_minutes` | number | `15` | Minutes without a tool call before a running agent counts as stalled; a reviewer gets 5 more (1–120) |
| `orch_lessons` | boolean | `true` | The [lessons loop](#lessons): injection by stack, the lessons tab, 📒 and the blocking dialog; off: none of them (the flag file `junkd/orch-lessons-off` while off) |

Scope: user-global; project/session overrides: planned.

A value that does not fit (a guard word other than the three, a number out of range or not whole)
is refused on every write path: the pane, `$.junkd.set` and the `/config` menu alike; a switch takes
`true`, `'true'` or `'on'` as on, anything else as off.

#### API for other plugins

orch's settings and pane are on `$.junkd`, the noun junkd's hooks module adds to the engine's `$`, so
another mod calls it instead of reading this plugin's files. The host hands a noun's method one input
and answers every call asynchronously, so each takes one object and returns a promise. List `junkd`
under `dependencies` in your plugin.json and the engine lays its contract (`types/index.d.ts`, exported
as `Junkd`) beside the API reference, typed. The orch part:

- `schema()` — one entry per setting of every group; orch's are `group: 'orch'`, keyed `orch_<field>`:
  `{ key, group, field, type, title, default, main, options? }`; `main` marks `orch_enabled`,
  `orch_guard`, `orch_allow_fable_agents`, `orch_implementer_ctx_k` and `orch_claude_md`; `orch_guard` carries its `options`.
- `get({ key })` — the current value of a setting (`get({ key: 'orch_rounds' })`).
- `set({ key, value, scope? })` — writes `junkd.orch_<field>` through `$.config` and resolves to the
  stored value; refused (unknown key, a value that does not fit, a `config.set` hook's deny) it rejects
  with the reason. `scope` takes only `user` today.
- `open({ pane: 'orch' })` — the same path as `/junkd:orch panel`: toggles the pane (it has no tabs, so
  a `route` is refused).
- `orchGuardState()` — `{ active, model }`: whether the guard holds the main loop right now (never
  while `orch_enabled` is off), and the main-loop model it was judged on.

The former `$.orch.show` and `hide` are gone from the noun: the /junkd set opens and closes the orch pane
inside the module, marked as its own, and leaves it up when the person reopened it since.

The module is Claude-only: Codex and Kimi run the skills, the bin scripts and the SessionStart hook
as before.

### Under the hood

Three zero-dependency scripts carry the deterministic mechanics (frontmatter is the single source
of truth — no separate manifest to drift):

- `bin/orch-state` — task-store CRUD (`list` / `set` / `reset-stale [--blocked]` / `new` /
  `cfg <key>` / `id <id>` / `settings`). `settings` prints `enabled`, `rounds`, `ui_review`,
  `implementer_ctx_k` and `inject_rules` as `/junkd:orch` uses them (read from `settings.json`, the first
  `junkd@` entry's `orch_*` options, clamped like the hooks module).
  All three scripts work on the checkout they run in; from a task worktree (`<project>/.worktrees/<id>`,
  which has no `.orch/`) on the nearest enclosing checkout that has one (`orch-state root` prints it). The config's `tasks_dir` must be a relative path to a folder under the project's `.orch/` (no `..` segment, and its real path, symlinks resolved, below `.orch/`; never `.orch/` itself), or the scripts stop. `list` hides `_lessons.md` and every other `_`-prefixed file (they are
  not tasks) and marks a file without a closed frontmatter block `invalid`; `set` refuses it.
- `bin/orch-worktree` — per-task worktrees under `.worktrees/` (excluded from git status) + stable
  port slots (`port = capability port_base + slot`, registry guarded by a lock for parallel
  verifiers). An existing branch is attached detached, so the implementer's checkout may keep it;
  the config's `default_base` is never accepted as a task branch.
- `bin/orch-sync` — the task-store ⇄ backend bridge.

`bin/` at the plugin root links into `skills/junkd/bin/`, whose entries link to `../../orch/bin/<script>`;
each script finds its siblings beside the path it was called by, so all three run by any of those paths.
On a Fable main loop the guard runs only `<plugin root>/bin/<script>`.

### v0.1 limitations

- **`linear-mcp` is thin** — the sync happens in-conversation through the MCP; `bin/orch-sync` is a
  stub for that backend.
- **No Jira backend** yet.
- The `--single-pr` `batch` integration resolves only *trivial* structural conflicts (keeps both
  sides in registration files); any real logic conflict stops and is reported, never guessed.

## tldr

Part of the `junkd` plugin. Codex: invoke `$tldr`, optionally with a sentence count or `on|off|status`; Kimi
Code: `/skill:tldr`; OpenCode: `/tldr` (the generated wrapper). Codex stores the persistent flag under
`~/.codex/junk-drawer`, Kimi Code under `~/.kimi-code/junk-drawer`, OpenCode under
`${XDG_DATA_HOME:-$HOME/.local/share}/opencode/junk-drawer`; Claude Code keeps its flags under `~/.claude/junkd`.
OpenCode has no hook: `/tldr on` only records the flag there and replies do not change. On Codex the hook runs once
you trust the plugin's hooks, and under `codex exec -s workspace-write` `$tldr on|off` needs
`--add-dir "${CODEX_HOME:-$HOME/.codex}/junk-drawer"` to write the flag.

Two things in one command:

- `/junkd:tldr N` — summarize the last **substantive** reply in at most N sentences (default 3). One-shot. Repeated calls always condense the original reply, never a previous TL;DR.
- `/junkd:tldr on` / `/junkd:tldr off` — keep **every** following reply terse, across **all** sessions, until off.

### Usage

```
/junkd:tldr 2      # last reply in ≤2 sentences
/junkd:tldr        # last reply in ≤3 sentences (the `tldr_sentences` setting on Claude Code)
/junkd:tldr on     # terse mode ON — every reply, all sessions
/junkd:tldr off    # back to normal
/junkd:tldr status # is terse mode currently on or off
```

### How persistent mode works

`/junkd:tldr on` writes a global flag (`~/.claude/junkd/tldr-on`, or `$CLAUDE_CONFIG_DIR/junkd/tldr-on`). A
bundled **UserPromptSubmit hook** (`bin/tldr-hook`) checks that flag every turn and, while set, injects a "be
terse" instruction into context — so the terseness is enforced deterministically each turn. A skill couldn't
guarantee that (skills are model-triggered, not per-turn). `/junkd:tldr off` removes the flag. The flag is global
on purpose: turn it on in one tab, every session with the plugin goes terse.

### Settings

Three rows in `/config` on Claude Code (`userConfig` in the manifest; the `/config` key is `junkd.<row>`):

| Row | Type | Default | Meaning |
|---|---|---|---|
| `tldr_enabled` | boolean | `true` | Off: the per-turn hook prints nothing, whatever terse mode says. `/junkd:tldr N` and `on|off|status` still work |
| `tldr_terse` | boolean | `false` | Terse mode, the same switch as `/junkd:tldr on|off` |
| `tldr_sentences` | number | `3` | How many sentences a `/junkd:tldr` without a number may use (a whole number, 1 or more) |

Scope: user-global; project/session overrides: planned.

`tldr_sentences` applies on Claude Code through the hooks module: a `/junkd:tldr` with no argument reaches the
skill with the setting as its number. Other hosts run the markdown alone and keep its default of 3.

The junkd pane (`/junkd`, or ✚ junkd under the prompt) shows the three rows in its tldr group.

**The flag files are the shell-side truth.** The per-turn hook is a shell script, and a shell hook cannot read
`$.config`, so two files under `~/.claude/junkd/` (or `$CLAUDE_CONFIG_DIR/junkd/`) stand in for the rows:

- `tldr-on` decides terse mode. Flipping `tldr_terse` in `/config` or through `$.junkd.set` writes the row *and*
  the flag file (the file first; a row that is refused puts the file back); `/junkd:tldr on|off` writes the flag
  file only. When the two disagree the file wins: `$.junkd.get({ key: 'tldr_terse' })` answers from the file, and
  the next write puts both back in step. A hand edit of `tldr_terse` in settings.json writes the row only: it takes
  effect at the next write through `/config` or `$.junkd.set`.
- `tldr-off` mirrors `tldr_enabled`: there while it is off, removed while it is on. The hooks module writes it at
  every write of the row (`$.junkd.set` and `/config`, the file first as above) and at every session start. The
  hook reads `tldr_enabled` from settings.json itself first (`pluginConfigs`, the first entry whose key starts
  with `junkd@`, `.options.tldr_enabled`), so a hand edit there counts at once; only where that names no value,
  or `jq` is missing, or the file does not parse, the `tldr-off` file decides.

A flag file that cannot be written (or an `rm` that fails) refuses the write: no row is stored, and `set` rejects
with the reason (`tldr: could not write …` / `tldr: could not remove …`).

#### API for other plugins

The hooks module adds `$.junkd` to the engine's `$` (types: `types/index.d.ts`, exported as `Junkd`); the tldr rows
are three of its settings:

- `schema()` — one entry per row of every group: `{ key, group, field, type, title, default, main }`; the tldr
  rows have `group: 'tldr'` and are all `main`.
- `get({ key })` — `tldr_terse` from the flag file, `tldr_enabled` and `tldr_sentences` as last stored (at load,
  then every write).
- `set({ key, value, scope? })` — writes `junkd.<key>` through `$.config` (and, for `tldr_terse` and
  `tldr_enabled`, the flag file) and resolves to the stored value; `true`, `'true'` and `'on'` are a true for the
  two booleans, anything else a false. Refused (unknown key, a value that does not fit, a `config.set` hook's
  deny, a flag file that could not be written) it rejects with the reason. `scope` takes only `user` today.

There is no tldr pane; `/junkd:tldr` stays the command on Claude Code. The module is Claude-only: Codex and Kimi
run the shell hook and `tldr-flag` as before (OpenCode only `tldr-flag`), and `tldr_enabled` does not apply there.

## ctx-limit and ctx-tokens

Two context tools that work on every host. `ctx-tokens` reads how full the context is from the session transcript;
`ctx-limit` sets a context-size limit that a per-prompt hook enforces.

### Usage

```text
/junkd:ctx-limit 300k          # set the limit and turn the guard on (also 400000, 1m)
/junkd:ctx-limit on            # on at the last threshold (300k by default)
/junkd:ctx-limit               # status (also `status`)
/junkd:ctx-limit off           # off
/junkd:ctx-limit action warn   # block | warn | cmd
/junkd:ctx-limit cmd terminal-notifier -message "ctx limit hit"   # the command, and action cmd
/junkd:ctx-tokens              # how full the context is: ctx 61k (61951) | out 562
```

Past the threshold the hook does one of three things:

- **block** (the default): the prompt is refused until you `/clear`, `/junkd:handoff`, or `/junkd:ctx-limit off`.
- **warn**: a warning goes into the context and the prompt runs.
- **cmd**: your command runs with `CTX_TOKENS` and `CTX_LIMIT` in its environment, and the prompt runs.

The guard never blocks its own way out: `/junkd:ctx-limit`, `/junkd:handoff`, `/junkd:handon`, `/junkd:ahandoff`,
`/clear`, `$ctx-limit`, `$handoff`, `/skill:ctx-limit`, `/skill:handoff`, `/skill:handon` and the OpenCode
wrappers `/ctx-limit`, `/handoff`, `/handon` always pass. Whole names only: `/ctx-limiter` or `$handoffs` is
blocked like any prompt.

`ctx-tokens` keeps its CLI: `ctx-tokens` prints the context tokens as a bare number, `-h` the human form,
`<file.jsonl>` reads that transcript, `--codex`, `--kimi`, `--claude` pick the host, `--cwd <dir>` the project.
Without a flag it finds the session of the host `host-lib` detects; the flags override that. "Context" is the last
turn's input side (input + cache creation + cache read): what fills the window.

### Settings

Four rows (`/config` key `junkd.<row>`); the junkd pane shows the first three in its ctx group:

| Row | Type | Default | Meaning |
|---|---|---|---|
| `ctx_enabled` | boolean | `false` | The guard on or off, the same switch as `/junkd:ctx-limit on|off` |
| `ctx_threshold` | number | `300000` | The limit in tokens: a whole number, 1000 or more; `300k` and `1m` are read too |
| `ctx_action` | choice | `block` | `block`, `warn` or `cmd` |
| `ctx_cmd` | string | `''` | The shell command of action `cmd` |

**The files are the shell-side truth.** The hook is a shell script and reads no `$.config`, so three files under
`~/.claude/junkd/` (`$CLAUDE_CONFIG_DIR/junkd/`) stand in for the rows: `ctx-limit-threshold` (there while the
guard is on, holding the limit), `ctx-limit-action`, `ctx-limit-cmd` (none while it is empty). A write to a row,
through `/config`, the pane, `$.junkd.set` or `/junkd:ctx-limit`, writes its file first and then the row; a row
that is refused puts the file back. `ctx_threshold` changes the file only while the guard is on (the row keeps the
number `ctx_enabled` writes). `$.junkd.get` answers from the files, so a change made with the skill's CLI
(`./bin/ctx-limit`) shows there too.

### Hosts

| Host | Command | State files | Hook |
|---|---|---|---|
| Claude Code | `/junkd:ctx-limit`, `/junkd:ctx-tokens` | `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/ctx-limit-*` | `hooks/hooks.json`, UserPromptSubmit; block is exit 2 |
| Codex | `$ctx-limit`, `$ctx-tokens` | `${CODEX_HOME:-$HOME/.codex}/junk-drawer/junkd/ctx-limit-*` | `.codex-plugin/hooks.json`, once you trust it; block is `{"continue": false}` |
| Kimi Code | `/skill:ctx-limit`, `/skill:ctx-tokens` | `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/junkd/ctx-limit-*` | the manifest's `hooks`; block is exit 2 |
| OpenCode | `/ctx-limit`, `/ctx-tokens` (the wrappers) | `${XDG_DATA_HOME:-$HOME/.local/share}/opencode/junk-drawer/junkd/ctx-limit-*` | none: the limit is recorded, not enforced |

On every host but Claude Code the skill runs `./bin/ctx-limit` and `./bin/ctx-tokens` from its own folder, and
`host-lib` tells the host (`JUNK_DRAWER_RUNTIME` overrides). The CLI exits 2 on a host it cannot tell and writes
nothing; the hook exits 0 there, so the guard never blocks on a guess. `on` with no threshold set uses 300000 on
Claude Code and 200000 elsewhere. The hook reads `token_count` events on Codex, `step.end` usage records on Kimi
Code (found from the hook's `session_id`), and the usage blocks of `transcript_path` on Claude Code; no usage
record it knows, and it lets the prompt through. Neither the Codex nor the Kimi transcript layout is a stable API:
the host's own context footer is the stable reference.

## statusline

A colored status line for Claude Code. Segments, separated by a dim `│`:

`ctx` (cyan: context free and used) · `branch` (green) · `⑂worktree` (magenta, only in a linked worktree) · `model`
(bold blue) · `effort` (yellow) · `limits` (the 5h and weekly rate-limit use, green, orange past 50%, red past 80%)

### Usage

```text
/junkd:statusline              # toggle the statusline pane
/junkd:statusline on           # wire it into settings.json (the statusline_enabled row)
/junkd:statusline off          # take it out again
/junkd:statusline status       # on, off, or off (<your own command>), and the segments that are off
```

The status line is on by default: the first session start with junkd copies `bin/statusline.sh` to
`~/.claude/junkd/statusline.sh` and points `statusLine` in `~/.claude/settings.json` at that absolute path (a
plugin path is a versioned cache, and `${CLAUDE_PLUGIN_ROOT}` does not resolve in settings.json). It does so only
where settings.json has no `statusLine` or one that is junkd's. A `statusLine` of your own is never replaced:
turning the row on refuses with the reason (`bin/statusline-setup on --force` from the skill folder replaces it),
and `off` leaves it alone. At every session start, while the row is on, a copy that differs from the plugin's (a
plugin update) is copied again. Every write backs settings.json up to `settings.json.bak`, goes through a symlink
to the real file (temp + `mv`), and never touches a settings.json that does not parse.

### Settings

| Row | Type | Default | Meaning |
|---|---|---|---|
| `statusline_enabled` | boolean | `true` | `statusLine` points at junkd's line: true runs `bin/statusline-setup on`, false `off`; a refusal is the deny and the row stays |
| `statusline_ctx` | boolean | `true` | Draw the context segment |
| `statusline_branch` | boolean | `true` | Draw the git branch |
| `statusline_worktree` | boolean | `true` | Draw the linked worktree's folder |
| `statusline_model` | boolean | `true` | Draw the model's name |
| `statusline_effort` | boolean | `true` | Draw the effort level |
| `statusline_limits` | boolean | `true` | Draw the 5h and weekly rate limits |

The renderer reads the segment rows from settings.json itself at every draw (`pluginConfigs`, the first entry
whose key starts with `junkd@`, its `options.statusline_<segment>`): a missing key, a settings.json that does not
parse, or no `jq` draws the segment. A segment off takes out exactly it and its separator.

The junkd pane shows `statusline_enabled`; its `settings ▸` opens the statusline pane: the enabled switch (`a`), one
switch per segment (`b`–`g`), and a preview of the line for your choice (the renderer run on a sample session:
model "preview", the project folder, 61k of a 200k context used, the rate limits at 12% and 33%; drawn without its
colors). `q` closes it; `$.junkd.open({ pane: 'statusline' })` toggles it.

### Hosts

The line is Claude Code only. Codex: the skill (`$statusline`) proposes the native `[tui].status_line` list in
`config.toml`. Kimi Code: a fixed footer, themes only. OpenCode: no status line to configure (no `/statusline`
wrapper either: `bin/opencode-commands.sh` skips the skill).

## tools

Claude Code only: a pane of the hooks module. `/junkd:tools` opens or closes it; `/junkd:tools agents`, `tools`,
`mcp` or `skills` opens it on that tab, or switches to it while it is up. It is also the fifth tab of the
`/junkd` set, `settings ▸` on the tools group opens it on its Agents tab, and another mod calls
`$.junkd.open({ pane: 'tools', route })`. On Codex, Kimi Code and OpenCode the `tools` skill says in one line that
the pane is a Claude Code mod and the host has none.

The four tabs:

1. **Agents** — a tree of this session's agents over the repo's git worktrees (`git worktree list --porcelain`).
   The root is the main checkout with its branch; under it the other worktrees, each by its folder name and
   branch (`detached`, `bare`). Each agent sits under the worktree its directory is in (the `cwd` its spawn gave
   it, else the session's directory at the spawn); an agent in no worktree, or one spawned before the module
   loaded, sits under the root. A row shows the status glyph (`●` running, `◐` waiting, `○` done, in the theme's
   success, warning and inactive colours), the name, the agent type, the model it got and, once finished, `done`.
   An agent the engine drops from its list after it ended stays, as done. Outside a repo the root is the
   session's folder.
2. **Tools** — one row per tool the model called: on the main loop (`main`), in subagents (`sub`), and `≈tokens`
   of the results it read (characters ÷ 4). Most calls first. Every MCP tool folds into one `mcp (N servers)` row;
   the MCP tab has them per server.
3. **MCP** — one row per MCP server: calls, tools loaded/total and the schema `≈tokens` from the session's usage
   summary (`$.session.usage({ breakdown: 'summary' })`, estimated locally), and the result `≈tokens`. `no MCP
   server` when the session has none.
4. **Skills** — one row per skill run: `via slash` (you typed `/<skill>`: a plugin's or your own skill or command)
   or `via tool` (the model's `Skill` call), the count, and when it last ran (`3 m ago`). A typed run the model
   also answers with a `Skill` call within 2 seconds counts once. Built-in commands, MCP prompts, another plugin's
   `$.command.run` and the pane toggles are not counted.

What is counted is the model's own calls (another plugin's `$.tool.call` is not); a refused call is not. The
counters start with the session and start over at `/clear` and `/resume`; the folded nodes, the selection and the
tab stay. The tree is read again every `tools_refresh` seconds while the pane is open, at every agent spawn, at
every turn's end, and on `r`. The reading stops when the pane closes (`q`, its `✕`) or when its drawing fails.

### Keys

| Key | Does |
|---|---|
| `1`–`4` | Agents, Tools, MCP, Skills |
| `↑` `↓`, `j` `k` | Move the selection along the tree's rows (the arrows move the focus ring, which is the selection) |
| `enter` | Fold or unfold the selected node (a worktree, the root); the fold is kept per node across refreshes |
| `r` | Read the agents, the worktrees and the MCP schemas again now |
| `t` | Show this session's transcript: in Finder on macOS (`open -R`), its folder elsewhere (`xdg-open`); the outcome is a toast |
| `q` | Close the pane |

`space` does not fold: Claude Code presses a focused button with `enter` only, and a button's hotkey is one digit
or one letter. The transcript is the `<session id>.jsonl` (else the newest `.jsonl`) in the project folder Claude
Code keeps for the session's directory, `~/.claude/projects/<the directory, each character not a letter or digit
a dash>/`; `$.session` names no transcript path.

### Settings

| Row | Type | Default | Meaning |
|---|---|---|---|
| `tools_enabled` | boolean | `true` | Off: the pane closes, its tab leaves the `/junkd` set, `/junkd:tools` and `$.junkd.open({ pane: 'tools' })` say it is off, and nothing is counted (what was counted is dropped) |
| `tools_refresh` | number | `60` | Seconds between two reads while the pane is open. Clamped to 10–600 (a value under 10 is 10, over 600 is 600); a value that is no number is refused |
| `tools_agents_only` | boolean | `false` | The Agents tab leaves out the worktrees with no agent of this session (the root stays) |

`tools_enabled` is the group's one row in the junkd pane. `tools_refresh` and `tools_agents_only` are `/config`
rows only (`junkd.tools_refresh`, `junkd.tools_agents_only`), also read and written by `$.junkd.get/set`: the
group has no settings tab of its own, so its `settings ▸` opens the tools pane on its Agents tab. A switch takes
`true`, `'true'` or `'on'` as on, anything else as off, by `$.junkd.set` and by the `/config` menu alike. The
manifest keeps `tools_refresh` to its type and default: Claude Code refuses a whole module whose stored value is
out of a manifest range, so the bounds live in the module.

Hosts: Claude Code only (a hooks-module mod). Codex, Kimi Code and OpenCode have the `tools` skill, which answers
in one line that the pane is a Claude Code mod.

## dashboard

The orch run as a local web page: the task board (todo, in progress, verify, done; blocked under todo) with each
task's round, AC and ACX counts and its last verdict note; a timeline of the phases each agent worked on a task
(implement, verify, fix, done; a killed one hatched), with an overview strip and 1h, 3h, 12h and all zooms; the
agents with their status, model, context, last step and age of their last call; the recent events; the lessons
from `_lessons.md`; the rate-limit usage. No server and no fetch: the page is a file (`index.html`) that loads
`status.js` (`window.ORCH = {…}`) beside it with a plain `<script>` and reads it again every 5 seconds, so it works
from `file://`. Without a `status.js` it draws an empty board and says `status.js unreachable`.

Both live in `${CLAUDE_CONFIG_DIR:-~/.claude}/junkd/orch/dashboard/<hash>/`: `index.html` and `scale.js` (copied
from `skills/orch/dashboard/` at every open, so a plugin update reaches them), `status.js`, and the `open` flag.
`<hash>` is the handoff ids' rule (`host-lib`'s `jd_hash8`) applied to the session's git toplevel; a session in no
repo uses `_none`. The task store is the orch root's (`.orch/config.md`'s `tasks_dir`), found from inside a task
worktree too.

**Two writers of `status.js`:**

- **The hooks module** (Claude Code). `/junkd:dashboard` (or `/junkd:orch dashboard`, or `dashboard: open ▸` in
  the orch pane) writes the `open` flag, copies the page, writes `status.js`, opens the page (`open` on macOS,
  `xdg-open` elsewhere) and toasts the path. While the flag is there it writes again at every agent spawn, every
  agent's end, every turn's end and every `orch_dashboard_refresh` seconds. `/junkd:dashboard close` removes the
  flag; the page keeps its last data. A flag left by an earlier session starts the writes again at session start.
  Nothing is written while `orch_enabled` is off. Each spawn opens a phase on the task it names (its `.worktrees/<id>`
  folder, else the first task id in its name, description or prompt): `implement` for an implementer, `fix` for one
  on a task that was verified, `verify` for a reviewer. It closes at the agent's SubagentStop (with its context),
  when the agent list says done, or killed when it failed, was killed or left the list with no SubagentStop record.
  The phases live in `status.js` itself: the first write after a `/reload-plugins` reads the file back and merges,
  so the history stays. The write is atomic (`status.js.tmp`, then `mv`).
- **`bin/orch-status`** (any host, bash and jq): `orch-status [--out <dir>] [--sample] [--open]` builds the same
  file from the task store, the SubagentStop records under `junkd/orch/_agents/<session>/` (each agent done, with
  its context), `_lessons.md`, the OAuth usage endpoint when the macOS keychain holds the credentials (else no
  usage) and `git` for the repo and branch. It has no phases: a shell sees no spawns. `--sample` writes the demo
  data as `status.js`, `--open` copies the page beside it, writes the flag and opens it. It exits 0 with a partial
  file rather than nothing (no jq: an empty status and a note). The `dashboard` skill runs it on the other hosts.

**The data contract** (every field optional; the page draws an empty state per section): `generatedAt` epoch ms;
`repo`, `branch`, `mock`; `window {start, end}` epoch ms; `tasks[{id, title, column: todo|in_progress|verify|done|blocked,
round, deps, ac:[pass,total], acx:[pass,total], note, implementer, verifier, worktree, lastActivity, commits,
phases[{agent, model, kind: implement|verify|fix|done, start, end, ctx, killed, note}]}]`; `agents[{name, role,
model, status: running|waiting|done|dead|queued, lastCallSec, ctx, task, round, branch, worktree, lastStep,
deadNote, events[{t, text, kind}]}]`; `events[{t, text, kind: info|pass|fail}]`; `lessons[{task, text}]`;
`usage {fiveHour, week}` (percent); `watchdog {on, minutes}`. The comment at the top of
`skills/orch/dashboard/status.sample.js` holds the same, with the time formats the page also takes.

**Hosts:** Claude Code has the live writer. Codex, Kimi Code and OpenCode have the `dashboard` skill (`$dashboard`,
`/skill:dashboard`, `/dashboard`), which runs `orch-status --open`: a snapshot, run it again to refresh.

**Settings:** `orch_dashboard_refresh` (seconds between writes while open, default 30, 5–600) and
`orch_dashboard_window_h` (hours the timeline shows, default 24, 1–168), both clamped in the module (the manifest
holds no bounds: Claude Code would refuse the module over a stored value out of range), in `/config`
(`junkd.orch_dashboard_*`) and the orch pane; see [orch settings](#settings-2). `orch-status` reads the window from
`settings.json` (or `ORCH_DASHBOARD_WINDOW_H`).
## watchdog

A watchdog over the agents of this session, part of orch. It costs no tokens: on Claude Code it is engine hooks and
a 30 s timer in the hooks module; on the other hosts it is the bash script `bin/orch-watch`. No model is in the
loop, and it never respawns anything.

### The rules

The watchdog looks at each agent the main loop spawned. An agent spawned by another agent is its parent's
business and is skipped, and the main loop itself is never watched or stopped.

- **Stall**: the agent is `running`, no tool call of its own is in flight, and its last call ended longer ago than
  its role's limit. A permission prompt (`waiting`, `◐` in the tools pane) is never a stall, and neither is a long
  call such as `sleep 90` in Bash.
- **Dead**: the agent was in the agent list at the last tick, it is gone now, and it left no SubagentStop record.
  An agent that is gone with a record finished, even if its report was lost.
- **Idle leftover**: the agent finished (it is done, or it has a stop record newer than its last move) and it is
  still listed. Whether it is stopped depends on its role.

| Role | Stall limit | Idle leftover |
|---|---|---|
| `implementer`, `lead-implementer` | `orch_stall_minutes` | Kept while its task is `in_progress` (a verify or fix round reuses it); stopped once the task is `done` or `blocked`, or after `orch_idle_stop_minutes` when the task is in no other state |
| `verify-coordinator`, `test-planner`, `test-reviewer`, `ui-reviewer` | `orch_stall_minutes` + 5 | Stopped as soon as it reported: a reviewer is never messaged again |
| `orch-ops`, any agent named `pr-…` or `gh-…` | `orch_stall_minutes` | Stopped as soon as it reported |
| Any other agent | `orch_stall_minutes` | Stopped after `orch_idle_stop_minutes` |

The task of an agent is the `T<n>` in its name, else the `T<n>` of its worktree path (`.worktrees/T<n>`). Its
status is the `status:` line of the frontmatter of `.orch/tasks/T<n>.md`, read once per tick. An agent with no
task has the idle rule alone. A task file that cannot be read keeps the last status, and an agent list that cannot
be read keeps the last verdict: neither raises an alarm.

Each alarm is raised once per agent and kind (stall, dead, stopped), and cleared when the agent moves again.
`/clear` and `/resume` start the watchdog over. With `orch_enabled` or `orch_watchdog` off there is no timer and no
alarm.

### What it does (Claude Code)

- **A stop** goes through the engine's `TaskStop` tool with the agent's id (the hooks API has no agent stop
  operation). It shows a toast such as `⚠ stopped verify-T17: reported 12 min ago`. A stop that fails or is
  refused is said once and not tried again. With `orch_idle_stop` off, the leftover is reported once instead.
- **A death** shows a toast and the `⚠ 1 dead` segment under the prompt. It writes a `deadNote` into the agent's
  record (`no SubagentStop record · last: <tool> <argument head>`), so SendMessage still reaches it by id or name.
  At the orchestrator's next turn, one line rides along as context, once:
  `watchdog: impl-T17 died (no stop record, last call Bash tests/smoke.sh 18 min ago); resume it with SendMessage or spawn a fresh agent on task/T17-…`.
- **A stall** shows a toast, the `⚠ 1 stalled` segment and one line at the next turn:
  `watchdog: impl-T19 idle 16 min, last call Edit …; ping it or stop it`. Nothing else happens.
- The segment is red and hidden while nothing is wrong. A press opens the tools pane on its Agents tab, where each
  agent row carries the watchdog's verdict: `⚠ stalled 16m`, `✝ dead`, `· idle 4m` or `· stopped`.
- `/junkd:orch watchdog` runs a tick now, prints the verdict table (agent, role, status, idle, verdict) to the
  transcript and shows the counts as a toast. `/junkd:orch watchdog off` and `on` flip `orch_watchdog`.

Every stop, death, stall and reported leftover is also one JSON line `{t, agent, kind, note}` in the watchdog log:

```
${CLAUDE_CONFIG_DIR:-~/.claude}/junkd/orch/watchdog/<session id>.log
```

### The other hosts: `bin/orch-watch`

```
orch-watch [--once] [--interval S] [--idle-minutes N] [--no-stop] [--session ID]
```

It reads the stop records of a session (`junkd/orch/_agents/<session>/*.json` as `scripts/orch-agent-stop.sh`
writes them; the newest session folder unless `--session` names one). It finds the live agents in the process list:
`claude`, `codex` and `kimi` processes whose working directory (`lsof`, else `pwdx`, else `/proc`) is a task
worktree. A process whose directory cannot be read is listed by name only. It prints one table, agent, role,
status, idle and verdict, by the rules above. `--once` prints it and exits 0; otherwise it prints one every
`--interval` seconds (1–3600, default 60) until Ctrl-C. `--idle-minutes` defaults to the `orch_idle_stop_minutes`
row of `settings.json`, else 10. Without `jq` it says so and exits 0.

| Host | Watches with | Stops idle leftovers |
|---|---|---|
| Claude Code | the hooks module (and `bin/orch-watch` in a headless run) | Yes, through `TaskStop`, while `orch_idle_stop` is on |
| Codex, Kimi Code, OpenCode | `bin/orch-watch` (the `orch` skill's `./bin/orch-watch`) | No: the host has no agent stop command, so the table only reports (`stop, report only`) |

`--no-stop` says the same on any host. On Claude Code the plugin root's `bin/orch-watch` is the same script.

### Settings

| Row | Type | Default | Meaning |
|---|---|---|---|
| `orch_watchdog` | boolean | `true` | The whole watchdog. Off: no timer, no alarms, no segment; `/junkd:orch watchdog` says it is off |
| `orch_idle_stop` | boolean | `true` | Stop the idle leftovers the rules above name. Off: report them only (a toast and a log line, once) |
| `orch_idle_stop_minutes` | number | `10` | Idle minutes before a finished agent with no task in progress is stopped. Clamped to 1–120 |
| `orch_stall_minutes` | number | `15` | Minutes without a tool call before a running agent is stalled; a reviewer gets 5 more. Clamped to 1–120 |

The four rows are in the orch pane (`/junkd:orch panel`) and in `/config` (`junkd.orch_watchdog`, …). A switch
takes `true`, `'true'` or `'on'` as on. A minutes value is rounded and clamped in the module, and a value that is
no number is refused; the manifest keeps the rows to their type and default.

## lessons

orch's lessons are a queue that empties itself: every lesson has a promotion target, a run cannot end (or start)
while one is pending, and a promotion turns it into something executable and deletes it.

### The three stores

| Store | File | Lives |
|---|---|---|
| local | `<tasks_dir>/_lessons.md` (`.orch/tasks/_lessons.md`) | This checkout's orch store; every lesson is born here. `.orch/` never enters git |
| repo | `<project root>/lessons.md` | Committed and pushed with the project (the team, other machines); made on the first promotion to it, committed on the task branch of the task that produced it |
| global | `${CLAUDE_CONFIG_DIR:-~/.claude}/junkd/lessons.md` | One per machine, read by every repo |

Promotion goes one way, local → repo → global. One block per lesson, in all three files:

```
## L<n> (<YYYY-MM-DD>) scope: local|repo|global · stack: <tags> · to: test|smoke|check|role|repo|global|drop · from: T<id>
<2–3 sentences: what failed, why, what check would have caught it>
```

`L<n>` is unique per file (the next free number). `stack` is one or more of `node`, `python`, `shell`, `tsx-mods`,
`go`, `rust`, `any`, comma separated. A repo's own stack is read from its files: `package.json` → node,
`pyproject.toml` or `requirements*.txt` → python, a `bin/*` file with a bash shebang → shell, `*.tsx` under a
`hooks/` folder → tsx-mods, `go.mod` → go, `Cargo.toml` → rust; nothing → `any`. A `## ` heading of another shape (the
old diary's `## T8 (…)`) is no lesson. There is no entry limit: relevance comes from the stack tag.

A lesson is **pending** unless its `to` is a store it has reached (`to: repo` in the repo or global store, `to:
global` in the global store). A lesson with no `to`, a handed test, and every other target are pending.

### The signal rule and blocking

A lesson is written only on a signal: a fix round, a surviving mutant, a PM-REVIEW that found a bug, a dead or stalled
agent (the [watchdog](#watchdog)), a verify FAIL. A clean round-0 PASS writes nothing. At a task's resolve the
orchestrator adds it with a `to`, and promotes what needs no consent at once: a `test` or `smoke` lesson goes to the
implementer of the same task as a fix round and is closed once the test is on the branch. Everything else stays
pending.

The run does not print its `BACKLOG:` line while `orch-state lesson pending` exits 1: the orchestrator resolves each
pending lesson with you (promote, drop or move up), and a new `/junkd:orch` with lessons pending starts with the same
dialog before it selects a task. There is no "later". The hooks module cannot stop the model from printing text, so
the enforcement is the spec (`commands/orch.md` §7 and §8), the context line below, and `pending`'s exit code.

### `bin/orch-state lesson` (every host)

| Command | Does |
|---|---|
| `lesson add [--scope local\|repo\|global] [--stack <tags>] --to <target> --from T<id> "<text>"` | Appends the block (scope `local`, stack the repo's by default) and prints its id, `local:L4` |
| `lesson list [--pending] [--scope <s>] [--json]` | The table id · scope · stack · to · from · first sentence; `--json` for scripts |
| `lesson promote <id> [--to <target>] [--yes]` | To its `to` (or `--to`): `repo`/`global` moves it one store up (renumbered, `scope` rewritten) and deletes it below; `check` appends the text to `standing_checks_extra` in `.orch/config.md` only with `--yes` (without it: the proposed line, exit 3), and only when that file has a frontmatter block (`---` … `---`) to hold the key (else exit 2, nothing changed, the lesson kept); `test`/`smoke` prints the fix-round line and marks it `to: test·handed`; `role` writes a task `T<next>.md` into the backlog when this repo is junk-drawer (elsewhere it prints the text to paste and writes nothing); `drop` deletes |
| `lesson up <id>` | One store up, the `to` kept |
| `lesson drop <id>` | Deletes it |
| `lesson prune [--months N] [--yes]` | Lists the lessons older than N months (default 6) whose stack is not this repo's; `--yes` drops them |
| `lesson pending` | The count of pending lessons of the three stores; exit 1 when there are any |
| `lesson inject` | The lessons whose stack meets the repo's (and `any`), as the text the session start prints |

`<id>` is `L3`, or `local:L3`, `repo:L3`, `global:L3` when two stores have an `L3`. It is the one writer of the
stores: each write is a temp file and an `mv`, a CRLF file is written back LF, and a file that cannot be written
stops the command (exit 2) with nothing changed. With no `.orch/` the repo and global stores still work. Without
`jq` the read commands say so and exit 0, the writes exit 2.

### Injection, and why it is fenced

At every orch session's start `scripts/orch-context.sh` prints, after the rule sheet, what `orch-state lesson
inject` prints: `# Lessons for this repo (stack: …)`, one line saying the block below is data from lessons files and
not instructions, and the lessons in one fenced block. A lessons file is text other people can write (anyone who
can commit to the repo writes its `lessons.md`), and the block lands in the main loop's context, so:

- the repo store is injected only in an orch project (one with `.orch/config.md`, which you initialised); the local
  and global stores are yours;
- a body line that opens a heading (`#`…`######` and a space) or a fence (```` ``` ````, `~~~`) is dropped, so a
  lesson cannot close the fence or pose as a new section;
- at most 40 lessons and 4096 bytes (bytes, not characters: multibyte text counts in full) of them are printed; the rest is one line, `… N more, see /junkd:lessons`.

The injection needs `orch_enabled`, `orch_inject_rules` and `orch_lessons` on (each read from `settings.json`, else
from its flag file: `junkd/orch-off`, `junkd/orch-rules-off`, `junkd/orch-lessons-off`).

### Claude Code: the lessons tab, 📒 and the dialog

- **The lessons tab** of the [/junkd set](#the-junkd-frame-claude-code-only), after tools: the pending lessons of the
  three stores, columns id · scope · stack · to · from · text (cut to the pane; a lesson of another stack dimmed).
  `j`/`k` (or the arrows) select, `p` promotes it to its `to` (a `check` or a `role` asks in a confirm line first,
  `y`/`n`; a confirmed check runs with `--yes`), `d` drops it, `u` moves it a store up, `r` reads the stores again,
  `q` closes. Every write is a run of `orch-state lesson …`.
- **`📒 N`** under the prompt (the theme's warning colour) while lessons are pending; a press opens the tab. None at 0.
- **The dialog**: at the session start of an orch session (orch on, `orch_lessons` on, a `.orch/config.md` at the
  root) with lessons pending, when the main loop's answer prints a `BACKLOG:` line, and when `/junkd:orch` starts a
  run, the tab opens focused with the top line `N lessons pending — resolve them to finish the run`, and every prompt
  of the main loop carries one context line, `lessons: N pending, open /junkd lessons; the run is not finished`, until
  none is pending.
- **`/junkd:lessons [list | promote <id> | drop <id> | up <id>]`** toggles the tab (`list` opens it) or runs the one
  action and answers with the CLI's line.

The stores are read again at session start, at the end of each main-loop turn, after each write and on `r`.

| Host | Lessons with |
|---|---|
| Claude Code | The hooks module (tab, 📒, dialog, context line) and `orch-state lesson` |
| Codex, Kimi Code, OpenCode | The `lessons` skill (`$lessons`, `/skill:lessons`, `/lessons`), which runs `./bin/orch-state lesson …`; the orchestrator asks with plain questions |

### Settings

| Row | Type | Default | Meaning |
|---|---|---|---|
| `orch_lessons` | boolean | `true` | The lessons loop. Off: no injection, no tab, no 📒, no dialog, no context line, no blocking and no `lesson add` by the spec; the files are left as they are (the flag file `junkd/orch-lessons-off` while off) |

The row is in the /junkd pane (orch's main rows), the orch pane and `/config` (`junkd.orch_lessons`); `true`,
`'true'` and `'on'` are on.

## Files

- `hooks/index.tsx` — the one hooks module: `$.junkd` and the hooks more than one feature needs (session start,
  `tool.call`, `command.run`, the prompt hint line); it composes the feature files below.
- `hooks/settings.ts` — the mirror of the manifest's `userConfig` rows (checked against it by `tests/smoke.sh`);
  `hooks/dispatch.ts` from a row or a pane to its feature; `hooks/feature.ts` the shapes they share.
- `hooks/core.ts` — the core rows: `core_output_style` and its flag file, `core_cache_check_sessions`.
- `hooks/cache.tsx`, `cache-lib.ts` — the prompt-cache check at session start (`scripts/cache-check.sh`) and its
  band above the prompt.
- `hooks/handoff.tsx`, `handoff-lib.ts`, `handoff-ui.tsx`, `handoff-views.tsx` — handoff: the auto loop, the 🪃
  segment, its pane.
- `hooks/orch.tsx`, `orch-lib.ts`, `orch-views.tsx` — orch: the main-loop guard, its pane.
- `hooks/watchdog.ts`, `watchdog.tsx` — the agent watchdog: the rules and the tick, `$`-free; the timer, the stops,
  the ⚠ segment, the log and the line at the next turn.
- `hooks/tldr.tsx` — tldr: the sentences default and the flag files `tldr-on`, `tldr-off`.
- `hooks/ctx.ts` — ctx: the rows, their files `ctx-limit-*`, `/junkd:ctx-limit`, the move of the old files.
- `hooks/statusline.tsx`, `statusline-views.tsx` — statusline: the rows, `statusline-setup` on|off, the refresh at
  session start, `/junkd:statusline`, its pane.
- `hooks/tools-pane.tsx`, `tools.ts`, `tools-views.tsx` — tools: the pane, its poll and the settings group; the
  counters, the worktree parser and the agents tree; the four tabs.
- `hooks/panel.tsx`, `junkd-views.tsx` — the /junkd frame and the set.
- `hooks/lessons.tsx`, `lessons.ts`, `lessons-views.tsx` — the lessons loop: the tab, 📒, the dialog and its context
  line, `/junkd:lessons`; the reader of the three stores, the stack filter and the pending rule; the tab's drawing.
- `hooks/dashboard.tsx`, `dashboard.ts` — the orch dashboard: `/junkd:dashboard`, the phases, `status.js`; the task
  store's parsers and the status builder.
- `skills/orch/dashboard/` — the dashboard page (`orch-dashboard.html`), its timeline scale (`scale.js`) and the
  demo data with the data contract (`status.sample.js`); `skills/orch/bin/orch-status` its shell writer.
- `skills/<name>/SKILL.md` — one per command (`junkd`, `handoff`, `handon`, `ahandoff`, `orch`, `orch-init`,
  `tldr`, `ctx-limit`, `ctx-tokens`, `statusline`, `tools`, `dashboard`, `lessons`); the real helpers live inside their skill (`skills/handoff/bin`,
  `skills/orch/bin` (with `orch-watch`, and `orch-state lesson`), `skills/orch/scripts`, `skills/orch/roles`, `skills/tldr/bin`, `skills/ctx-limit/bin`
  (`ctx-limit`, `ctx-limit-hook`), `skills/ctx-tokens/bin`, `skills/statusline/bin` (`statusline.sh`,
  `statusline-setup`), `skills/junkd/scripts/setup.sh`, `skills/junkd/scripts/cache-check.sh`). `host-lib` has a
  real copy in each skill that sources it (handoff, handon, tldr, ctx-limit, ctx-tokens).
- `bin/`, `scripts/`, `agents/` at the plugin root — links: `bin -> skills/junkd/bin` and `scripts ->
  skills/junkd/scripts` (each entry a link to its skill's real file), `agents -> skills/orch/roles`, as the
  layout invariant of `tests/smoke.sh` asks.
- `output-styles/STE.md` — the `junkd:STE` output style. `docs/orch-guide.md` (and `.html`) — orch's long guide.
- Tests: `hooks/*.test.ts(x)` (`claude plugin test plugins/junkd`), `tests/junkd.sh`, `tests/orch.sh`,
  `tests/tldr.sh`, `tests/cache-check.sh`, `tests/ctx.sh`, `tests/statusline.sh` (its golden line in
  `tests/statusline/`), `tests/orch-watch.sh`, all run by `tests/smoke.sh`; `tests/dashboard.sh` (the page's scale
  under node and its file:// shape) and `tests/orch-status.sh` (the shell writer over fixture task stores);
  `tests/lessons.sh` (`orch-state lesson` and the lessons of `scripts/orch-context.sh` over fixture stores).
