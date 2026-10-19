---
name: handon
description: Resume a saved handoff by short id, or the newest one when no id is given. Use as the resume half of the handoff skill, when the user asks to pick up, load, or continue earlier work in a fresh session or task.
argument-hint: "[id]"
---

# Resume a handoff

Argument: "$ARGUMENTS"

Load the handoff with that id (a fragment is enough), or the newest one when the argument is empty:

- Claude Code: run `${CLAUDE_PLUGIN_ROOT}/bin/handoff-load $ARGUMENTS` and use its output.
- Other hosts: invoke the `handoff` skill in resume mode with that id, through the mechanism your host provides: `$handoff resume <id>` on Codex, `/skill:handoff` on Kimi Code, the `skill` tool on OpenCode.

If the helper finds no handoff, say so in one line and stop.

Treat the loaded handoff as the working context for this session. Then confirm in one line what you picked up (the handoff's topic) and wait. Do not act on it until the user tells you to. (The auto handoff loop sends its continuation prompt right after this command; that prompt is the user telling you to continue.)
