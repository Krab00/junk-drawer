# junk-drawer

A multi-host marketplace of independently installable plugins for **Claude Code, Codex, and Kimi
Code CLI** — plus a skills-only install path for **OpenCode** and other agents. It contains small context utilities and **junkd**, one plugin with durable handoffs (an
automatic context-limit continuation and 5h-rate-limit resume on Claude Code), a project-agnostic task orchestrator
(*orch*) that delegates implementation and verification to subagents and gates acceptance criteria on real tool
evidence, TL;DR summaries and terse mode, and the `/junkd` frame over the marketplace.

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

Kimi notes: `commands/` are Claude-only (Kimi uses the skills); the hooks of junkd (tldr's terse mode) and `ctx-limit` are declared in each plugin's manifest and active while the plugin is enabled; `statusline`
only documents Kimi's fixed footer (theme via `/theme`), it does not install a script.

## Install in Codex

```bash
codex plugin marketplace add Krab00/junk-drawer
codex plugin add statusline@junk-drawer
codex plugin add ctx-tokens@junk-drawer
codex plugin add ctx-limit@junk-drawer
codex plugin add junk-drawer@junk-drawer
codex plugin add junkd@junk-drawer
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
/plugin install ctx-limit@junk-drawer
/plugin install junk-drawer@junk-drawer
/plugin install junkd@junk-drawer
```

handoff, orch and tldr are part of junkd; every command is `/junkd:<name>` (`/junkd:handoff`, `/junkd:handon`,
`/junkd:ahandoff`, `/junkd:orch`, `/junkd:orch-init`, `/junkd:tldr`). Coming from the separate `handoff`, `orch`
and `tldr` plugins: uninstall them and see "Moving from the handoff, orch and tldr plugins" in
[`plugins/junkd/README.md`](plugins/junkd/README.md) for the renamed commands, settings keys and flag files.

After installing or updating: `/plugin marketplace update junk-drawer`, then `/reload-plugins`.

## junkd

One plugin for handoff, orch and tldr, and the frame over the marketplace. Its skills (`handoff`, `handon`,
`ahandoff`, `orch`, `orch-init`, `tldr`, `junkd`) run on every host; on Claude Code each is `/junkd:<name>`, and the
hooks module adds the automatic handoff loop, the orch main-loop guard, the panes and `$.junkd` for other mods.

- Claude Code: `/plugin install junkd@junk-drawer`, then `/reload-plugins`.
- Codex: `codex plugin add junkd@junk-drawer`; the skills answer as `$handoff`, `$orch-init`, `$orch`, `$tldr`.
- Kimi: `/plugins install junkd`; the skills answer as `/skill:<name>`, and its manifest declares tldr's
  terse-mode hook. The mod parts (the pane, the auto handoff loop, the guard) are Claude Code only.

`/junkd`, or a click on the `✚ junkd` segment under the prompt, opens a set of panes as tabs (junkd, handoff's,
orch's) and closes them together. The junkd pane has three sections:

- **Plugins**: every plugin of the marketplace, on or off at user scope; a number flips one, then
  `/reload-plugins`.
- **Settings**: junkd's setting groups (core, handoff, orch, tldr), each with its `enabled` switch first, edited
  in place and validated by the group's rules; `settings ▸` jumps into the handoff or orch pane.
- **Commands**: the enabled plugins' slash commands with their descriptions.

junkd also ships the `junkd:STE` output style (Simplified Technical English). At session start it
becomes the default once, and only when `~/.claude/settings.json` has no `outputStyle` yet; a style you
chose is never touched. To skip that step set `core_output_style` to `off` in `/config` under plugin
`junkd`, or pick any style with `/output-style`. Details in
[`plugins/junkd/README.md`](plugins/junkd/README.md).

## Install in OpenCode

OpenCode has no plugin layer for this marketplace, but it discovers Agent Skills natively. Install
them into a project with:

```bash
npx skills add Krab00/junk-drawer -a opencode
```

Skills land in `.agents/skills/<name>/`, one of the directories OpenCode scans (alongside
`.opencode/skills/`); add `-g` for a per-user install. The agent sees them via its native `skill`
tool — invoke one by describing the task or asking for it by name ("use the orch skill"). The
limits of a skills-only install (next section) apply: no slash commands, no lifecycle hooks, and
`statusline` does not apply to OpenCode's TUI.

To get slash-command autocomplete anyway, generate thin command wrappers (one per installed
skill) into OpenCode's commands directory:

```bash
bin/opencode-commands.sh   # ~/.agents/skills -> ~/.config/opencode/commands
```

Re-run it after `npx skills add`/`update`. It only overwrites files it generated itself, and
skips `statusline`.

## Install the skills only (any agent)

The workflows are also installable as plain agent skills with
[`npx skills`](https://github.com/vercel-labs/skills), which works across ~70 agents rather than the
three hosts above. This installs the skills **without** the plugins — no slash commands and no
lifecycle hooks, so `tldr` and `ctx-limit` lose their automatic hook behavior and you drive
them explicitly instead.

```bash
npx skills add Krab00/junk-drawer                     # all eleven skills
npx skills add Krab00/junk-drawer --skill orch        # just one
npx skills add Krab00/junk-drawer --list              # preview, install nothing
```

Skills land in the target agent's project directory, e.g. `.claude/skills/<name>/` for Claude Code
or `.agents/skills/<name>/` for Codex and Cursor. Add `-g` for a global install.

Each skill directory owns its files. The real helpers live inside it and the plugin root reaches
them through relative symlinks: `plugins/<p>/bin -> skills/<p>/bin`, statusline's `statusline.sh`
and `setup-statusline.sh`, and for junkd `bin -> skills/junkd/bin` and `scripts -> skills/junkd/scripts`
(each entry a link to the real file in its own skill: `skills/handoff/bin`, `skills/orch/bin`,
`skills/tldr/bin`, `skills/orch/scripts`) and `agents -> skills/orch/roles`.
Plugin manifests, hooks, and slash commands therefore keep resolving `${CLAUDE_PLUGIN_ROOT}/bin/...`
unchanged, `npx skills add` dereferences the links into real files with executable bits intact, and
every SKILL.md addresses its helpers as `./bin/<script>`, never `../../bin/<script>`, because a path
that escapes the skill directory breaks once the skill is copied out on its own. The direction also
matters for updates: editing a helper now changes a file inside the skill folder, so the folder's
git tree hash moves and `npx skills update` reinstalls. The reverse layout hid every such change,
because a git tree entry hashes a symlink's target text rather than the target's content.
`tests/smoke.sh` enforces the layout.

junkd's handoff ships its resume half as its own skill (`handon`), so a skills-only
install can resume a handoff by id: `/handon <id>` in Claude Code, and in OpenCode through the
wrapper `bin/opencode-commands.sh` generates.

Known limits of the skills-only install:

- `$junk-drawer` catalogs sibling skills instead of plugins, since no plugin manifests are present,
  so it cannot report versions or slash commands.
- `orch-init` borrows `orch`'s helpers through a sibling symlink, so its own tree hash does not move
  when those helpers change. Once `npx skills update` has refreshed `orch`, refresh it explicitly
  with `npx skills add Krab00/junk-drawer --skill orch-init`; `add` always reinstalls.
- Codex's plugin installer drops symlinks. Under the previous layout that left Codex plugin installs
  with no `bin/` inside the skills at all; now the skills carry real files and work. `orch-init`'s
  sibling symlinks are still dropped there, which is why its SKILL.md says to fall back to the
  `orch` skill's copies.
- The symlinks are stored in git as symlinks. A Windows clone without `core.symlinks=true` writes
  them as plain text files, which breaks the plugin-root paths, so hooks and slash commands fail for
  a plugin install made from such a clone. The skills themselves are real files, so a skills-only
  install is unaffected.

## Plugins

| Plugin | What it does | Codex / Kimi entry point |
|---|---|---|
| `statusline` | Claude custom line; Codex footer configuration; Kimi footer notes | `$statusline` / `/skill:statusline` |
| `ctx-tokens` | Read context usage from Claude, Codex, or Kimi transcripts | `$ctx-tokens` / `/skill:ctx-tokens` |
| `ctx-limit` | Context threshold hook with block, warn, or command actions | `$ctx-limit` / `/skill:ctx-limit` |
| `junk-drawer` | Runtime catalog of the marketplace | `$junk-drawer` / `/skill:junk-drawer` |
| `junkd` | handoff (`/junkd:handoff`, `/junkd:handon`; `/junkd:ahandoff` continues past a context threshold and resumes after the 5h rate limit on Claude Code), orch (`/junkd:orch-init`, then `/junkd:orch`: implementation and independent verification through subagents), tldr (`/junkd:tldr`: summarize on demand, optional persistent terse mode), and on Claude Code the `/junkd` frame: tabs for junkd, handoff and orch, every plugin on/off, the setting groups, the commands | `$handoff`, `$orch-init`, `$orch`, `$tldr` / `/skill:handoff`, `/skill:orch-init`, `/skill:orch`, `/skill:tldr` |

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
  skills/<name>/bin/                  # real helper scripts, hashed with the skill folder
  bin -> skills/<name>/bin            # symlink, so manifests and hooks keep one stable path
  hooks/hooks.json                    # optional shared lifecycle hooks
```

junkd has several skills with helpers, so its plugin-root `bin/` and `scripts/` link to a folder of links in
`skills/junkd/`, each to the real file in its own skill, and `agents -> skills/orch/roles`. It has no plugin-root
`commands/`: every junkd command is a skill.


Codex exposes `${PLUGIN_ROOT}` and compatibility aliases including `${CLAUDE_PLUGIN_ROOT}`; Kimi
plugin hooks get `${KIMI_PLUGIN_ROOT}` and `${KIMI_CODE_HOME}`. Scripts that persist state separate
Codex data under `${CODEX_HOME:-$HOME/.codex}/junk-drawer`, Kimi data under
`${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer`, and Claude Code data under
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}`. Set `JUNK_DRAWER_RUNTIME=codex|kimi` when invoking `bin/`
helpers from a skill; Claude Code needs no variable.

Codex and Kimi transcript parsing in `ctx-tokens` and `ctx-limit` is best effort because
neither transcript layout is a stable API. The native CLI context footer is the stable visual
indicator; transcript hooks fail open if they cannot recognize a usage record.

Claude Code still puts a plugin's `bin/` on the Bash tool's PATH. Codex and Kimi skills invoke
helpers by paths relative to their installed skill directory.
