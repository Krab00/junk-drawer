# ctx-tokens

Read the current context-window token usage of the **live** Claude Code session, straight from its
transcript — so an agent (or you) can check how full the context is and act before it degrades.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install ctx-tokens@junk-drawer
```

Ships `ctx-tokens` on the Bash tool's PATH — runnable as a bare command inside any Claude Code Bash
call while the plugin is enabled. Needs `jq`.

## Usage

```
ctx-tokens              # current context tokens, e.g. 61951
ctx-tokens -h           # human form, e.g. "ctx 61k (61951) | out 562"
ctx-tokens <file.jsonl> # from a specific transcript (e.g. a hook's transcript_path)
```

`context` = the last turn's input side (input + cache_creation + cache_read) — what actually fills the
window; `out` is that turn's output, reported separately.

Threshold on it in scripts: `[ "$(ctx-tokens)" -gt 300000 ] && …` — the basis for the `wylinka`
orchestrator's handoff trigger.

Installing also registers a `ctx-tokens` **skill**, so Claude runs the command on its own when
context fullness is relevant (e.g. you ask "how much context is left?").
