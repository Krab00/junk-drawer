---
name: handoff
description: Save a durable Markdown handoff for the current task or resume a prior handoff by short id. Use when work should continue in a fresh Codex task, before switching context, or when the user asks to save, load, resume, hand off, or pick up earlier work.
---

# Handoff

Choose `save` or `resume` from the request. Default to `save` when the user asks to hand work off, and to `resume` when they provide an id or ask to pick work up.

## Save

1. From this skill directory, run `JUNK_DRAWER_RUNTIME=codex ../../bin/handoff-path`.
2. Use line 1 as the output file and line 2 as the short id.
3. Write a concrete Markdown handoff: objective and rationale, current state, completed work, next actions, key paths and commands, decisions, and gotchas. Assume the next task has no conversation context.
4. Report `saved - id <id>`. Mention that a fresh task can invoke `$handoff resume <id>`.

## Resume

1. Run `JUNK_DRAWER_RUNTIME=codex ../../bin/handoff-load [id]`; omit the id to load the newest handoff.
2. Treat the output as working context.
3. Confirm what was picked up in one sentence. Continue immediately only if the user asked to continue; otherwise wait.

Handoffs live under `${CODEX_HOME:-$HOME/.codex}/junk-drawer/handoffs/`.
