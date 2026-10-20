#!/usr/bin/env bash
# bin/orch-status, the shell writer of the orch dashboard's status.js: a fixture task store (todo, done with a block
# list of deps, in_progress with CRLF and two verification rounds, no frontmatter, an `_notes.md`, an unreadable file,
# _lessons.md) and agent records → status.js parsed by node; the window clamp; the atomic write; the store found from
# a task worktree; the default folder (host-lib's jd_hash8 of the toplevel); --sample; --open with stub openers; no jq
# (the fallback file); a bad flag; the same store through hooks/dashboard.ts (parity); the write through an mv spy and a
# refusing mv; the usage endpoint through stub security/curl; a failing jq. Never the network: ORCH_STATUS_NO_USAGE=1
# (the usage cases stub curl). Run: bash tests/orch-status.sh
set -u

repo=$(cd "$(dirname "$0")/.." && pwd -P)
junkd="$repo/plugins/junkd"
bin="$junkd/bin/orch-status"
command -v node >/dev/null || { echo "orch-status tests: node is needed"; exit 1; }
command -v jq >/dev/null || { echo "orch-status tests: jq is needed"; exit 1; }

tmp=$(cd "$(mktemp -d)" && pwd -P)
trap 'chmod -R u+rwx "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
export HOME="$tmp/home" CLAUDE_CONFIG_DIR="$tmp/cfg" ORCH_STATUS_NO_USAGE=1 ORCH_NOW_MS=1800000000000
unset ORCH_SESSION ORCH_DASHBOARD_WINDOW_H
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR"

pass=0 fails=0
ok() { if [ "$1" = 0 ]; then pass=$((pass + 1)); else fails=$((fails + 1)); echo "FAIL: $2"; fi; }
check() { local what="$1"; shift; "$@" >/dev/null 2>&1; ok $? "$what"; }
# js <status.js> <expression>: the expression over S (the parsed status) is true
js() {
  node -e '
    const t = require("fs").readFileSync(process.argv[1], "utf8")
    const m = /^window\.ORCH = ([\s\S]*);\n$/.exec(t)
    if (!m) process.exit(3)
    const S = JSON.parse(m[1])
    process.exit(eval(process.argv[2]) ? 0 : 1)' "$1" "$2"
}
expect() { js "$1" "$2"; ok $? "$3 ($2)"; }

# ---------------------------------------------------------------- the fixture
proj="$tmp/proj"
mkdir -p "$proj/.orch/tasks"
git -C "$proj" init -q -b main
git -C "$proj" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
printf -- '---\ntasks_dir: .orch/tasks\n---\n' >"$proj/.orch/config.md"
T="$proj/.orch/tasks"
printf -- '---\nid: T1\ntitle: "first task"\nstatus: todo\ndeps: []\n---\n\nbody\n' >"$T/T1.md"
printf -- '---\nid: T2\ntitle: second\nstatus: done   # finished\ndeps:\n  - T1\n  - "T0"\n---\n' >"$T/T2.md"
# an `Item` header with the verdict in the middle, and a row above the header that is not counted
printf '\n## Verification round 1\n\n| AC7 above | PASS |\n\n| Item | Verdict | Evidence |\n|---|---|---|\n| AC1 a | FAIL | PASS later |\n| AC2 b | PASS | FAIL before |\n' >>"$T/T2.md"
{
  printf -- '---\nid: T10\ntitle: tenth\nstatus: in_progress\ndeps: [T1, T2]\n---\n\n'
  printf '## Verification round 1\n\n| Criterion | Evidence | Verdict |\n|---|---|---|\n| AC1 old | x | FAIL |\n\n'
  printf '## Verification round 2\n\n| Criterion | Evidence | Verdict |\n| :--- | --- | ---: |\n'
  printf '| AC1 builds | ok | PASS |\n| AC2 parses | no | FAIL |\n| AC3 opens | no | fail: crash |\n'
  printf '| AC4 looks | ? | PM-REVIEW |\n| ACX1 extra | ok | pass |\n| ACX2 more | no | FAIL |\n| Note row | - | PASS |\n\n'
  printf '## After\n\n| Criterion | Verdict |\n|---|---|\n| AC9 later | FAIL |\n'
} | sed 's/$/\r/' >"$T/T10.md"
printf 'no frontmatter here\n' >"$T/T3.md"
printf -- '---\nid: N1\nstatus: todo\n---\n' >"$T/_notes.md"
printf -- '---\nid: T4\nstatus: todo\n---\n' >"$T/T4.md"
chmod 000 "$T/T4.md"
printf '## T1 (2026-10-18)\nFirst lesson. More text\nwrapped here.\n\n## T2 (2026-10-19)\nSecond lesson is about e.g\nwrapping? Yes.\n\n## T3 (2026-10-20)\n\n' >"$T/_lessons.md" # T3: a heading with no body is no lesson
mkdir -p "$CLAUDE_CONFIG_DIR/junkd/orch/_agents/aa-old" "$CLAUDE_CONFIG_DIR/junkd/orch/_agents/sid-new"
printf '{"type":"x:old","tokens":1}\n' >"$CLAUDE_CONFIG_DIR/junkd/orch/_agents/aa-old/old.json"
printf '{"type":"junkd:implementer","tokens":148213}\n' >"$CLAUDE_CONFIG_DIR/junkd/orch/_agents/sid-new/impl-T10.json"
printf '{"type":"verify-coordinator","tokens":512}\n' >"$CLAUDE_CONFIG_DIR/junkd/orch/_agents/sid-new/ver.json"
printf '{"type":"orch:test-planner","tokens":null}\n' >"$CLAUDE_CONFIG_DIR/junkd/orch/_agents/sid-new/tp.json"
printf 'not json\n' >"$CLAUDE_CONFIG_DIR/junkd/orch/_agents/sid-new/bad.json"
touch -t 202601010000 "$CLAUDE_CONFIG_DIR/junkd/orch/_agents/aa-old"
touch -t 202602010000 "$CLAUDE_CONFIG_DIR/junkd/orch/_agents/sid-new"

# ---------------------------------------------------------------- the status
o1="$tmp/out1"
printed=$(cd "$proj" && "$bin" --out "$o1" 2>"$tmp/err1"); rc=$?
ok "$rc" "exit 0 with an unreadable task file"
[ "$printed" = "$o1/status.js" ]; ok $? "prints the written path ($printed)"
S="$o1/status.js"
expect "$S" 'S.mock === false && S.generatedAt === 1800000000000' "mock and the clock"
expect "$S" 'S.repo === "proj" && S.branch === "main"' "repo and branch"
expect "$S" 'S.window.end === S.generatedAt && S.window.end - S.window.start === 24 * 3600000' "a 24 h window"
if [ "$(id -u)" != 0 ]; then
  expect "$S" 'JSON.stringify(S.tasks.map(t => t.id)) === JSON.stringify(["T1", "T2", "T10"])' "task ids in the numeric order, no _notes, no file without frontmatter, no unreadable file"
else
  echo "skip: running as root, the unreadable file reads"
fi
expect "$S" 'S.tasks[0].column === "todo" && S.tasks[1].column === "done" && S.tasks[2].column === "in_progress"' "columns"
expect "$S" 'S.tasks[0].title === "first task" && S.tasks[2].title === "tenth"' "titles (quotes stripped, CRLF)"
expect "$S" '!("deps" in S.tasks[0]) && JSON.stringify(S.tasks[1].deps) === "[\"T1\",\"T0\"]" && JSON.stringify(S.tasks[2].deps) === "[\"T1\",\"T2\"]"' "deps: [] is none, a block list, an inline list"
expect "$S" '!("round" in S.tasks[0]) && !("ac" in S.tasks[0]) && !("acx" in S.tasks[0]) && !("note" in S.tasks[0])' "no table: no round, ac, acx or note"
expect "$S" 'S.tasks[1].round === 1 && JSON.stringify(S.tasks[1].ac) === "[1,2]" && !("acx" in S.tasks[1]) && S.tasks[1].note === "round 1: FAIL: AC1"' "an Item header, the Verdict column found by name"
expect "$S" 'S.tasks[2].round === 2' "the last round"
expect "$S" 'JSON.stringify(S.tasks[2].ac) === "[1,4]"' "ac [pass, total] of round 2"
expect "$S" 'JSON.stringify(S.tasks[2].acx) === "[1,2]"' "acx [pass, total]"
expect "$S" 'S.tasks[2].note === "round 2: FAIL: AC2, AC3, ACX2 · PM-REVIEW: AC4"' "the note"
expect "$S" 'JSON.stringify(S.lessons) === JSON.stringify([{task: "T2", text: "Second lesson is about e.g wrapping?"}, {task: "T1", text: "First lesson."}])' "lessons newest first, first sentence"
expect "$S" 'S.agents.length === 3 && S.agents.every(a => a.model === "—" && a.status === "done" && a.lastCallSec === null)' "agents of the newest session (not the first by name), the bad record skipped"
expect "$S" 'JSON.stringify(S.agents.find(a => a.name === "impl-T10")) === JSON.stringify({name: "impl-T10", role: "implementer", model: "—", status: "done", lastCallSec: null, ctx: "148k"})' "an agent: role after the colon, ctx 148k"
expect "$S" 'S.agents.find(a => a.name === "ver").ctx === "512" && S.agents.find(a => a.name === "ver").role === "verify-coordinator" && S.agents.find(a => a.name === "tp").ctx === "—"' "ctx under 1000 and unknown"
expect "$S" 'JSON.stringify(S.events) === "[]" && JSON.stringify(S.usage) === "{}" && JSON.stringify(S.watchdog) === "{}"' "events, usage, watchdog"
[ -z "$(ls -A "$o1" | grep -F .tmp)" ]; ok $? "no .tmp left"
[ "$(ls -A "$o1")" = status.js ]; ok $? "only status.js written without --open"

# ORCH_SESSION picks the folder
(cd "$proj" && ORCH_SESSION=aa-old "$bin" --out "$tmp/out-sid" >/dev/null 2>&1)
expect "$tmp/out-sid/status.js" 'S.agents.length === 1 && S.agents[0].name === "old" && S.agents[0].role === "old" && S.agents[0].ctx === "1"' "ORCH_SESSION"
(cd "$proj" && ORCH_SESSION=nope "$bin" --out "$tmp/out-sid2" >/dev/null 2>&1)
expect "$tmp/out-sid2/status.js" 'S.agents.length === 0' "no such session: no agents"
# a session name that climbs out (../_agents/sid-new names a real folder by the back door): refused, no agents
(cd "$proj" && ORCH_SESSION=../_agents/sid-new "$bin" --out "$tmp/out-sid3" >/dev/null 2>&1)
expect "$tmp/out-sid3/status.js" 'S.agents.length === 0' "ORCH_SESSION with a path in it: no agents"
# .. in the middle (aa-old/../sid-new resolves to sid-new's three records): refused all the same
(cd "$proj" && ORCH_SESSION=aa-old/../sid-new "$bin" --out "$tmp/out-sid5" >/dev/null 2>&1)
expect "$tmp/out-sid5/status.js" 'S.agents.length === 0' "ORCH_SESSION with .. mid-path: no agents"
# a record that is JSON but no object is no agent
printf '[1,2]\n' >"$CLAUDE_CONFIG_DIR/junkd/orch/_agents/sid-new/arr.json"
(cd "$proj" && "$bin" --out "$tmp/out-sid4" >/dev/null 2>&1)
expect "$tmp/out-sid4/status.js" 'S.agents.length === 3 && !S.agents.some(a => a.name === "arr")' "a record that is no object: skipped"
rm -f "$CLAUDE_CONFIG_DIR/junkd/orch/_agents/sid-new/arr.json"

# a verification table with no Verdict column: the round, nothing counted
printf -- '---\nid: T30\nstatus: in_progress\n---\n\n## Verification round 3\n\n| Criterion | Evidence |\n|---|---|\n| AC1 a | PASS |\n| ACX1 b | FAIL |\n' >"$T/T30.md"
(cd "$proj" && "$bin" --out "$tmp/outnv" >/dev/null 2>&1)
expect "$tmp/outnv/status.js" 'JSON.stringify(S.tasks.find(t => t.id === "T30")) === JSON.stringify({id: "T30", title: "", column: "in_progress", round: 3})' "a table with no Verdict column: the round alone"
rm -f "$T/T30.md"

# the window: clamped, rounded; a non-number is 24; the setting when the env is unset
for pair in 500:168 168:168 169:168 0:1 1:1 -5:1 2.6:3 abc:24 ' 12 ':12 '':24; do
  h=${pair%:*} want=${pair##*:}
  (cd "$proj" && ORCH_DASHBOARD_WINDOW_H="$h" "$bin" --out "$tmp/outw" >/dev/null 2>&1)
  expect "$tmp/outw/status.js" "S.window.end - S.window.start === $want * 3600000" "window '$h' -> ${want}h"
done
printf '{"pluginConfigs":{"junkd@m":{"options":{"orch_dashboard_window_h":"6"}}}}' >"$CLAUDE_CONFIG_DIR/settings.json"
(cd "$proj" && "$bin" --out "$tmp/outw" >/dev/null 2>&1)
expect "$tmp/outw/status.js" 'S.window.end - S.window.start === 6 * 3600000' "the orch_dashboard_window_h setting"
(cd "$proj" && ORCH_DASHBOARD_WINDOW_H=2 "$bin" --out "$tmp/outw" >/dev/null 2>&1)
expect "$tmp/outw/status.js" 'S.window.end - S.window.start === 2 * 3600000' "the env over the setting"
rm -f "$CLAUDE_CONFIG_DIR/settings.json"

# a CRLF config and a tasks_dir elsewhere under .orch/; one outside .orch/ is the default
mkdir -p "$proj/.orch/other"
printf -- '---\nid: Z1\nstatus: blocked\n---\n' >"$proj/.orch/other/Z1.md"
printf -- '---\r\ntasks_dir: ".orch/other/"  # moved\r\n---\r\n' >"$proj/.orch/config.md"
(cd "$proj" && "$bin" --out "$tmp/outc" >/dev/null 2>&1)
expect "$tmp/outc/status.js" 'S.tasks.length === 1 && S.tasks[0].id === "Z1" && S.tasks[0].column === "blocked" && S.lessons.length === 0' "tasks_dir from a CRLF config"
printf -- '---\ntasks_dir: ../elsewhere\n---\n' >"$proj/.orch/config.md"
(cd "$proj" && "$bin" --out "$tmp/outc" >/dev/null 2>&1)
expect "$tmp/outc/status.js" 'S.tasks.length >= 3 && S.tasks[0].id === "T1"' "a tasks_dir outside .orch/ is .orch/tasks"
mkdir -p "$proj/elsewhere"
printf -- '---\nid: E1\nstatus: todo\n---\n' >"$proj/elsewhere/E1.md"
printf -- '---\ntasks_dir: .orch/../elsewhere\n---\n' >"$proj/.orch/config.md"
(cd "$proj" && "$bin" --out "$tmp/outc" >/dev/null 2>&1)
expect "$tmp/outc/status.js" '!S.tasks.some(t => t.id === "E1") && S.tasks[0].id === "T1"' "a tasks_dir with a .. segment is .orch/tasks"
printf -- '---\ntasks_dir: other\n---\n' >"$proj/.orch/config.md"
(cd "$proj" && "$bin" --out "$tmp/outc" >/dev/null 2>&1)
expect "$tmp/outc/status.js" 'S.tasks.length >= 3 && S.tasks[0].id === "T1"' "a tasks_dir not under .orch/ is .orch/tasks"
printf -- '---\ntasks_dir: .orch/tasks\n---\n' >"$proj/.orch/config.md"

# a status other than the five is todo; verify stays verify; an id from the file name
printf -- '---\ntitle: no id\nstatus: weird\n---\n' >"$T/T20.md"
printf -- '---\nid: T21\nstatus: Verify\n---\n' >"$T/T21.md"
printf -- '---\nid: T22\nstatus: blocked\n---\n' >"$T/T22.md"
printf -- '---\nid: T23\nstatus: todo\n' >"$T/T23.md"
(cd "$proj" && "$bin" --out "$tmp/outs" >/dev/null 2>&1)
expect "$tmp/outs/status.js" 'S.tasks.find(t => t.id === "T20").column === "todo"' "an unknown status is todo, the id from the file name"
expect "$tmp/outs/status.js" 'S.tasks.find(t => t.id === "T21").column === "verify" && S.tasks.find(t => t.id === "T22").column === "blocked"' "verify and blocked"
expect "$tmp/outs/status.js" '!S.tasks.some(t => t.id === "T23")' "an unclosed frontmatter is skipped"
rm -f "$T/T20.md" "$T/T21.md" "$T/T22.md" "$T/T23.md"

# ---------------------------------------------------------------- the two writers agree (hooks/dashboard.ts under node)
# The same store through dashboard.ts's parsers (parseTask, columnOf, parseVerification, parseLessons) gives the tasks
# and lessons orch-status wrote, field for field.
(cd "$proj" && "$bin" --out "$tmp/outp" >/dev/null 2>&1)
node --input-type=module -e '
  const fs = await import("node:fs")
  const D = await import(process.argv[1])
  const [dir, out] = process.argv.slice(2)
  const S = JSON.parse(/^window\.ORCH = ([\s\S]*);\n$/.exec(fs.readFileSync(out, "utf8"))[1])
  const names = fs.readdirSync(dir).filter(D.isTaskFile).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
  const tasks = []
  for (const n of names) {
    let text
    try { text = fs.readFileSync(`${dir}/${n}`, "utf8") } catch { continue }
    const h = D.parseTask(n, text)
    if (!h) continue
    tasks.push({ id: h.id, title: h.title, column: D.columnOf(h.status, []), ...(h.deps.length ? { deps: h.deps } : {}), ...(D.parseVerification(text) ?? {}) })
  }
  const lessons = D.parseLessons(fs.readFileSync(`${dir}/_lessons.md`, "utf8"))
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  if (!same(tasks, S.tasks)) { console.error("tasks differ:\n" + JSON.stringify(tasks) + "\n" + JSON.stringify(S.tasks)); process.exit(1) }
  if (!same(lessons, S.lessons)) { console.error("lessons differ"); process.exit(1) }
  if (tasks.length < 3) process.exit(1)
' "$junkd/hooks/dashboard.ts" "$T" "$tmp/outp/status.js"
ok $? "orch-status and dashboard.ts read the store alike (tasks, columns, deps, rounds, ac/acx, notes, lessons)"

# ---------------------------------------------------------------- the atomic write through mv
spy="$tmp/spy"
mkdir -p "$spy"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"%s/mv.log"\nexec %s "$@"\n' "$tmp" "$(command -v mv)" >"$spy/mv"
chmod +x "$spy/mv"
(cd "$proj" && PATH="$spy:$PATH" "$bin" --out "$tmp/outa" >/dev/null 2>&1); rc=$?
ok "$rc" "through the mv spy: exit 0"
[ "$(cat "$tmp/mv.log" 2>/dev/null)" = "-f $tmp/outa/status.js.tmp $tmp/outa/status.js" ]; ok $? "status.js is written as status.js.tmp, then mv -f onto status.js ($(cat "$tmp/mv.log" 2>/dev/null))"
expect "$tmp/outa/status.js" 'S.tasks.length >= 3' "the moved file is the whole status"
# an mv that refuses: the status.js already there is left whole, no .tmp, exit 1 with the reason
refuse="$tmp/refuse"
mkdir -p "$refuse"
printf '#!/bin/sh\nexit 1\n' >"$refuse/mv"
chmod +x "$refuse/mv"
printf 'window.ORCH = {"mock":false,"generatedAt":1,"tasks":[]};\n' >"$tmp/outa/status.js"
err=$(cd "$proj" && PATH="$refuse:$PATH" "$bin" --out "$tmp/outa" 2>&1 >/dev/null); rc=$?
[ "$rc" = 1 ] && [[ "$err" == *"cannot write $tmp/outa/status.js"* ]]; ok $? "a refused mv: exit 1, cannot write (rc $rc, $err)"
[ "$(cat "$tmp/outa/status.js")" = 'window.ORCH = {"mock":false,"generatedAt":1,"tasks":[]};' ]; ok $? "a refused mv: the previous status.js untouched, never half a new one"
[ ! -e "$tmp/outa/status.js.tmp" ]; ok $? "a refused mv: no .tmp left"
# a folder it cannot write in: exit 1, nothing there
if [ "$(id -u)" != 0 ]; then
  mkdir -p "$tmp/ro" && chmod 555 "$tmp/ro"
  (cd "$proj" && "$bin" --out "$tmp/ro" >/dev/null 2>&1); rc=$?
  [ "$rc" = 1 ] && [ -z "$(ls -A "$tmp/ro")" ]; ok $? "a read-only folder: exit 1, nothing written (rc $rc)"
  chmod 755 "$tmp/ro"
fi

# ---------------------------------------------------------------- the usage endpoint (stub keychain and curl)
us="$tmp/us"
mkdir -p "$us"
printf '#!/bin/sh\necho Darwin\n' >"$us/uname"
printf '#!/bin/sh\n[ -n "${STUB_NOKEY:-}" ] && exit 44\necho %s\n' "'{\"claudeAiOauth\":{\"accessToken\":\"tok-123\"}}'" >"$us/security"
printf '#!/bin/sh\ncat >"%s/curl.stdin"\nprintf "%%s\\n" "$*" >"%s/curl.argv"\nprintf "%%s" "${STUB_BODY:-}"\n' "$tmp" "$tmp" >"$us/curl"
chmod +x "$us"/*
body='{"five_hour":{"utilization":41.6},"seven_day":{"utilization":12.4},"other":{"utilization":99}}'
(cd "$proj" && env -u ORCH_STATUS_NO_USAGE PATH="$us:$PATH" STUB_BODY="$body" "$bin" --out "$tmp/outu" >/dev/null 2>&1)
expect "$tmp/outu/status.js" 'JSON.stringify(S.usage) === JSON.stringify({fiveHour: 42, week: 12})' "usage from the endpoint, rounded, only the two windows"
grep -q 'Authorization: Bearer tok-123' "$tmp/curl.stdin" && ! grep -q tok-123 "$tmp/curl.argv" && grep -q 'api/oauth/usage' "$tmp/curl.argv"; ok $? "the token goes to curl on stdin, never in argv"
(cd "$proj" && env -u ORCH_STATUS_NO_USAGE PATH="$us:$PATH" STUB_BODY='<html>oops' "$bin" --out "$tmp/outu" >/dev/null 2>&1)
expect "$tmp/outu/status.js" 'JSON.stringify(S.usage) === "{}" && S.tasks.length >= 3' "a body that is no JSON: no usage, the rest written"
rm -f "$tmp/curl.argv"
(cd "$proj" && env -u ORCH_STATUS_NO_USAGE PATH="$us:$PATH" STUB_NOKEY=1 STUB_BODY="$body" "$bin" --out "$tmp/outu" >/dev/null 2>&1)
expect "$tmp/outu/status.js" 'JSON.stringify(S.usage) === "{}"' "no credentials: no usage"
[ ! -e "$tmp/curl.argv" ]; ok $? "no credentials: curl is never called"

# ---------------------------------------------------------------- jq there but failing
badjq="$tmp/badjq"
mkdir -p "$badjq"
printf '#!/bin/sh\nexit 5\n' >"$badjq/jq"
chmod +x "$badjq/jq"
err=$(cd "$proj" && PATH="$badjq:$PATH" "$bin" --out "$tmp/outbj" 2>&1 >/dev/null); rc=$?
ok "$rc" "a failing jq: exit 0"
[[ "$err" == *"could not be built"* ]]; ok $? "a failing jq: stderr says the status could not be built ($err)"
expect "$tmp/outbj/status.js" 'S.mock === false && S.tasks.length === 0 && S.agents.length === 0' "a failing jq: the empty status parses"

# ---------------------------------------------------------------- a task worktree with no .orch/ (lesson T2)
git -C "$proj" worktree add -q "$proj/.worktrees/T10" -b task/T10 2>/dev/null
[ ! -e "$proj/.worktrees/T10/.orch" ]; ok $? "the task worktree has no .orch/"
(cd "$proj/.worktrees/T10" && "$bin" --out "$tmp/outwt" >/dev/null 2>&1)
expect "$tmp/outwt/status.js" 'S.tasks.some(t => t.id === "T10") && S.repo === "proj" && S.branch === "task/T10"' "from the worktree: the enclosing store, the worktree's branch"

# ---------------------------------------------------------------- the default folder
hash=$(. "$junkd/skills/handoff/bin/host-lib" && jd_hash8 "$proj")
printed=$(cd "$proj" && "$bin" 2>/dev/null)
[ "$printed" = "$CLAUDE_CONFIG_DIR/junkd/orch/dashboard/$hash/status.js" ] && [ -f "$printed" ]; ok $? "the default folder is the toplevel's jd_hash8 ($printed)"
wthash=$(. "$junkd/skills/handoff/bin/host-lib" && jd_hash8 "$proj/.worktrees/T10")
printed=$(cd "$proj/.worktrees/T10" && "$bin" 2>/dev/null)
[ "$printed" = "$CLAUDE_CONFIG_DIR/junkd/orch/dashboard/$wthash/status.js" ]; ok $? "from the worktree: the worktree's own toplevel hash"
mkdir -p "$tmp/norepo"
printed=$(cd "$tmp/norepo" && GIT_CEILING_DIRECTORIES="$tmp" "$bin" 2>/dev/null); rc=$?
[ "$rc" = 0 ] && [ "$printed" = "$CLAUDE_CONFIG_DIR/junkd/orch/dashboard/_none/status.js" ]; ok $? "outside a repo: _none"
expect "$printed" 'S.tasks.length === 0 && S.repo === "" && S.branch === ""' "outside a repo: no tasks"

# ---------------------------------------------------------------- --sample
printed=$(cd "$proj" && "$bin" --sample --out "$tmp/outsm" 2>/dev/null)
[ "$printed" = "$tmp/outsm/status.js" ]; ok $? "--sample prints the status.js it wrote"
cmp -s "$tmp/outsm/status.js" "$junkd/skills/orch/dashboard/status.sample.js"; ok $? "--sample's status.js is the plugin's sample byte for byte"
[ ! -e "$tmp/outsm/status.sample.js" ]; ok $? "--sample leaves no status.sample.js beside it"

# ---------------------------------------------------------------- --open with stub openers
stub="$tmp/stub"
mkdir -p "$stub"
for tool in open xdg-open; do printf '#!/bin/sh\nprintf "%%s\\n" "$*" >>"%s/%s.log"\n' "$tmp" "$tool" >"$stub/$tool"; done
printf '#!/bin/sh\necho "${STUB_OS:-Darwin}"\n' >"$stub/uname"
chmod +x "$stub"/*
printed=$(cd "$proj" && PATH="$stub:$PATH" "$bin" --open --out "$tmp/outo" 2>/dev/null); rc=$?
ok "$rc" "--open exits 0"
[ "$printed" = "$tmp/outo/status.js" ]; ok $? "--open prints status.js"
cmp -s "$tmp/outo/index.html" "$junkd/skills/orch/dashboard/orch-dashboard.html" && cmp -s "$tmp/outo/scale.js" "$junkd/skills/orch/dashboard/scale.js"; ok $? "--open copies the page and scale.js"
[ -f "$tmp/outo/open" ]; ok $? "--open touches the open flag"
[ "$(cat "$tmp/open.log" 2>/dev/null)" = "$tmp/outo/index.html" ] && [ ! -e "$tmp/xdg-open.log" ]; ok $? "Darwin: open is called with index.html"
(cd "$proj" && PATH="$stub:$PATH" STUB_OS=Linux "$bin" --open --out "$tmp/outo2" >/dev/null 2>&1)
[ "$(cat "$tmp/xdg-open.log" 2>/dev/null)" = "$tmp/outo2/index.html" ]; ok $? "elsewhere: xdg-open is called with index.html"
# --sample --open: the demo beside the page, no open flag (a session's hooks module would write over the demo)
(cd "$proj" && PATH="$stub:$PATH" "$bin" --sample --open --out "$tmp/outso" >/dev/null 2>&1)
cmp -s "$tmp/outso/status.js" "$junkd/skills/orch/dashboard/status.sample.js" && [ -f "$tmp/outso/index.html" ] && [ ! -e "$tmp/outso/open" ]; ok $? "--sample --open: the demo as status.js, the page, no open flag"
# no opener at all: the path on stderr, still exit 0 (PATH of links to the tools it needs)
lim="$tmp/lim"
mkdir -p "$lim"
for tool in bash git jq cat mkdir mv rm cp dirname readlink ls date printf tail awk sed shasum md5 md5sum env sh; do
  p=$(command -v "$tool" 2>/dev/null) && [ -n "$p" ] && [ "${p#/}" != "$p" ] && ln -sf "$p" "$lim/$tool"
done
ln -sf "$stub/uname" "$lim/uname"
err=$(cd "$proj" && PATH="$lim" STUB_OS=Linux "$bin" --open --out "$tmp/outo3" 2>&1 >/dev/null); rc=$?
[ "$rc" = 0 ] && [[ "$err" == *"$tmp/outo3/index.html"* ]]; ok $? "no opener: the path, exit 0 ($err)"

# ---------------------------------------------------------------- no jq
nojq="$tmp/nojq"
mkdir -p "$nojq"
for f in "$lim"/*; do [ "${f##*/}" = jq ] || ln -sf "$(readlink "$f")" "$nojq/${f##*/}"; done
[ ! -e "$nojq/jq" ]; ok $? "the starved PATH has no jq"
err=$(cd "$proj" && PATH="$nojq" "$bin" --out "$tmp/outnj" 2>&1 >/dev/null); rc=$?
ok "$rc" "no jq: exit 0"
[[ "$err" == *jq* ]]; ok $? "no jq: stderr names jq ($err)"
expect "$tmp/outnj/status.js" 'S.mock === false && S.generatedAt === 1800000000000 && S.tasks.length === 0 && S.agents.length === 0 && S.lessons.length === 0 && JSON.stringify(S.usage) === "{}"' "no jq: the fallback file parses"
[ -z "$(ls -A "$tmp/outnj" | grep -F .tmp)" ]; ok $? "no jq: no .tmp left"

# ---------------------------------------------------------------- bad arguments
for args in "--bogus" "--out" "extra" "--out="; do
  # shellcheck disable=SC2086
  (cd "$proj" && "$bin" $args >/dev/null 2>"$tmp/errb"); rc=$?
  [ "$rc" = 2 ] && grep -q usage "$tmp/errb"; ok $? "bad args '$args': usage, exit 2 (got $rc)"
done

# ---------------------------------------------------------------- a skills-only copy
# `npx skills add` copies each skill with its links dereferenced: the dashboard skill's bin/ becomes a real folder
# with no dashboard/ beside it, so its orch-status takes the page from the sibling orch skill.
inst="$tmp/installed"
mkdir -p "$inst"
for sk in dashboard orch handoff; do cp -RL "$junkd/skills/$sk" "$inst/$sk"; done
[ -f "$inst/dashboard/bin/orch-status" ] && [ ! -L "$inst/dashboard/bin" ] && [ ! -e "$inst/dashboard/dashboard" ]; ok $? "the copy: a real dashboard/bin, no page folder of its own"
printed=$(cd "$proj" && PATH="$stub:$PATH" "$inst/dashboard/bin/orch-status" --open --out "$tmp/outi" 2>/dev/null); rc=$?
ok "$rc" "the copy's orch-status --open exits 0"
cmp -s "$tmp/outi/index.html" "$inst/orch/dashboard/orch-dashboard.html" && cmp -s "$tmp/outi/scale.js" "$inst/orch/dashboard/scale.js"; ok $? "the copy's --open copies the orch skill's page"
expect "$tmp/outi/status.js" 'S.tasks.length > 0' "the copy builds the status"
# the page or the sample missing: --open says the page could not be copied and still exits 0; --sample exits 1
rm -f "$inst/orch/dashboard/orch-dashboard.html" "$inst/orch/dashboard/status.sample.js"
err=$(cd "$proj" && PATH="$stub:$PATH" "$inst/dashboard/bin/orch-status" --open --out "$tmp/outi2" 2>&1 >/dev/null); rc=$?
[ "$rc" = 0 ] && [[ "$err" == *"could not be copied"* ]]; ok $? "no page to copy: said, exit 0 ($err)"
expect "$tmp/outi2/status.js" 'S.tasks.length > 0' "no page to copy: status.js written all the same"
err=$(cd "$proj" && "$inst/dashboard/bin/orch-status" --sample --out "$tmp/outi3" 2>&1 >/dev/null); rc=$?
[ "$rc" = 1 ] && [[ "$err" == *"status.sample.js"* ]] && [ ! -e "$tmp/outi3/status.js" ]; ok $? "no sample: exit 1, said, nothing written ($err)"

# ---------------------------------------------------------------- the layout
[ -f "$junkd/skills/orch/bin/orch-status" ] && [ ! -L "$junkd/skills/orch/bin/orch-status" ] && [ -x "$junkd/skills/orch/bin/orch-status" ]; ok $? "a real executable in skills/orch/bin"
[ "$(readlink "$junkd/skills/junkd/bin/orch-status")" = ../../orch/bin/orch-status ]; ok $? "skills/junkd/bin/orch-status links ../../orch/bin/orch-status"

echo "orch-status tests: $pass passed, $fails failed"
[ "$fails" = 0 ] || exit 1
echo "orch-status tests passed"
