# handoff

Codex: use `$handoff` to save, or `$handoff resume <id>` to restore. Codex handoffs live under
`~/.codex/junk-drawer/handoffs`; Claude Code retains the paths below.

Save the state of a session to disk and pick it up in a fresh one — by id, not copy-paste.

- **`/handoff`** — writes a handoff to `~/.claude/handoffs/<date>_<id>.md`, prints a short session id and copies it to your clipboard.
- **`/handon <id>`** — in a new session, loads that handoff as context. No id → loads the newest.

A skills-only install (`npx skills add Krab00/junk-drawer`) has no slash commands, so the resume half
ships as its own skill: `handon` takes the same optional id and delegates to `handoff`. On Claude Code
that makes it invocable as `/handon <id>` even without the plugin.

Files live in `~/.claude/handoffs/` (`$CLAUDE_CONFIG_DIR/handoffs/` when that is set; outside the plugin cache, so they survive updates). The date + id in each filename make old handoffs greppable.

Session id comes from `$CLAUDE_CODE_SESSION_ID`.

Install: `/plugin install handoff --marketplace Krab00/junk-drawer`.

## Auto handoff and panel (Claude Code only)

The hooks module (`hooks/register.tsx`) adds three arguments to `/handoff` and, while the loop is armed, resumes a turn that died on the 5h rate limit (below). Bare `/handoff` with no
argument still saves a handoff as above. Plugin commands are namespaced, so the full form is
`/handoff:handoff`; `/handoff` works when no other command claims the name.

- **`/handoff auto [prompt]`**: arm the loop and open the pane on the Auto tab. The optional prompt is
  the task to run right now (`/orch:orch all` runs as a command); without one the loop is only armed.
- **`/handoff off`**: disarm the loop.
- **`/handoff panel`**: open the pane, or close it when it is open.
- **`/ahandoff [prompt] | off | panel`**: the short form of the three above, without the pane
  (`/ahandoff /orch:orch all` arms the loop and runs the command).

Loop: every `checkEvery` tool calls the hook reads context usage. Past `threshold` it denies every tool
except the handoff itself and tells the model to write one. When that turn ends it runs `/clear`, then
`/handon <id>`, then sends the continuation prompt — `Continue after the handoff` unless you change it
with `p` on the Auto tab (a `/command` runs as a command). It repeats until `/handoff off`. A fresh window
that already starts at or over the threshold hands off again after that many more points of growth.

### Resume after the 5h rate limit

An armed loop also survives the 5-hour rate limit. When a turn dies with the window at 100%, the mod
sets one timer for 2 minutes after the window resets (the host reports the reset time with every
measurement) and sends the continuation prompt then — your `/ahandoff` prompt, or `Continue where
the rate limit stopped you`. No handoff is needed: the session keeps its context. The segment shows
`🪃 limit → 14:32` meanwhile. There is no recurring timer: the next limit hit schedules the next
resume. `/ahandoff off` or the `resumeAfterLimit` setting (`l` on the Settings tab) turns it off. The
timer lives in the running session; after a restart you only get a toast that a resume was pending.

### Status line segment

The prompt line shows `🪃 72%`: context usage, green below the threshold, yellow within 10 points of
it, red past it. It shows `🪃 off` while the loop is disarmed and `🪃 handoff…` / `🪃 resume…` while a
handoff is in flight. Clicking the segment opens or closes the pane. Turn it off with the `segment` setting.

### Pane

Tabs switch with `1`, `2` and `3`. `q` closes the pane.

| Tab | Shows | Keys |
|---|---|---|
| 1 Auto | Armed or off, a context bar against the threshold, the continuation prompt, the last handoff and this session's handoffs | `a` arm or `o` off, `p` set prompt, `n` handoff now, `r` resume last |
| 2 Handoffs | Every file in `~/.claude/handoffs`, newest first, with id, time and title; stale ones in yellow | `j`/`k` move, `enter` handon, `v` view (`b` back), `c` copy id, `x` delete (press twice), `f` filter, `m` show more, `n` save now |
| 3 Settings | The settings below, the handoffs folder and its file count, the version | `u` enabled, `t` threshold, `e` check every, `s` arm at start, `l` resume after 5h limit, `a` stale days, `d` delete stale, `o` open folder, `g` segment |

### Settings

Set them in the Settings tab or in `/config` under plugin `handoff`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | The auto handoff at all. Off: the loop cannot be armed (`/ahandoff` and `/handoff auto` say so, `autoOn` is ignored, an armed loop disarms at once and a pending 5h-limit resume is dropped) and the `🪃` segment is hidden. `/handoff`, `/handon` and the pane keep working |
| `threshold` | number | `85` | Context usage in percent that triggers the handoff; above 0, up to 100 |
| `checkEvery` | number | `5` | How often, in tool calls, usage is read mid-turn; a whole number, 1 or more (`2.6` is refused, not rounded) |
| `autoOn` | boolean | `false` | Arm the loop at every session start |
| `resumeAfterLimit` | boolean | `true` | Send the continuation prompt 2 minutes after the 5h window resets when a turn died on the limit |
| `staleDays` | number | `30` | Handoffs older than this are marked stale and removed by `d`; above 0 |
| `segment` | boolean | `true` | Show the `🪃` segment in the prompt line |

A value outside these is refused by `$.handoff.set` and the `/config` menu alike (the Settings tab is stricter still:
whole numbers); a write from either applies at once. A refused option at load falls back to its default.
Scope: user-global; project/session overrides: planned.

`ctx-limit` stays a separate, manual safeguard. The [junkd](../junkd/README.md) frame shows the main
rows of this table in its own pane through `$.handoff` (below); it is optional, handoff works without it.

### API for other plugins

The hooks module adds `$.handoff` to the engine's `$`, so another mod (a frame that shows the main
settings and jumps into the pane) calls it instead of reading this plugin's files. The host hands a
noun's method one input and answers every call asynchronously, so each takes one argument and returns a
promise. List `handoff` under `dependencies` in your plugin.json and the engine lays its contract
(`types/index.d.ts`, exported as `Handoff`) beside the API reference, typed.

- `schema()` — one entry per setting: `{ key, type, title, default, main }`; `main` marks `enabled`,
  `threshold`, `autoOn`, `resumeAfterLimit` and `segment`, the five a frame shows first (`enabled` leads).
- `get(key)` — the current value of a setting (the `/config` row at load, then every `set`).
- `set({ key, value, scope? })` — writes `handoff.<key>` through `$.config` and resolves to the stored
  value; refused (unknown key, a value that does not fit, a `config.set` hook's deny) it rejects with
  the reason. `scope` takes only `user` today; the field exists so project or session scopes can be
  added later without changing callers.
- `open({ route? })` — the same path as `/handoff panel` and the 🪃 click: toggles the pane; with a
  route (`auto`, `handoffs`, `settings`) it opens on that tab, or switches the tab while the pane is up.
- `show({ route?, focus?, owner? })` — opens the pane and never closes it: on `route` when given;
  `focus` asks for the keys; `owner` marks the pane as the caller's (junkd opens its set of panes this
  way).
- `hide({ owner? })` — closes the pane; with `owner`, only while the pane is still the one that owner's
  `show` opened (any other open or close since, the person's included, clears the mark).
- `status()` — `{ armed, percent, phase }` of the auto loop.

Can a mod read another plugin's `$.config` keys? Yes. There is no `$.config.get`; `$.config.list()`
returns every row of the `/config` menu, the engine's own and each enabled plugin's `userConfig`
fields alike, keyed `<plugin>.<field>` with its current `value`, `kind`, owner and lock, so a mod reads
`handoff.threshold` by finding that row (the API reference documents `list` as "each enabled plugin's
userConfig fields alike"; a row a `config.describe` hook hides is left out, a managed one shows
`isLocked`). Writing works the same way: `$.config.set({ key: 'handoff.threshold', value })` changes
another plugin's row as the person would in the menu, through the other plugins' hooks, which may deny
it. `$.handoff.get` and `set` are the typed, validated shortcut over those rows, nothing more.

## Support per harness

| | `/handoff` | `/handon` | `/handoff auto` |
|---|---|---|---|
| Claude Code | yes | yes | yes |
| Codex | `$handoff` | `$handoff resume <id>` | no (manual) |
| Kimi | `/skill:handoff` | `/skill:handoff` | no (manual) |
| OpenCode | skill | skill | no (manual) |
