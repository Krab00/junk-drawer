# molt

Context-limit **orchestrator**. Near the token limit, the agent sheds its full context like a snake
sheds its skin (*molt*): it writes a handoff, spawns a **fresh claude session** that loads the
handoff and continues the work, and turns on remote control — no `/clear`, no lost thread.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install molt@junk-drawer
```

Requires [`herdr`](https://herdr.dev) (running server) for the spawn path, and `jq`.

## Usage

- `/molt` — write a handoff, then spawn a fresh claude tab via herdr, seed it with the handoff, and
  enable remote control. The new session picks the work back up on its own; the old tab can be closed.

## Auto-molt at a limit

Two complementary triggers, both **default-off**:

- **User side — [`ctx-limit`](../ctx-limit):** `/ctx-limit on` (default 300000). Past the limit it
  blocks *your* next prompt and tells you to `/molt`. Gates the *start* of a turn, not mid-turn work.
- **Agent side — `/molt auto on`:** a **Stop hook**. When *the agent's* context crosses the limit
  (`/molt limit <N>`, default 300000) it blocks the stop and makes the agent molt — write a handoff
  and spawn the successor — before finishing. This catches a long agentic turn that a UserPromptSubmit
  hook can't see. `stop_hook_active` guards against a loop (it forces at most one molt per turn-end).

## How the spawn works (herdr)

`bin/molt-spawn <handoff-file> [cwd] [name]` drives herdr over its socket — **verified, not blind**
(it reads the new session's screen; no osascript, no Screen Recording, no fixed sleeps):

1. `herdr agent start <name> --cwd <dir> -- claude` — new tab.
2. `herdr agent wait --status idle` — wait until claude is ready.
3. Inject a **self-contained** prompt pointing at the handoff file (a fresh session has no `/handon`
   command, so molt sends the full instruction, not the slash command).
4. Inject `/remote-control`.

Injection recipe: `pane send-text` → `wait output --match` (let it render) → `pane send-keys Enter`.
Pressing Enter immediately after the text does not submit.

## Fallback (no herdr)

If `molt-spawn` fails, `/molt` falls back to in-place mode: `bin/molt-mark` arms
`~/.claude/molt-pending` (`<epoch> <id>`, 1h guard) and you run `/clear`; the SessionStart hook
`bin/molt-restore` reloads the handoff in the same tab. Handoffs live in `~/.claude/molt-handoffs/`.

> Not yet: auto-closing the old session after a successful spawn.
