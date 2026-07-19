---
name: orch
description: Orchestrate implementation and independent verification of one task or a backlog using specialized subagents, isolated Git worktrees, evidence gates, fix rounds, and draft pull requests. Use when the user asks to run orch, process task ids, drain a backlog, delegate implementation and verification, or execute batch, chain, all, deep, or single-PR modes.
---

# Orchestrate tasks

You are the root orchestrator. You must delegate implementation and verification to subagents; do not implement or self-verify task code. Keep selection, acceptance criteria, state transitions, agent steering, and PR bookkeeping in the root task.

## Load the specification

Read `../../commands/orch.md` from this skill directory completely before acting. Treat it as the canonical workflow, with these host mappings:

- An explicit skill mention replaces `/orch` (`$orch` on Codex, `/skill:orch` on Kimi Code).
- `.orch/config.md` is primary; `.claude/orch.config.md` is a read-only compatibility fallback.
- Resolve helpers as `../../bin/orch-state`, `../../bin/orch-worktree`, and `../../bin/orch-sync`.
- Replace Claude's `Task` operation with your host's subagent mechanism (see below).
- Read the matching role file under `../../agents/` and include its full task-relevant instructions in each agent prompt.

## Codex delegation rules

- Spawn independent task implementers in parallel only when their expected files do not overlap.
- Spawn one `verify-coordinator` per implemented task and keep verification independent from implementation.
- Current Codex defaults allow the root to spawn direct children. For deep mode, keep the root as the fan-out owner unless `agents.max_depth >= 2` is explicitly configured; do not assume a lead child can create grandchildren.
- Give each agent a concrete worktree path, branch, acceptance criteria, config-derived commands, evidence destination, and return format.
- Wait for all agents required by the selected mode, consume their summaries, and keep raw logs inside their threads.

## Kimi Code delegation rules

- Subagents = the `Agent` tool (`coder` for implementation/verification, `explore` for read-only scans); parallel batches via `AgentSwarm`. A `coder` subagent can spawn its own children, so `lead-implementer` fan-out (deep mode) works — keep the max depth orchestrator → lead → sub.
- Subagents have a fixed 30-minute timeout; resume the same agent id on timeout instead of starting over.
- `/loop /orch all` has no native equivalent: use `CronCreate` in the same session to re-trigger the loop, or resume manually with the spec's `BACKLOG:` resume line.
- Browser-based UI verification (`ui-reviewer`) needs a browser tool (e.g. Playwright MCP); if none is available, state the gap and gate on the remaining checks — never fabricate screenshots.
- Git mutations (commit, push, `gh pr create`) require explicit user confirmation on this host: ask ONCE per run for a blanket approval covering task branches and draft PRs, then proceed. Never touch the base branch regardless.

Preserve the specification's immutable-criteria ladder, capability-gated checks, maximum fix rounds, draft-only PR rule, cleanup, lessons, and final `BACKLOG:` state line. Never merge a PR or mark it ready.
