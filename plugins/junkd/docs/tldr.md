# tldr

Part of the `junkd` plugin. Codex: invoke `$tldr`, optionally with a sentence count or `on|off|status`. Codex
stores the persistent flag under `~/.codex/junk-drawer`, Kimi Code under `~/.kimi-code/junk-drawer`; Claude Code
keeps its flags under `~/.claude/junkd`.

Two things in one command:

- `/junkd:tldr N` — summarize the last **substantive** reply in at most N sentences (default 3). One-shot. Repeated calls always condense the original reply, never a previous TL;DR.
- `/junkd:tldr on` / `/junkd:tldr off` — keep **every** following reply terse, across **all** sessions, until off.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install junkd@junk-drawer
```

## Usage

```
/junkd:tldr 2      # last reply in ≤2 sentences
/junkd:tldr        # last reply in ≤3 sentences (the `tldr_sentences` setting on Claude Code)
/junkd:tldr on     # terse mode ON — every reply, all sessions
/junkd:tldr off    # back to normal
/junkd:tldr status # is terse mode currently on or off
```

## How persistent mode works

`/junkd:tldr on` writes a global flag (`~/.claude/junkd/tldr-on`, or `$CLAUDE_CONFIG_DIR/junkd/tldr-on`). A
bundled **UserPromptSubmit hook** (`bin/tldr-hook`) checks that flag every turn and, while set, injects a "be
terse" instruction into context — so the terseness is enforced deterministically each turn. A skill couldn't
guarantee that (skills are model-triggered, not per-turn). `/junkd:tldr off` removes the flag. The flag is global
on purpose: turn it on in one tab, every session with the plugin goes terse.

## Settings

Three rows in `/config` on Claude Code (`userConfig` in the manifest; the `/config` key is `junkd.<row>`):

| Row | Type | Default | Meaning |
|---|---|---|---|
| `tldr_enabled` | boolean | `true` | Off: the per-turn hook prints nothing, whatever terse mode says. `/junkd:tldr N` and `on|off|status` still work |
| `tldr_terse` | boolean | `false` | Terse mode, the same switch as `/junkd:tldr on|off` |
| `tldr_sentences` | number | `3` | How many sentences a `/junkd:tldr` without a number may use (a whole number, 1 or more) |

Scope: user-global; project/session overrides: planned.

`tldr_sentences` applies on Claude Code through the hooks module: a `/junkd:tldr` with no argument reaches the
skill with the setting as its number. Other hosts run the markdown alone and keep its default of 3.

The junkd pane (`/junkd`, or ✚ junkd under the prompt) shows the three rows in its tldr group.

**The flag files are the shell-side truth.** The per-turn hook is a shell script, and a shell hook cannot read
`$.config`, so two files under `~/.claude/junkd/` (or `$CLAUDE_CONFIG_DIR/junkd/`) stand in for the rows:

- `tldr-on` decides terse mode. Flipping `tldr_terse` in `/config` or through `$.junkd.set` writes the row *and*
  the flag file (the file first; a row that is refused puts the file back); `/junkd:tldr on|off` writes the flag
  file only. When the two disagree the file wins: `$.junkd.get({ key: 'tldr_terse' })` answers from the file, and
  the next write puts both back in step. A hand edit of `tldr_terse` in settings.json writes the row only: it takes
  effect at the next write through `/config` or `$.junkd.set`.
- `tldr-off` mirrors `tldr_enabled`: there while it is off, removed while it is on. The hooks module writes it at
  every write of the row (`$.junkd.set` and `/config`, the file first as above) and at every session start. The
  hook reads `tldr_enabled` from settings.json itself first (`pluginConfigs`, the first entry whose key starts
  with `junkd@`, `.options.tldr_enabled`), so a hand edit there counts at once; only where that names no value,
  or `jq` is missing, or the file does not parse, the `tldr-off` file decides.

A flag file that cannot be written (or an `rm` that fails) refuses the write: no row is stored, and `set` rejects
with the reason (`tldr: could not write …` / `tldr: could not remove …`).

### API for other plugins

The hooks module adds `$.junkd` to the engine's `$` (types: `types/index.d.ts`, exported as `Junkd`); the tldr rows
are three of its settings:

- `schema()` — one entry per row of every group: `{ key, group, field, type, title, default, main }`; the tldr
  rows have `group: 'tldr'` and are all `main`.
- `get({ key })` — `tldr_terse` from the flag file, `tldr_enabled` and `tldr_sentences` as last stored (at load,
  then every write).
- `set({ key, value, scope? })` — writes `junkd.<key>` through `$.config` (and, for `tldr_terse` and
  `tldr_enabled`, the flag file) and resolves to the stored value; `true`, `'true'` and `'on'` are a true for the
  two booleans, anything else a false. Refused (unknown key, a value that does not fit, a `config.set` hook's
  deny, a flag file that could not be written) it rejects with the reason. `scope` takes only `user` today.

There is no tldr pane; `/junkd:tldr` stays the command on every host. The module is Claude-only: Codex and Kimi
run the shell hook and `tldr-flag` as before, and `tldr_enabled` does not apply there.

## Migrating from the `tldr` plugin

The `tldr` plugin is now part of `junkd`:

- The command `/tldr:tldr` is `/junkd:tldr`.
- Settings: `pluginConfigs["tldr@junk-drawer"].options.<field>` is
  `pluginConfigs["junkd@junk-drawer"].options.tldr_<field>` (`terse` → `tldr_terse`, `sentences` →
  `tldr_sentences`); the `/config` keys `tldr.<field>` are `junkd.tldr_<field>`. The values are not carried over:
  set them again in `/config`.
- The terse flag `$CLAUDE_CONFIG_DIR/tldr-on` (`~/.claude/tldr-on`) is `$CLAUDE_CONFIG_DIR/junkd/tldr-on`
  (`~/.claude/junkd/tldr-on`). A flag left at the old path is not read: run `/junkd:tldr on` again, and remove the
  old file.
- `$.tldr.get/set({ key })` is `$.junkd.get/set({ key: 'tldr_<field>' })`; list `junkd` instead of `tldr` under
  `dependencies`.
- Codex and Kimi Code keep their flags where they were (`<home>/junk-drawer/tldr-on`).
