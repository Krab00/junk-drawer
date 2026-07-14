---
name: molt
description: Capture a complete continuation handoff before compaction or start a fresh Codex CLI session seeded with that handoff. Use when context is nearly full, the user asks to molt or continue in a fresh task, or a long-running task needs a durable context boundary.
---

# Molt

Codex already compacts context automatically. Use this workflow when the user wants an explicit durable boundary or a genuinely fresh task.

## Configure automatic warning

For `auto on`, `auto off`, `auto status`, or `limit <tokens>`, run:

```bash
JUNK_DRAWER_RUNTIME=codex ../../bin/molt-auto <arguments>
```

The Stop hook warns when the locally observed context usage crosses the configured threshold. The
Codex default is 200k tokens; Claude Code keeps 300k. Treat the warning as best effort because
transcript format is not a stable Codex API.

## Create a continuation

1. Run `JUNK_DRAWER_RUNTIME=codex ../../bin/molt-path` from this skill directory.
2. Write a self-contained Markdown handoff to the path on line 1. Include objective, state, completed work, next actions, paths, commands, decisions, approvals, and gotchas.
3. By default, report the short id and tell the user to start a fresh task with `$handoff resume <id>` or ask Codex to read the file.
4. Only when the user explicitly asks to spawn a terminal successor, run `JUNK_DRAWER_RUNTIME=codex ../../bin/molt-spawn <handoff-path> <project-dir>`. This optional path requires a running `herdr` server and starts `codex`, without Claude-only rename, color, or remote-control commands.

Never close the old task automatically. Do not claim the successor started unless `molt-spawn` verifies the new pane.
