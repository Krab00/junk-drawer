---
name: ctx-limit
description: Configure, disable, or inspect a context-window threshold enforced by a lifecycle hook. Use when the user asks for a context limit, token guard, warning near compaction, context threshold status, or a command to run when usage crosses a limit.
argument-hint: "[<tokens e.g. 300k> | on | off | status | action <block|warn|cmd> | cmd <shell>]"
---

# Context limit

Argument: "$ARGUMENTS"

Run the bundled controller with the argument (on hosts that do not fill `$ARGUMENTS` above, the text the user gave with the skill; none means `status`) and return its output verbatim:

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: run `./bin/ctx-limit <arguments>` from this skill directory (the plugin root has no `bin/` on Codex and Kimi Code: use this skill's own `./bin`). The helper detects the host; if it exits 2 saying it cannot tell, run it again with `JUNK_DRAWER_RUNTIME` set to yours: `codex`, `kimi` or `opencode`.
- Claude Code: the junkd hooks module answers `/junkd:ctx-limit` before this text is reached (it keeps the `ctx_*` settings and the files in step). If you read this, run `${CLAUDE_PLUGIN_ROOT}/bin/ctx-limit <arguments>`.

Supported forms are `status`, `on`, `off`, `<tokens>` with optional `k` or `m`, `action <block|warn|cmd>`, and `cmd <shell command>`.

The state is three files in the host's junkd folder, read fresh each turn by the bundled `UserPromptSubmit` hook (`bin/ctx-limit-hook`), so a change is live:

- Claude Code: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/ctx-limit-{threshold,action,cmd}`.
- Codex: `${CODEX_HOME:-$HOME/.codex}/junk-drawer/junkd/ctx-limit-*`. Codex runs a plugin hook only after you trust it: a session start asks you to review the plugin's hooks.
- Kimi Code: `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/junkd/ctx-limit-*`. The hook is the one the plugin manifest declares in its `hooks`.
- OpenCode: `${XDG_DATA_HOME:-$HOME/.local/share}/opencode/junk-drawer/junkd/ctx-limit-*`. OpenCode has no hook for it: the limit is recorded and not enforced; say so when you report the output.

The hook reads context usage from the session transcript: `token_count` events on Codex, `step.end` usage records on Kimi Code (resolved from the hook's `session_id`), and `transcript_path` usage blocks on Claude Code. Transcript layouts are not stable APIs, so failure to find a supported usage record fails open. Recommend the host's native context indicator as the stable visual reference.

On Codex, `block` returns structured hook JSON; on Kimi Code and Claude Code the hook blocks with exit code 2 and a stderr reason. The guard never blocks its own disable or handoff commands: `/junkd:ctx-limit`, `/junkd:handoff`, `/junkd:handon`, `/junkd:ahandoff`, `/clear`, `$ctx-limit`, `$handoff`, `/skill:ctx-limit`, `/skill:handoff`, `/skill:handon`, `/ctx-limit`, `/handoff`, `/handon` always pass.
