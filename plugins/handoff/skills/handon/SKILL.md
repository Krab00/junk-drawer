---
name: handon
description: Resume a saved handoff by short id, or the newest one when no id is given. Use as the resume half of the handoff skill, when the user asks to pick up, load, or continue earlier work in a fresh session or task.
argument-hint: "[id]"
---

# Resume a handoff

Argument: "$ARGUMENTS"

Invoke the `handoff` skill in resume mode with that id, and omit the id to load the newest handoff.
Use the mechanism your host provides: the Skill tool on Claude Code, `$handoff resume <id>` on Codex,
`/skill:handoff` on Kimi Code, and the `skill` tool on OpenCode.

Treat the loaded handoff as the working context for this session. Then confirm in one line what you
picked up (the handoff's topic) and wait. Do not act on it until the user tells you to.
