---
description: Molt — shed context into a FRESH claude session (via herdr) seeded with a handoff; or `auto on|off` / `limit <N>` to auto-molt past a context limit.
argument-hint: "[auto on|off|status | limit <tokens>]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/molt-path:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/molt-spawn:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/molt-mark:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/molt-auto:*), Write
---

Argument: "$ARGUMENTS"

- If the argument starts with `auto` or `limit`: run `${CLAUDE_PLUGIN_ROOT}/bin/molt-auto $ARGUMENTS`, report its one-line output, and do nothing else. (This toggles the Stop hook that auto-molts once context crosses the limit — default 300000, off unless turned on.)
- Otherwise, **perform a molt** — shed this session's context into a fresh one that continues the work:

1. Run `${CLAUDE_PLUGIN_ROOT}/bin/molt-path`. It prints the target file path (line 1) and a short id (line 2), and creates the molt-handoffs dir.
2. Compose a thorough handoff in markdown: what we're doing and why, current state, what's done, what's next, key paths/commands/decisions, and any gotchas learned this session. Concrete, no fluff — assume the reader knows nothing. Write it to that path with the Write tool.
3. Spawn the successor: run `${CLAUDE_PLUGIN_ROOT}/bin/molt-spawn <handoff-path> <project-dir>`, where `<project-dir>` is the repo/root you're working in (already trusted). It opens a fresh claude tab via herdr, seeds it with the handoff, and turns on remote control, then prints the new pane id and a claude.ai/code URL.
   - **If it fails** (e.g. herdr not running — it prints an error and exits non-zero): fall back to in-place mode — run `${CLAUDE_PLUGIN_ROOT}/bin/molt-mark <id>` and tell the user to run `/clear` (the SessionStart hook restores the handoff in the same tab).
4. Report in one line:
   - spawned: `molted → fresh session spawned with remote control on. This tab can be closed.`
   - fallback: `molted — handoff saved (id <id>). Run /clear now; the fresh session auto-restores it.`
