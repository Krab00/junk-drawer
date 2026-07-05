---
description: TL;DR — summarize your last message in ≤N sentences, or on/off/status for terse mode
argument-hint: "[N | on | off | status]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/tldr-flag:*)
---

Argument: "$ARGUMENTS"

- If the argument is `on`, `off`, or `status`: run `${CLAUDE_PLUGIN_ROOT}/bin/tldr-flag $ARGUMENTS`, report its one-line output, and do nothing else.
- Otherwise: write a TL;DR of your previous message in at most N sentences (N = the argument if it is a number, else 3), result only, no preamble. If there is no previous message to summarize (e.g. this is the first turn), reply in one line that there is nothing to summarize — do not invent one.
