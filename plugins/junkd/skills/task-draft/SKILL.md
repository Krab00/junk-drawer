---
name: task-draft
argument-hint: "<task-id> [input] [--unattended]"
description: Turn an orch task into a reviewed EGM spec (EGM's own draft and review, read from disk and run by the junkd:task-egm role), optionally check that the lowest registry class understands it (the comprehension sub-loop), and write the orch task file .orch/tasks/<id>.md. Use when the user runs /junkd:task-draft, or when orch drafts a task while egm_enabled is on.
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/task-draft-state:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/task-probe:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/task-from-spec:*), Agent, Read, Write, AskUserQuestion, SendMessage
---

# task-draft

Arguments: "$ARGUMENTS"

The first word is the task id (orch's id rule: `[A-Za-z0-9][A-Za-z0-9._-]*`, no `..`). The second word, when present and not `--unattended`, is the input path; without it the input is `.orch/taskdraft/<id>/input.md` when that file exists, else `none`. `--unattended` only sends questions to `.orch/taskdraft/<id>/questions.md` and stops the run; it never answers one, unless `egm_answers` is `auto`: then no question is sent anywhere, the roles answer them (see "Questions"). On a host that leaves the placeholder above unfilled, the arguments are the rest of the user's request. No task id: ask for one in one line and stop.

Unless `egm_answers` is `auto`, never answer a question for the user and never take a default. Only the decisions register answers a question without the user: the spec's `## Decisions`, then `.orch/decisions.md`. With `egm_answers` = `auto` the skill asks nothing, not even the step 4 confirmation: every question is answered by its proposed answer (or a composed one), logged, and listed in the closing reply.

## Hosts

The skill runs on Claude Code, Codex, Kimi Code and OpenCode. It runs in the main loop: it runs the helpers, dispatches the roles, asks the user, and writes nothing itself except through the helpers. The helpers are `task-draft-state`, `task-probe` and `task-from-spec` (`task-probe` runs the harness adapters itself), run with the repository root as the working directory.

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: the helpers are `./bin/<name>` inside this skill folder (for example `./bin/task-draft-state`). The roles are the files `./roles/task-egm.md`, `./roles/task-elephant.md`, `./roles/task-judge.md` and `./roles/task-goldfish.md`: read the file and inline its text (without the frontmatter) into a generic subagent; with no subagents, follow the role in your own thread. Ask a question as one plain question. The `egm_enabled` gate is skipped (an explicit run), `models=true` only with `JUNKD_EGM_MODELS=1`, and `answers=auto` only with `JUNKD_EGM_ANSWERS=auto`. The final orch command is `$orch <id>` on Codex, `/skill:orch <id>` on Kimi Code and `/orch <id>` on OpenCode.
- Claude Code: the helpers are `${CLAUDE_PLUGIN_ROOT}/bin/<name>`. The roles are the agent types `junkd:task-egm`, `junkd:task-elephant`, `junkd:task-judge` and `junkd:task-goldfish`, dispatched with the Agent tool (no `model`, except the goldfish's). Ask a question with AskUserQuestion and continue a role with SendMessage. Never call an EGM skill through the Skill tool: EGM's skills refuse it, and `junkd:task-egm` reads them from disk. The final orch command is `/junkd:orch <id>`.

Never read, print or pass a credential file (for example `~/.config/<tool>/token`); `task-probe` inlines only tracked, non-ignored repo files and never one whose name looks like a secret.

## Questions

**Questions.** With `egm_answers` = `manual` (the default) the skill is
interactive; `auto` is in "Auto" below. Under `manual` a role never
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

**Auto.** With the line `egm_answers: auto` in a role's prompt (the
setting `egm_answers` = `auto`), nothing is asked of anyone: no
AskUserQuestion, no plain question, no `WAITING <N>`, no `questions.md`,
with or without `--unattended`. The decisions register still answers first.
A role answers every other question itself, where it would have returned
the block: with the first OPTIONS entry (its proposed answer), or, for
`OPTIONS: (free text)`, with an answer it composes from the spec, the repo
and the input. It applies the answer where EGM's flow puts it, appends
`answered auto: <question> => <answer>` to
`.orch/taskdraft/<id>/egm/gate_log.md`, and goes on. Before its final line
it returns one block of four lines per answer it took, in the order it took
them:

```text
QUESTION: <the question, one line>
CONTEXT: <one line: the EGM step or gate it belongs to, and what the answer changes>
OPTIONS: <option 1> | <option 2> [| …]
ANSWER: <the answer it applied>
```

Its final line then ends with ` (auto-answered <N>)`, for example
`spec <path> (auto-answered 5)`; with no such block, nothing is added. For
each role reply with `ANSWER:` blocks, the main loop:

*   writes the answers, one line per block, `A<n>: <question> => <answer>`,
    to `<out>/answers.md` with the Write tool and runs
    `task-draft-state decisions add <id> --source auto --file <out>/answers.md`
    (never for the step 4 answer);
*   writes the blocks to `<out>/auto-answers.md` with the Write tool, after
    the ones already there (the first auto answer of the run starts the
    file; `## Q<n>` numbers on):

    ```markdown
    # task-draft <id>: auto-answered questions
    Spec: <spec path or none>

    ## Q1
    Question: <question>
    Context: <context>
    Options: <option 1> | <option 2>
    A: <answer>
    ```

    It is for the human's review after the run: no helper reads it, and it
    never blocks `task-from-spec` (only `questions.md` does);
*   keeps each pair for the closing list (step 5).

The step 4 inline-file confirmation is not asked under `auto` either: the
skill takes the safe choice, `skip non-local` (no repo file leaves the
machine), appends
`answered auto: Send these <n> files to non-local harnesses? => skip non-local` to
`<out>/egm/gate_log.md`, adds it to `<out>/auto-answers.md` and to the
closing list, and never records it in `.orch/decisions.md`.

## The decisions register

The register has two parts: the `## Decisions` section of the task's own spec, and the repo file `.orch/decisions.md`. The file is an ordinary repo file that the user may commit: junkd does not git-ignore it (only `.orch/taskdraft/` is ignored, by the `.orch/taskdraft/.gitignore` that `task-draft-state` writes). It holds one block per decision:

```markdown
## R<n> (<YYYY-MM-DD>) <the question, one line>
A: <the answer>
source: <spec D<n> | questions.md of task <id> | chat | auto (task <id>)>
```

- The roles read it with `task-draft-state decisions [--match "<text>"]` and never write it. A question a recorded decision covers is answered from it and logged as `answered from <decision id>: <question>` in `.orch/taskdraft/<id>/egm/gate_log.md`; when the spec and the file disagree, the spec wins; when in doubt, the question is not covered.
- The skill appends every answer the user gives in a session with `task-draft-state decisions add <id> --source chat --file <out>/answers.md` (the file holds the `A<n>: <question> => <answer>` lines; without `--file` the helper reads them from stdin), never the step 4 answer (the inline-file confirmation is never answered from the register and never recorded in it).
- With `egm_answers` = `auto`, the skill appends every answer a role took itself with `task-draft-state decisions add <id> --source auto --file <out>/answers.md` (never the step 4 answer).
- `task-draft-state questions <id> done` copies the `questions.md` answers of a `task-egm` or `task-elephant` file into `.orch/decisions.md` before it deletes `questions.md`; when that copy fails, `questions.md` stays.

## Steps

All the paths below are relative to the repo root. `<out>` is `.orch/taskdraft/<id>`.

1.  **Gate.**
    *   Run `task-draft-state settings`. It prints four lines,
        `enabled=<bool>`, `models=<bool>`, `answers=<manual|auto>` and
        `host=<claude|codex|kimi|opencode>`. Keep `answers` as `<mode>`
        (on another host it is `auto` only with `JUNKD_EGM_ANSWERS=auto`).
        With `host=claude` and `enabled=false`, print
        `task-draft is off: turn on egm_enabled in the /junkd pane (Settings, egm) or /config`
        and stop. With any other host the `enabled` gate is skipped: the
        user ran the skill explicitly.
    *   Run `task-draft-state egm`. On exit 1, print its one line and stop. On
        exit 0, keep `root=<abs>` as `<root>`.
    *   **Resume.** Run `task-draft-state questions <id> answers`.
        *   Exit 1 (no `questions.md`): a fresh run; `<answers>` is `none`.
        *   Exit 4 with `<mode>` = `auto`, `--unattended` or not: nothing
            is asked and the run does not stop. Each open `Q<n>:` line
            becomes `A<n>: <question> => auto` in `<answers>`; go on as for
            exit 0. A role answers a `=> auto` line itself as in "Auto"
            (with an `ANSWER:` block); role `task-draft`: step 4 takes
            `skip non-local` as in "Auto".
        *   Exit 4 (some `A:` lines empty) with `<mode>` = `manual`: with `--unattended`, print
            `task-draft <id>: waiting: <N> questions in .orch/taskdraft/<id>/questions.md`
            (`<N>` = the number of `Q<n>:` lines) and stop, dispatching
            nothing. Without it, ask the open `Q<n>:` questions as in
            "Questions" (their answers go to `.orch/decisions.md` with
            `decisions add --source chat`; `done` later copies only the
            answers written in the file), then go on as for exit 0 with those
            answers added.
        *   Exit 0 (every question answered): keep the `A<n>:` lines as
            `<answers>`, the `role:` value and the `spec:` value. Role
            `task-egm`: step 2 runs with `<answers>`. Role `task-elephant`:
            skip step 2, the spec is the `spec:` value, and step 4 dispatches
            the elephant with `<answers>`. Role `task-draft`: skip step 2, the
            spec is the `spec:` value, and the answer settles the step 4
            confirmation.
        *   Run `task-draft-state questions <id> done` (it appends the file's
            answers to `.orch/decisions.md`, then deletes
            `questions.md`) right after the role that got `<answers>` returns
            its next reply, whatever that reply is (role `task-draft`: right
            after step 4 reads the answer). When that reply ends with
            `WAITING <N>` again, the new questions are handled as in
            "Questions" (with `--unattended`, `put` writes a new file after
            the old one is deleted).
2.  **EGM spec.** Dispatch one `junkd:task-egm` (Claude Code: by agent type,
    no `model`; elsewhere: a generic subagent with `./roles/task-egm.md`
    inlined). Its prompt is these lines:

    ```text
    id: <id>
    root: <root>
    input: <input path or "none">
    artifacts: .orch/taskdraft/<id>/egm/
    spec_dir: docs/designs/
    egm_answers: <mode>
    answers: none
    ```

    On resume, `answers:` is followed by the `<answers>` lines,
    `A<n>: <question> => <answer>`, one per line, instead of `none`.

    The role answers with lines (protocol in "Role `task-egm`"). A reply that
    ends with `WAITING <N>` is handled as in "Questions"; the role waits for
    the answers and continues (under `auto` no reply does: its `ANSWER:`
    blocks are handled as in "Auto"). The final line is
    `spec <path>` (under `auto`, `spec <path> (auto-answered <N>)` when it
    answered any) or `failed: <reason>`. On `failed:`, print
    `task-draft <id>: egm failed: <reason>` and stop.
3.  **Acceptance criteria check.** The spec must have a section
    `## Acceptance criteria` with items `- AC<n>: … (modality: ui|api|test|data)`
    (the form to write; the helpers also accept the bare `AC<n>: …` line, an
    indent, and the markers `* `, `+ `, `<n>. `, `<n>) `). A line with no
    `AC<n>:` is no item. Run `task-probe <spec> --ac-hash` and keep the hash: it
    covers the items with the marker, the indent and the trailing space
    stripped, so a format-only fix keeps it. `task-from-spec` reads the items
    by the same rule. Exit 3 (no section, or no item) stops
    with `task-draft <id>: the spec has no ## Acceptance criteria list; add it in egm-resolve`.
4.  **Comprehension sub-loop**, only when `models=true`.
    *   Run `task-draft-state models` (the ladder). An empty ladder prints
        `task-draft <id>: the model registry has no entries; skipping comprehension`
        and goes to step 5 without `worker_class`. Exit 1 prints its line and
        stops.
    *   When the ladder has an entry with a non-local harness (anything but
        `claude`): run `task-probe <spec> --list --out <out>`. It writes
        `<out>/inline-files.txt` and prints the same list, one repo-relative
        path per line, then `total <bytes>`. Ask the skill's own question
        `Send these <n> files to non-local harnesses?`, with the list as its
        context and the options `send` and `skip non-local`, as in
        "Questions" (role `task-draft`; with `--unattended` it goes to
        `questions.md` and the run stops). With `<mode>` = `manual` this
        question is asked on every run that has a non-local entry; nothing
        answers it for the user, not even the decisions register, and its
        answer is not recorded there. With `<mode>` = `auto` it is not
        asked, `--unattended` or not: the skill takes `skip non-local` and logs it as
        in "Auto". `skip non-local` drops every non-local entry from the
        ladder.
    *   Dispatch one `junkd:task-elephant` with the lines `id: <id>`,
        `spec: <spec>`, `out: <out>`, `ladder:` followed by the ladder lines,
        `host: <claude|codex|kimi|opencode>`, `source: <task source or adhoc>`,
        `egm_answers: <mode>` and `answers: none` (on resume with role `task-elephant`, `answers:`
        followed by the `<answers>` lines). A reply that ends with
        `WAITING <N>` is handled as in "Questions".
    *   The elephant returns one of the lines in "Role `task-elephant`"
        (under `auto`, after its `ANSWER:` blocks, with
        ` (auto-answered <N>)` on its last line when it answered any). On
        `unresolved`, print
        `task-draft <id>: no class understood the spec; return to egm-review`
        and stop.
    *   Run `task-probe <spec> --ac-hash` again. When the hash differs from
        step 3, print
        `task-draft <id>: the acceptance criteria changed during comprehension; return to egm-review`
        and stop.
5.  **Task file.** Run
    `task-from-spec <spec> <id> [--probe <answer>] [--worker-class <X>] [--understood N/M] [--deps <ids>] [--force]`
    once per spec (twice after a split). `--force` is passed when the task
    file exists (the orch rule only drafts a task that is not frozen). Step 5
    runs only when no question is open; `task-from-spec` exits 4 while
    `.orch/taskdraft/<id>/questions.md` exists, and the skill then prints
    `task-draft <id>: questions are open in .orch/taskdraft/<id>/questions.md; no task file written`
    and stops. End
    with one line per task file,
    `task-draft <id>: <understood N/M on class X | EGM only> -> <task file>`,
    then one line naming the orch command of the host: `/junkd:orch <id>`
    (Claude Code), `$orch <id>` (Codex), `/skill:orch <id>` (Kimi Code), or
    `/orch <id>` (OpenCode).
6.  **Auto answers.** Under `auto`, when any answer was taken without the
    user (the roles' `ANSWER:` blocks and the step 4 `skip non-local`), the closing
    reply goes on, after the lines of step 5 or after the line of any stop
    above, `--unattended` or not, with:

    ```text
    task-draft <id>: auto-answered <N>
    <gate>:
    1. <question> => <answer>
    2. <question> => <answer>
    files: .orch/taskdraft/<id>/auto-answers.md, .orch/taskdraft/<id>/egm/gate_log.md, .orch/decisions.md
    ```

    Every answer is one numbered line, in the order taken, numbered across
    the whole run. A `<gate>:` line (the step or gate its CONTEXT names, as
    in the AskUserQuestion `header`) heads each run of answers of one gate;
    without a gate in CONTEXT, no heading. The count alone is never enough.
