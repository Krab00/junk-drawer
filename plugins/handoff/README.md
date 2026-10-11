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

## /ahandoff

Automatic version of the pair above, for Claude Code only (hooks module `hooks/register.tsx`).

- **`/ahandoff [prompt]`** — arm the loop; the optional prompt is re-sent after each handoff (default: the last prompt you typed, e.g. `/orch:orch all`).
- **`/ahandoff off`** — disarm. **`/ahandoff panel`** — open the side pane.

Loop: every `checkEvery` tool calls the hook reads context usage. Past `threshold` it denies further tools and tells the model to write a handoff via `/handoff`. When that turn ends it runs `/clear`, then `/handon <id>`, then re-submits the continuation prompt. Repeats until you run `/ahandoff off`.

Settings (`/config`, plugin `handoff`): `threshold` (default 85 %), `checkEvery` (default 5 tool calls), `autoOn` (arm at session start, default off).

Panel shows live % vs threshold, on/off, last handoff id, handoff count and the continuation prompt; threshold and `checkEvery` are editable there. Without the panel the status line shows `ahandoff 72%/85%`.

`ctx-limit` stays a separate, manual safeguard.

## Support per harness

| | `/handoff` | `/handon` | `/ahandoff` |
|---|---|---|---|
| Claude Code | yes | yes | yes |
| Codex | `$handoff` | `$handoff resume <id>` | no (manual) |
| Kimi | `/skill:handoff` | `/skill:handoff` | no (manual) |
| OpenCode | skill | skill | no (manual) |
