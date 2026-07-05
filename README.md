# junk-drawer

A junk drawer of [Claude Code](https://claude.com/claude-code) skills — assorted utilities plus a
context-limit **orchestrator** that sheds a full context like a snake sheds its skin (*wylinka*) and
continues the work in a fresh session via a handoff prompt.

This repo is **both** a plugin marketplace and the plugin itself.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install junk-drawer@junk-drawer
```

## What's inside

Nothing yet — scaffold only. Skills and scripts get added one by one:

- [ ] `ctx-tokens` — read current context token usage from the live transcript
- [ ] `tldr` — summarize on demand
- [ ] orchestrator (*wylinka*) — spawn / hand off / close sessions near the context limit

## Layout

```
.claude-plugin/marketplace.json     # marketplace catalog (repo root)
plugins/junk-drawer/
  .claude-plugin/plugin.json        # the plugin manifest
  skills/                           # one folder per skill (added later)
  bin/                              # helper scripts, land on Bash PATH (added later)
  hooks/                            # optional hooks, e.g. SessionStart handoff restore
```

Scripts reference `${CLAUDE_PLUGIN_ROOT}` — never absolute paths — so they work after install to cache.

WIP.
