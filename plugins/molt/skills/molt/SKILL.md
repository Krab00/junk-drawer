---
name: molt
description: Capture a complete continuation handoff before compaction or start a fresh session seeded with that handoff. Use when context is nearly full, the user asks to molt or continue in a fresh session, or a long-running task needs a durable context boundary.
---

# Molt

Most hosts compact context automatically. Use this workflow when the user wants an explicit durable boundary or a genuinely fresh session.

Set `JUNK_DRAWER_RUNTIME` to your host when running the helpers: `codex` on Codex, `kimi` on Kimi Code. Claude Code needs no variable.

## Configure automatic warning

For `auto on`, `auto off`, `auto status`, or `limit <tokens>`, run:

```bash
JUNK_DRAWER_RUNTIME=<host> ../../bin/molt-auto <arguments>
```

The Stop hook warns when the locally observed context usage crosses the configured threshold (default 200k on Codex and Kimi Code, 300k on Claude Code). Treat the warning as best effort because transcript formats are not stable APIs. On Kimi Code the hook must be declared in the plugin manifest's `hooks` to be active.

## Create a continuation

1. Run `JUNK_DRAWER_RUNTIME=<host> ../../bin/molt-path` from this skill directory.
2. Write a self-contained Markdown handoff to the path on line 1. Include objective, state, completed work, next actions, paths, commands, decisions, approvals, and gotchas.
3. By default, report the short id and tell the user to start a fresh session with the handoff skill (`resume <id>`) or ask the agent to read the file.
4. Only when the user explicitly asks to spawn a terminal successor, run `JUNK_DRAWER_RUNTIME=<host> ../../bin/molt-spawn <handoff-path> <project-dir>`. This optional path requires a running `herdr` server and starts the host CLI (`codex`, `kimi`, or `claude`), without Claude-only rename, color, or remote-control commands.

Never close the old session automatically. Do not claim the successor started unless `molt-spawn` verifies the new pane.
