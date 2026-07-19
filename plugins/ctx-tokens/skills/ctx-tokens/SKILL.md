---
name: ctx-tokens
description: Check current context-window usage for this Codex, Kimi Code, or Claude Code session. Use when the user asks how many tokens are used or left, how full the context is, or whether to compact, hand off, or start a fresh session.
---

# Check context usage

Remember the active project directory, then run the bundled command from this skill directory and
pass that directory explicitly. Use the flag for your host (`--codex` or `--kimi`):

- `../../bin/ctx-tokens --kimi --cwd <project-dir> -h` -> human form with used and remaining context.
- `../../bin/ctx-tokens --kimi --cwd <project-dir>` -> current input-context tokens as a bare number.
- `../../bin/ctx-tokens --codex --cwd <project-dir> -h` / `--codex --cwd <project-dir>` -> same for Codex.
- `../../bin/ctx-tokens --codex <file.jsonl>` / `--kimi <file.jsonl>` -> inspect a specific transcript.

For Claude Code, preserve the original forms:

- `ctx-tokens` → current context tokens as a bare number (e.g. `61951`)
- `ctx-tokens -h` → human form (e.g. `ctx 61k (61951) | out 562`)
- `ctx-tokens <file.jsonl>` → a specific transcript (e.g. a hook's `transcript_path`)

`context` is the most recent turn's input side. Codex transcripts expose this in `token_count` events,
Kimi Code wire files in `step.end` usage records, and Claude Code transcripts in usage blocks. The
script supports all observed formats.

Codex and Kimi transcript formats are not stable APIs. If parsing fails, fail openly and direct the
user to the host's native context indicator rather than guessing.
