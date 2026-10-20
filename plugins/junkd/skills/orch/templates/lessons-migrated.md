# Lessons

The diary of `.orch/tasks/_lessons.md` (T1–T27), rewritten into lesson blocks on 2026-10-20 by T26. The generic
agent behaviour was applied to the role files and the orchestrator sheet in T26's branch and is not here: T1, T3,
T4, T5, T8 (the ordering world), T9, T10 (a clean worktree, path-fence probes), T12, T13 (foreground sweeps), T14,
T16 (pwd -P), T17 (narrow widths, the verbatim sweep, the context cap), T18, T19, T20, T21, T22 (full-sentence
needles), T23, T24, T27 (in `roles/implementer.md`, `roles/lead-implementer.md`, `roles/test-reviewer.md`,
`ORCHESTRATOR.md`). What stays is repo-specific, each with a proposed target, pending for the person.

## L1 (2026-10-18) scope: local · stack: shell · to: smoke · from: T2
A ported bin script found the repo root another way than its siblings (`git rev-parse --show-toplevel`), and the live orch dir is itself a worktree. Every bin script test needs a project-is-a-worktree case; a smoke check that runs each orch bin script from a `.worktrees/<id>` folder would have caught it.

## L2 (2026-10-19) scope: local · stack: shell,tsx-mods · to: smoke · from: T11
A flag file has two ends, the hooks module that writes it and the shell hook that reads it, and the first session runs the shell hook before the module (T6). A smoke check that every flag name the module writes (`orch-off`, `orch-rules-off`, `orch-lessons-off`, …) is spelled the same in the script that reads it, beside a seam test, would have caught a drift.

## L3 (2026-10-19) scope: local · stack: tsx-mods · to: smoke · from: T13
The engine enforces a userConfig min/max at load: a hand-edited value out of range stopped the whole module. tests/smoke.sh already refuses any userConfig key beyond type, title, description, default and options; drop this lesson once that is confirmed as the check.

## L4 (2026-10-19) scope: local · stack: any · to: check · from: T17
Ported text kept the origin's distinctive names until a verifier grepped for them. tests/smoke.sh greps the repo for the origin's name; a standing check that runs that grep on every task branch (not only in smoke) would keep it out of every task.

## L5 (2026-10-19) scope: local · stack: tsx-mods · to: check · from: T16
A `settings ▸` route for a new pane had no press test pinning its open, close and focus order, so the early-return and the focus-flag mutants survived. A standing check "every pane reachable by settings ▸ has a press test of the order" would have caught it.

## L6 (2026-10-19) scope: local · stack: shell · to: check · from: T15
Skills that "work on every host" sent three hosts into ~/.claude: the Claude bullet came first in SKILL.md and an unset runtime variable was read as Claude's. A standing check "a skill change gets one live run per host, with the host detected from what it exports" would have caught it.

## L7 (2026-10-19) scope: local · stack: tsx-mods · to: check · from: T16
A fresh isolated CLAUDE_CONFIG_DIR has no login (keychain), so live pane checks stayed PM-REVIEW. A standing check that plans the live check through the hook path (a fixture session, no login) would have caught it before the verify round.

## L8 (2026-10-20) scope: local · stack: any · to: smoke · from: T22
docs/orch-guide.html is a copy of docs/orch-guide.md that a human syncs after merge when a task names only the .md. A smoke check that the two carry the same section headings would say when the copy is behind.

## L9 (2026-10-18) scope: local · stack: tsx-mods · to: global · from: T10
A test harness that raises a plugin's own config.set hook hid the real host's skip of that hook: `set` must apply its own side effects, and the test world must mimic the host's rule. Every hooks module with settings rows needs that host rule in its test world.

## L10 (2026-10-19) scope: local · stack: tsx-mods · to: global · from: T11
The engine refuses nested noun objects and dotted userConfig keys, and follows `$` only into named function declarations. Probe the engine before freezing a contract; a probe test per assumption would have caught each refusal before the build.

## L11 (2026-10-18) scope: local · stack: tsx-mods · to: global · from: T8
Cross-plugin pane control works only through the peer's noun (events never cross plugins). Fakes need the same owner-reset path the real module has, or a stand-in command that mirrors it; a test against the real noun would have caught it.
