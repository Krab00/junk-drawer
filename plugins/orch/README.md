# orch

A **project-agnostic orchestration loop** for Claude Code. Point it at a repo, and it picks tasks
from a canonical store, delegates each to an `implementer` subagent, verifies **every acceptance
criterion against real tool evidence** (not the implementer's word) through a `verify-coordinator`,
round-caps the fix loop, and opens **draft PRs** — while keeping the base branch untouchable and
the heavy build/test/screenshot output out of the orchestrator's own context.

It's a portable extraction of a loop proven on a real product backlog. Every project fact (task
backend, branch naming, dev-server commands, ports, test runners) comes from one config file, so
the same loop fits any stack.

**Docs:** this README is the cheatsheet; the long-form companion — the why, the loop end to end, the
subagents, backends, and config reference — is in [`docs/guide.md`](docs/guide.md)
([HTML](docs/guide.html)).

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install orch@junk-drawer
```

Then, **in the target repo**, generate the adapter once:

```
/orch:init
```

## Config = the adapter

`/orch:init` scans the repo and writes `.claude/orch.config.md`. `/orch` reads only this file for
project facts — **no config, no run** (it tells you to init). The `capabilities` block **gates**
the checks: declare `web`, `api`, `tests` for exactly the layers you have, and the loop verifies
only those (no api → the malformed-body check is skipped; no web → no browser review; no test
runner → build + behaviour checks stand in).

```markdown
---
backend: adhoc            # adhoc | manifest | github-issues | linear-mcp
tasks_dir: .orch/tasks    # canonical task files live here
branch_prefix: task/      # per-task branch = <branch_prefix><id>-<slug>
install: { cmd: "pnpm install --frozen-lockfile --offline", lockfiles: [pnpm-lock.yaml], reuse: clone }  # worktree node_modules reuse; omit if no lockfile
capabilities:
  web:  { run: "npm run dev", port_base: 5180, health: "/" }        # omit if no web app
  api:  { run: "npm run start:dev", port_base: 3180, health: "/health" }  # omit if none
  tests: { api: "npm test" }  # per-package test commands; omit layers with no runner
standing_checks_extra: []     # project lessons promoted to standing checks
github: { label: "orch" }     # github-issues backend only
---
Free-form project notes the orchestrator should know (conventions, gotchas, the visual spec path,
calibration values that must never be guessed).
```

## Modes

| Command | What it does |
|---|---|
| `/orch <free text>` | **Adhoc single task** — create a task file from the prompt, freeze criteria interactively, then the loop |
| `/orch <ID> [<ID>…]` | Run explicit tasks from the store |
| `/orch batch [N]` | Up to N independent tasks in **parallel** (default N=3) |
| `/orch chain [N]` | Task-by-task, each branch **stacked** on the previous |
| `/orch all` | Drain the backlog (chain until no `todo` remains) |

Flags (any mode): `--rounds R` (fix-loop cap, default 3) · `--base <branch>` · `--deep` (fan-out a
big task via `lead-implementer`) · `--single-pr[=<branch>]` (one integration branch + one draft PR
for the whole run).

## How a task is driven

1. **Freeze the criteria** before any code: copy a structured DoD / checklist verbatim, else derive
   tool-checkable, traceable criteria (autonomous runs mark them `derived` for review; too-thin
   descriptions go `blocked` with a question — never implemented on vibes).
2. **Implement** on an isolated task branch (`implementer`, or `lead-implementer` for a big task
   that cuts into file-disjoint slices behind a frozen contract).
3. **Verify** the whole task via `verify-coordinator` — it builds the env, spawns `test-planner`
   (diff → mandatory matrix), `ui-reviewer` (browser criteria) and `test-reviewer` (test quality),
   runs the standing checks, and returns one merged verdict. **No PASS without tool evidence.**
4. **Resolve:** all-PASS → `done` + draft PR; any FAIL → fix loop, capped at `--rounds`. Round 1
   builds, middle rounds re-run the same implementer on only the failing criteria, the **final
   round hands a FRESH implementer the diff + a why-it-keeps-failing analysis**; still failing →
   `blocked` and escalated.
5. **Retro:** every resolve appends a lesson to `_lessons.md`; a pattern recurring across ≥2 tasks
   is proposed for promotion into `standing_checks_extra` (asks you — never edits config silently).

The base branch is untouchable throughout: all work lands on task branches in worktrees, only draft
PRs are opened, and **humans merge**.

## Autonomous drain

`/orch` ends every run with exactly one machine-readable line:

```
BACKLOG: DRAINED   — no todo tasks remain
BACKLOG: REMAINING — <count> (<ids>); resume: /orch <mode> [N] --base <last-finished-branch>
BACKLOG: BLOCKED   — remaining tasks need a human: <ids + reasons>
```

Drive a full drain with **`/loop /orch all`** — it keys off this line and stops on `DRAINED` or
`BLOCKED`.

## Backends

| Backend | Sync behaviour |
|---|---|
| `adhoc` | No tracker; task files are the whole source of truth (`/orch <free text>` creates them) |
| `manifest` | Same, but you maintain the task files by hand |
| `github-issues` | Pull labelled issues → task files, push a status comment back (needs `gh`) |
| `linear-mcp` | Pull/push via the Linear MCP **in-conversation** — thin in v0.1 (see limitations) |

## Under the hood

Three zero-dependency scripts carry the deterministic mechanics (frontmatter is the single source
of truth — no separate manifest to drift):

- `bin/orch-state` — task-store CRUD (`list` / `set` / `reset-stale` / `new`).
- `bin/orch-worktree` — per-task worktrees under `.worktrees/` + stable port slots
  (`port = capability port_base + slot`); provisions each worktree's node_modules once at creation
  (CoW-clone from the main checkout when the lockfile is unchanged, real install only when it changed).
- `bin/orch-sync` — the task-store ⇄ backend bridge.

## v0.1 limitations

- **`linear-mcp` is thin** — the sync happens in-conversation through the MCP; `bin/orch-sync` is a
  stub for that backend.
- **No Jira backend** yet.
- The `--single-pr` `batch` integration resolves only *trivial* structural conflicts (keeps both
  sides in registration files); any real logic conflict stops and is reported, never guessed.
