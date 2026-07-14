# junk-drawer

A dual-host marketplace of independently installable plugins for **Claude Code and Codex**. It
contains small context utilities, durable handoffs, a context-continuation workflow (*molt*), and a
project-agnostic task orchestrator (*orch*) that delegates implementation and verification to
subagents and gates acceptance criteria on real tool evidence.

## Install in Codex

```bash
codex plugin marketplace add Krab00/junk-drawer
codex plugin add statusline@junk-drawer
codex plugin add ctx-tokens@junk-drawer
codex plugin add tldr@junk-drawer
codex plugin add handoff@junk-drawer
codex plugin add ctx-limit@junk-drawer
codex plugin add molt@junk-drawer
codex plugin add junk-drawer@junk-drawer
codex plugin add orch@junk-drawer
```

For local development, run `codex plugin marketplace add .` from the repository root. After an
update, run `codex plugin marketplace upgrade junk-drawer`, reinstall the changed plugin, and open a
new task so Codex loads the new skills and hooks.

Invoke Codex workflows by mentioning their skill, for example `$orch-init`, `$orch`, `$tldr`, or
`$handoff`.

## Install in Claude Code

```text
/plugin marketplace add Krab00/junk-drawer
/plugin install statusline@junk-drawer
/plugin install ctx-tokens@junk-drawer
/plugin install tldr@junk-drawer
/plugin install handoff@junk-drawer
/plugin install ctx-limit@junk-drawer
/plugin install molt@junk-drawer
/plugin install junk-drawer@junk-drawer
/plugin install orch@junk-drawer
```

After installing or updating: `/plugin marketplace update junk-drawer`, then `/reload-plugins`.

## Plugins

| Plugin | What it does | Codex entry point |
|---|---|---|
| `statusline` | Claude custom line; native Codex CLI footer configuration | `$statusline` |
| `ctx-tokens` | Read context usage from Claude or Codex transcripts | `$ctx-tokens` |
| `tldr` | Summarize on demand; optional persistent terse mode | `$tldr` |
| `handoff` | Save or restore a durable handoff by id | `$handoff` |
| `ctx-limit` | Context threshold hook with block, warn, or command actions | `$ctx-limit` |
| `molt` | Durable continuation before compaction or a fresh task | `$molt` |
| `junk-drawer` | Runtime catalog of the marketplace | `$junk-drawer` |
| `orch` | Implementation and independent verification through subagents | `$orch-init`, then `$orch` |

## Layout

```text
.claude-plugin/marketplace.json       # Claude Code marketplace
.agents/plugins/marketplace.json      # Codex marketplace
plugins/<plugin>/
  .claude-plugin/plugin.json          # Claude Code manifest
  .codex-plugin/plugin.json           # Codex manifest and UI metadata
  commands/<name>.md                  # Claude Code slash commands
  skills/<name>/SKILL.md              # Codex and shared workflows
  bin/                                # shared helper scripts
  hooks/hooks.json                    # optional shared lifecycle hooks
```

Codex exposes `${PLUGIN_ROOT}` and compatibility aliases including `${CLAUDE_PLUGIN_ROOT}`. Scripts
that persist state separate Codex data under `${CODEX_HOME:-$HOME/.codex}/junk-drawer` from Claude
Code data under `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`.

Codex transcript parsing in `ctx-tokens`, `ctx-limit`, and `molt` is best effort because transcript
layout is not a stable API. The native CLI `context-remaining` footer is the stable visual indicator;
transcript hooks fail open if they cannot recognize a usage record.

Claude Code still puts a plugin's `bin/` on the Bash tool's PATH. Codex skills invoke helpers by
paths relative to their installed skill directory.
