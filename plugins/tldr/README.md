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
/tldr        # last message in ≤3 sentences
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
