---
name: ctx-tokens
description: Check how full THIS Claude Code session's context window is (current token usage). Use when you or the user ask how much context is used/left, or before deciding to compact or hand off to a fresh session.
---

# Check context usage

Run the bundled command (on the Bash PATH while this plugin is enabled):

- `ctx-tokens` → current context tokens as a bare number (e.g. `61951`)
- `ctx-tokens -h` → human form (e.g. `ctx 61k (61951) | out 562`)
- `ctx-tokens <file.jsonl>` → a specific transcript (e.g. a hook's `transcript_path`)

`context` = the last turn's input side (input + cache_creation + cache_read) — what actually fills the
window. Claude Code does not hand this number to the model, so read it here instead of guessing.

Rule of thumb: quality degrades well before the nominal window; ~300k is a practical "getting mushy"
zone. Above it, suggest compacting or handing off to a fresh session.
