# junk-drawer

A junk drawer of [Claude Code](https://claude.com/claude-code) plugins — assorted, **independently
installable** utilities plus a context-limit orchestrator (*molt*) that sheds a full context like a
snake sheds its skin and continues the work in a fresh session via a handoff prompt.

This repo is a plugin **marketplace**: one catalog, several small plugins. Install only what you want.

## Install

```
/plugin marketplace add Krab00/junk-drawer      # once
/plugin install statusline@junk-drawer          # then pick per plugin
/plugin install ctx-tokens@junk-drawer
/plugin install tldr@junk-drawer
/plugin install handoff@junk-drawer
/plugin install ctx-limit@junk-drawer
/plugin install molt@junk-drawer
/plugin install junk-drawer@junk-drawer
/plugin install orch@junk-drawer
```

After installing or updating a plugin: `/plugin marketplace update junk-drawer` then `/reload-plugins`
(hooks only register on reload). Bump a plugin's `plugin.json` version or `/plugin install` says
"already installed".

## Plugins

| Plugin | What it does | Status |
|--------|--------------|--------|
| `statusline` | git branch + worktree + ANSI-colored status line | ready — run `/statusline:init` after install |
| `ctx-tokens` | read current context token usage from the live transcript | ready — `ctx-tokens` on Bash PATH |
| `tldr` | `/tldr N` summarize; `/tldr on\|off` terse mode (all sessions) | ready |
| `handoff` | save a session handoff to disk, restore it in a fresh session by id (`/handoff`, `/handon <id>`) | ready |
| `ctx-limit` | per-session context-size limit; past it the hook blocks / warns / runs a command (`/ctx-limit`) | ready — needs `ctx-tokens` |
| `molt` | shed context: write a handoff, then spawn a fresh claude session (via [herdr](https://herdr.dev)) seeded with it and remote-control on (`/molt`); `/clear` fallback if herdr is absent; pairs with `ctx-limit` for detection | ready |
| `junk-drawer` | cheatsheet of the whole marketplace: every plugin, version, and commands (`/junk-drawer`) | ready |
| `orch` | project-agnostic orchestration loop: pick tasks, delegate implement + verify to subagents, gate every criterion on tool evidence, round-cap the fix loop, open draft PRs (`/orch:init` then `/orch`) | ready — run `/orch:init` per repo after install |

## Layout

```
.claude-plugin/marketplace.json       # marketplace catalog (repo root), lists every plugin
plugins/<plugin>/
  .claude-plugin/plugin.json          # per-plugin manifest (name, version, description)
  commands/<name>.md                  # slash commands
  bin/                                # helper scripts (on Bash PATH inside Claude Code)
  hooks/hooks.json                    # optional hooks (UserPromptSubmit, SessionStart, …)
  skills/<name>/SKILL.md              # optional auto-invoked skills
```

Scripts reference `${CLAUDE_PLUGIN_ROOT}` — never absolute paths — so they work after install to cache.
Note: a plugin's `bin/` is on PATH for the **Bash tool** but **not** inside hook subprocesses — hooks
must be self-contained (compute inline or resolve absolute paths).
