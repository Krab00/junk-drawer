---
description: TL;DR — summarize your last message in ≤N sentences, or on/off to keep every reply terse
argument-hint: "[N | on | off]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/tldr-flag:*)
---

Argument: "$ARGUMENTS"

- If the argument is `on` or `off`: run `${CLAUDE_PLUGIN_ROOT}/bin/tldr-flag $ARGUMENTS`, report its one-line output, and do nothing else.
- Otherwise: write a TL;DR of your previous message in at most N sentences (N = the argument if it is a number, else 3). Result only — no preamble.
