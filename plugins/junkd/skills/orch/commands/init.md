---
description: "Scan this repo and generate .orch/config.md — the adapter /junkd:orch reads for every project fact (task backend, branch naming, dev-server run commands, ports, test runners). Run once before /junkd:orch."
argument-hint: "(no arguments)"
allowed-tools: Bash(git:*), Bash(cat:*), Bash(ls:*), Bash(test:*), Bash(cp:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/orch-state:*), Read, Write, Glob, Grep
---

# /junkd:orch-init — generate the project config for `/junkd:orch`

Produce `.orch/config.md` in this repo: the single adapter that makes the
project-agnostic `/junkd:orch` loop fit THIS stack. Scan, propose, confirm, write — don't invent
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
- **Spec files** — the requirement documents `/junkd:direction` scores the code against. Candidates:
  `PRD*` and `SPEC*` at the root, the `specs/` folder, `docs/ARCHITECTURE*` and `docs/PLAN*`.
  Propose the ones found as the `specs:` list (a folder as `specs/*.md`); the user confirms or edits it.
  None found → write no `specs:` key and say nothing about it.

## 2. Pick the backend (ask — this is a real choice)

Show the four options and ask which fits; default to `adhoc` if the user just wants to start:
- **`adhoc`** — no external tracker; task files in `tasks_dir` are the whole source of truth
  (`/junkd:orch <free text>` creates them). Simplest; `orch-sync` is a no-op.
- **`manifest`** — same as adhoc but the user maintains the task files by hand.
- **`github-issues`** — pull issues carrying a label into task files, push a status comment back
  (needs the `gh` CLI authenticated). Ask for the label (default `orch`).
- **`linear-mcp`** — sync through the Linear MCP in-conversation (thin in v0.1: `/junkd:orch` does the
  pull/push via MCP; the `orch-sync` script is a stub for this backend).

## 3. Propose the filled config, confirm the commands

Show the user the file you're about to write and confirm the run/test commands + ports you
detected (these are the ones that most often need a human correction). Omit any capability the
project doesn't have — **do not** write a `web`/`api`/`tests` block for a layer that isn't there;
`/junkd:orch` gates its checks on exactly what's declared here.

```markdown
---
backend: adhoc            # adhoc | manifest | github-issues | linear-mcp
tasks_dir: .orch/tasks    # canonical task files live here
default_base: main        # detected git default branch; --base overrides it
branch_prefix: task/      # per-task branch = <branch_prefix><id>-<slug>
capabilities:
  web:  { run: "<dev-server cmd>", port_base: 5180, health: "/" }        # omit if no web app
  api:  { run: "<dev-server cmd>", port_base: 3180, health: "/health" }  # omit if no api
  tests: { <pkg>: "<test cmd>" }   # use key `root` for a repo-level suite; omit absent runners
standing_checks_extra: []          # project lessons promoted to standing checks (starts empty)
specs: [PRD.md, specs/*.md]        # spec files /junkd:direction checks; omit when none were found
github: { label: "orch" }          # github-issues backend only; drop otherwise
---
Free-form project notes /junkd:orch should know: conventions, gotchas, where the visual spec lives,
calibration values that must never be guessed, etc.
```

`port_base` values are the *base* of a per-task port range (`orch-worktree` adds a stable slot),
so pick bases far enough apart that a few parallel tasks won't collide (e.g. 5180 web / 3180 api).

## 4. Write + scaffold

After the user confirms:
1. Create `.orch/` if needed, then write `.orch/config.md`.
2. Create `tasks_dir` and an empty `<tasks_dir>/_lessons.md` (the retro log `/junkd:orch` appends to).
3. Confirm `${CLAUDE_PLUGIN_ROOT}/bin/orch-state list` runs clean against the new config (empty
   store is fine), then tell the user how to start: `/junkd:orch <free text>` for an adhoc task, or
   `/junkd:orch batch` once tasks exist. If `.orch/config.md` already exists, show the diff and
   ask before overwriting — never clobber a hand-tuned config silently.

## 5. Binding rules → checks

A rule written into CLAUDE.md holds only on the prompt until a tool checks it.
This step turns each written rule into a row of `standing_checks_extra`, a pointer to a test that already pins it, or an explicit "prose".
Run it after the config is written (§4), before the "how to start" message.

1. **Find the candidates.**
   Read every `CLAUDE.md` and `AGENTS.md` in the repo (root and per package).
   A candidate is (a) any rule in a section whose heading matches `/binding|non-negotiable|never|must|invariant/i`, or (b) any list item anywhere that contains `never`, `always`, `must` or `only`.
   Keep the file, the heading and the rule text for each.
2. **Pick one outcome per candidate:**
   - **row**: a `standing_checks_extra` row with a concrete tool recipe: a `grep`/`rg` over the source (what must or must not match, in which paths), a test command, or a `curl` against the dev server.
     The recipe states the expected result, so the verify-coordinator can run it and show the output.
   - **covered by test `<path>`**: a test already pins the rule.
     Grep the test tree for the rule's key nouns and name the file (and test) that asserts it.
     No row is written.
   - **not tool-checkable, stays prose**: no tool can decide it (taste, architecture intent, naming).
     No row is written.
3. **Show the table** (`rule | source | outcome | row or test path`).
   Write only the rows the user confirms.
   A row is never added silently; a declined row stays in the table as prose.
4. **Re-runs propose only what is new.**
   A candidate with outcome row is new unless a `standing_checks_extra` row already holds its recipe or names its source rule.
   A candidate that re-derives as covered by a test, or as prose, is not new: it writes nothing, so it is not proposed again and the second table lists nothing for it (at most a one-line count).
   If nothing is new, say so and write nothing.
5. **Offer the starter test policy only when `.orch/TEST-POLICY.md` is absent.**
   Then offer to copy the orch skill's `templates/TEST-POLICY.md` there (`${CLAUDE_PLUGIN_ROOT}/skills/orch/templates/TEST-POLICY.md` on Claude Code, the sibling `orch` skill's `./templates/TEST-POLICY.md` elsewhere).
   Its seventh rule is this step: every binding rule has a test or a row.
   Copy only after the user agrees.
   When the file exists, leave it alone and do not offer.
