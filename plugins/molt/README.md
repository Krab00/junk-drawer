# molt

Context-limit **orchestrator**. Near the token limit, the agent sheds its full context like a snake
sheds its skin (*molt*): it writes a handoff, you `/clear`, and the fresh session **auto-restores**
the handoff and continues the work. molt is self-contained — it writes and reads its own handoffs.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install molt@junk-drawer
```

## Usage

- `/molt` — write a handoff, arm the next session to restore it, then tells you to run `/clear`.
  The new session picks the work back up automatically.

**Detection is delegated to [`ctx-limit`](../ctx-limit).** Install it and run `/ctx-limit on`
(default 300000 tokens): when you cross the limit it blocks the prompt and tells you to `/molt`.
molt itself has no detector — it's just the shed + restore half of the loop.

Handoffs live in `~/.claude/molt-handoffs/`. A pending restore is marked in `~/.claude/molt-pending`
(1h guard so a stale marker can't hijack an unrelated `/clear`).

### Chain name + color

`/molt` prints a suggested `/rename <base>_N` and `/color <color>` so a chain of molted sessions
stays visually consistent. Those are user-side commands — molt can't type them for you (no cmux
socket auth), so it just hands you the exact commands to paste.

> Not yet: auto-spawning / closing cmux workspaces and read-screen verification. That needs
> authorized access to the cmux socket (`CMUX_SOCKET_PASSWORD`); until then molt is in-place only.
