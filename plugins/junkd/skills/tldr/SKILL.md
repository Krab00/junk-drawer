---
name: tldr
description: Summarize your own most recent substantive reply in at most N sentences (default 3), or turn persistent terse-response mode on, off, or report its status. Use when the user asks for a TLDR, a shorter version of the last answer, or persistent concise replies.
argument-hint: "[N | on | off | status]"
---

# TL;DR

Argument: "$ARGUMENTS"

Interpret the argument (the text after the command; on hosts that do not fill `$ARGUMENTS` above, the text the user gave with the skill):

- `on`, `off`, or `status`: run `bin/tldr-flag <argument>` from this skill directory (on Claude Code also reachable as `${CLAUDE_PLUGIN_ROOT}/bin/tldr-flag`), report its one-line output, and do nothing else. On Codex and Kimi Code, set `JUNK_DRAWER_RUNTIME` to your host (`codex` or `kimi`): `JUNK_DRAWER_RUNTIME=<host> ./bin/tldr-flag <argument>`. Leave it unset on Claude Code.
- A positive integer N: write a TL;DR of your own most recent **substantive** reply in at most N sentences.
- No argument: the same in at most 3 sentences. (On Claude Code, the junkd hooks module fills in the `tldr_sentences` setting as the number before this text is reached.)

For a summary: skip any earlier replies produced in response to this command, and always summarize the original message itself, never a summary of it, so repeated calls all condense the same original, not each other. Return the result only, no preamble. If there is no substantive message to summarize, say so in one line; do not invent one.

Terse mode: while it is on, the bundled `UserPromptSubmit` hook (`bin/tldr-hook`) injects the be-terse instruction on every turn, in every session of that host. The flag is stored per host and does not leak across hosts: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/tldr-on` on Claude Code, `${CODEX_HOME:-$HOME/.codex}/junk-drawer/tldr-on` on Codex, `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/tldr-on` on Kimi Code. On Claude Code the hook is also silent while the `tldr_enabled` setting is off, whatever the flag says (`status` still reports the flag). On Kimi Code the hook must be declared in the plugin manifest's `hooks` to be active.
