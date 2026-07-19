---
name: ctx-limit
description: Configure, disable, or inspect a context-window threshold enforced by a lifecycle hook. Use when the user asks for a context limit, token guard, warning near compaction, context threshold status, or a command to run when usage crosses a limit.
---

# Context limit

Run the bundled controller from this skill directory (set the runtime to your host: `codex` or `kimi`; omit on Claude Code):

```bash
JUNK_DRAWER_RUNTIME=<host> ../../bin/ctx-limit <arguments>
```

Supported forms are `status`, `on`, `off`, `<tokens>` with optional `k` or `m`, `action <block|warn|cmd>`, and `cmd <shell command>`. Return the controller output verbatim.

The bundled `UserPromptSubmit` hook reads context usage from the session transcript: `token_count` events on Codex, `step.end` usage records on Kimi Code (resolved from the hook's `session_id`), and `transcript_path` usage blocks on Claude Code. Transcript layouts are not stable APIs, so failure to find a supported usage record must fail open. Recommend the host's native context indicator as the stable visual reference.

On Codex, `block` returns structured hook JSON; on Kimi Code and Claude Code the hook blocks with exit code 2 and a stderr reason (both hosts treat `UserPromptSubmit` as blockable). On Kimi Code the hook must be declared in the plugin manifest's `hooks` to be active. Never let the guard block its own disable or handoff operations.
