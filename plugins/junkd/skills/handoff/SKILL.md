---
name: handoff
description: Save a durable Markdown handoff for the current task or resume a prior handoff by short id. Use when work should continue in a fresh session or task, before switching context, or when the user asks to save, load, resume, hand off, or pick up earlier work.
argument-hint: "[panel | auto [prompt] | off]"
---

# Handoff

Choose `save` or `resume` from the request. Default to `save` when the user asks to hand work off, and to `resume` when they provide an id or ask to pick work up.

Set `JUNK_DRAWER_RUNTIME` to your host when running the helpers: `codex` on Codex, `kimi` on Kimi Code. Claude Code needs no variable.

## Save

1. From this skill directory, run `JUNK_DRAWER_RUNTIME=<host> ./bin/handoff-path`. It creates the handoffs folder, prints the target file path (line 1) and a short session id (line 2), and copies the id to the clipboard where the host has one.
2. Use line 1 as the output file and line 2 as the short id.
3. Write a concrete Markdown handoff with your file-writing tool: objective and rationale, current state, completed work, next actions, key paths and commands, decisions, and gotchas learned this session. Start it with a `# ` title line (the handoff list shows it). No filler; assume the next session has no conversation context.
4. Report in one line: `saved - id <id>`, and how a fresh session resumes it: `/junkd:handon <id>` on Claude Code, the `handon` skill (or this skill in resume mode) with the id elsewhere.

## Resume

1. Run `JUNK_DRAWER_RUNTIME=<host> ./bin/handoff-load [id]` from this skill directory; omit the id to load the newest handoff. An id fragment is enough.
2. Treat the output as working context.
3. Confirm what was picked up in one sentence. Continue immediately only if the user asked to continue; otherwise wait.

Handoffs live under the host's data root: `${CODEX_HOME:-$HOME/.codex}/junk-drawer/handoffs/` on Codex, `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/handoffs/` on Kimi Code, `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/handoffs/` on Claude Code.

## panel, auto, off

On Claude Code with the junkd plugin's hooks module loaded, `/junkd:handoff panel` (toggle the handoff pane), `/junkd:handoff auto [prompt]` (arm the auto handoff loop: handoff, `/clear`, `/junkd:handon <id>`, continue) and `/junkd:handoff off` are answered by the module before this text is reached. If the argument is one of these and you are reading this, the module is not loaded: on Claude Code, tell the user in one line to run `/reload-plugins` after enabling `junkd@junk-drawer`; on any other host, say in one line that the pane and the auto loop are a Claude Code mod feature. Do nothing else.
