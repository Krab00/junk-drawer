---
description: Save a handoff of the current session to ~/.claude/handoffs and return its id
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/handoff-path:*), Write
---

Write a handoff so a fresh session (zero prior context) can resume this work.

1. Run `${CLAUDE_PLUGIN_ROOT}/bin/handoff-path`. It prints the target file path (line 1) and a short session id (line 2), creates the handoffs dir, and copies the id to the clipboard.
2. Compose the handoff in markdown: what we're doing and why, current state, what's done, what's next, key paths/commands/decisions, and any gotchas learned this session. Concrete, no fluff — assume the reader knows nothing.
3. Write it to that path with the Write tool.
4. Report in one line: `saved — id <id> (on clipboard). New session: /handon <id>`.
