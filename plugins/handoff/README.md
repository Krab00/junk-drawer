# handoff

Codex: use `$handoff` to save, or `$handoff resume <id>` to restore. Codex handoffs live under
`~/.codex/junk-drawer/handoffs`; Claude Code retains the paths below.

Save the state of a session to disk and pick it up in a fresh one — by id, not copy-paste.

- **`/handoff`** — writes a handoff to `~/.claude/handoffs/<date>_<id>.md`, prints a short session id and copies it to your clipboard.
- **`/handon <id>`** — in a new session, loads that handoff as context. No id → loads the newest.

A skills-only install (`npx skills add Krab00/junk-drawer`) has no slash commands, so the resume half
ships as its own skill: `handon` takes the same optional id and delegates to `handoff`. On Claude Code
that makes it invocable as `/handon <id>` even without the plugin.

Files live in `~/.claude/handoffs/` (outside the plugin cache, so they survive updates). The date + id in each filename make old handoffs greppable.

Session id comes from `$CLAUDE_CODE_SESSION_ID`.

Install: `/plugin install handoff --marketplace Krab00/junk-drawer`.

## Auto handoff and panel (Claude Code only)

The hooks module (`hooks/register.tsx`) adds three arguments to `/handoff`. Bare `/handoff` with no
argument still saves a handoff as above. Plugin commands are namespaced, so the full form is
`/handoff:handoff`; `/handoff` works when no other command claims the name.

- **`/handoff auto [prompt]`**: arm the loop and open the pane on the Auto tab. The optional prompt is
  re-sent after each handoff; without one the loop re-sends the last prompt you typed (e.g. `/orch:orch all`).
- **`/handoff off`**: disarm the loop.
- **`/handoff panel`**: open the pane, or close it when it is open.
- **`/ahandoff [prompt] | off | panel`**: the short form of the three above (`/ahandoff /orch:orch all`).

Loop: every `checkEvery` tool calls the hook reads context usage. Past `threshold` it denies every tool
except the handoff itself and tells the model to write one. When that turn ends it runs `/clear`, then
`/handon <id>`, then re-submits the continuation prompt. It repeats until `/handoff off`. A fresh window
that is already over the threshold disarms the loop instead of looping.

### Status line segment

The prompt line shows `🪃 72%`: context usage, green below the threshold, yellow within 10 points of
it, red past it. It shows `🪃 off` while the loop is disarmed and `🪃 handoff…` / `🪃 resume…` while a
handoff is in flight. Clicking the segment opens or closes the pane. Turn it off with the `segment` setting.

### Pane

Tabs switch with `1`, `2` and `3`. `q` closes the pane.

| Tab | Shows | Keys |
|---|---|---|
| 1 Auto | Armed or off, a context bar against the threshold, the continuation prompt, the last handoff and this session's handoffs | `a` arm or `o` off, `p` set prompt, `l` use last prompt, `n` handoff now, `r` resume last |
| 2 Handoffs | Every file in `~/.claude/handoffs`, newest first, with id, time and title; stale ones in yellow | `j`/`k` move, `enter` handon, `v` view (`b` back), `c` copy id, `x` delete (press twice), `f` filter, `m` show more, `n` save now |
| 3 Settings | The settings below, the handoffs folder and its file count, the version | `t` threshold, `e` check every, `s` arm at start, `w` continue with, `a` stale days, `d` delete stale, `o` open folder, `g` segment |

### Settings

Set them in the Settings tab or in `/config` under plugin `handoff`.

| Setting | Default | Meaning |
|---|---|---|
| `threshold` | 85 | Context usage in percent that triggers the handoff |
| `checkEvery` | 5 | How often, in tool calls, usage is read mid-turn |
| `autoOn` | off | Arm the loop at every session start |
| `continueWith` | `last prompt` | Re-send the last prompt you typed, or a `fixed` one set with `p` |
| `staleDays` | 30 | Handoffs older than this are marked stale and removed by `d` |
| `segment` | on | Show the `🪃` segment in the prompt line |

`ctx-limit` stays a separate, manual safeguard.

## Support per harness

| | `/handoff` | `/handon` | `/handoff auto` |
|---|---|---|---|
| Claude Code | yes | yes | yes |
| Codex | `$handoff` | `$handoff resume <id>` | no (manual) |
| Kimi | `/skill:handoff` | `/skill:handoff` | no (manual) |
| OpenCode | skill | skill | no (manual) |
