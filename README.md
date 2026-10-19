# junk-drawer

A multi-host marketplace of independently installable plugins for **Claude Code, Codex, and Kimi
Code CLI** — plus a skills-only install path for **OpenCode** and other agents. It holds two plugins: **junkd**, one
plugin with durable handoffs (an automatic context-limit continuation and 5h-rate-limit resume on Claude Code), a
project-agnostic task orchestrator (*orch*) that delegates implementation and verification to subagents and gates
acceptance criteria on real tool evidence, TL;DR summaries and terse mode, a context-size guard (*ctx-limit*) and
reader (*ctx-tokens*), a colored Claude Code status line, and the `/junkd` frame over the marketplace; and
**junk-drawer**, the marketplace's cheatsheet.

## Install in Kimi Code CLI

Kimi installs from a local checkout. A GitHub URL does not work: the repo root has no Kimi manifest, and a Kimi URL
cannot point at a subfolder. Clone, then, inside Kimi (the install is TUI-only):

```text
git clone https://github.com/Krab00/junk-drawer.git ~/src/junk-drawer
/plugins marketplace /abs/path/to/junk-drawer/kimi-marketplace.json
```

The marketplace command opens a picker: choose the plugin, then "Trust and install" (the dialog's default is Exit).
One plugin without the marketplace: `/plugins install /abs/path/to/junk-drawer/plugins/junkd`. A bare id
(`/plugins install junkd`) is not a Kimi command.

Plugins install per user into `$KIMI_CODE_HOME/plugins/managed/<id>/`. Run `/reload` (or start a
new session) after installing or updating. Invoke workflows as skills, for example `/skill:orch-init`,
`/skill:orch`, `/skill:tldr`, or `/skill:handoff` — or just describe the task and let the model
invoke them.

Kimi notes:

- `commands/` are Claude-only (Kimi uses the skills); junkd's hooks (tldr's terse mode, ctx-limit's guard) are
  declared in its manifest and active while the plugin is enabled; the `statusline` skill only documents Kimi's
  fixed footer (theme via `/theme`), it does not install a script.
- A local-path install keeps the plugin's symlinks, rewritten to absolute paths into your checkout (junkd's
  plugin-root `bin/` and `scripts/`, orch-init's `bin/` and `commands/`). Moving the checkout breaks them, and
  switching its branch changes what they run. The skills' own `bin/` are real copies and do not move.
- Skills in `~/.agents/skills` shadow a plugin's skills of the same name, on Kimi and on Codex: a stale
  `npx skills add -g` copy wins over the installed plugin. Remove it (or `npx skills update -g`) when you switch to
  the plugin.

## Install in Codex

```bash
codex plugin marketplace add Krab00/junk-drawer
codex plugin add junk-drawer@junk-drawer
codex plugin add junkd@junk-drawer
```

For local development, run `codex plugin marketplace add .` from the repository root. After an update,
re-run `codex plugin add junkd@junk-drawer` (and any other changed plugin), then open a new task so Codex loads the
new skills and hooks. `codex plugin marketplace upgrade junk-drawer` refreshes only a Git marketplace; for a local
source it fails with "not configured as a Git marketplace".

Invoke Codex workflows by mentioning their skill, for example `$orch-init`, `$orch`, `$tldr`, or
`$handoff`; the model sees them as `junkd:<name>`.

Codex notes:

- Codex's installer drops every symlink: junkd's plugin-root `bin/`, `agents/` and `scripts/`, and orch-init's
  sibling links. The skills' own `bin/` are real files and work; orch-init falls back to the `orch` skill's copies.
- junkd's hooks (terse mode, the ctx-limit guard) are in `.codex-plugin/hooks.json` (the manifest names it),
  because Codex refuses the Claude Code-only `modules` key of `hooks/hooks.json`. Codex runs a plugin hook only
  once you trust it: a new session asks you to review the plugin's hooks ("Trust all and continue"). `codex exec` never asks, so an
  untrusted hook stays silent there.
- Skills in `~/.agents/skills` shadow the plugin's skills of the same name here too: a stale `npx skills add -g`
  copy wins over the installed plugin.
- junkd keeps its Codex data (handoffs, the terse flag, ctx-limit's `junkd/ctx-limit-*`) in
  `${CODEX_HOME:-$HOME/.codex}/junk-drawer`, outside the workspace: `codex exec -s workspace-write` refuses writes
  there unless you add `--add-dir "${CODEX_HOME:-$HOME/.codex}/junk-drawer"`.

## Install in Claude Code

```text
/plugin marketplace add Krab00/junk-drawer
/plugin install junk-drawer@junk-drawer
/plugin install junkd@junk-drawer
```

handoff, orch, tldr, ctx-limit, ctx-tokens and statusline are part of junkd; every command is `/junkd:<name>`
(`/junkd:handoff`, `/junkd:handon`, `/junkd:ahandoff`, `/junkd:orch`, `/junkd:orch-init`, `/junkd:tldr`,
`/junkd:ctx-limit`, `/junkd:ctx-tokens`, `/junkd:statusline`). Coming from the separate `handoff`, `orch`, `tldr`,
`ctx-limit`, `ctx-tokens` or `statusline` plugins: uninstall them and see "Moving from the handoff, orch, tldr,
ctx-limit, ctx-tokens and statusline plugins" in [`plugins/junkd/README.md`](plugins/junkd/README.md) for the renamed
commands, settings keys and state files.

After installing or updating: `/plugin marketplace update junk-drawer`, then `/reload-plugins`.

## junkd

One plugin for handoff, orch, tldr, ctx-limit, ctx-tokens and the status line, and the frame over the marketplace.
Its skills (`handoff`, `handon`, `ahandoff`, `orch`, `orch-init`, `tldr`, `ctx-limit`, `ctx-tokens`, `statusline`,
`junkd`) run on every host; on Claude Code each is `/junkd:<name>`, and the hooks module adds the automatic handoff
loop, the orch main-loop guard, the panes, the status line's wiring and `$.junkd` for other mods.

- Claude Code: `/plugin install junkd@junk-drawer`, then `/reload-plugins`.
- Codex: `codex plugin add junkd@junk-drawer`; the skills answer as `$handoff`, `$orch-init`, `$orch`, `$tldr`,
  `$ctx-limit`, `$ctx-tokens`, `$statusline`.
- Kimi: `/plugins marketplace /abs/path/to/junk-drawer/kimi-marketplace.json` from a clone (see "Install in Kimi
  Code CLI"); the skills answer as `/skill:<name>`, and its manifest declares tldr's terse-mode hook and
  ctx-limit's guard.
- OpenCode: `npx skills add Krab00/junk-drawer -a opencode` (see "Install in OpenCode"); the skills answer through
  the skill tool or the `/<name>` command wrappers. OpenCode has no hook, so terse mode and ctx-limit only record
  their files there.

The mod parts (the pane, the auto handoff loop, the guard) and the status line are Claude Code only.

`/junkd`, or a click on the `✚ junkd` segment under the prompt, opens a set of panes as tabs (junkd, handoff's,
orch's, statusline's) and closes them together. The junkd pane has three sections:

- **Plugins**: every plugin of the marketplace, on or off at user scope; a number flips one, then
  `/reload-plugins`.
- **Settings**: junkd's setting groups (core, handoff, orch, tldr, ctx, statusline), each with its `enabled` switch
  first, edited in place and validated by the group's rules; `settings ▸` jumps into the handoff, orch or
  statusline pane.
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
npx skills add /abs/path/to/junk-drawer -a opencode    # from a local checkout
```

Skills land in `.agents/skills/<name>/`, one of the directories OpenCode scans (alongside
`.opencode/skills/`); add `-g` for a per-user install. The agent sees them via its native `skill`
tool — invoke one by describing the task or asking for it by name ("use the orch skill"). The
limits of a skills-only install (next section) apply: no slash commands, no lifecycle hooks, and
`statusline` does not apply to OpenCode's TUI (its skill says so).

To get slash-command autocomplete anyway, generate thin command wrappers (one per installed
skill) into OpenCode's commands directory:

```bash
bin/opencode-commands.sh   # from a checkout: ~/.agents/skills -> ~/.config/opencode/commands
# without a checkout (arguments: [skills-dir] [commands-dir]):
curl -fsSL https://raw.githubusercontent.com/Krab00/junk-drawer/main/bin/opencode-commands.sh | sh -s -- .agents/skills .opencode/commands
```

Re-run it after `npx skills add`/`update`. It only overwrites files it generated itself, and
skips `statusline` (OpenCode has no status line to configure); `ctx-limit` and `ctx-tokens` get `/ctx-limit` and
`/ctx-tokens`. Each wrapper's description is the skill's first sentence, or its first whole words with
`...`, never cut inside a word.

junkd's helpers detect OpenCode themselves and keep its data apart from every other host, under
`${XDG_DATA_HOME:-$HOME/.local/share}/opencode/junk-drawer/` (`handoffs/`, `tldr-on`, `junkd/ctx-limit-*`). OpenCode
has no hook, so `/tldr on` and `/ctx-limit` only record their files; replies and prompts do not change.

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
them through relative symlinks: `plugins/<p>/bin -> skills/<p>/bin`, and for junkd `bin -> skills/junkd/bin`
and `scripts -> skills/junkd/scripts` (each entry a link to the real file in its own skill: `skills/handoff/bin`,
`skills/orch/bin`, `skills/tldr/bin`, `skills/ctx-limit/bin`, `skills/ctx-tokens/bin`, `skills/statusline/bin`,
`skills/orch/scripts`) and `agents -> skills/orch/roles`.
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
- Codex's plugin installer drops every symlink (the plugin-root `bin/`, `agents/` and `scripts/` too).
  Under the previous layout that left Codex plugin installs with no `bin/` inside the skills at all;
  now the skills carry real files and work. `orch-init`'s sibling symlinks are still dropped there,
  which is why its SKILL.md says to fall back to the `orch` skill's copies. `handon` carries a real
  copy of `handoff-load` (and of `host-lib`, the host detection it sources), kept byte-identical by
  `tests/smoke.sh`, so it resumes a handoff on its own; `tldr`, `ctx-limit` and `ctx-tokens` carry their own
  `host-lib` copies the same way.
- The symlinks are stored in git as symlinks. A Windows clone without `core.symlinks=true` writes
  them as plain text files, which breaks the plugin-root paths, so hooks and slash commands fail for
  a plugin install made from such a clone. The skills themselves are real files, so a skills-only
  install is unaffected.

## Plugins

| Plugin | What it does | Codex / Kimi entry point |
|---|---|---|
| `junk-drawer` | Runtime catalog of the marketplace | `$junk-drawer` / `/skill:junk-drawer` |
| `junkd` | handoff (`/junkd:handoff`, `/junkd:handon`; `/junkd:ahandoff` continues past a context threshold and resumes after the 5h rate limit on Claude Code), orch (`/junkd:orch-init`, then `/junkd:orch`: implementation and independent verification through subagents), tldr (`/junkd:tldr`: summarize on demand, optional persistent terse mode), ctx-limit (`/junkd:ctx-limit`: a context threshold hook that blocks, warns or runs a command), ctx-tokens (`/junkd:ctx-tokens`: context usage from Claude, Codex or Kimi transcripts), statusline (`/junkd:statusline`: the Claude Code status line with a switch per segment; Codex footer configuration; Kimi footer notes), and on Claude Code the `/junkd` frame: tabs for junkd, handoff, orch and statusline, every plugin on/off, the setting groups, the commands | `$handoff`, `$orch-init`, `$orch`, `$tldr`, `$ctx-limit`, `$ctx-tokens`, `$statusline` / `/skill:<name>` |

## Layout

```text
.claude-plugin/marketplace.json       # Claude Code marketplace
.agents/plugins/marketplace.json      # Codex marketplace
kimi-marketplace.json                 # Kimi Code marketplace
plugins/<plugin>/
  .claude-plugin/plugin.json          # Claude Code manifest
  .codex-plugin/plugin.json           # Codex manifest and UI metadata
  .codex-plugin/hooks.json            # junkd: Codex's hooks file (hooks/hooks.json carries Claude Code's modules)
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


Codex hooks get `${PLUGIN_ROOT}` and the alias `${CLAUDE_PLUGIN_ROOT}`, its bash tool `CODEX_THREAD_ID`; Kimi
plugin hooks get `${KIMI_PLUGIN_ROOT}` and `${KIMI_CODE_HOME}`; OpenCode's bash tool gets `OPENCODE` and
`OPENCODE_PID`. Scripts that persist state separate Codex data under `${CODEX_HOME:-$HOME/.codex}/junk-drawer`, Kimi
data under `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer`, OpenCode data under
`${XDG_DATA_HOME:-$HOME/.local/share}/opencode/junk-drawer`, and Claude Code data under
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}`. junkd's helpers detect the host from these (`skills/handoff/bin/host-lib`);
`JUNK_DRAWER_RUNTIME=claude|codex|kimi|opencode` overrides the detection, and a helper that finds no signal exits 2
naming that variable instead of writing into `~/.claude` (ctx-limit's hook exits 0 instead: a guard never blocks
on a guess). junk-drawer's cheatsheet does not detect the host: its skill sets `JUNK_DRAWER_RUNTIME=codex|kimi`, and
Claude Code needs no variable.

Codex and Kimi transcript parsing in `ctx-tokens` and `ctx-limit` is best effort because
neither transcript layout is a stable API. The native CLI context footer is the stable visual
indicator; transcript hooks fail open if they cannot recognize a usage record.

Claude Code still puts a plugin's `bin/` on the Bash tool's PATH. Codex and Kimi skills invoke
helpers by paths relative to their installed skill directory.
