# junk-drawer

A junk drawer of [Claude Code](https://claude.com/claude-code) plugins — assorted, **independently
installable** utilities plus a context-limit orchestrator (*wylinka*) that sheds a full context like a
snake sheds its skin and continues the work in a fresh session via a handoff prompt.

This repo is a plugin **marketplace**: one catalog, several small plugins. Install only what you want.

## Install

```
/plugin marketplace add Krab00/junk-drawer      # once
/plugin install statusline@junk-drawer          # then pick per plugin
/plugin install ctx-tokens@junk-drawer
/plugin install wylinka@junk-drawer
```

## Plugins

| Plugin | What it does | Status |
|--------|--------------|--------|
| `statusline` | git branch + worktree + ANSI-colored status line | ready — run `/statusline:init` after install |
| `ctx-tokens` | read current context token usage from the live transcript | ready — `ctx-tokens` on Bash PATH |
| `tldr` | `/tldr N` summarize; `/tldr on\|off` terse mode (all sessions) | ready |
| `wylinka` | context-limit orchestrator: spawn / hand off / close sessions | scaffold |

## Layout

```
.claude-plugin/marketplace.json       # marketplace catalog (repo root), lists every plugin
plugins/<plugin>/
  .claude-plugin/plugin.json          # per-plugin manifest
  skills/                             # one folder per skill (added later)
  bin/                                # helper scripts, land on Bash PATH (added later)
  hooks/                              # optional hooks (added later)
```

Scripts reference `${CLAUDE_PLUGIN_ROOT}` — never absolute paths — so they work after install to cache.

WIP.
