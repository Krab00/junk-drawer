---
description: "Direction check: score the code against the spec files of .orch/config.md (MET | PARTIAL | MISSING | CONTRADICTED | UNVERIFIABLE per requirement), list the undocumented work, and write one decision per gap for the human. Usage: /junkd:direction [<spec>...] [--since <ref>] [--head <ref>]"
argument-hint: "[<spec>...] [--since <ref>] [--head <ref>]"
---

# /junkd:direction — spec drift scorecard

Every orch task is verified against its own frozen criteria; nothing compares the sum of the tasks with the
project's requirement documents. This check does: it scores the code against each spec file, finds the work no
spec claims, and leaves the human one decision per gap: change the code, or update the spec.

It runs in the orchestrator's checkout (the one that holds `.orch/config.md`) and is read-only on the repo.
The only file it writes is the report under `.orch/direction/`; a task file is written only after the user confirms a "change code" decision (§6).

## 1. Config: the `specs:` key

Read `.orch/config.md`. No config → print `direction: no .orch/config.md; run /junkd:orch-init first.` and stop.
No `specs:` key, or an empty list → print `direction: .orch/config.md has no specs: key; add specs: [<path or glob>...] and run again.` and stop.
Print that one line and nothing else: no scan, no agent, no report.

`specs:` is a list of paths or globs relative to the repo root (`PRD.md`, `specs/*.md`, `docs/ARCHITECTURE.md`).
Expand each glob against the files at `<head>` (§2); keep the files in list order, each once.
A `<spec>` argument narrows the run to that file; an argument that is not one of the expanded files → print `direction: <spec> is not in the specs: key of .orch/config.md.` and stop.
The list expands to no file → print `direction: specs: matches no file at <head>; fix the list in .orch/config.md.` and stop.

## 2. The range: `--since` and `--head`

- `--head <ref>`: the code under review. Default `HEAD`. Inside an orch run, the branch that holds the run's code (orch.md §6).
- `--since <ref>`: the start of the range. When it is absent, the first that applies:
  1. the `head:` sha of the newest report in `.orch/direction/`, when that sha is an ancestor of `<head>`;
  2. the base commit of the run: inside an orch run, the commit the run's base branch pointed at when the run started;
     outside one, `git merge-base <head> <default_base>` (`default_base` from the config).

Resolve both to full shas before the passes start; the report names both ends and how `<since>` was chosen.
When `<head>` is not the checked-out commit, every pass reads the code at `<head>` through `git show <head>:<path>` and `git grep -n <pattern> <head> --`, never by a checkout.

The **done tasks** of the range: the `done` rows of `${CLAUDE_PLUGIN_ROOT}/bin/orch-state list` whose id occurs in `git log --format='%s%n%b' <since>..<head>`, plus, inside an orch run, every task the run marked `done`.
Each comes with its title and its task file path.

## 3. One pass per spec file

Spawn one read-only agent per spec file, all in parallel. On Claude Code it is a fresh `Explore`-class agent with `model: sonnet`; never `junkd:implementer` or another role that writes.
Brief each one with: the spec file's path, the repo root, `<since>` and `<head>`, the output of `git log --oneline <since>..<head>`, the done tasks (id, title, task file path), and these rules:

- A **requirement** is a heading or a numbered item of the spec file that states something the product does, has or must not do.
  One row per requirement, in the file's order; a heading whose items are requirements of their own gets no row of its own.
- The row quotes the requirement's sentence **verbatim** (the first sentence that states the claim), with its place in the file: the heading text or the item number.
- The verdict is exactly one of:
  - `MET`: the code at `<head>` does what the sentence says, and the evidence shows it (a test that asserts it is the best evidence).
  - `PARTIAL`: some of the sentence holds and some does not; the reasoning names the missing part.
  - `MISSING`: nothing in the code does it.
  - `CONTRADICTED`: the code does the opposite, or something the sentence rules out.
  - `UNVERIFIABLE`: the sentence has no checkable claim (intent, tone, a goal with no behaviour).
- UNVERIFIABLE is for prose with no checkable claim, never for "did not look".
  A claim the agent could not find evidence for after searching is `MISSING`.
- Evidence is one or more of: `path:line` at `<head>`, a test name (`path::test name`), a task id. `MET`, `PARTIAL` and `CONTRADICTED` rows carry at least one; `MISSING` rows name where the agent looked.
- Reasoning is one line.
- The agent reads and runs read-only commands only (`git log`, `git show`, `git grep`, file reads). It edits nothing, creates nothing and runs no test that writes.

It returns only this table, and a last line `ROWS: <n>`:

```markdown
| # | Requirement | Verdict | Evidence | Reasoning |
|---|---|---|---|---|
| 1 | §2 Login: "A wrong password shows an error under the field." | MET | src/login.ts:42, tests/login.test.ts::shows the error | The handler sets the field error; the test asserts it. |
```

A row with a verdict outside the five, or a `MET`/`PARTIAL`/`CONTRADICTED` row with no evidence, goes back to its agent once, with the rule it broke.

## 4. One pass for undocumented work

When every spec pass is back, spawn one more read-only agent (the same kind).
Brief it with `git diff --stat <since>..<head>`, the done tasks, and the merged requirement rows (their evidence column above all).
It finds **undocumented work**: a change in the range that no spec row claims, neither in its evidence nor in its sentence. One row each:

```markdown
| # | Change | Evidence | Reasoning |
|---|---|---|---|
| 1 | A CSV export of the orders list | src/export.ts, task T7 | No spec sentence mentions an export. |
```

Tests, lockfiles, formatting and the `.orch/` store are no undocumented work on their own; a test counts only with the behaviour it pins.
No such change → the agent returns `NONE`.

## 5. The report

Write `.orch/direction/<YYYY-MM-DD>-<short-sha>.md` (today's date, the short sha of `<head>`); create the folder when it is missing.
A report of the same name already exists → add `-2`, `-3`… before `.md`; never overwrite a report.
Nothing is written anywhere else.

```markdown
---
since: <full sha of since>
head: <full sha of head>
date: <YYYY-MM-DD>
specs: [<spec path>, ...]
---
# Direction check — <YYYY-MM-DD> <short sha of head>

Range: `<short since>..<short head>` (<since: given | last report <file> | run base | merge-base with <default_base>>), <n> commits, <n> done tasks.

## Scorecard

| Spec | MET | PARTIAL | MISSING | CONTRADICTED | UNVERIFIABLE | MET % |
|---|---|---|---|---|---|---|
| <spec path> | <n> | <n> | <n> | <n> | <n> | <met>/<total> = <p>% |
| All | <n> | <n> | <n> | <n> | <n> | <met>/<total> = <p>% |

## Requirements

### <spec path>

<the agent's table, rows renumbered R1, R2, ... across all spec files>

## Undocumented work

<the agent's table, rows numbered U1, U2, ...; or "None found.">

## Decisions

- [ ] D1 — R4 MISSING (<spec path>, <place>): "<the verbatim sentence>" → change code | update spec
- [ ] D2 — U1 undocumented: <the change> → change code | update spec
```

- `<total>` counts every requirement row except `UNVERIFIABLE`: a sentence with no checkable claim is neither met nor missed.
  MET % is `<met>/<total>` rounded to a whole percent; with `<total>` 0 it is `0/0 = n/a`.
- Every `MISSING`, `CONTRADICTED` and undocumented row is one decision, one checkbox, with the two options "change code" and "update spec".
  `PARTIAL` and `UNVERIFIABLE` rows are no decision; the scorecard shows them.
- The decisions follow the order of the rows: requirement rows first, then undocumented rows.

The last line of the reply is `DIRECTION: <met>/<total> MET — <n> decisions in <path>`, with the counts of the "All" row and the report's path.

## 6. Decisions: nothing happens without the user

After the report is written, show the Decisions list and ask the user to pick, per decision: change code, update spec, or leave it open.
Inside an orch run, do not ask: leave every decision open and let the run's summary quote the `DIRECTION:` line.
No task is created without the user's confirmation.

- **change code**, confirmed: create one task with `${CLAUDE_PLUGIN_ROOT}/bin/orch-state new DIR-<n> "<short title>"` (`<n>` the next free number among the `DIR-` ids).
  Then replace the two placeholder sections of the new task file:
  - `## Description`: the decision id, the report path, the spec path and place, and what the code must change.
  - `## Acceptance criteria`: `- [ ] AC1: <spec path> (<place>) holds: "<the spec sentence, verbatim>" (modality: <test|api|ui|data>)`.
    For an undocumented row the criterion names the change and the user's wording of what must become of it, since no spec sentence exists.
  Leave the frontmatter as `orch-state` wrote it; the spec sentence is the traceable criterion source of the freeze ladder (orch.md §2).
  Mark the decision in the report: `- [x] D1 — … → change code (task DIR-<n>)`.
- **update spec**, confirmed: mark it `- [x] D1 — … → update spec`. The check does not edit the spec; the human does.
- **declined or left open**: the checkbox stays empty and no task is created.

Report the tasks created (or "no task created") in one line.
The reply after the decisions ends with the `DIRECTION:` line too, unchanged: it counts the decisions, open or taken.
