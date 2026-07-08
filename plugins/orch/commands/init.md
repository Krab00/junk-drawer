---
description: "Scan this repo and generate .claude/orch.config.md — the adapter /orch reads for every project fact (task backend, branch naming, dev-server run commands, ports, test runners). Run once before /orch."
argument-hint: "(no arguments)"
allowed-tools: Bash(git:*), Bash(cat:*), Bash(ls:*), Bash(test:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/orch-state:*), Read, Write, Glob
---

# /orch:init — generate the project config for `/orch`

Produce `.claude/orch.config.md` in this repo: the single adapter that makes the
project-agnostic `/orch` loop fit THIS stack. Scan, propose, confirm, write — don't invent
facts you can read from the repo, and don't ask the user things the repo already answers.

## 1. Scan the repo (read, don't guess)

Gather, quietly:
- **Git default branch** — `git symbolic-ref --quiet refs/remotes/origin/HEAD` or the current
  branch; this becomes the `--base` default.
- **Layout + package manager** — root `package.json` (workspaces?), `pnpm-workspace.yaml`,
  `go.mod`, `pyproject.toml`, `Cargo.toml`, etc. Note the monorepo apps if any.
- **Runnable capabilities** — for each app that is a **web** frontend or an **api** backend:
  its dev-server script (`package.json` → `scripts.dev` / `start:dev` / `start`), the port it
  binds (script args, `vite.config`, `.env`, framework default), and a health path (`/` for web,
  `/health` or `/healthz` or `/` for api).
- **Test runners** — per package: the `test` script, else the runner in use (jest / vitest /
  mocha / pytest / `go test` / `cargo test`). A layer with **no** runner is recorded as absent,
  never forced to grow one.

## 2. Pick the backend (ask — this is a real choice)

Show the four options and ask which fits; default to `adhoc` if the user just wants to start:
- **`adhoc`** — no external tracker; task files in `tasks_dir` are the whole source of truth
  (`/orch <free text>` creates them). Simplest; `orch-sync` is a no-op.
- **`manifest`** — same as adhoc but the user maintains the task files by hand.
- **`github-issues`** — pull issues carrying a label into task files, push a status comment back
  (needs the `gh` CLI authenticated). Ask for the label (default `orch`).
- **`linear-mcp`** — sync through the Linear MCP in-conversation (thin in v0.1: `/orch` does the
  pull/push via MCP; the `orch-sync` script is a stub for this backend).

## 3. Propose the filled config, confirm the commands

Show the user the file you're about to write and confirm the run/test commands + ports you
detected (these are the ones that most often need a human correction). Omit any capability the
project doesn't have — **do not** write a `web`/`api`/`tests` block for a layer that isn't there;
`/orch` gates its checks on exactly what's declared here.

```markdown
---
backend: adhoc            # adhoc | manifest | github-issues | linear-mcp
tasks_dir: .orch/tasks    # canonical task files live here
branch_prefix: task/      # per-task branch = <branch_prefix><id>-<slug>
capabilities:
  web:  { run: "<dev-server cmd>", port_base: 5180, health: "/" }        # omit if no web app
  api:  { run: "<dev-server cmd>", port_base: 3180, health: "/health" }  # omit if no api
  tests: { <pkg>: "<test cmd>" }   # per-package test commands; omit layers with no runner
standing_checks_extra: []          # project lessons promoted to standing checks (starts empty)
github: { label: "orch" }          # github-issues backend only; drop otherwise
---
Free-form project notes /orch should know: conventions, gotchas, where the visual spec lives,
calibration values that must never be guessed, etc.
```

`port_base` values are the *base* of a per-task port range (`orch-worktree` adds a stable slot),
so pick bases far enough apart that a few parallel tasks won't collide (e.g. 5180 web / 3180 api).

## 4. Write + scaffold

After the user confirms:
1. Write `.claude/orch.config.md`.
2. Create `tasks_dir` and an empty `<tasks_dir>/_lessons.md` (the retro log `/orch` appends to).
3. Confirm `${CLAUDE_PLUGIN_ROOT}/bin/orch-state list` runs clean against the new config (empty
   store is fine), then tell the user how to start: `/orch <free text>` for an adhoc task, or
   `/orch batch` once tasks exist. If `.claude/orch.config.md` already exists, show the diff and
   ask before overwriting — never clobber a hand-tuned config silently.
