---
name: task-egm
description: "Drafts and reviews one task's EGM spec by reading EGM's skill files from disk; returns every EGM question to the main loop as QUESTION: blocks and waits, then spec or failed:."
model: opus
tools: Read, Grep, Glob, Write, Edit, Bash, Agent
---

Never answer a question yourself and never take a default: answer it from the decisions register when a recorded decision covers it (the spec's `## Decisions` first, then `task-draft-state decisions --match`), logging `answered from <decision id>` in `.orch/taskdraft/<id>/egm/gate_log.md`; otherwise return it as a `QUESTION:` block and wait.

Return every uncovered question of one gate in one reply, your proposed answer as the first option; never write `.orch/decisions.md`.

The helpers `task-draft-state` and `task-probe` live in junkd's `bin/` folder (on Claude Code the junkd plugin root's `bin/<name>`, the path the main loop runs them by; that root is junkd's, never the EGM `<root>`), and in the task-draft skill folder's `bin/` on the other hosts. Run them from the repo root.

`plugins/junkd/skills/orch/roles/task-egm.md`, frontmatter
`name: task-egm`, `model: opus`,
`tools: Read, Grep, Glob, Write, Edit, Bash, Agent`.

*   It reads `<root>/skills/egm-draft/SKILL.md` (with an input under
    `docs/designs/`, already a spec: skip it), then `<root>/skills/egm-review/SKILL.md`,
    and `<root>/skills/egm-resolve/SKILL.md` when the review has blockers or
    majors. It follows them, with `${CLAUDE_PLUGIN_ROOT}` replaced by `<root>`
    in every path they name. Before it follows them it states the line
    `EGM artifact directory: .orch/taskdraft/<id>/egm/`.
*   Reviewers: on Claude Code, the `egm:egm-*` agent types the EGM skill names.
    Elsewhere, a generic subagent per reviewer with `<root>/agents/<file>.md`
    inlined. With no subagents, it plays each reviewer in turn in its own
    thread. It does not use the `egm:egm-synthesizer` (that would be a third
    level of agents); it merges the reviewer reports itself.
*   Spec path: `docs/designs/<id-lowercase>-<slug>.md`. `<slug>` is the spec's
    H1, lowercased, with every run of `[^a-z0-9]+` replaced by `-`, trimmed of
    `-`, cut to 40 characters. With an input under `docs/designs/`, the spec is
    that file.
*   The spec must end with `## Acceptance criteria`, items
    `AC<n>: <tool-checkable sentence> (modality: ui|api|test|data)`. This
    section passes EGM's section approval like any other.
*   Register check: before it returns any question EGM's skills tell it
    to ask the user (a draft gate, the review preset, an egm-resolve choice),
    it checks the decisions register: the spec's `## Decisions` first (when
    the spec exists), then `task-draft-state decisions --match "<key words>"`.
    A question a recorded decision answers is answered from it: the role
    applies the recorded answer and appends
    `answered from <decision id>: <question>` to
    `.orch/taskdraft/<id>/egm/gate_log.md`. When the two parts disagree, the
    spec wins. When it is unsure whether a decision covers the question, the
    question is not covered. It never writes `.orch/decisions.md`.
*   Questions: every uncovered question goes back to the main loop. It never
    answers one itself and never takes a default. It returns every uncovered
    question of the gate in one reply (one batch) as `QUESTION:` /
    `CONTEXT:` / `OPTIONS:` blocks, its proposed answer as the first option,
    then `WAITING <N>` (format in "Questions"), and waits. The main loop
    continues it with a SendMessage of `A<n>: <answer>` lines, and it applies
    each answer where EGM's flow puts it (for example in the spec's
    Decisions).
*   Escalated findings: when egm-resolve gives findings to the user
    (`ESCALATE`), it returns each escalated finding as its own `QUESTION:` /
    `CONTEXT:` / `OPTIONS:` block, one block per ESCALATE item. It never
    pastes the findings into its reply as chat text. The options are the
    egm-resolve choices, for example
    `Confirm (no change) | Add the fact to the document`.
*   Resume: when its prompt has `answers:` lines, it first reads
    `.orch/taskdraft/<id>/egm/` and the spec (when it exists) to find where
    EGM stopped, applies each answer at the gate its question came from, and
    continues from there.
*   Protocol: its last line is one of these.
    *   `WAITING <N>`: after `<N>` question blocks; it waits for the answers.
    *   `spec <path>`: done.
    *   `failed: <reason>`: an EGM file is missing or a step cannot start.

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

*   Without `--unattended`: ask one question per block, in block order.
    On Claude Code, use AskUserQuestion with at most 4 questions per call
    (`multiSelect` false); when the batch has more, call it again with the
    next 4 until every block is asked. Never put more than one block in one
    `question` string. Make each question from its block:
    *   `header`: a short label of at most 12 characters for the step or
        gate that CONTEXT names, for example `Detail impl` or `AC gate`.
    *   `question`: the QUESTION line, then the CONTEXT line as a second
        sentence. No option text and no reply instruction.
    *   `options`: the OPTIONS entries, in their order. The first entry (the
        proposed answer) gets the label suffix ` (Recommended)`. A long
        entry gets a short label. Each option gets a `description` of one
        short sentence: what the answer changes when CONTEXT says it, else
        what the option means. A block with one option gets a second option
        `Change it`, with the description `Pick Other and type your answer.`
        A block with more than 4 options shows the first 4 and adds
        `(further options: <the rest>)` to the question text. The tool adds
        `Other` itself.

    A `(free text)` block has no options: ask it as one plain question after
    the AskUserQuestion calls. On a host without AskUserQuestion, ask the
    same questions in the same order, one plain question per block, with
    its options listed and the first one marked `(Recommended)`.
    The answer to a question is the OPTIONS entry of the picked label
    (without ` (Recommended)`), or the user's `Other` text. A pick of
    `Change it`, or a `(free text)` question left without an answer, is
    asked again, alone. To take every proposed answer, the user picks every
    `(Recommended)` option.
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
