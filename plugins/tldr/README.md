# tldr

Codex: invoke `$tldr`, optionally with a sentence count or `on|off|status`. Codex stores the
persistent flag under `~/.codex/junk-drawer`; Claude Code keeps its flag under `~/.claude`.

Two things in one command:

- `/tldr N` — summarize your last **substantive** message in at most N sentences (default 3). One-shot. Repeated calls always condense the original message, never a previous TL;DR.
- `/tldr on` / `/tldr off` — keep **every** following reply terse, across **all** sessions, until off.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install tldr@junk-drawer
```

## Usage

```
/tldr 2      # last message in ≤2 sentences
/tldr        # last message in ≤3 sentences (the `sentences` setting on Claude Code)
/tldr on     # terse mode ON — every reply, all sessions
/tldr off    # back to normal
/tldr status # is terse mode currently on or off
```

## How persistent mode works

`/tldr on` writes a global flag (`~/.claude/tldr-on`). A bundled **UserPromptSubmit hook** checks that
flag every turn and, while set, injects a "be terse" instruction into context — so the terseness is
enforced deterministically each turn. A skill couldn't guarantee that (skills are model-triggered, not
per-turn). `/tldr off` removes the flag. The flag is global on purpose: turn it on in one tab, every
session with the plugin goes terse.

## Settings

Two rows in `/config` on Claude Code (`userConfig` in the manifest):

| Key | Type | Default | Meaning |
|---|---|---|---|
| `terse` | boolean | `false` | Terse mode, the same switch as `/tldr on|off` |
| `sentences` | number | `3` | How many sentences a `/tldr` without a number may use |

Scope: user-global; project/session overrides: planned.

`sentences` applies on Claude Code through the hooks module: a `/tldr` with no argument reaches the command
with the setting as its number. Other hosts run the markdown alone and keep its default of 3.

The [junkd](../junkd/README.md) frame shows both rows in its own pane through `$.tldr` (below); it is
optional, tldr works without it.

**The flag file is the shell-side truth.** The per-turn hook is a shell script and runs on every host, and a
shell hook cannot read `$.config`, so `~/.claude/tldr-on` (or `$CLAUDE_CONFIG_DIR/tldr-on`) is what decides
terse mode. Flipping `terse` in `/config` or through `$.tldr.set` writes the row *and* the flag file;
`/tldr on|off` writes the flag file only. When the two disagree the file wins: `$.tldr.get` answers `terse`
from the file, and the next write puts both back in step. A hand edit of `terse` in settings.json writes the row
only: the flag file, written by `/tldr on|off` and by the setting, is what the shell hook reads, so the edit takes
effect at the next write through `/config` or `$.tldr.set`.

### API for other plugins

The hooks module adds `$.tldr` to the engine's `$`, so another mod (a frame that shows the settings and
flips terse mode) calls it instead of reading this plugin's files. The host hands a noun's method one input
and answers every call asynchronously, so each takes one object and returns a promise. List `tldr` under
`dependencies` in your plugin.json and the engine lays its contract (`types/index.d.ts`, exported as `Tldr`)
beside the API reference, typed.

- `schema()` — one entry per setting: `{ key, type, title, default, main }`; both are `main`.
- `get({ key })` — `terse` from the flag file, `sentences` from the row (at load, then every write).
- `set({ key, value, scope? })` — writes `tldr.<key>` through `$.config` (and, for `terse`, the flag file) and
  resolves to the stored value; refused (unknown key, a value that does not fit — `sentences` takes a whole
  number of 1 or more —, a `config.set` hook's deny) it rejects with the reason. `scope` takes only `user`
  today; the field exists so project or session scopes can be added later without changing callers.

There is no pane; `/tldr` stays the command on every host. The module is Claude-only: Codex and Kimi run the
shell hook and `tldr-flag` as before.
