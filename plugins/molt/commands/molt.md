---
description: Shed context — write a handoff, mark it pending, then /clear into a fresh session that auto-restores it.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/molt-path:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/molt-mark:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/molt-chain:*), Write
---

**Perform a molt** — shed this session's context into a fresh one:

1. Run `${CLAUDE_PLUGIN_ROOT}/bin/molt-path`. It prints the target file path (line 1) and a short session id (line 2), and creates the molt-handoffs dir.
2. Compose the handoff in markdown: what we're doing and why, current state, what's done, what's next, key paths/commands/decisions, and any gotchas learned this session. Concrete, no fluff — assume the reader knows nothing. Write it to that path with the Write tool.
3. Run `${CLAUDE_PLUGIN_ROOT}/bin/molt-mark <id>` with the short id from step 1. This arms the next fresh session to auto-restore the handoff (guarded to 1 hour).
4. Run `${CLAUDE_PLUGIN_ROOT}/bin/molt-chain` (pass a short topic slug the first time, e.g. `molt-chain junk-drawer`). It prints `<name>\t<color>`.
5. Report in one line, then tell the user exactly what to do next:
   - `molted — handoff saved (id <id>). Run /clear now; the fresh session auto-restores it.`
   - Optional, on its own line: `Keep the chain visible: /rename <name> and /color <color>` (from step 4). molt can't run these itself — they're user-side commands.
