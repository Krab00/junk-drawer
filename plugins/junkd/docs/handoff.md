# handoff

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

Install: `/plugin install junkd@junk-drawer` (marketplace `Krab00/junk-drawer`).

## Auto handoff and panel (Claude Code only)

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

### Resume after the 5h rate limit

An armed loop also survives the 5-hour rate limit. When a turn dies with the window at 100%, the mod
sets one timer for 2 minutes after the window resets (the host reports the reset time with every
measurement) and sends the continuation prompt then — your `/junkd:ahandoff` prompt, or `Continue
where the rate limit stopped you`. No handoff is needed: the session keeps its context. The segment
shows `🪃 limit → 14:32` meanwhile. There is no recurring timer: the next limit hit schedules the next
resume. `/junkd:ahandoff off` or the `handoff_resumeAfterLimit` setting (`l` on the Settings tab) turns
it off. The timer lives in the running session; after a restart you only get a toast that a resume was
pending (re-arm with `/junkd:ahandoff`).

### Status line segment

The prompt line shows `🪃 72%` beside `✚ junkd`: context usage, green below the threshold, yellow within
10 points of it, red past it. It shows `🪃 off` while the loop is disarmed and `🪃 handoff…` /
`🪃 resume…` while a handoff is in flight. Clicking the segment opens or closes the pane. Turn it off
with the `handoff_segment` setting.

### Pane

Tabs switch with `1`, `2` and `3`. `q` closes the pane. `/junkd` opens it as a tab beside the junkd and
orch panes; it also opens on its own (`/junkd:handoff panel`, the segment).

| Tab | Shows | Keys |
|---|---|---|
| 1 Auto | Armed or off, a context bar against the threshold, the continuation prompt, the last handoff and this session's handoffs | `a` arm or `o` off, `p` set prompt, `n` handoff now, `r` resume last |
| 2 Handoffs | Every file in `~/.claude/handoffs`, newest first, with id, time and title; stale ones in yellow | `j`/`k` move, `enter` handon, `v` view (`b` back), `c` copy id, `x` delete (press twice), `f` filter, `m` show more, `n` save now |
| 3 Settings | The settings below, the handoffs folder and its file count, the version | `u` enabled, `t` threshold, `e` check every, `s` arm at start, `l` resume after 5h limit, `a` stale days, `d` delete stale, `o` open folder, `g` segment |

### Settings

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

#### Moving from the handoff plugin

The settings moved with the plugin. Before, they were rows of the `handoff` plugin; now they are rows of
`junkd`, keyed `handoff_<field>`. In `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`):

| Before | Now |
|---|---|
| `pluginConfigs["handoff@junk-drawer"].options.<field>` | `pluginConfigs["junkd@junk-drawer"].options.handoff_<field>` |
| `/config` row `handoff.<field>` | `/config` row `junkd.handoff_<field>` |
| `/handoff`, `/handoff:handoff` | `/junkd:handoff` |
| `/handon`, `/handoff:handon` | `/junkd:handon` |
| `/ahandoff` | `/junkd:ahandoff` |
| `$.handoff.<method>` | `$.junkd` (below) |

Nothing is copied over: set the values you changed again (the Settings tab or `/config`), or rename the
keys in settings.json by hand, for example `"threshold": 70` under `handoff@junk-drawer` becomes
`"handoff_threshold": 70` under `junkd@junk-drawer`. The saved handoffs need nothing.

`ctx-limit` stays a separate, manual safeguard.

### API for other plugins

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

## Support per harness

| | `/junkd:handoff` | `/junkd:handon` | `/junkd:handoff auto`, `/junkd:ahandoff` |
|---|---|---|---|
| Claude Code | yes | yes | yes |
| Codex | `$handoff` | `$handoff resume <id>` | no (manual) |
| Kimi | `/skill:handoff` | `/skill:handoff` | no (manual) |
| OpenCode | skill | skill | no (manual) |
