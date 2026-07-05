---
description: TL;DR — summarize your last real message in ≤N sentences, or on/off/status for terse mode
argument-hint: "[N | on | off | status]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/tldr-flag:*)
---

Argument: "$ARGUMENTS"

- If the argument is `on`, `off`, or `status`: run `${CLAUDE_PLUGIN_ROOT}/bin/tldr-flag $ARGUMENTS`, report its one-line output, and do nothing else.
- Otherwise: write a TL;DR, in at most N sentences (N = the argument if it is a number, else 3), of your most recent **substantive** message — skip any earlier replies you produced in response to a `/tldr` command, and always summarize the original message itself, never a summary of it (so repeated `/tldr` calls all condense the same original, not each other). Result only, no preamble. If there is no substantive message to summarize, say so in one line — do not invent one.
