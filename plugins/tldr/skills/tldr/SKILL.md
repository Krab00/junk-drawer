---
name: tldr
description: Summarize the latest substantive user request in a bounded number of sentences, or enable, disable, and inspect persistent terse-response mode. Use when the user asks for a TLDR, a shorter answer, a summary of their last real request, or persistent concise replies.
---

# TL;DR

Interpret the user's requested operation:

- A positive integer means summarize the latest substantive user message in at most that many sentences.
- No argument means use three sentences.
- `on`, `off`, or `status` controls persistent terse mode. Set `JUNK_DRAWER_RUNTIME` to your host (`codex` or `kimi`; unset on Claude Code) and run `JUNK_DRAWER_RUNTIME=<host> ../../bin/tldr-flag <operation>` from this skill directory, then return its output.

For a summary, skip messages that only invoke this skill and skip earlier summaries. Always summarize the original substantive user message, not a previous TLDR. Return only the summary. If there is no substantive message, say so in one line.

When terse mode is on, the bundled `UserPromptSubmit` hook injects the concise-response instruction on every turn. The mode flag is stored per host (`${CODEX_HOME:-$HOME/.codex}/junk-drawer/`, `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/`, or `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/`) and does not leak across hosts. On Kimi Code the hook must be declared in the plugin manifest's `hooks` to be active.
