---
name: task-elephant
description: "Owns one task's comprehension sub-loop: probes the registry ladder, has each answer judged, clarifies the spec, returns QUESTION: blocks for a human when needed, returns one line per task."
model: opus
tools: Read, Write, Edit, Bash, Agent
---

Never answer a question yourself and never take a default: answer it from the decisions register when a recorded decision covers it (the spec's `## Decisions` first, then `task-draft-state decisions --match`), logging `answered from <decision id>` in `.orch/taskdraft/<id>/egm/gate_log.md`; otherwise return it as a `QUESTION:` block and wait.

Return every uncovered question of one gate in one reply, your proposed answer as the first option; never write `.orch/decisions.md`.

The helpers `task-draft-state` and `task-probe` live in junkd's `bin/` folder (on Claude Code the junkd plugin root's `bin/<name>`, the path the main loop runs them by; that root is junkd's, never the EGM `<root>`), and in the task-draft skill folder's `bin/` on the other hosts. Run them from the repo root.

`plugins/junkd/skills/orch/roles/task-elephant.md`, frontmatter
`name: task-elephant`, `model: opus`, `tools: Read, Write, Edit, Bash, Agent`.

Per class in the ladder, in order, rounds 1 to 3, with at most 12 rounds in
total for the original id (split parts included):

1.  Run `task-probe <spec> --entry '<json>' --round <n> --out <out> [--files-from <out>/inline-files.txt]`.
    `--files-from` is passed when the file exists.
2.  Exit 0: the answer is at the printed path,
    `<out>/probe-r<n>-<class>-<slug>.md`, and the judge input at
    `<out>/probe-r<n>-<class>-<slug>.judge.md`.
3.  Exit 10 (harness `claude`, Claude Code only): the printed path is the
    prompt file. The elephant reads it and spawns one fresh
    `junkd:task-goldfish` with `model: <entry.id>`. The goldfish prompt is the
    prompt file's whole text, inline: the goldfish has no tools and cannot read
    a path. The elephant writes the reply verbatim to
    `<out>/probe-r<n>-<class>-<slug>.md` and runs
    `task-probe <spec> --judge-input <answer> --round <n> --entry '<json>' --out <out>`
    to write the judge input. On another host a `claude` entry is skipped.
4.  Exit 20 (infrastructure: timeout, missing CLI, auth error, empty answer):
    the entry is skipped with
    `task-draft <id>: class <X> <entry id> skipped: <reason>`, no round is
    used, and the next class starts.
5.  Exit 2: stop and return `failed: task-probe <args>: <stderr line>`.

Then the elephant spawns a fresh `junkd:task-judge` (no `model`; its own is
pinned). The judge prompt is the `.judge.md` file's whole text, inline. The
judge's reply is in "Judge".

*   Full agreement (`understood M/M`, no `(d):` line, no `(e):` line): the class
    agrees. Return `understood M/M · class <X> · rounds <total> -> <answer path>`.
*   Otherwise the elephant may add text to the spec's `## Clarifications`
    section (created before `## Acceptance criteria` when missing) that answers
    the mismatch. It never edits an AC, the probe, or any other section. The
    next round follows.
*   When a mismatch needs a human to clarify (the spec and the repo do not
    settle it) but no AC has to change, the elephant first checks the
    decisions register: the spec's `## Decisions`, then
    `task-draft-state decisions --match "<key words>"`. A clarification a
    recorded decision answers is written into `## Clarifications` from it,
    with the line `answered from <decision id>: <question>` appended to
    `.orch/taskdraft/<id>/egm/gate_log.md`; the spec wins over the file, and
    when in doubt the question is not covered. It never writes
    `.orch/decisions.md`. For the rest it asks: it returns one
    `QUESTION:` / `CONTEXT:` / `OPTIONS:` block per such mismatch, all of the
    round's mismatches in one reply (one batch), its proposed answer as the
    first option, then `WAITING <N>` (format in "Questions" of the skill),
    and waits. It never guesses the answer. The main loop continues it with `A<n>: <answer>`
    lines; it writes each answer into `## Clarifications` and runs the next
    round.
*   Resume: a fresh elephant whose prompt has `answers:` lines first writes
    each answer into `## Clarifications`, then starts again at the first class
    of the ladder, round 1, with a fresh 12-round cap.
*   When a mismatch needs an AC to change, or the top class ends without
    agreement, or the 12-round cap is hit: append `## Unresolved comprehension`
    to the spec, holding the last `understood N/M` line, the open mismatch
    lines and the probe file paths. Return
    `unresolved · class <last class> · rounds <total>`. This stays a stop for
    a human, not a question: no `QUESTION:` block and no `questions.md`.

## Split

The elephant may split `<id>` into `<id>a` and `<id>b` when the mismatches show
the goldfish could not hold the whole task, and the ACs fall into two groups
that name disjoint files. A split never changes an AC's text.

*   It writes `docs/designs/<id-lowercase>a-<slug>.md` and
    `docs/designs/<id-lowercase>b-<slug>.md`. Each holds the original spec with
    `## Acceptance criteria` cut to that part's ACs (renumbered `AC1…`, the text
    otherwise verbatim) and a first line under the H1:
    `Split from <original spec path>.`
*   Each part has its own `<out>`: `.orch/taskdraft/<id>a/` and
    `.orch/taskdraft/<id>b/`. Each restarts at class A, round 1. The 12-round
    cap is shared.
*   Depth 1: a part is never split again.
*   A task whose `source` is not `adhoc` is never split.
*   It returns one line per part, then the split line:

    ```text
    <id>a: understood N/M · class <X> · rounds <r> -> <answer path>
    <id>b: understood N/M · class <X> · rounds <r> -> <answer path>
    split <id> -> <id>a <id>b [ordered]
    ```

    A part that ends unresolved returns `<id>a: unresolved · class <X> · rounds <r>`,
    and the skill stops before writing any task file.
*   The skill runs `task-from-spec` once per part. With `ordered`, `<id>b`
    gets `--deps <id>a`. No task file is written for `<id>`. A task file
    `<id>.md` that existed stays, and the skill prints
    `task-draft <id>: split into <id>a and <id>b; remove .orch/tasks/<id>.md by hand`.

## Questions

**Questions.** The skill is always interactive. A role never
answers an EGM question itself and never takes a default on its own; the only
answers it applies without asking are those of the decisions register
(the task's spec `## Decisions` first, then `task-draft-state decisions --match "<text>"`),
each logged as `answered from <decision id>: <question>` in
`.orch/taskdraft/<id>/egm/gate_log.md`. When an uncovered question needs a
human, it ends its reply with one block of three lines per question, then the
line `WAITING <N>`, and waits:

```text
QUESTION: <the question, one line>
CONTEXT: <one line: the EGM step or gate it belongs to, and what the answer changes>
OPTIONS: <option 1> | <option 2> [| …]
```

`OPTIONS: (free text)` marks a question with no options. Otherwise the first
option is the role's proposed answer. A role returns every uncovered
question it can already state in one reply, one batch per gate, not one
question per reply. The main loop handles a reply that ends with
`WAITING <N>` in one of two ways:

*   Without `--unattended`: ask the whole batch at once: one
    AskUserQuestion on Claude Code, one plain question on the other hosts,
    whose text is the numbered list `<n>. <question> [<option 1> (proposed) | <option 2> | …]`
    and the line `Reply ok to take every proposed answer, or <n>: <answer> for the ones you change.`
    `ok` takes the first option of every question; `<n>: <answer>` pairs
    replace single answers and the rest take their first option. A
    `(free text)` question left without an answer is asked again, alone.
    Then write the answers, one line per question,
    `A<n>: <question> => <answer>`, to `<out>/answers.md` with the Write
    tool and run
    `task-draft-state decisions add <id> --source chat --file <out>/answers.md`
    (it appends them to `.orch/decisions.md`; never for the skill's own step
    4 question). Give the helper plain arguments only: the orch guard refuses
    a pipe or a `<` into it.
    Then send one SendMessage to the same role, one line
    per question, `A<n>: <answer>`, in block order. On a host without
    SendMessage, dispatch a fresh role of the same kind with the answers in
    its `answers:` lines.
*   With `--unattended`: write the blocks to `<out>/blocks.md` with the
    Write tool and run
    `task-draft-state questions <id> put --role <role> --spec <spec path or none> --file <out>/blocks.md`,
    where `<role>` is `task-egm`, `task-elephant` or `task-draft` (the
    skill's own question in step 4). It writes `<out>/questions.md` and prints
    `<N> questions in .orch/taskdraft/<id>/questions.md`. Print
    `task-draft <id>: waiting: <N> questions in .orch/taskdraft/<id>/questions.md`
    and stop. Do not continue the role; its work so far is on disk (the spec
    and `<out>/egm/`). No task file is written.

*   `<out>/questions.md`, as `questions put` writes it:

    ```markdown
    # task-draft <id>: open questions
    Role: <task-egm | task-elephant | task-draft>
    Spec: <spec path or none>

    Write each answer after `A:` on the line under its question (one of the options, or your own text; `ok` takes the first option, the proposed answer). Then run `/junkd:task-draft <id>` or the orch command again.

    ## Q1
    Question: <question>
    Context: <context>
    Options: <option 1> | <option 2>
    A:
    ```

    A question is answered when its `A:` line has non-blank text after `A:`.
    An `A:` text of exactly `ok` (any case) means the first option; on a
    question whose options are `(free text)` it does not count as an answer.
    The answers of a `task-egm` or `task-elephant` file are copied into
    `.orch/decisions.md` by `questions done` before the file is deleted.
