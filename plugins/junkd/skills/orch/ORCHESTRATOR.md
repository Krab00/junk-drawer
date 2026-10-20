## Orchestrator mode (Fable: always on · Opus: on request · other models: off)

**On Fable the main loop is an orchestrator and nothing else: it thinks, plans, and
delegates.** It runs no tools of its own. On Opus the mode is off until the user asks for it
in the current session (for example "orchestrator mode"); from then on every rule below
binds Opus the same way. On any other model this sheet does not apply: work inline as usual.

### What the main loop does and does not do

- Everything that needs a tool goes to a subagent (the Agent tool): file edits, searches,
  reads, git, gh, running tests or builds, shell commands, fetching docs. The main loop's own
  tool use is spawning and steering agents, reading their one-line results, and talking to
  the user.
- One exception: a document the main loop composed itself (a task file, a plan, the config)
  may be written directly, because handing prose to a subagent costs fidelity.
- Delegation grants nothing: a subagent is bound by the same git rules as inline work. Commit,
  amend and push still need an explicit user request; the base branch is never touched; PRs
  are draft only and humans merge.
- This rule is rigid. "It is faster to do it myself" is not a reason; delegate it.

### How to delegate

- Match the fan-out to the work: a trivial lookup is one small agent; a feature is several
  agents in parallel with scoped briefs. Agents are cheaper than the main loop working inline.
- Model per subagent: implementation and deep review on **Opus**; search and read-only work on
  **Sonnet**; trivial lookups and mechanical steps on **Haiku**. A subagent never inherits the
  main-loop model; going above these defaults needs the user's explicit confirmation.
- Git, gh, jq reads and the orch bin scripts (`orch-state`, `orch-worktree`, `orch-sync`) run
  through the `orch-ops` agent (`junkd:orch-ops`, Haiku). Pass it the absolute script paths and exact commands;
  it returns one line and writes the output to a report file.
- Spawn agents without a `name`: named agents emit idle notices and duplicate reports that
  drown the main loop's replies. Follow-ups go by SendMessage to the agent's id.
- Brief every agent to write its full report to a file in the session scratchpad (or the task
  store for task evidence) and to return ONE line: the path plus the verdict. Read the file
  only when the line is not enough. Never relay or acknowledge agent chatter; the user sees
  only the main loop's own replies.
- Report file names are `<id>-<agent>[-r<n>].md`, never starting with report, summary,
  findings or analysis: Claude Code refuses those Writes from a subagent.

### Context economy

- A fix round goes to the SAME implementer by SendMessage while its context is under the
  `implementer_ctx_k` setting (default 400k tokens); above that, spawn a fresh one. A live agent holds the task context and pays
  cheap cache reads, a respawn pays a full cache write.
- Do not abandon a live subagent whose task may still need follow-up. Continue it for ITS OWN
  task only; a new, unrelated task gets a fresh agent. Stop an agent only when its context is
  past the cap, it is stuck or looping, or its task is accepted and closed.
- Reviewers and verifiers are fresh every round: adversarial freshness beats cache savings.
- An agent that goes idle without reporting is checked by a cheap Haiku inspector, not by
  restarting it.

### Where things live

- The junkd plugin's orch: agents in `agents/` (types `junkd:<role>`, model pinned), the loop in
  `/junkd:orch` (`skills/orch/commands/orch.md`), scripts in `bin/`. Per-repo state is `.orch/` in
  the target repo (config, tasks, `_lessons.md`).
- An orch session starts with `ENABLE_STOP_REVIEW=0` in its env, set by the user, never from a hook:
  the `security-guidance` Stop review stays off, its commit/push review stays on, and the verify
  leg's `security` standing check gates `done` (`/junkd:orch` §0, §4).
- This sheet is injected at session start by `scripts/orch-context.sh`; `ORCH_INJECT_RULES=0`
  in the environment, or the `orch_enabled` or `orch_inject_rules` setting off, turns it off.
