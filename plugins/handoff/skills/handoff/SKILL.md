---
name: handoff
description: Save a durable Markdown handoff for the current task or resume a prior handoff by short id. Use when work should continue in a fresh session or task, before switching context, or when the user asks to save, load, resume, hand off, or pick up earlier work.
---

# Handoff

Choose `save` or `resume` from the request. Default to `save` when the user asks to hand work off, and to `resume` when they provide an id or ask to pick work up.

Set `JUNK_DRAWER_RUNTIME` to your host when running the helpers: `codex` on Codex, `kimi` on Kimi Code. Claude Code needs no variable.

## Save

1. From this skill directory, run `JUNK_DRAWER_RUNTIME=<host> ../../bin/handoff-path`.
2. Use line 1 as the output file and line 2 as the short id.
3. Write a concrete Markdown handoff: objective and rationale, current state, completed work, next actions, key paths and commands, decisions, and gotchas. Assume the next session has no conversation context.
4. Report `saved - id <id>`. Mention that a fresh session can resume with this skill and the id.

## Resume

1. Run `JUNK_DRAWER_RUNTIME=<host> ../../bin/handoff-load [id]`; omit the id to load the newest handoff.
2. Treat the output as working context.
3. Confirm what was picked up in one sentence. Continue immediately only if the user asked to continue; otherwise wait.

Handoffs live under the host's data root: `${CODEX_HOME:-$HOME/.codex}/junk-drawer/handoffs/` on Codex, `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/handoffs/` on Kimi Code, `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/handoffs/` on Claude Code.
