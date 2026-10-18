# orch

Codex: install the plugin, open a new task, run `$orch-init` once per repository, then invoke
`$orch` with a task id, free text, `batch`, `chain`, or `all`. Claude Code keeps `/orch:init` and
`/orch`. Both hosts share `.orch/config.md`, task files, worktrees, and helper scripts.

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

`/orch:init` scans the repo and writes `.orch/config.md`. The orchestrator uses it as the primary
config and accepts legacy `.claude/orch.config.md` as a fallback. **No config, no run.** The `capabilities` block **gates**
the checks: declare `web`, `api`, `tests` for exactly the layers you have, and the loop verifies
only those (no api → the malformed-body check is skipped; no web → no browser review; no test
runner → build + behaviour checks stand in).

```markdown
---
backend: adhoc            # adhoc | manifest | github-issues | linear-mcp
tasks_dir: .orch/tasks    # canonical task files live here
default_base: main        # detected git default branch; --base overrides it
branch_prefix: task/      # per-task branch = <branch_prefix><id>-<slug>
capabilities:
  web:  { run: "npm run dev", port_base: 5180, health: "/" }        # omit if no web app
  api:  { run: "npm run start:dev", port_base: 3180, health: "/health" }  # omit if none
  tests: { api: "npm test" }  # use `root` for a repo-level suite; omit absent runners
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

## Agents

Each agent pins its model in its frontmatter; spawn them without `model:` and they run on it. Pass
a different model only when the user asked for it.

| Agent | Model | Job |
|---|---|---|
| `orch-ops` | haiku | runs the bin scripts, git, gh and jq reads for the orchestrator; one line back, output in a report file |
| `implementer` | opus | builds one task (or one file-disjoint slice of it) on its own branch in its own worktree, with tests and a mutant sweep |
| `lead-implementer` | opus | one big task: freezes the shared contract, fans out to parallel `implementer` slices, merges them back, runs the final gate |
| `verify-coordinator` | opus | the whole verification of one task: builds the verify env, runs the inline checks, spawns the three reviewers, writes the verdict table |
| `test-planner` | sonnet | derives the mandatory test matrix from the diff (happy + edge rows with real induction recipes) |
| `ui-reviewer` | sonnet | drives the browser (chrome-devtools MCP, agent-browser, playwright MCP, agent-device: first found), a screenshot per UI criterion |
| `test-reviewer` | sonnet | audits the tests a change ships: real assertions, coverage of the change, no over-mocking; `OK` or `GAPS` |

The real files live in `skills/orch/roles/`; `agents/` at the plugin root is a symlink to them
(see the layout note in the repo README).

## Orchestrator rules, injected at session start

`skills/orch/ORCHESTRATOR.md` is the rule sheet for the main session: on Fable the main loop only
plans and delegates (no tool use of its own, git and the bin scripts through `orch-ops`, one-line
agent results, no agent chatter in the transcript); on Opus the same rules apply only when the user
asks for orchestrator mode; other models work inline. `hooks/hooks.json` registers
`scripts/orch-context.sh` as a `SessionStart` hook that prints the sheet into the context of the
main session only:

- a subagent never gets it: the hook exits silently when `CLAUDE_AGENT_ID` is set or the hook
  input carries an `agent_id`;
- `ORCH_INJECT_RULES=0` in the environment turns the injection off, and so does the `inject_rules`
  setting below: off, the hooks module writes the flag file `~/.claude/orch/rules-off` (under
  `CLAUDE_CONFIG_DIR` when set) and the hook exits silently while it exists;
- the hook always exits 0, so a missing sheet never blocks a session.

`tests/orch.sh` (run by `tests/smoke.sh`) covers the hook, the agent roster and the bin scripts.

## The main-loop guard (Claude Code only)

`hooks/index.tsx` is the plugin's hooks module. On a Fable main loop the rule sheet says "plan and
delegate"; the guard enforces it. It checks the main loop's own tool calls only: a subagent's calls
and another plugin's `$.tool.call` always go through. The `guard` setting says when it is active:

- `fable` (default): while the main-loop model is a Fable. The model is read live, so a `/model`
  switch counts at once (to Opus: the guard is off; back to Fable: on again). A model that cannot
  be read is no Fable: the guard fails open and says so once per session.
- `always`: on every model.
- `off`: never.

Every denial starts with `Orchestrator mode (orch):` and says what to do instead.

| Tool | The main loop may use it… |
|---|---|
| `ListAgents`, `TaskStop`, `AskUserQuestion`, `ToolSearch`, `Skill`, `CronList`, `CronDelete`, `EnterPlanMode`, `ExitPlanMode`, `PushNotification`, `RemoteTrigger` | always |
| `Agent` | with `model: opus\|sonnet\|haiku`, or as an `orch:` agent type with no `model` (theirs is pinned). Never as a fork or with `inherit`. With a Fable model only when `allow_fable_agents` is on. An `agent.spawn` hook checks the resolved model again (a fork, `inherit`, or no model on a non-`orch:` type would run on the main loop's model). |
| `SendMessage` | except to a reviewer (`verify-coordinator`, `ui-reviewer`: spawn a new one), to an agent past `implementer_ctx_k` k tokens of context, or to an agent nobody knows. A stopped agent is known by its `SubagentStop`: the module keeps its type and the context tokens of its transcript's last usage record, by id and by name. |
| `Read` | in the session scratchpad, the repo's task store `<repo>/.orch/` (`<repo>` = git's toplevel of the session's cwd; none outside a repo) and, in the config dir (`$CLAUDE_CONFIG_DIR`, else `~/.claude`), `orch/`, `handoffs/` and `projects/*/memory/`. The path must be a plain absolute ASCII path (no `~`, no relative path, no surrounding spaces, no non-ASCII letters) with no `..` segment; symlinks and case aliases are resolved first and where it lands must pass too, and a path that cannot be placed is denied. |
| `Write` | in the same places as `Read` (the task store only outside a `.claude/` dir), or to a new `.md` file. Never a path with a `..` segment, never to settings, Claude Code config (`CLAUDE.md`, `AGENTS.md`, `SKILL.md`, anything in a `.claude/` dir, any plugin's `agents`, `commands`, `skills`, `hooks`, `rules`, `output-styles`, a `.claude-plugin/` dir) or this plugin. The path must be a plain absolute ASCII path; symlinks and case aliases are resolved first, and a path that cannot be placed (a link to nothing, a folder that does not resolve) is denied. |
| `Bash`, `Monitor` | only to run one of this plugin's own `bin/` scripts, by its path under the plugin root, with plain arguments (no quotes, `$`, backticks, `;`, `&`, `\|`, `<`, `>`) |
| `CronCreate`, `ScheduleWakeup` | only to schedule `/orch` (or `/orch:orch`), `/loop` of an allowed prompt, or a plain prompt, or to stop one |
| anything else (`Edit`, `Grep`, `Glob`, `WebFetch`, `WebSearch`, `LSP`, MCP tools, …) | never |

If the guard itself throws, the call is denied (`Orchestrator mode (orch): guard error`). Known
gaps: a `context: fork` skill raises no spawn event, so the guard never sees it; a plugin loaded
from outside a `plugins/` path is not covered by the Write rule. The exact rules are in
`hooks/orch-lib.ts`, the tests in `hooks/orch.test.tsx` (`claude plugin test plugins/orch`).

### Settings

`/orch panel` toggles the pane: one Settings tab with the six rows (`tab` moves, `enter` saves a
field, a letter flips a switch or focuses a field, the guard's options are buttons, `q` closes).
The same rows are in `/config` under plugin `orch`.

| Key | Type | Default | What it does |
|---|---|---|---|
| `guard` | string (`fable`, `always`, `off`) | `fable` | When the guard holds the main loop: on a Fable model, always, or never |
| `allow_fable_agents` | boolean | `false` | Let the main loop spawn a subagent on an explicit Fable model (the user asked) |
| `implementer_ctx_k` | number | `400` | Reuse an implementer for a fix round only while its context is under this many k tokens (50–1000) |
| `ui_review` | boolean | `true` | Run `ui-reviewer` without asking when the config declares `web` |
| `inject_rules` | boolean | `true` | Print `ORCHESTRATOR.md` into the main session at start (the flag file above when off) |
| `rounds` | number | `3` | Fix rounds per task; `--rounds` overrides it for one run (1–10) |

Scope: user-global; project/session overrides: planned.

A value that does not fit (a guard word other than the three, a number out of range or not whole)
is refused on every write path: the pane, `$.orch.set` and the `/config` menu alike. The
[junkd](../junkd/README.md) frame shows the first three rows in its own pane through `$.orch` (below);
it is optional, orch works without it.

### API for other plugins

The hooks module adds `$.orch` to the engine's `$`, so another mod (a frame that shows the main
settings and jumps into the pane) calls it instead of reading this plugin's files. The host hands a
noun's method one input and answers every call asynchronously, so each takes one object and returns
a promise. List `orch` under `dependencies` in your plugin.json and the engine lays its contract
(`types/index.d.ts`, exported as `Orch`) beside the API reference, typed.

- `schema()` — one entry per setting: `{ key, type, title, default, main, options? }`; `main` marks
  `guard`, `allow_fable_agents` and `implementer_ctx_k`, the three a frame shows first; `guard`
  carries its `options`.
- `get({ key })` — the current value of a setting (the `/config` row at load, then every write).
- `set({ key, value, scope? })` — writes `orch.<key>` through `$.config` and resolves to the stored
  value; refused (unknown key, a value that does not fit, a `config.set` hook's deny) it rejects with
  the reason. `scope` takes only `user` today; the field exists so project or session scopes can be
  added later without changing callers.
- `open()` — the same path as `/orch panel`: toggles the pane.
- `show({ focus?, owner? })` — opens the pane and never closes it: `focus` asks for the keys; `owner`
  marks the pane as the caller's (junkd opens its set of panes this way).
- `hide({ owner? })` — closes the pane; with `owner`, only while the pane is still the one that owner's
  `show` opened (any other open or close since, the person's included, clears the mark).
- `guardState()` — `{ active, model }`: whether the guard holds the main loop right now, and the
  main-loop model it was judged on.

The module is Claude-only: Codex and Kimi run the skills, the bin scripts and the SessionStart hook
as before.

## Under the hood

Three zero-dependency scripts carry the deterministic mechanics (frontmatter is the single source
of truth — no separate manifest to drift):

- `bin/orch-state` — task-store CRUD (`list` / `set` / `reset-stale [--blocked]` / `new` /
  `cfg <key>` / `id <id>`). `list` hides `_lessons.md` and every other `_`-prefixed file (they are
  not tasks) and marks a file without a closed frontmatter block `invalid`; `set` refuses it.
- `bin/orch-worktree` — per-task worktrees under `.worktrees/` (excluded from git status) + stable
  port slots (`port = capability port_base + slot`, registry guarded by a lock for parallel
  verifiers). An existing branch is attached detached, so the implementer's checkout may keep it;
  the config's `default_base` is never accepted as a task branch.
- `bin/orch-sync` — the task-store ⇄ backend bridge.

## v0.1 limitations

- **`linear-mcp` is thin** — the sync happens in-conversation through the MCP; `bin/orch-sync` is a
  stub for that backend.
- **No Jira backend** yet.
- The `--single-pr` `batch` integration resolves only *trivial* structural conflicts (keeps both
  sides in registration files); any real logic conflict stops and is reported, never guessed.
