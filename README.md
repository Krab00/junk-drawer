# junk-drawer

A multi-host marketplace of independently installable plugins for **Claude Code, Codex, and Kimi
Code CLI**. It contains small context utilities, durable handoffs, a context-continuation workflow
(*molt*), and a project-agnostic task orchestrator (*orch*) that delegates implementation and
verification to subagents and gates acceptance criteria on real tool evidence.

## Install in Kimi Code CLI

Local checkout (marketplace file at the repo root):

```text
/plugins marketplace /path/to/junk-drawer/kimi-marketplace.json
```

Or install a single plugin directly from GitHub:

```text
/plugins install https://github.com/Krab00/junk-drawer
```

Plugins install per user into `$KIMI_CODE_HOME/plugins/managed/<id>/`. Run `/reload` (or start a
new session) after installing or updating. Invoke workflows as skills, for example `/skill:orch-init`,
`/skill:orch`, `/skill:tldr`, or `/skill:handoff` — or just describe the task and let the model
invoke them.

Kimi notes: `commands/` are Claude-only (Kimi uses the skills); hooks for `tldr`, `ctx-limit`, and
`molt` are declared in each plugin's manifest and active while the plugin is enabled; `statusline`
only documents Kimi's fixed footer (theme via `/theme`), it does not install a script.

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

## Install the skills only (any agent)

The workflows are also installable as plain agent skills with
[`npx skills`](https://github.com/vercel-labs/skills), which works across ~70 agents rather than the
three hosts above. This installs the skills **without** the plugins — no slash commands and no
lifecycle hooks, so `tldr`, `ctx-limit`, and `molt` lose their automatic hook behavior and you drive
them explicitly instead.

```bash
npx skills add Krab00/junk-drawer                     # all nine skills
npx skills add Krab00/junk-drawer --skill orch        # just one
npx skills add Krab00/junk-drawer --list              # preview, install nothing
```

Skills land in the target agent's project directory, e.g. `.claude/skills/<name>/` for Claude Code
or `.agents/skills/<name>/` for Codex and Cursor. Add `-g` for a global install.

Each skill directory is self-contained: `bin/` and, for `orch`, `commands/` and `roles/` are
symlinks into the plugin root here, and the installer dereferences them into real files with
executable bits intact. That is why every SKILL.md addresses its helpers as `./bin/<script>` and
never `../../bin/<script>` — a path that escapes the skill directory works in the plugin layout but
breaks once the skill is copied out on its own. `tests/smoke.sh` enforces this.

Two known limits of the skills-only install:

- `$junk-drawer` catalogs sibling skills instead of plugins, since no plugin manifests are present,
  so it cannot report versions or slash commands.
- The symlinks are stored in git as symlinks. A Windows clone without `core.symlinks=true` writes
  them as plain text files, which breaks this install path. It also breaks skill invocation for a
  plugin install on such a clone, since the skills now reach helpers through the symlink rather
  than through `../../bin/`. Slash commands and hooks are unaffected either way, because they
  resolve `${CLAUDE_PLUGIN_ROOT}/bin` directly.

## Plugins

| Plugin | What it does | Codex / Kimi entry point |
|---|---|---|
| `statusline` | Claude custom line; Codex footer configuration; Kimi footer notes | `$statusline` / `/skill:statusline` |
| `ctx-tokens` | Read context usage from Claude, Codex, or Kimi transcripts | `$ctx-tokens` / `/skill:ctx-tokens` |
| `tldr` | Summarize on demand; optional persistent terse mode | `$tldr` / `/skill:tldr` |
| `handoff` | Save or restore a durable handoff by id | `$handoff` / `/skill:handoff` |
| `ctx-limit` | Context threshold hook with block, warn, or command actions | `$ctx-limit` / `/skill:ctx-limit` |
| `molt` | Durable continuation before compaction or a fresh session | `$molt` / `/skill:molt` |
| `junk-drawer` | Runtime catalog of the marketplace | `$junk-drawer` / `/skill:junk-drawer` |
| `orch` | Implementation and independent verification through subagents | `$orch-init`, then `$orch` / `/skill:orch-init`, then `/skill:orch` |

## Layout

```text
.claude-plugin/marketplace.json       # Claude Code marketplace
.agents/plugins/marketplace.json      # Codex marketplace
kimi-marketplace.json                 # Kimi Code marketplace
plugins/<plugin>/
  .claude-plugin/plugin.json          # Claude Code manifest
  .codex-plugin/plugin.json           # Codex manifest and UI metadata
  .kimi-plugin/plugin.json            # Kimi Code manifest (skills + hooks)
  commands/<name>.md                  # Claude Code slash commands
  skills/<name>/SKILL.md              # Codex, Kimi, and shared workflows
  skills/<name>/bin -> ../../bin      # symlink, so a skills-only install is self-contained
  bin/                                # shared helper scripts
  hooks/hooks.json                    # optional shared lifecycle hooks
```

Codex exposes `${PLUGIN_ROOT}` and compatibility aliases including `${CLAUDE_PLUGIN_ROOT}`; Kimi
plugin hooks get `${KIMI_PLUGIN_ROOT}` and `${KIMI_CODE_HOME}`. Scripts that persist state separate
Codex data under `${CODEX_HOME:-$HOME/.codex}/junk-drawer`, Kimi data under
`${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer`, and Claude Code data under
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}`. Set `JUNK_DRAWER_RUNTIME=codex|kimi` when invoking `bin/`
helpers from a skill; Claude Code needs no variable.

Codex and Kimi transcript parsing in `ctx-tokens`, `ctx-limit`, and `molt` is best effort because
neither transcript layout is a stable API. The native CLI context footer is the stable visual
indicator; transcript hooks fail open if they cannot recognize a usage record.

Claude Code still puts a plugin's `bin/` on the Bash tool's PATH. Codex and Kimi skills invoke
helpers by paths relative to their installed skill directory.
