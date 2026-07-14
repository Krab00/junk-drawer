# orch — the full guide

`orch` is a **project-agnostic orchestration loop** for Claude Code. Point it at a repo and it
picks tasks from a canonical store, delegates each one to subagents, verifies **every acceptance
criterion against real tool evidence**, round-caps the fix loop, and opens **draft PRs** — while
keeping the base branch untouchable and the heavy build/test/screenshot output out of the
orchestrator's own context.

This is the long-form companion to the plugin [`README.md`](../README.md). The README is the
cheatsheet; this guide explains *why* the loop is shaped the way it is and walks through it end to
end. Everything here matches the shipped `commands/`, `agents/`, and `bin/` files — no invented
behaviour.

## Contents

1. [The idea — why it exists](#1-the-idea--why-it-exists)
2. [How it works — the loop](#2-how-it-works--the-loop)
3. [The criteria freeze ladder](#3-the-criteria-freeze-ladder)
4. [Standing checks, gated by capabilities](#4-standing-checks-gated-by-capabilities)
5. [Learning — the retro / `_lessons.md`](#5-learning--the-retro--_lessonsmd)
6. [Modes & flags](#6-modes--flags)
7. [Setup & usage walkthrough](#7-setup--usage-walkthrough)
8. [Backends](#8-backends)
9. [The bin scripts](#9-the-bin-scripts)
10. [Config reference](#10-config-reference)
11. [Limitations — v0.1 notes](#11-limitations--v01-notes)

---

## 1. The idea — why it exists

A naive "agent, go build my backlog" loop fails in four predictable ways. `orch` is built around
an answer to each.

| The failure mode | What goes wrong | orch's answer |
|---|---|---|
| **Context drift** | One agent implements, verifies, reads build logs, drives the browser, and reflects — all in one context. Heavy output (installs, boot logs, test runs, screenshots) fills the window, and quality degrades task after task. | The **orchestrator never codes or verifies itself.** Implementation goes to an `implementer`; the whole verification goes to a `verify-coordinator`. The noisy output lives in *their* contexts. The orchestrator only ever sees a short plan in and a compact verdict out — so `all` can drain many more tasks before its own window fills. |
| **No memory** | The loop repeats the same mistake on task 7 that it made on task 2. Nothing learned in one task informs the next. | A **retro step** appends a lesson to `_lessons.md` at every resolve. Those lessons are fed back into the next task's plan and the next verification. A pattern that recurs across ≥2 tasks is proposed for promotion into a permanent standing check. |
| **Tokens burned on unreachable goals** | "Make it work" isn't checkable, so the agent grinds without ever knowing whether it's done — or declares victory on vibes. | Every task's goal is a set of **verifiable acceptance criteria, frozen before any code is written.** A criterion that no tool can check isn't a criterion. A description too thin to derive one goes `blocked` with a question — never implemented on a guess. |
| **Happy-path-only verification** | The gate improvises checks from a *positive* acceptance list, on data that happens to cooperate — so the empty / error / edge branches never get hit, and the task bounces later. | Verification derives its cases from the **diff, not the feature description** (`test-planner`), and runs a set of **standing checks** — real-data provenance, malformed-input handling, FE-actually-calls-the-API, E2E-through-the-UI — that hit exactly the branches a lucky run skips. **No PASS without tool evidence.** |

Two more principles hold the whole thing together:

- **State lives in files + git, so a run is resumable.** Task status is YAML frontmatter in the
  task file; evidence is committed alongside; work happens on real branches in worktrees. A killed
  run leaves a clean, inspectable state you can resume from.
- **Everything ends with a `BACKLOG:` line**, so an outer `/loop` driver can decide whether to keep
  going. That single machine-readable line is what turns `orch` from a one-shot into an autonomous
  drain (`/loop /orch all`).

---

## 2. How it works — the loop

```
                 read .orch/config.md   (no config → STOP: run /orch:init)
                              │
                    ┌─────────▼──────────┐
                    │  1. SYNC + SELECT  │  orch-sync pull · reset-stale · pick eligible todo(s)
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  2. FREEZE CRITERIA│  verbatim → checklist → derive(traceable) → blocked
                    └─────────┬──────────┘   (criteria are IMMUTABLE for the whole round loop)
                              │
                    ┌─────────▼──────────┐
                    │  3. PLAN + DELEGATE│  short plan + lessons → implementer
                    └─────────┬──────────┘   (or lead-implementer fan-out for a big task)
                              │
                    ┌─────────▼──────────┐
                    │  4. VERIFY (gate)  │  verify-coordinator:
                    │                    │    test-planner → matrix from the DIFF
                    │                    │    ui-reviewer   → browser, screenshot/criterion
                    │                    │    test-reviewer → test-quality audit
                    │                    │    + inline curl/build/test + standing checks
                    └─────────┬──────────┘   → ONE merged verdict + FAILING: list
                              │
                  ┌───────────▼───────────┐
             PASS │  5. RESOLVE           │ FAIL → fix loop, capped at --rounds R
              ────┤   round strategy       ├────  round 1 build · middle rounds same impl.
                  └───────────┬───────────┘        final round FRESH impl. + diff + why
                              │                     still failing after R → blocked + escalate
                    ┌─────────▼──────────┐
                    │  6. RETRO          │  append lesson → _lessons.md
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  7. DRAFT PR        │  gh pr create --draft  (humans merge, never orch)
                    └─────────┬──────────┘
                              │
                  next task (chain/batch/all)  … then  BACKLOG: DRAINED | REMAINING | BLOCKED
```

Step by step, as the shipped `commands/orch.md` runs it:

1. **Sync + select.** `orch-sync pull` refreshes the store from the backend. `orch-state
   reset-stale` returns any leftover `in_progress`/`blocked` task to `todo` (a killed run, or a
   task escalated last time, gets a fresh attempt). The selectable pool is every `todo` row whose
   `deps` are all `done`. **Two tasks that touch the same files are never batched together** —
   they split across batches or run as a chain. Picked tasks are set `in_progress`.

2. **Freeze the criteria.** Before *any* code, the acceptance criteria are settled once and made
   immutable for the rest of the loop — see [§3](#3-the-criteria-freeze-ladder).

3. **Plan + delegate.** The orchestrator writes a short implementation plan (files to touch,
   contracts, any spec to follow), folds in the current `_lessons.md`, and hands it to an
   implementer. It chooses `lead-implementer` when the work cuts into ≥2 file-disjoint slices (or
   `--deep` is passed), else the plain `implementer`. The agent is spawned worktree-isolated and is
   fed the **config facts it needs** — dev-server commands, ports, test commands — because the
   agent itself assumes no stack.

4. **Verify — via `verify-coordinator`.** The orchestrator never verifies; it delegates the whole
   thing. The coordinator builds the verify env, runs the checks, collects evidence, and returns
   **one merged verdict table plus a `FAILING:` list**. See the subagent roles below.

5. **Resolve — round strategy.** All criteria PASS (or PM-REVIEW) → the task is `done` and a
   **draft PR** is opened. Any FAIL → the fix loop runs, handing back **only** the failing
   criteria, capped at `--rounds R` (default 3):
   - **Round 1** — the implementer's first build.
   - **Middle rounds** — the **same** implementer, given only the failing criteria.
   - **Final round (R)** — a **FRESH** implementer, handed the diff (`git diff <base>...<branch>`)
     plus a short analysis of *why the previous attempts keep failing* — a new pair of eyes.
   - **Still failing after round R** → the task is `blocked`, the escalation reason is appended,
     and the loop moves on.

6. **Retro.** Every resolve appends a lesson to `_lessons.md` — see [§5](#5-learning--the-retro--_lessonsmd).

7. **Draft PR + iterate.** In `chain`/`all` the next task branches off the one just finished; in
   `batch` verdicts are consumed as coordinators finish. At end of run `orch-sync push` reflects
   statuses to the backend, and the run prints its `BACKLOG:` line.

### The subagents — who does what, and what each guarantees

The orchestrator delegates to six subagents. Naming them matters because each one *guarantees* a
specific property the orchestrator then trusts without re-checking.

| Subagent | Role | What it guarantees |
|---|---|---|
| **`implementer`** | Builds exactly one task on its own branch in its own worktree. | Scoped changes only (no architectural decisions, no adjacent "improvements"); authors tests for its change; runs the real build/lint/test before reporting; never touches the base branch. |
| **`lead-implementer`** | Builds one *big* task by fanning out to parallel sub-implementers. | Freezes the shared contract (types/DTOs/signatures) **first**, so no slice guesses another's interface; slices are **file-disjoint**; merges them back and runs the final gate; **falls back to flat** if the task can't be cut cleanly. |
| **`verify-coordinator`** | Owns the entire verification of one task. | Builds and tears down the verify env; spawns the three reviewers below; runs the inline + standing checks; writes the verdict table + evidence into the task file; returns one compact verdict. **No PASS without tool evidence.** Keeps all the heavy output out of the orchestrator's context. |
| **`test-planner`** | Reads the **diff** and derives the mandatory test matrix. | One binding row per changed branch / guard / validation / fallback / boundary — happy **and** edge — each with a *real* induction recipe and a preferred layer (`e2e`/`web`/`api`). A `?state=`-style preview is never accepted as proof of an error/edge row. |
| **`ui-reviewer`** | Verifies the UI/browser criteria by driving the real browser. | One screenshot per criterion via `agent-browser`; every state (default/empty/loading/error/no-permission); data checked against the real account, not a mock; PASS/FAIL/PM-REVIEW — never on the implementer's word. |
| **`test-reviewer`** | Audits the tests that ship with the change. | Judges *quality* (real assertions, coverage of the change, no over-mocking, modifications truly updated) — not just that the suite is green. Returns `OK` or `GAPS`; `GAPS` is a FAIL. |

A note on **where evidence lives**: the `verify-coordinator` and `ui-reviewer` deliberately run in
the orchestrator's checkout, **not** the throwaway verify worktree, so the screenshots and the
verification table survive when the worktree is torn down.

---

## 3. The criteria freeze ladder

The single most important rule: **the acceptance criteria are settled once, before any code, and
are immutable for the entire round loop.** This is what makes the goal *verifiable* — the fix loop
in [§2](#2-how-it-works--the-loop) grades against a fixed target, not a target that drifts to
whatever the implementer happened to build.

The orchestrator climbs this ladder per task and stops at the first rung that applies:

1. **Structured DoD / acceptance criteria in the task** → copy them **verbatim**.
2. **A checklist / checkboxes in the task** → **verbatim**.
3. **Neither** → **DERIVE**. Each derived criterion must be:
   - **(a) checkable by a tool** — curl / test / browser / build; and
   - **(b) traceable** — it cites the source sentence from the description it came from.

   Untraceable wishes become Open Questions, never criteria. On an interactive single-task run the
   derived criteria are shown for approval before implementing. On an autonomous run (`/loop`) the
   loop proceeds but stamps `criteria_source: derived` and leads the PR body with
   *"Criteria (derived — review these first)"*.
4. **Description too thin to derive anything checkable** → the task goes `blocked` with the reason
   `needs-criteria` and a concrete question, and is reported under `BACKLOG: BLOCKED`. **Never
   implement on vibes.**

---

## 4. Standing checks, gated by capabilities

On top of a task's own acceptance criteria, `verify-coordinator` runs an always-on quality bar.
Each check is **gated by a capability** the project declares in its config — declare `web`, `api`,
`tests` for exactly the layers you have and the loop verifies only those. A capability the project
doesn't declare is **silently skipped**; the loop never invents a check for a layer that doesn't
exist.

| Standing check | Gated on | What it proves |
|---|---|---|
| **Green scoped suite + change covered**, plus an independent **test-quality audit** (`test-reviewer` `GAPS` = FAIL) when tests were added/touched | `tests` declared | The change is tested, and the tests are worth keeping — not tautologies, not over-mocked, and modifications really updated the assertions. |
| **Malformed body → clean 4xx naming the field, never a 500** | `api` declared | Every touched write-endpoint validates its input. Happy-path-only is not a pass. |
| **Real-data provenance** — a fresh account created *this run* with **random** values; rendered == returned == stored | `web` + `api` declared | The screen shows *this account's* data from the live API — never a mock/demo seed or a `?preview=` switch a hardcoded value could pass. |
| **FE actually calls the live API** on data-backed routes, verified **E2E through the UI** | `web` + `api` declared | The frontend really consumes the backend end to end — not static content with a silent mock behind it. |
| **`ui-reviewer` drives the real browser** — a screenshot per criterion, every state | `web` declared | Screen/flow/state criteria are proven visually, at the project's target viewport, against the design tokens — not taken on the implementer's word. |
| **Every path from `test-planner`'s matrix** — happy + each edge (empty/loading/error/no-permission/boundary), each induced for real | always (scaled to declared layers) | The branches a lucky random run skips are actually hit. A state that genuinely can't be reached this run is a visible FAIL/PM-REVIEW row with a reason — never a silently missing line. |
| **Everything in `standing_checks_extra`** | project config | Project-specific lessons already promoted to permanent checks (see [§5](#5-learning--the-retro--_lessonsmd)). |

---

## 5. Learning — the retro / `_lessons.md`

`orch` learns *within a run* and, with your approval, *across runs*.

- **The retro step.** At **every** task resolve — especially after FAIL rounds or a `blocked` — the
  orchestrator appends 2–3 sentences to `<tasks_dir>/_lessons.md`: *what failed, why, and what
  check would have caught it.*
- **Fed forward immediately.** Those lessons are handed into the next task's plan (step 3) and into
  the next `verify-coordinator` spawn (step 4). So a mistake made on task 2 informs task 3 in the
  same run.
- **Promotion to a standing check.** When the **same pattern recurs across ≥2 tasks**, the
  orchestrator proposes promoting it into `standing_checks_extra` in the config — where it becomes a
  permanent, always-on check for every future task. This **asks you first; the loop never edits the
  config silently.**

This is the missing feedback loop in naive agent runs: without it, the same class of bug gets
re-litigated task after task.

---

## 6. Modes & flags

`orch` is one command with several shapes. Parse them from the arguments:

| Invocation | What it does |
|---|---|
| `/orch "<free text>"` | **Adhoc single task** — creates a canonical task file from your prompt (id `ADHOC-N`), runs the freeze ladder **interactively** (shows the criteria, waits for approval), then the standard loop for that one task. |
| `/orch <ID> [<ID>…]` | Run **explicit tasks** already in the store (skips selection; still enforces `deps`). |
| `/orch batch [N]` | Up to **N independent tasks in parallel** (default N=3). Picks tasks with no unsatisfied deps and no shared files; spawns all implementers, then all verify-coordinators. |
| `/orch chain [N]` | **Task-by-task**, each branch **stacked** on the previous finished branch. |
| `/orch all` | `chain` with no limit — **drain** until no `todo` remains. |

**Flags** (any mode):

| Flag | Effect |
|---|---|
| `--rounds R` | Fix-loop cap (default **3**). The final round always brings in a fresh implementer. |
| `--base <branch>` | Start point instead of the git default branch. |
| `--deep` | Force the `lead-implementer` contract-freeze + file-disjoint fan-out for a big task. |
| `--single-pr[=<branch>]` | Ship the whole run as **one** integration branch + **one** draft PR (each task is still independently verified; only the PR tail changes). |

**Autonomous drain:** `/loop /orch all` runs a fresh cycle each iteration, keying off the final
`BACKLOG:` line and stopping on `DRAINED` or `BLOCKED`.

### Which invocation for which situation

| Situation | Use |
|---|---|
| One small task, no task file yet | `/orch "<describe it>"` |
| One big task that splits into layers | `/orch <ID> --deep` (or `/orch "<text>" --deep`) |
| Several independent tasks, want speed | `/orch batch [N]` |
| Several tasks that build on each other | `/orch chain [N]` |
| Drain the whole backlog, hands-off | `/loop /orch all` |
| Everything should land as one PR | add `--single-pr` to any mode |

### The `BACKLOG:` line

Every run ends with **exactly one** of these — an outer `/loop` driver keys off it:

```
BACKLOG: DRAINED   — no todo tasks remain
BACKLOG: REMAINING — <count> (<ids>); resume: /orch <mode> [N] --base <last-finished-branch>
BACKLOG: BLOCKED   — remaining tasks need a human: <ids + one-line reasons>
```

`BLOCKED` (not `REMAINING`) is used when every remaining task is ineligible for a *human* reason —
`blocked` after the round cap, or a `deps` entry that isn't a known task id (a human prerequisite).
A `/loop` driver stops on both `DRAINED` and `BLOCKED`.

---

## 7. Setup & usage walkthrough

### Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install orch@junk-drawer
```

### Initialise the project (once per repo)

```
/orch:init
```

`/orch:init` **scans** the repo — it reads rather than guesses:

- the **git default branch** (becomes the `--base` default);
- the **layout + package manager** (workspaces? `package.json` / `go.mod` / `pyproject.toml` /
  `Cargo.toml` / …);
- each **runnable capability** — for every web frontend or api backend, its dev-server script, the
  port it binds, and a health path (`/` for web, `/health` for api);
- the **test runner** per package (a layer with no runner is recorded as absent, never forced to
  grow one).

It then **asks which backend** fits ([§8](#8-backends)), shows you the filled config to confirm the
run/test commands + ports it detected, and on approval writes `.orch/config.md`, creates
`tasks_dir`, and seeds an empty `_lessons.md`. If a config already exists it shows a diff and asks
before overwriting — a hand-tuned config is never clobbered silently.

### The canonical task file

Tasks live at `<tasks_dir>/<ID>.md`. **Status is the frontmatter** — there is no separate manifest
to drift out of sync.

```markdown
---
id: TASK-123
title: Fix login redirect
status: todo            # todo | in_progress | done | blocked
deps: [TASK-120]        # this task is eligible only once every dep is done
source: adhoc           # adhoc | github#45 | linear:ABC-12
source_updated_at:      # stamped on pull; push compares it (drift guard)
criteria_source: derived # verbatim | derived
---
## Description
<what the task is — describe the desired behaviour>

## Acceptance criteria
- [ ] AC1: <tool-checkable sentence> (modality: ui|api|test|data)

## Verification — <branch>   # appended by verify-coordinator
| Criterion | Tool | Evidence | Verdict |
```

Evidence files land in `<tasks_dir>/<ID>.evidence/`.

### A concrete run: `/orch "fix login redirect bug"`

1. **Adhoc task created.** `orch-state new ADHOC-1 "fix login redirect bug"` writes the skeleton
   file; the orchestrator fills the description from your prompt.
2. **Criteria frozen (interactively).** No structured DoD exists, so the loop *derives* criteria —
   e.g. *"AC1: after a successful login the user lands on `/dashboard`, not `/login` (modality:
   ui)"* — each traceable to a sentence in your prompt, and shows them to you for approval.
3. **Delegated.** A short plan + the current lessons go to an `implementer`, spawned in its own
   worktree on branch `task/adhoc-1-fix-login-redirect`, fed the dev-server and test commands from
   the config.
4. **Verified.** `verify-coordinator` boots the app, has `test-planner` derive the matrix from the
   diff (including the *failed*-login and *already-logged-in* branches), has `ui-reviewer` drive the
   real browser through the redirect on a fresh random account, runs the standing checks, and
   returns a merged verdict.
5. **Resolved.** All PASS → the task is `done`, a **draft PR** is opened
   (`gh pr create --draft …`), and a lesson is appended to `_lessons.md`. The run prints
   `BACKLOG: DRAINED`.

You review and merge the PR — `orch` never does.

---

## 8. Backends

The backend decides where tasks come from and what `orch-sync` does. Set it in the config.

| Backend | Where tasks live | What sync does |
|---|---|---|
| **`adhoc`** | The task files in `tasks_dir` are the whole source of truth; `/orch "<free text>"` creates them. | `orch-sync` is a **no-op** (the files *are* canon). |
| **`manifest`** | Same as adhoc, but you maintain the task files **by hand**. | No-op. |
| **`github-issues`** | GitHub issues carrying a configured label (default `orch`). | **Pull:** issues → task files (`id` becomes `GH-<number>`, the body checklist → acceptance criteria, `updatedAt` stamped as `source_updated_at`). **Push:** a status comment with the verification table + PR link. Needs the `gh` CLI authenticated. |
| **`linear-mcp`** | Linear, via the Linear MCP. | Sync happens **in-conversation** through the MCP — `/orch` does the pull/push itself. Thin in v0.1 (see [§11](#11-limitations--v01-notes)). |

**Field ownership + drift guard (`github-issues`).** The tool owns human-set fields (issue state,
labels); `orch` owns its status comment and never overwrites human edits. Pull stamps
`source_updated_at`; on push, if the issue changed upstream since that stamp, `orch-sync` **flags it
and refuses to push** — re-pull first. Issue OPEN/CLOSED maps to `todo`/`done` only (plain issues
have no rich workflow states); push **never closes an issue and never merges**.

---

## 9. The bin scripts

Three small, zero-dependency bash scripts carry the **deterministic mechanics** — the mechanical,
error-prone steps that shouldn't be an LLM's job. Keeping them out of the model's hands is why the
frontmatter never drifts and ports never collide.

- **`orch-state`** — the canonical task-store CRUD and the *only* writer of status:
  `list` (id/status/deps table) · `set <id> <status>` · `reset-stale` (`in_progress`/`blocked` →
  `todo`) · `new <id> [title]` (skeleton task file).
- **`orch-worktree`** — per-task git worktrees under `.worktrees/` plus **stable port slots**
  (`port = capability port_base + slot`): `add <id> <branch> [base]` · `remove <id>` · `slot <id>`.
- **`orch-sync`** — the task-store ⇄ backend bridge: `pull` / `push` (github via `gh`;
  `adhoc`/`manifest` no-op; `linear-mcp` an in-conversation stub).

---

## 10. Config reference

`/orch` reads every project fact from `.orch/config.md`. **No config → it stops and tells you
to run `/orch:init`.** YAML frontmatter + free-form prose notes:

```markdown
---
backend: adhoc            # adhoc | manifest | github-issues | linear-mcp
tasks_dir: .orch/tasks    # where the canonical task files live
default_base: main        # detected git default branch; --base overrides it
branch_prefix: task/      # per-task branch = <branch_prefix><id>-<slug>
capabilities:
  web:  { run: "npm run dev", port_base: 5180, health: "/" }              # omit if no web app
  api:  { run: "npm run start:dev", port_base: 3180, health: "/health" }  # omit if no api
  tests: { api: "npm test" }   # use `root` for a repo-level suite; omit absent runners
standing_checks_extra: []      # project lessons promoted to standing checks (starts empty)
github: { label: "orch" }      # github-issues backend only; drop otherwise
---
Free-form project notes /orch should know: conventions, gotchas, where the visual spec lives,
calibration values that must never be guessed, etc.
```

| Field | Meaning |
|---|---|
| `backend` | Which task source drives the run — see [§8](#8-backends). |
| `tasks_dir` | Directory holding the canonical `<ID>.md` task files (default `.orch/tasks`). |
| `default_base` | Detected git default branch; overridden by `--base`. |
| `branch_prefix` | Per-task branch name = `<branch_prefix><id>-<slug>`. |
| `capabilities.web` / `.api` | `run` (dev-server command), `port_base`, `health` path. **Omit the whole block if the layer doesn't exist** — its standing checks are then skipped. |
| `capabilities.tests` | Test command map (`{ pkg: "cmd" }`); use `root` for a repo-level suite. |
| `standing_checks_extra` | Project-specific checks promoted from `_lessons.md` (starts empty). |
| `github.label` | Only for the `github-issues` backend — the label to pull. |
| *(prose below the frontmatter)* | Anything the orchestrator should know: conventions, the visual-spec path, calibration values that must never be guessed. |

`port_base` is the *base* of a per-task range — `orch-worktree` adds a stable slot — so pick bases
far enough apart that a few parallel tasks won't collide (e.g. `5180` web / `3180` api).

---

## 11. Limitations — v0.1 notes

- **`linear-mcp` is thin.** The sync runs in-conversation through the Linear MCP; `bin/orch-sync`
  is only a stub for that backend.
- **No Jira backend** yet.
- **`--single-pr` `batch` integration resolves only *trivial* structural conflicts** — it keeps
  both sides' entries in a shared registration file (a module registry, router, or barrel
  `index.ts`). Any conflict touching real task logic **stops and is reported, never guessed**.
