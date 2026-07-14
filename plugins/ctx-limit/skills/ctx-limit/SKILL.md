---
name: ctx-limit
description: Configure, disable, or inspect a context-window threshold enforced by a lifecycle hook. Use when the user asks for a context limit, token guard, warning near compaction, context threshold status, or a command to run when usage crosses a limit.
---

# Context limit

Run the bundled controller from this skill directory:

```bash
JUNK_DRAWER_RUNTIME=codex ../../bin/ctx-limit <arguments>
```

Supported forms are `status`, `on`, `off`, `<tokens>` with optional `k` or `m`, `action <block|warn|cmd>`, and `cmd <shell command>`. Return the controller output verbatim.

The bundled `UserPromptSubmit` hook reads Codex `token_count` events from `transcript_path`. Codex documents transcript layout as unstable, so failure to find a supported usage record must fail open. Recommend the native CLI `context-remaining` status item as the stable visual indicator.

For Codex, `block` returns structured hook JSON; for Claude Code, the same hook retains the original exit-code behavior. Never let the guard block its own disable or handoff operations.
