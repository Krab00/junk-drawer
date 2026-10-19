# junkd

One plugin for three tools and the frame over them. Every command is a skill of junkd, so on Claude Code each is
`/junkd:<name>`:

| Command | Does |
|---|---|
| `/junkd:handoff` | Save a handoff of the session to disk and print its short id (`panel`, `auto [prompt]`, `off` drive the auto loop on Claude Code) |
| `/junkd:handon [id]` | Resume a handoff in a fresh session (the newest without an id) |
| `/junkd:ahandoff [prompt] \| off \| panel` | Arm the auto handoff loop: at a context threshold handoff, `/clear`, `/junkd:handon`, continue; resume after the 5h rate limit (Claude Code only) |
| `/junkd:orch …` | The orchestration loop: tasks, implementer and verifier subagents, evidence gates, draft PRs (`panel` opens its settings pane) |
| `/junkd:orch-init` | Write the project's `.orch/config.md` once, before the first `/junkd:orch` |
| `/junkd:tldr [N \| on \| off \| status]` | Summarize the last substantive reply in at most N sentences, or keep every reply terse |
| `/junkd`, `/junkd:junkd` | Open or close the junkd set of panes (Claude Code only) |

On Codex the same skills answer as `$handoff`, `$orch`, `$tldr`…, on Kimi Code as `/skill:<name>`, on OpenCode
through the `skill` tool. The hooks module (Claude Code only) adds the auto handoff loop, the orch main-loop guard,
the panes and `$.junkd` for other mods; the skills, the `bin/` helpers and the shell hooks work on every host.

handoff, orch and tldr were three plugins before; see [Moving from the handoff, orch and tldr
plugins](#moving-from-the-handoff-orch-and-tldr-plugins).

## Install

```text
/plugin marketplace add Krab00/junk-drawer
/plugin install junkd@junk-drawer
```

Codex: `codex plugin add junkd@junk-drawer`. Kimi Code: `/plugins install junkd` (see `kimi-marketplace.json`).

## The /junkd frame (Claude Code only)

`/junkd`, `/junkd:junkd`, or a click on the `✚ junkd` segment under the prompt, opens a set of panes as tabs and
closes them together:

1. **junkd** — focused, the frame below.
2. **handoff** — handoff's pane ([below](#handoff)).
3. **orch** — orch's settings pane ([below](#orch)).

All three are panes of the one hooks module, so the set opens them directly, marked as the set's. A feature pane
already open on its own closes first and opens again behind junkd's tab, so its tab never comes first, and from
then on it is the set's. `q`, a second `/junkd`, or closing junkd's tab by hand (`×`) closes all three, but only a
feature pane that is still the set's: one you closed and opened again on your own (`/junkd:handoff panel`,
`/junkd:orch panel`, `/junkd:ahandoff panel`, the 🪃 click) stays.

Where the set sits depends on the layout. Only in the fullscreen layout (`"tui": "fullscreen"` in
`settings.json`), from 110 terminal columns, it docks beside the transcript; narrower, and always on the main
screen, it sits above the prompt. The feature panes open after junkd's, and Claude Code counts only the first open
of a press as yours: until you have opened that pane by hand once (`/junkd:handoff panel`, `/junkd:orch panel`),
its tab may wait undrawn below 144 columns. After that, 110 columns are enough.

The header reads `✚ junkd  junk-drawer <sha>`: the short sha of the marketplace checkout (none where it is not
a git checkout). The junkd pane has three sections, their titles in junk-drawer's orange (the theme's accent):

- **Plugins** — every plugin of the marketplace (`.claude-plugin/marketplace.json`: statusline, ctx-tokens,
  ctx-limit, junk-drawer, junkd), on or off at user scope as `enabledPlugins` in `~/.claude/settings.json`
  (`$CLAUDE_CONFIG_DIR/settings.json`) says; the title names the file it writes. A plugin on in this project only
  is marked. Keys `1`–`9` flip one; the pane then says to run `/reload-plugins`. handoff, orch and tldr are no
  plugins of their own anymore: each group's `enabled` row in Settings is their on/off.
- **Settings** — the groups core, handoff, orch and tldr, in that order, each with its `main` rows and `enabled`
  first, with their current values. A letter flips a boolean; a number is typed and saved with `enter`, a choice
  (`orch_guard`, `core_output_style`) is picked with `tab` and `enter`. The group's own rules validate what it
  gets, and a refusal shows in the note line. Each row: the field, its title, the control on the right (a switch
  as an `on`/`off` pill and its letter, a choice as its options with the current one inverse, a number as a
  field). `settings ▸` on handoff and orch opens that pane (handoff on its Settings tab), closes junkd and the
  set's other feature pane (while it is still the set's), then asks again for the keys, so the feature pane ends
  alone with them; it is yours from then on. core and tldr have no pane and no button.
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
`_`). Four groups, each feature group with its `enabled` row first:

| Group | Rows | Details |
|---|---|---|
| core | `core_output_style` | [Output style](#output-style-ste) |
| handoff | `handoff_enabled`, `handoff_threshold`, `handoff_checkEvery`, `handoff_autoOn`, `handoff_resumeAfterLimit`, `handoff_staleDays`, `handoff_segment` | [handoff settings](#settings-1) |
| orch | `orch_enabled`, `orch_guard`, `orch_allow_fable_agents`, `orch_implementer_ctx_k`, `orch_ui_review`, `orch_inject_rules`, `orch_rounds` | [orch settings](#settings-2) |
| tldr | `tldr_enabled`, `tldr_terse`, `tldr_sentences` | [tldr settings](#settings-3) |

The `enabled` rows: `handoff_enabled` off is no auto handoff loop and no 🪃 segment (`/junkd:handoff`,
`/junkd:handon` and the pane still work); `orch_enabled` off is no main-loop guard and no rule sheet at session
start (`/junkd:orch` and its pane still work); `tldr_enabled` off keeps the per-turn terse hook silent
(`/junkd:tldr N` still summarizes). Scope: user-global; project/session overrides: planned.

A shell hook runs before the hooks module at a session start and reads no plugin setting, so each shell hook reads
its row from `settings.json` itself (`pluginConfigs`, the first entry whose key starts with `junkd@`, its
`.options.<row>`), and only where that names no value a flag file the module mirrors the row into decides. The
flag files live under `~/.claude/junkd/` (`$CLAUDE_CONFIG_DIR/junkd/`): `output-style-off`, `tldr-on`,
`tldr-off`, `orch-off`, `orch-rules-off`, and the setup stamps `setup-<version>.stamp`.

## Moving from the handoff, orch and tldr plugins

handoff, orch and tldr were separate plugins of this marketplace; they are now part of junkd, which no longer
depends on them. Uninstall the old ones (`/plugin uninstall handoff@junk-drawer`, `orch@junk-drawer`,
`tldr@junk-drawer`) and install junkd. Nothing is copied over: set the values you had changed again (`/config`,
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
| — | new rows `orch_enabled`, `tldr_enabled` (both on by default) |
| `~/.claude/tldr-on` | `~/.claude/junkd/tldr-on` (run `/junkd:tldr on` again; the old file is not read) |
| `~/.claude/orch/rules-off` | `~/.claude/junkd/orch-rules-off` (written by the module at the next session start) |
| `$.handoff`, `$.orch`, `$.tldr` | `$.junkd` ([below](#junkd-for-other-mods)) |

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
  `settings` opens on that tab, or switches to it while the pane is up), `orch`.
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

## handoff

Codex: use `$handoff` to save, or `$handoff resume <id>` to restore. Codex handoffs live under
`~/.codex/junk-drawer/handoffs`; Claude Code retains the paths below.

Save the state of a session to disk and pick it up in a fresh one — by id, not copy-paste.

- **`/junkd:handoff`** — writes a handoff to `~/.claude/handoffs/<date>_<id>.md`, prints a short session id and copies it to your clipboard.
- **`/junkd:handon <id>`** — in a new session, loads that handoff as context. No id → loads the newest.

Both are skills of the junkd plugin (`skills/handoff`, `skills/handon`); there are no separate command
files. A skills-only install (`npx skills add Krab00/junk-drawer`) has no plugin namespace, so there the
same skills answer as `handoff` and `handon`: `handon` takes the same optional id and delegates to
`handoff`.

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
| Codex | `$handoff` | `$handoff resume <id>` | no (manual) |
| Kimi | `/skill:handoff` | `/skill:handoff` | no (manual) |
| OpenCode | skill | skill | no (manual) |

## orch

Part of the **junkd** plugin. Claude Code: `/junkd:orch-init` once per repository, then `/junkd:orch` with a
task id, free text, `batch`, `chain`, or `all`. Codex: install the plugin, open a new task, run `$orch-init`,
then `$orch` the same way. Both hosts share `.orch/config.md`, task files, worktrees, and helper scripts.

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
5. **Retro:** every resolve appends a lesson to `_lessons.md`; a pattern recurring across ≥2 tasks
   is proposed for promotion into `standing_checks_extra` (asks you — never edits config silently).

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

`tests/orch.sh` (run by `tests/smoke.sh`) covers the hook, the agent roster and the bin scripts.

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
| `SendMessage` | except to a reviewer (`verify-coordinator`, `ui-reviewer`, `test-planner`, `test-reviewer`, bare or `junkd:`: spawn a new one), to an agent past `implementer_ctx_k` k tokens of context, or to an agent nobody knows. A stopped agent is known by its `SubagentStop`: the module keeps its type and the context tokens of its transcript's last usage record, by id and by name. |
| `Read` | in the session scratchpad, the repo's task store `<repo>/.orch/` (`<repo>` = git's toplevel of the session's cwd; none outside a repo) and, in the config dir (`$CLAUDE_CONFIG_DIR`, else `~/.claude`), `orch/`, `handoffs/` and `projects/*/memory/`. The path must be a plain absolute ASCII path (no `~`, no relative path, no surrounding spaces, no non-ASCII letters) with no `..` segment; symlinks and case aliases are resolved first and where it lands must pass too, and a path that cannot be placed is denied. |
| `Write` | in the same places as `Read`, except that in the task store only a `.md` file (task files, `_lessons.md`) and never an existing `.orch/config.md` (its `tasks_dir` steers the bin scripts; a new one passes as any new `.md` does), or to a new `.md` file. Never a path with a `..` segment, never to settings, Claude Code config (`CLAUDE.md`, `AGENTS.md`, `SKILL.md`, anything in a `.claude/` dir, any plugin's `agents`, `commands`, `skills`, `hooks`, `rules`, `output-styles`, a `.claude-plugin/` dir), the module's own control files `junkd/orch-off` and `junkd/orch-rules-off` (or any path under those names) or this plugin. The path must be a plain absolute ASCII path; symlinks and case aliases are resolved first, and a path that cannot be placed (a link to nothing, a folder that does not resolve) is denied. |
| `Bash`, `Monitor` | only to run one of this plugin's own `bin/` scripts, by its path under the plugin root, with plain arguments (no quotes, `$`, backticks, `;`, `&`, `\|`, `<`, `>`) |
| `CronCreate`, `ScheduleWakeup` | only to schedule `/junkd:orch` (or bare `/orch`), `/loop` of an allowed prompt, or a plain prompt, or to stop one |
| anything else (`Edit`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `LSP`, MCP tools, …) | never |

If the guard itself throws, the call is denied (`Orchestrator mode (orch): guard error`). Known
gaps: a `context: fork` skill raises no spawn event, so the guard never sees it; a plugin loaded
from outside a `plugins/` path is not covered by the Write rule. The exact rules are in
`hooks/orch-lib.ts`, the tests in `hooks/orch.test.tsx` (`claude plugin test plugins/junkd`).

##### Deliberate differences from the guard this one was ported from

Row by row, against the table above:

- **Always allowed:** `advisor` is not on the list, so it is denied here. It runs on the server and
  raises no tool call, so in practice nothing changes. The earlier guard's own decision tool is not
  ported at all (out of scope).
- **`ScheduleWakeup`:** the earlier guard listed it as always allowed, but its `CronCreate` rule ran
  first, so it was restricted there too. Here it is off the always list, and the table says what
  holds: the `CronCreate` rule (only `/junkd:orch`, `/loop` of an allowed prompt, a plain prompt, or a
  stop). Same behaviour, no shadowed entry.
- **`SendMessage`:** `test-planner` and `test-reviewer` count as reviewers too (they exist only in
  this plugin), so they are always spawned fresh. The `SubagentStop` records are kept in the
  module's memory, not on disk: after `/reload-plugins`, an agent that stopped earlier has no token
  count, so the context cap is not checked for it.
- **`Read`, `Write`:** the task store is `<repo>/.orch/` in the project, not a folder in the config
  dir, so the repo's `.orch/` is a root of its own (new here). Writes there take a `.md` only and
  never an existing `config.md`. The config dir's `orch/` stays a root for scratch state.
- **`Write`:** stricter on `.claude/`: anything in any `.claude/` dir is refused, not only its
  loaded folders. In place of protecting a records folder, the module's own control files
  `junkd/orch-off` and `junkd/orch-rules-off` (and any path under them) are refused.
- **`Bash`, `Monitor`:** no separate `..` check on the script path. The script name may not hold a
  `/`, so a `..` cannot lead out of `bin/`.

#### Settings

`/junkd:orch panel` toggles the pane: one Settings tab with the seven rows (`tab` moves, `enter` saves a
field, a letter flips a switch or focuses a field, the guard's options are buttons, `q` closes).
The same rows are in `/config` under plugin `junkd` (`junkd.orch_<field>`), and the first four in the
/junkd pane.

| Key | Type | Default | What it does |
|---|---|---|---|
| `orch_enabled` | boolean | `true` | Off: no main-loop guard and no rule sheet at session start, whatever `orch_guard` and `orch_inject_rules` say (the flag file `junkd/orch-off` while off); `/junkd:orch` and its pane still work |
| `orch_guard` | string (`fable`, `always`, `off`) | `fable` | When the guard holds the main loop: on a Fable model, always, or never |
| `orch_allow_fable_agents` | boolean | `false` | Let the main loop spawn a subagent on an explicit Fable model (the user asked) |
| `orch_implementer_ctx_k` | number | `400` | Reuse an implementer for a fix round only while its context is under this many k tokens (50–1000) |
| `orch_ui_review` | boolean | `true` | Run `ui-reviewer` on the UI criteria when the config declares `web`; off, they are `PM-REVIEW` rows |
| `orch_inject_rules` | boolean | `true` | Print `ORCHESTRATOR.md` into the main session at start (the flag file `junkd/orch-rules-off` while off) |
| `orch_rounds` | number | `3` | Fix rounds per task; `--rounds` overrides it for one run (1–10) |

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
  `orch_guard`, `orch_allow_fable_agents` and `orch_implementer_ctx_k`; `orch_guard` carries its `options`.
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

Part of the `junkd` plugin. Codex: invoke `$tldr`, optionally with a sentence count or `on|off|status`. Codex
stores the persistent flag under `~/.codex/junk-drawer`, Kimi Code under `~/.kimi-code/junk-drawer`; Claude Code
keeps its flags under `~/.claude/junkd`.

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

There is no tldr pane; `/junkd:tldr` stays the command on every host. The module is Claude-only: Codex and Kimi
run the shell hook and `tldr-flag` as before, and `tldr_enabled` does not apply there.

## Files

- `hooks/index.tsx` — the one hooks module: `$.junkd` and the hooks more than one feature needs (session start,
  `tool.call`, the prompt hint line); it composes the feature files below.
- `hooks/settings.ts` — the mirror of the manifest's `userConfig` rows (checked against it by `tests/smoke.sh`);
  `hooks/dispatch.ts` from a row or a pane to its feature; `hooks/feature.ts` the shapes they share.
- `hooks/core.ts` — `core_output_style` and its flag file.
- `hooks/handoff.tsx`, `handoff-lib.ts`, `handoff-ui.tsx`, `handoff-views.tsx` — handoff: the auto loop, the 🪃
  segment, its pane.
- `hooks/orch.tsx`, `orch-lib.ts`, `orch-views.tsx` — orch: the main-loop guard, its pane.
- `hooks/tldr.tsx` — tldr: the sentences default and the flag files `tldr-on`, `tldr-off`.
- `hooks/panel.tsx`, `junkd-views.tsx` — the /junkd frame and the set.
- `skills/<name>/SKILL.md` — one per command (`junkd`, `handoff`, `handon`, `ahandoff`, `orch`, `orch-init`,
  `tldr`); the real helpers live inside their skill (`skills/handoff/bin`, `skills/orch/bin`,
  `skills/orch/scripts`, `skills/orch/roles`, `skills/tldr/bin`, `skills/junkd/scripts/setup.sh`).
- `bin/`, `scripts/`, `agents/` at the plugin root — links: `bin -> skills/junkd/bin` and `scripts ->
  skills/junkd/scripts` (each entry a link to its skill's real file), `agents -> skills/orch/roles`, as the
  layout invariant of `tests/smoke.sh` asks.
- `output-styles/STE.md` — the `junkd:STE` output style. `docs/orch-guide.md` (and `.html`) — orch's long guide.
- Tests: `hooks/*.test.ts(x)` (`claude plugin test plugins/junkd`), `tests/junkd.sh`, `tests/orch.sh`,
  `tests/tldr.sh`, all run by `tests/smoke.sh`.
