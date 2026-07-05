---
description: Resume a handoff in a fresh session by id (or the newest one if omitted)
argument-hint: "[id]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/handoff-load:*)
---

Argument: "$ARGUMENTS"

Run `${CLAUDE_PLUGIN_ROOT}/bin/handoff-load $ARGUMENTS` and load its output as the working context for this session. Then confirm in one line what you picked up (the handoff's topic) and wait — do not act on it until I tell you to.
