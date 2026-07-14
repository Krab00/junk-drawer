---
name: ctx-tokens
description: Check current context-window usage for this Codex or Claude Code session. Use when the user asks how many tokens are used or left, how full the context is, or whether to compact, hand off, or start a fresh task.
---

# Check context usage

Remember the active project directory, then run the bundled command from this skill directory and
pass that directory explicitly:

- `../../bin/ctx-tokens --codex --cwd <project-dir> -h` -> human form with used and remaining context.
- `../../bin/ctx-tokens --codex --cwd <project-dir>` -> current input-context tokens as a bare number.
- `../../bin/ctx-tokens --codex <file.jsonl>` -> inspect a specific Codex transcript.

For Claude Code, preserve the original forms:

- `ctx-tokens` → current context tokens as a bare number (e.g. `61951`)
- `ctx-tokens -h` → human form (e.g. `ctx 61k (61951) | out 562`)
- `ctx-tokens <file.jsonl>` → a specific transcript (e.g. a hook's `transcript_path`)

`context` is the most recent turn's input side. Codex transcripts expose this in `token_count` events;
Claude Code transcripts expose it in usage blocks. The script supports both observed formats.

Codex documents transcript format as unstable. If parsing fails, fail openly and direct CLI users to
the native `context-remaining` footer item rather than guessing.
