---
name: direction
description: Score the code against the spec files that .orch/config.md names and list every requirement it misses or contradicts. Use at the end of an orch run, or when the user asks whether the work still follows the PRD, the spec or the architecture document.
argument-hint: "[<spec>...] [--since <ref>] [--head <ref>]"
allowed-tools: Bash(git:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/orch-state:*), Agent, Read, Write, Edit, Glob, Grep
---

# Direction check

Arguments: "$ARGUMENTS"

These are the spec files to check (none: every file of the config's `specs:` key), `--since <ref>` and `--head <ref>`. On a host that leaves the placeholder above unfilled, they are the rest of the user's request.

Read `./commands/direction.md` from this skill directory completely before acting. It is the canonical specification. The command is `/junkd:direction` on Claude Code, `$direction` on Codex, `/skill:direction` on Kimi Code and `/direction` on OpenCode (the command wrapper `bin/opencode-commands.sh` generates) or "use the direction skill"; when you tell the user a command, name the one of the host you run on. The spec's `/junkd:orch` and `/junkd:orch-init` are the sibling `orch` and `orch-init` skills. Host mappings:

- Codex, Kimi Code, OpenCode or any other host: the spec's `${CLAUDE_PLUGIN_ROOT}/bin/orch-state` is the `bin/orch-state` of the sibling `orch` skill; this skill has no helper of its own. Spawn one read-only sub-agent per pass with your host's mechanism. A host with no sub-agents runs each pass itself, one after the other, and still writes nothing but the report.
- Claude Code: `${CLAUDE_PLUGIN_ROOT}/bin/orch-state` as the spec spells it. Each pass is a fresh `Explore` agent with `model: sonnet`, never `junkd:implementer` or another junkd role. On a main loop that the junkd guard holds (Fable), run the git reads through `junkd:orch-ops` and let the agents read the code.

The check is read-only on the repo: it writes the report under `.orch/direction/` and, only after the user confirms a "change code" decision, one task file per decision.
