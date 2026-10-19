/* status.sample.js: demo data for the orch dashboard (orch-dashboard.html), also what `orch-status --sample` writes
   as status.js, and what tests/dashboard.sh loads. The page reads `window.ORCH` from a status.js beside it (a plain
   <script>, re-read every 5 s; no fetch, so file:// works).

   The data contract. Every field is optional: the page draws an empty state per section and never throws.
     generatedAt  epoch ms of the write; "updated N s ago" counts from it
     repo, branch the repo's folder name and its branch, for the header
     mock         true for demo data
     window       {start, end}: epoch ms, the span the timeline shows (end = now; start = end - orch_dashboard_window_h)
     tasks[]      {id, title, column, round, deps[], ac:[pass,total], acx:[pass,total], note, implementer, verifier,
                   worktree, lastActivity, commits, phases[]}
                  column: todo | in_progress | verify | done | blocked (blocked is drawn in the todo column)
                  ac/acx: the AC and ACX rows of the last "## Verification round N" table, passed and in all
                  lastActivity: "HH:MM" or epoch ms
       phases[]   {agent, model, kind: implement | verify | fix | done, start, end, ctx, killed, note}
                  start/end: epoch ms, "HH:MM" (today, or yesterday when later than now) or "YYYY-MM-DD HH:MM";
                  an open phase has end = window.end (drawn live). The writers add {id, open} for their own merge.
     agents[]     {name, role, model, status: running | waiting | done | dead | queued, lastCallSec, ctx, task, round,
                   branch, worktree, lastStep, deadNote, events[]}
     events[]     {t, text, kind: info | pass | fail}, newest first; t is "HH:MM" or epoch ms (an agent's events too)
     lessons[]    {task, text}, newest first
     usage        {fiveHour, week}: percent of the rate-limit windows
     watchdog     {on, minutes}
*/
function mockPast(){
  function Y(h){var p=h.split(":");return new Date(2026,9,h<"12:00"?19:18,+p[0],+p[1]).getTime()}
  var rows=[
    ["T1","plugin skeleton and manifest",[["implement","19:00","19:34"],["verify","19:35","19:47"]]],
    ["T2","settings loader",[["implement","19:10","19:52"],["verify","19:53","20:05"]]],
    ["T3","hooks map for four hosts",[["implement","19:40","20:31"],["verify","20:32","20:48"]]],
    ["T4","ahandoff plan file",[["implement","20:05","20:44"],["verify","20:45","20:58"]]],
    ["T5","handoff-path helper",[["implement","20:35","21:20"],["verify","21:21","21:40"],["fix","21:40","21:52"]]],
    ["T6","hosts detection",[["implement","21:00","21:42"],["verify","21:43","21:58"]]],
    ["T7","opencode commands",[["implement","21:30","22:12"],["verify","22:13","22:30"]]],
    ["T8","tldr skill",[["implement","21:50","22:15"],["verify","22:16","22:27"]]],
    ["T9","ctx-tokens skill",[["implement","22:20","22:58"],["verify","22:59","23:12"]]],
    ["T10","smoke tests",[["implement","22:40","23:30"],["verify","23:31","23:48"]]],
    ["T11","one plugin",[["implement","23:10","00:40"],["verify","00:41","00:58"],["fix","00:58","01:08"],["verify","01:09","01:15"]]],
    ["T12","README host matrix",[["implement","00:10","00:48"],["verify","00:49","01:02"]]],
    ["T13","manifest min/max",[["implement","00:50","01:35"],["verify","01:36","01:55"],["fix","01:55","02:05"]]],
    ["T14","install docs",[["implement","01:20","02:02"],["verify","02:03","02:30"]]]
  ];
  return rows.map(function(r,i){
    var ps=r[2].map(function(p){return {agent:(p[0]==="verify"?"verify-":"impl-")+r[0],model:i%3===2?"sonnet":"opus",kind:p[0],start:Y(p[1]),end:Y(p[2]),ctx:(40+(i*37)%120)+"k"}});
    var last=r[2][r[2].length-1][2];
    ps.push({agent:"pr-"+r[0],model:"haiku",kind:"done",start:Y(last),end:Y(last),ctx:"20k",note:"✓ merged"});
    return {id:r[0],title:r[1],column:"done",round:r[2].some(function(p){return p[0]==="fix"})?1:0,phases:ps}})}
window.ORCH={
  mock: true,
  generatedAt: Date.now() - 12000,
  repo: "junk-drawer",
  branch: "junkd",
  usage: { fiveHour: 2, week: 34 },
  watchdog: { on: true, minutes: 10 },
  window: { start: new Date(2026,9,18,19,0).getTime(), end: new Date(2026,9,19,21,40).getTime() },
  agents: [
    { name: "impl-T17b", role: "implementer", model: "opus", status: "running", lastCallSec: 40, ctx: "148k", task: "T17", round: 1, branch: "task/T17-tools-pane", worktree: ".worktrees/orch/.worktrees/T17", lastStep: "Edit tools/src/handoff.tsx",
      events: [
        { t: "21:00", text: "took over from impl-T17", kind: "info" },
        { t: "21:01", text: "commit c41d7a9 wip: tools pane", kind: "info" },
        { t: "21:19", text: "fix round 1 started", kind: "info" },
        { t: "21:21", text: "Read verify-T17 report", kind: "info" },
        { t: "21:24", text: "Bash tests/smoke.sh ✓", kind: "pass" },
        { t: "21:27", text: "Edit tools/src/handoff.tsx", kind: "info" },
        { t: "21:29", text: "Bash npm run typecheck ✓", kind: "pass" },
        { t: "21:31", text: "commit 94743cc", kind: "info" },
        { t: "21:34", text: "Edit drop 2 copied comments", kind: "info" },
        { t: "21:37", text: "Bash node --test ✗ 1 surviving mutant", kind: "fail" },
        { t: "21:39", text: "Edit tools/src/handoff.tsx", kind: "info" }
      ] },
    { name: "verify-T17", role: "verifier", model: "opus", status: "done", lastCallSec: 190, ctx: "96k", task: "T17", round: 1, branch: "task/T17-tools-pane", worktree: ".worktrees/orch/.worktrees/T17", lastStep: "Write verification table",
      events: [
        { t: "21:02", text: "verification of T17 started", kind: "info" },
        { t: "21:04", text: "Bash npm run build ✓", kind: "pass" },
        { t: "21:06", text: "Bash tests/smoke.sh ✓", kind: "pass" },
        { t: "21:09", text: "Bash npm run typecheck ✗ handoff.tsx", kind: "fail" },
        { t: "21:12", text: "mutation run: 5 surviving mutants", kind: "fail" },
        { t: "21:15", text: "review: 2 copied comments", kind: "fail" },
        { t: "21:17", text: "Write verification table", kind: "info" },
        { t: "21:18", text: "verdict FAIL 6 rows", kind: "fail" }
      ] },
    { name: "impl-T16", role: "implementer", model: "opus", status: "done", lastCallSec: 3300, ctx: "171k", task: "T16", round: 1, branch: "task/T16-ctx-limit", worktree: ".worktrees/orch/.worktrees/T16", lastStep: "Bash git commit",
      events: [
        { t: "20:05", text: "T16 implement started", kind: "info" },
        { t: "20:09", text: "Read tools/src/ctx-limit.ts", kind: "info" },
        { t: "20:14", text: "Edit tools/src/ctx-limit.ts", kind: "info" },
        { t: "20:19", text: "Bash npm run typecheck ✓", kind: "pass" },
        { t: "20:24", text: "Edit statusline settings move", kind: "info" },
        { t: "20:29", text: "Bash tests/smoke.sh ✓", kind: "pass" },
        { t: "20:33", text: "Bash node --test ✗ 2 failing", kind: "fail" },
        { t: "20:36", text: "Edit fix physical temp paths", kind: "info" },
        { t: "20:40", text: "commit 5d1c9e2", kind: "info" },
        { t: "20:55", text: "fix round 1 started", kind: "info" },
        { t: "20:58", text: "Bash tests/smoke.sh ✓", kind: "pass" },
        { t: "21:01", text: "commit a8b47f0", kind: "info" }
      ] },
    { name: "impl-T17", role: "implementer", model: "opus", status: "dead", lastCallSec: 3480, ctx: "400k", task: "T17", round: 1, branch: "task/T17-tools-pane", worktree: ".worktrees/orch/.worktrees/T17",
      deadNote: "no SubagentStop record", lastStep: "Bash tests/smoke.sh",
      events: [
        { t: "20:20", text: "T17 implement started", kind: "info" },
        { t: "20:26", text: "Read tools pane layout", kind: "info" },
        { t: "20:33", text: "Edit tools/src/tools-pane.tsx", kind: "info" },
        { t: "20:37", text: "Edit worktrees tree", kind: "info" },
        { t: "20:41", text: "Bash npm run typecheck ✓", kind: "pass" },
        { t: "20:45", text: "commit 3e0a9b1", kind: "info" },
        { t: "20:49", text: "Bash tests/smoke.sh ✗ 1 failing", kind: "fail" },
        { t: "20:55", text: "context 380k, near the limit", kind: "fail" },
        { t: "20:58", text: "Bash tests/smoke.sh", kind: "info" },
        { t: "21:00", text: "killed: context 400k", kind: "fail" }
      ] },
    { name: "pr-T16", role: "pr", model: "haiku", status: "done", lastCallSec: 3000, ctx: "21k", task: "T16", round: 1, branch: "task/T16-ctx-limit", worktree: ".worktrees/orch/.worktrees/T16", lastStep: "Bash gh pr create --draft", events: [] },
    { name: "impl-T18", role: "implementer", model: "opus", status: "queued", lastCallSec: null, ctx: "—", task: "T18", round: 0, branch: "—", worktree: "—", lastStep: "—", events: [] }
  ],
  tasks: [
    { id: "T15", title: "multi-host fixes", column: "done", round: 1,
      phases: [ { agent: "impl-T15", model: "opus", kind: "done", start: "19:50", end: "19:58", ctx: "—", note: "merged 19:58" } ] },
    { id: "T16", title: "ctx-limit, ctx-tokens and statusline move into junkd", column: "done", round: 1,
      implementer: "impl-T16", verifier: "verify-T16", worktree: ".worktrees/orch/.worktrees/T16",
      lastActivity: "21:06", ac: [8, 8], acx: [2, 3],
      note: "PM-REVIEW: click settings ▸ on statusline in a live session",
      phases: [
        { agent: "impl-T16", model: "opus", kind: "implement", start: "20:05", end: "20:40", ctx: "171k" },
        { agent: "verify-T16", model: "opus", kind: "verify", start: "20:41", end: "20:55", ctx: "88k" },
        { agent: "impl-T16", model: "opus", kind: "fix", start: "20:55", end: "21:01", ctx: "171k", note: "fix r1" },
        { agent: "verify-T16", model: "opus", kind: "verify", start: "21:02", end: "21:06", ctx: "64k" },
        { agent: "pr-T16", model: "haiku", kind: "done", start: "21:06", end: "21:06", ctx: "21k", note: "✓ PASS" }
      ] },
    { id: "T17", title: "tools pane — agents and worktrees tree", column: "verify", round: 1,
      implementer: "impl-T17b", verifier: "verify-T17", worktree: ".worktrees/orch/.worktrees/T17",
      lastActivity: "21:18", ac: [6, 7], commits: 6,
      note: "round 1: typecheck in handoff.tsx, 5 surviving mutants, 2 copied comments",
      phases: [
        { agent: "impl-T17", model: "opus", kind: "implement", start: "20:20", end: "21:00", ctx: "400k", killed: true, note: "killed: context 400k" },
        { agent: "impl-T17b", model: "opus", kind: "implement", start: "21:00", end: "21:01", ctx: "12k", note: "took over" },
        { agent: "verify-T17", model: "opus", kind: "verify", start: "21:02", end: "21:18", ctx: "96k" },
        { agent: "impl-T17b", model: "opus", kind: "fix", start: "21:19", end: "21:40", ctx: "148k", note: "fix r1" }
      ] },
    { id: "T18", title: "/junkd:explain skill", column: "todo", deps: ["T17"] },
    { id: "T19", title: "orch dashboard", column: "todo", deps: ["T18"] },
    { id: "T20", title: "agent watchdog", column: "todo", deps: ["T17"] }
  ],
  events: [
    { t: "21:18", text: "verify-T17 → FAIL 6 rows", kind: "fail" },
    { t: "21:06", text: "T16 → PASS", kind: "pass" },
    { t: "21:00", text: "impl-T17b resumed", kind: "info" },
    { t: "20:40", text: "T16 first commit", kind: "info" },
    { t: "20:12", text: "impl-T17 killed: context 400k", kind: "fail" }
  ],
  lessons: [
    { task: "T16", text: "physical temp paths / settings ▸ press test" },
    { task: "T15", text: "live-run each host" },
    { task: "T13", text: "manifest min/max" }
  ]
};
window.ORCH.tasks=mockPast().concat(window.ORCH.tasks);
