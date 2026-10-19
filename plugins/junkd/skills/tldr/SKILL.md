---
name: tldr
description: Summarize your own most recent substantive reply in at most N sentences (default 3), or turn persistent terse-response mode on, off, or report its status. Use when the user asks for a TLDR, a shorter version of the last answer, or persistent concise replies.
argument-hint: "[N | on | off | status]"
---

# TL;DR

Argument: "$ARGUMENTS"

Interpret the argument (the text after the command; on hosts that do not fill `$ARGUMENTS` above, the text the user gave with the skill). The command is `/junkd:tldr` on Claude Code, `$tldr` on Codex, `/skill:tldr` on Kimi Code, and `/tldr` on OpenCode (the command wrapper `bin/opencode-commands.sh` generates) or "use the tldr skill".

- `on`, `off`, or `status`: run `./bin/tldr-flag <argument>` from this skill directory, report its one-line output, and do nothing else. The helper detects the host (Claude Code, Codex, Kimi Code, OpenCode); if it exits 2 saying it cannot tell, run it again with `JUNK_DRAWER_RUNTIME` set to yours: `claude`, `codex`, `kimi` or `opencode`. On Codex and Kimi Code the plugin root has no `bin/` (their installers drop or rewrite its symlinks): use `./bin` inside this skill. On Claude Code, `${CLAUDE_PLUGIN_ROOT}/bin/tldr-flag` is the same script.
- A positive integer N: write a TL;DR of your own most recent **substantive** reply in at most N sentences.
- No argument: the same in at most 3 sentences. (On Claude Code, the junkd hooks module fills in the `tldr_sentences` setting as the number before this text is reached.)

For a summary: skip any earlier replies produced in response to this command, and always summarize the original message itself, never a summary of it, so repeated calls all condense the same original, not each other. Return the result only, no preamble. If there is no substantive message to summarize, say so in one line; do not invent one.

Terse mode: while it is on, the bundled `UserPromptSubmit` hook (`bin/tldr-hook`) injects the be-terse instruction on every turn, in every session of that host. The flag is stored per host and does not leak across hosts:

- Claude Code: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/tldr-on`. The hook is also silent while the `tldr_enabled` setting is off, whatever the flag says (`status` still reports the flag).
- Codex: `${CODEX_HOME:-$HOME/.codex}/junk-drawer/tldr-on`. Codex runs a plugin hook only after you trust it: a session start asks you to review the plugin's hooks; until then `on` only records the flag.
- Kimi Code: `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/tldr-on`. The hook is the one the plugin manifest declares in its `hooks`.
- OpenCode: `${XDG_DATA_HOME:-$HOME/.local/share}/opencode/junk-drawer/tldr-on`. OpenCode has no hook for it: `on` only records the flag and replies do not change; say so when you report the output.
