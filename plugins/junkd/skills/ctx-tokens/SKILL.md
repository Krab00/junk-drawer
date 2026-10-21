---
name: ctx-tokens
description: Check current context-window usage for this Codex, Kimi Code, or Claude Code session. Use when the user asks how many tokens are used or left, how full the context is, or whether to compact, hand off, or start a fresh session.
---

# Check context usage

Remember the active project directory, then run the bundled command and pass that directory explicitly:

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: run `./bin/ctx-tokens --cwd <project-dir> -h` from this skill directory (the plugin root has no `bin/` on Codex and Kimi Code: use this skill's own `./bin`). The helper detects the host; if it reads the wrong host's transcript or finds none, run it again with the flag for yours (`--codex` or `--kimi`), or with `JUNK_DRAWER_RUNTIME` set to `codex` or `kimi`. OpenCode keeps no transcript this helper reads: say so and point to OpenCode's own context indicator.
- Claude Code: run `${CLAUDE_PLUGIN_ROOT}/bin/ctx-tokens -h` (or `ctx-tokens -h`: the plugin's `bin/` is on the Bash tool's PATH).

The forms, on every host:

- `ctx-tokens -h` → human form (e.g. `ctx 61k (61951) | out 562`, with `remaining` and `window` where the transcript names the window).
- `ctx-tokens` → current input-context tokens as a bare number (e.g. `61951`).
- `ctx-tokens --cwd <dir>` → the session of that project directory; `--codex`, `--kimi`, `--claude` pick the host and override the detection.
- `ctx-tokens <file.jsonl>` → a specific transcript (e.g. a hook's `transcript_path`); its content tells the format unless a flag says.

`context` is the most recent turn's input side. Codex transcripts expose this in `token_count` events,
Kimi Code wire files in `step.end` usage records, and Claude Code transcripts in usage blocks. The
script supports all observed formats.

Codex and Kimi transcript formats are not stable APIs. If parsing fails, fail openly and direct the
user to the host's native context indicator rather than guessing.
