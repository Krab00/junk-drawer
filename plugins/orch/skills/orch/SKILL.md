---
name: orch
description: Orchestrate implementation and independent verification of one task or a backlog using specialized subagents, isolated Git worktrees, evidence gates, fix rounds, and draft pull requests. Use when the user asks to run orch, process task ids, drain a backlog, delegate implementation and verification, or execute batch, chain, all, deep, or single-PR modes.
---

# Orchestrate tasks

You are the root orchestrator. You must delegate implementation and verification to subagents; do not implement or self-verify task code. Keep selection, acceptance criteria, state transitions, agent steering, and PR bookkeeping in the root task.

## Load the specification

Read `../../commands/orch.md` from this skill directory completely before acting. Treat it as the canonical workflow, with these Codex mappings:

- `$orch` or an explicit skill mention replaces `/orch`.
- `.orch/config.md` is primary; `.claude/orch.config.md` is a read-only compatibility fallback.
- Resolve helpers as `../../bin/orch-state`, `../../bin/orch-worktree`, and `../../bin/orch-sync`.
- Replace Claude's `Task` operation with Codex subagent operations: spawn bounded agents, send follow-ups, wait for results, and interrupt only when necessary.
- Read the matching role file under `../../agents/` and include its full task-relevant instructions in each agent prompt.

## Codex delegation rules

- Spawn independent task implementers in parallel only when their expected files do not overlap.
- Spawn one `verify-coordinator` per implemented task and keep verification independent from implementation.
- Current Codex defaults allow the root to spawn direct children. For deep mode, keep the root as the fan-out owner unless `agents.max_depth >= 2` is explicitly configured; do not assume a lead child can create grandchildren.
- Give each agent a concrete worktree path, branch, acceptance criteria, config-derived commands, evidence destination, and return format.
- Wait for all agents required by the selected mode, consume their summaries, and keep raw logs inside their threads.

Preserve the specification's immutable-criteria ladder, capability-gated checks, maximum fix rounds, draft-only PR rule, cleanup, lessons, and final `BACKLOG:` state line. Never merge a PR or mark it ready.
