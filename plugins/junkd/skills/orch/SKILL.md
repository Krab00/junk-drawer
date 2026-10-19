---
name: orch
description: Orchestrate implementation and independent verification of one task or a backlog using specialized subagents, isolated Git worktrees, evidence gates, fix rounds, and draft pull requests. Use when the user asks to run orch, process task ids, drain a backlog, delegate implementation and verification, or execute batch, chain, all, deep, or single-PR modes.
argument-hint: "[<free text> | <ID...> | batch [N] | chain [N] | all | panel] [--rounds R] [--base <branch>] [--deep] [--single-pr[=<branch>]]"
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/orch-state:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/orch-worktree:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/orch-sync:*), Bash(git:*), Bash(gh:*), Task, Read, Write, Edit
---

# Orchestrate tasks

Arguments: "$ARGUMENTS"

These are the run's mode and flags: `<free text>`, `<ID...>`, `batch [N]`, `chain [N]` or `all`, with `--rounds R`, `--base <branch>`, `--deep`, `--single-pr[=<branch>]`; `/junkd:orch batch 3` is mode `batch`, N=3. On a host that leaves the placeholder above unfilled, they are the rest of the user's request. Nothing given means the next eligible task.

You are the root orchestrator. You must delegate implementation and verification to subagents; do not implement or self-verify task code. Keep selection, acceptance criteria, state transitions, agent steering, and PR bookkeeping in the root task.

## Load the specification

Read `./commands/orch.md` from this skill directory completely before acting. Treat it as the canonical workflow, with these host mappings:

- The spec's `/junkd:orch` is this skill (`/junkd:orch` on Claude Code, `$orch` on Codex, `/skill:orch` on Kimi Code, "use the orch skill" on OpenCode), and its `/junkd:orch-init` the sibling `orch-init` skill.
- `.orch/config.md` is primary; `.claude/orch.config.md` is a read-only compatibility fallback.
- Resolve helpers as `./bin/orch-state`, `./bin/orch-worktree`, and `./bin/orch-sync` (on Claude Code, see below).
- Replace Claude's `Task` operation with your host's subagent mechanism (see below).
- Read the matching role file under `./roles/` and include its full task-relevant instructions in each agent prompt (Claude Code has them as agent types, see below).

## Claude Code rules

- `/junkd:orch panel` never reaches this text: the junkd hooks module answers it by toggling the orch settings pane. Without the hooks module loaded, `panel` is no mode; say so in one line.
- The helpers are `${CLAUDE_PLUGIN_ROOT}/bin/orch-state`, `${CLAUDE_PLUGIN_ROOT}/bin/orch-worktree` and `${CLAUDE_PLUGIN_ROOT}/bin/orch-sync`, spelled exactly so wherever the spec says `${CLAUDE_PLUGIN_ROOT}`: on a Fable main loop the junkd guard runs only that bin/ path, with plain arguments.
- The roles are agent types: `junkd:implementer`, `junkd:lead-implementer`, `junkd:verify-coordinator`, `junkd:ui-reviewer`, `junkd:test-planner`, `junkd:test-reviewer`, `junkd:orch-ops`. Spawn them by type without a `model` (theirs is pinned); any other agent needs `model: opus|sonnet|haiku`.
- The settings are the junkd plugin's `orch_*` rows (`/config` under junkd, or `/junkd:orch panel`); `orch-state settings` prints them without the prefix.

## Codex delegation rules

- Spawn independent task implementers in parallel only when their expected files do not overlap.
- Spawn one `verify-coordinator` per implemented task and keep verification independent from implementation.
- Current Codex defaults allow the root to spawn direct children. For deep mode, keep the root as the fan-out owner unless `agents.max_depth >= 2` is explicitly configured; do not assume a lead child can create grandchildren.
- Give each agent a concrete worktree path, branch, acceptance criteria, config-derived commands, evidence destination, and return format.
- Wait for all agents required by the selected mode, consume their summaries, and keep raw logs inside their threads.

## Kimi Code delegation rules

- Subagents = the `Agent` tool (`coder` for implementation/verification, `explore` for read-only scans); parallel batches via `AgentSwarm`. A `coder` subagent can spawn its own children, so `lead-implementer` fan-out (deep mode) works — keep the max depth orchestrator → lead → sub.
- Subagents have a fixed 30-minute timeout; resume the same agent id on timeout instead of starting over.
- `/loop /junkd:orch all` has no native equivalent: use `CronCreate` in the same session to re-trigger the loop, or resume manually with the spec's `BACKLOG:` resume line.
- Browser-based UI verification (`ui-reviewer`) needs a browser tool (e.g. Playwright MCP); if none is available, state the gap and gate on the remaining checks — never fabricate screenshots.
- Git mutations (commit, push, `gh pr create`) require explicit user confirmation on this host: ask ONCE per run for a blanket approval covering task branches and draft PRs, then proceed. Never touch the base branch regardless.

## OpenCode delegation rules

- Subagents = the `task` tool. orch's roles are not registered as OpenCode agents: read the matching `./roles/<role>.md` and include its full task-relevant instructions in each task prompt (spawn the default/general subagent unless the user configured dedicated ones).
- Keep the root as the fan-out owner in every mode, deep included — do not assume a subagent can spawn grandchildren.
- Parallelize by issuing multiple `task` calls in one message, only when the implementers' expected files do not overlap; one `verify-coordinator` task per implemented task, independent from implementation.
- Browser-based UI verification (`ui-reviewer`) needs a browser tool (e.g. Playwright MCP); if none is available, state the gap and gate on the remaining checks — never fabricate screenshots.
- `/loop /junkd:orch all` has no native equivalent: resume manually with the spec's `BACKLOG:` resume line.

Preserve the specification's immutable-criteria ladder, capability-gated checks, maximum fix rounds, draft-only PR rule, cleanup, lessons, and final `BACKLOG:` state line. Never merge a PR or mark it ready.
