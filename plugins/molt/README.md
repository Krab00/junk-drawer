# molt

Context-limit **orchestrator**. Near the token limit, the agent sheds its full context like a snake
sheds its skin (*molt*) and continues the work in a **fresh session** seeded by a handoff prompt.
Spawns and closes cmux sessions to keep the work going past a single context window.

> Status: **scaffold** — not implemented yet.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install molt@junk-drawer
```

## Usage

*(intended, lands when the orchestrator is built)*

Point it at a task; it works until it nears the context limit, writes a handoff, spawns a fresh
session to continue, and closes the old one. Reads context usage via `ctx-tokens`.
