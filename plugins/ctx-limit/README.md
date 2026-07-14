# ctx-limit

Codex: use `$ctx-limit`. The hook supports the locally observed Codex `token_count` transcript
shape and returns structured hook output when blocking. Parsing is best effort and fails open; use
the native `context-remaining` footer as the stable visual indicator. `$ctx-limit on` defaults to
200k tokens in Codex; the Claude Code command below keeps its 300k default.

Set a **context-size limit** for a Claude Code session. A `UserPromptSubmit` hook checks the
session's context size each turn (via [`ctx-tokens`](../ctx-tokens)) and, once you cross the
threshold, does one of three things — your choice:

- **block** (default) — rejects the prompt until you `/clear`, `/molt`, or `/ctx-limit off`
- **warn** — injects a warning into context but lets the prompt through
- **cmd** — runs a shell command you configure (e.g. a desktop notification)

Everything is read fresh each turn, so changes are **live — no new session**.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install ctx-limit@junk-drawer
```

Requires the `ctx-tokens` plugin (same marketplace) on PATH.

## Usage

```
/ctx-limit 300k              # set the limit and enable (also 400000, 1m)
/ctx-limit on                # enable at the default (300k)
/ctx-limit                   # status
/ctx-limit off               # disable
/ctx-limit action warn       # block | warn | cmd
/ctx-limit cmd terminal-notifier -message "ctx limit hit"   # sets cmd + switches action to cmd
```

State: `~/.claude/ctx-limit-threshold`, `~/.claude/ctx-limit-action`, `~/.claude/ctx-limit-cmd`.
In `cmd` mode the command runs with `CTX_TOKENS` and `CTX_LIMIT` set in its environment.
