---
description: Set a context-size limit for this session. Past the threshold the hook blocks the prompt, warns, or runs a command. Configure with a number, off, action <mode>, or cmd <shell>.
argument-hint: "[<tokens e.g. 300k> | on | off | status | action <block|warn|cmd> | cmd <shell>]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/ctx-limit:*)
---

Argument: "$ARGUMENTS"

Run `${CLAUDE_PLUGIN_ROOT}/bin/ctx-limit $ARGUMENTS` and print its output verbatim. The CLI handles everything (set threshold / off / status / action / cmd). The limit is read fresh each turn by the UserPromptSubmit hook, so any change takes effect on the next prompt — no new session.
