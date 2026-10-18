#!/usr/bin/env bash
# orch plugin tests: the SessionStart rule-sheet hook, the agent roster, and the bin scripts
# (orch-state list/set/new/reset-stale, orch-worktree add/slot/remove). Run: bash tests/orch.sh
# (tests/smoke.sh runs it too). Every check is an explicit `if`/`[ ]` so `set -e` catches it.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/orch"
hook="$plugin/scripts/orch-context.sh"
sheet="$plugin/skills/orch/ORCHESTRATOR.md"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() { echo "orch tests: $*" >&2; exit 1; }

# ---------------------------------------------------------------- rule sheet + hook (AC2, AC3)
[ -f "$sheet" ] || fail "no ORCHESTRATOR.md"
lines=$(wc -l < "$sheet" | tr -d ' ')
[ "$lines" -lt 80 ] || fail "ORCHESTRATOR.md has $lines lines, must be under 80"
rg -q 'Fable' "$sheet" || fail "ORCHESTRATOR.md does not mention Fable"
rg -q 'Opus' "$sheet" || fail "ORCHESTRATOR.md does not mention Opus"

# hooks.json: a SessionStart command hook that runs scripts/orch-context.sh
jq -e '.hooks.SessionStart[0].hooks[] | select(.type == "command" and (.command | contains("/scripts/orch-context.sh")))' \
    "$plugin/hooks/hooks.json" >/dev/null || fail "hooks.json has no SessionStart hook for scripts/orch-context.sh"
[ -L "$plugin/scripts" ] || fail "plugins/orch/scripts must be a symlink into skills/"
[ -x "$plugin/skills/orch/scripts/orch-context.sh" ] || fail "orch-context.sh is not executable"

# main session (no agent marker): the sheet, byte for byte (compared through files so a
# trailing-newline difference shows), exit 0
printf '{"session_id":"s1","hook_event_name":"SessionStart"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook" > "$tmp/main.out"
cmp -s "$tmp/main.out" "$sheet" || fail "main session: hook output differs from ORCHESTRATOR.md"
# no stdin at all (a tty-less hook with closed input) still prints the sheet
env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook" < /dev/null > "$tmp/nostdin.out"
cmp -s "$tmp/nostdin.out" "$sheet" || fail "main session without stdin: hook output differs"

# subagent by env marker: nothing, exit 0
sub=$(printf '{"session_id":"s1"}' | CLAUDE_AGENT_ID=agent-1 ORCH_INJECT_RULES= "$hook")
[ -z "$sub" ] || fail "CLAUDE_AGENT_ID set: hook printed $(wc -c <<<"$sub") bytes, expected nothing"
# subagent by hook-input marker (agent_id key, any spacing): nothing
for payload in '{"session_id":"s1","agent_id":"a1"}' '{"agent_id" : "a1"}' '{ "agent_id":"" }'; do
    sub=$(printf '%s' "$payload" | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook")
    [ -z "$sub" ] || fail "payload $payload: hook printed output, expected nothing"
done
# a key that merely contains the text (agent_identity) is NOT the marker
out=$(printf '{"agent_identity":"a1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook")
[ "$out" = "$(cat "$sheet")" ] || fail "agent_identity key wrongly treated as the subagent marker"

# ORCH_INJECT_RULES=0: nothing; any other value injects
off=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES=0 "$hook")
[ -z "$off" ] || fail "ORCH_INJECT_RULES=0: hook printed output, expected nothing"
for v in 1 00 off false; do
    on=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES=$v "$hook")
    [ "$on" = "$(cat "$sheet")" ] || fail "ORCH_INJECT_RULES=$v: expected the sheet (only 0 turns it off)"
done
# exit status is 0 in every case (a non-zero SessionStart hook would block the session)
printf '{}' | CLAUDE_AGENT_ID=a "$hook" >/dev/null || fail "subagent path exited non-zero"
printf '{}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES=0 "$hook" >/dev/null || fail "ORCH_INJECT_RULES=0 exited non-zero"

# a missing sheet: empty output, still exit 0 (a failing SessionStart hook would block the session)
mkdir -p "$tmp/nosheet/scripts"
cp "$plugin/skills/orch/scripts/orch-context.sh" "$tmp/nosheet/scripts/"
missing=$(printf '{}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$tmp/nosheet/scripts/orch-context.sh") || fail "missing sheet: hook exited non-zero"
[ -z "$missing" ] || fail "missing sheet: hook printed output"

# ---------------------------------------------------------------- agents (AC1)
for agent in implementer verify-coordinator ui-reviewer orch-ops lead-implementer test-planner test-reviewer; do
    f="$plugin/agents/$agent.md"
    [ -f "$f" ] || fail "missing agent $agent"
    model=$(awk 'NR==1 && !/^---/ {exit} /^---/ {n++; if (n==2) exit; next} /^model:/ {sub(/^model:[ \t]*/, ""); print}' "$f")
    case "$model" in
        opus|sonnet|haiku) ;;
        *) fail "agent $agent: model '$model' is not opus|sonnet|haiku" ;;
    esac
    name=$(awk '/^---/ {n++; if (n==2) exit; next} /^name:/ {sub(/^name:[ \t]*/, ""); print}' "$f")
    [ "$name" = "$agent" ] || fail "agent $agent: frontmatter name is '$name'"
done
for pair in implementer:opus lead-implementer:opus verify-coordinator:opus ui-reviewer:sonnet test-planner:sonnet test-reviewer:sonnet orch-ops:haiku; do
    model=$(awk '/^---/ {n++; if (n==2) exit; next} /^model:/ {sub(/^model:[ \t]*/, ""); print}' "$plugin/agents/${pair%%:*}.md")
    [ "$model" = "${pair##*:}" ] || fail "agent ${pair%%:*}: model '$model', expected ${pair##*:}"
done

# ---------------------------------------------------------------- bin scripts (AC4, AC5)
for s in orch-state orch-sync orch-worktree; do bash -n "$plugin/bin/$s" || fail "bash -n $s"; done
bin="$plugin/bin"

mkdir -p "$tmp/project/.orch/tasks"
project=$(cd -P "$tmp/project" && pwd)   # git reports physical paths (/private/var on macOS)
git -C "$project" init -q
git -C "$project" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
cat > "$project/.orch/config.md" <<'CONFIG'
---
backend: adhoc
tasks_dir: ".orch/tasks"
default_base: main
branch_prefix: task/
capabilities:
  web: { run: "npm run dev", port_base: 5180, health: "/" }
---
CONFIG
printf '## T-0\nlesson one\n' > "$project/.orch/tasks/_lessons.md"
printf -- '---\nid: _draft\nstatus: todo\n---\n' > "$project/.orch/tasks/_draft.md"
printf 'no frontmatter here\n' > "$project/.orch/tasks/BROKEN.md"
cd "$project"

# new: skeleton with status todo; a duplicate is refused; a `_` id is refused
"$bin/orch-state" new T-1 "First task" >/dev/null
[ -f .orch/tasks/T-1.md ] || fail "new did not create T-1.md (quoted tasks_dir not honoured?)"
[ ! -e '.orch/tasks"' ] && [ ! -e '"' ] || fail "quoted tasks_dir taken literally"
rg -q '^status: todo$' .orch/tasks/T-1.md || fail "new: status is not todo"
rg -q '^title: First task$' .orch/tasks/T-1.md || fail "new: title not written"
if "$bin/orch-state" new T-1 2>/dev/null; then fail "new: duplicate id accepted"; fi
if "$bin/orch-state" new _lessons 2>/dev/null; then fail "new: id starting with _ accepted"; fi
if "$bin/orch-state" new 'a..b' 2>/dev/null; then fail "new: id with .. accepted"; fi
"$bin/orch-state" new x_y >/dev/null   # an inner _ is fine

# set: valid statuses rewrite the frontmatter; a bad status / unknown id / broken file is refused
"$bin/orch-state" set T-1 in_progress >/dev/null
rg -q '^status: in_progress$' .orch/tasks/T-1.md || fail "set: status not in_progress"
[ "$(rg -c '^status:' .orch/tasks/T-1.md)" = 1 ] || fail "set: duplicated the status line"
if "$bin/orch-state" set T-1 running 2>/dev/null; then fail "set: bad status accepted"; fi
if "$bin/orch-state" set NOPE todo 2>/dev/null; then fail "set: unknown id accepted"; fi
if "$bin/orch-state" set BROKEN todo 2>/dev/null; then fail "set: file without frontmatter accepted"; fi
if "$bin/orch-state" set _draft todo 2>/dev/null; then fail "set: _ id accepted"; fi
# a frontmatter block without a status line gets one inserted before the closing ---
printf -- '---\nid: NS\ntitle: no status\n---\nbody\n' > .orch/tasks/NS.md
"$bin/orch-state" set NS blocked >/dev/null
[ "$(cat .orch/tasks/NS.md)" = "$(printf -- '---\nid: NS\ntitle: no status\nstatus: blocked\n---\nbody')" ] || fail "set: status line not inserted: $(cat .orch/tasks/NS.md)"
# a CRLF file is rewritten LF with the new status
printf -- '---\r\nid: CR\r\nstatus: todo\r\n---\r\nbody\r\n' > .orch/tasks/CR.md
"$bin/orch-state" set CR done >/dev/null
rg -q $'^status: done$' .orch/tasks/CR.md || fail "set on CRLF: status not rewritten"
if rg -q $'\r' .orch/tasks/CR.md; then fail "set on CRLF: CR bytes remain"; fi

# list: header + one row per task file; `_`-files hidden; a file without frontmatter is `invalid`
list=$("$bin/orch-state" list)
[ "$(printf '%s\n' "$list" | head -1 | awk '{print $1, $2, $3}')" = "ID STATUS DEPS" ] || fail "list: no header"
rg -q '^T-1[[:space:]]+in_progress[[:space:]]+\[\]' <<<"$list" || fail "list: T-1 row wrong: $list"
rg -q '^x_y[[:space:]]+todo' <<<"$list" || fail "list: x_y (inner underscore) missing"
rg -q '^CR[[:space:]]+done' <<<"$list" || fail "list: CR row missing"
rg -q '^BROKEN[[:space:]]+invalid' <<<"$list" || fail "list: BROKEN not marked invalid"
if rg -q '_lessons' <<<"$list"; then fail "list shows _lessons"; fi
if rg -q '_draft' <<<"$list"; then fail "list shows _draft"; fi
rg -q '^NS[[:space:]]+blocked' <<<"$list" || fail "list: NS row missing"
[ "$(printf '%s\n' "$list" | wc -l | tr -d ' ')" = 6 ] || fail "list: expected header + 5 rows, got: $list"

# deps: a flow list and a block list both print as [a, b]
printf -- '---\nid: D1\nstatus: todo\ndeps: [T-1, CR]\n---\n' > .orch/tasks/D1.md
printf -- '---\nid: D2\nstatus: "blocked"   # quoted\ndeps:\n  - T-1\n  - CR\n---\n' > .orch/tasks/D2.md
list=$("$bin/orch-state" list)
rg -q '^D1[[:space:]]+todo[[:space:]]+\[T-1, CR\]$' <<<"$list" || fail "list: flow deps wrong"
rg -q '^D2[[:space:]]+blocked[[:space:]]+\[T-1, CR\]$' <<<"$list" || fail "list: block deps / quoted status wrong"

# reset-stale: in_progress -> todo; blocked only with --blocked; `_` files untouched
"$bin/orch-state" reset-stale >/dev/null
rg -q '^status: todo$' .orch/tasks/T-1.md || fail "reset-stale: T-1 not reset"
rg -q '^status: "blocked"' .orch/tasks/D2.md || fail "reset-stale touched a blocked task without --blocked"
"$bin/orch-state" reset-stale --blocked >/dev/null
rg -q '^status: todo$' .orch/tasks/D2.md || fail "reset-stale --blocked: D2 not reset"
[ "$("$bin/orch-state" reset-stale)" = "no stale tasks" ] || fail "reset-stale: expected 'no stale tasks'"
rg -q '^status: todo$' .orch/tasks/_draft.md || fail "reset-stale rewrote _draft.md"
[ "$(cat .orch/tasks/_lessons.md)" = "$(printf '## T-0\nlesson one')" ] || fail "_lessons.md changed"
if "$bin/orch-state" reset-stale --bogus 2>/dev/null; then fail "reset-stale: unknown flag accepted"; fi

# cfg / id
[ "$("$bin/orch-state" cfg default_base)" = main ] || fail "cfg default_base"
[ "$("$bin/orch-state" cfg backend)" = adhoc ] || fail "cfg backend"
[ "$("$bin/orch-state" id T-9)" = T-9 ] || fail "id T-9"
if "$bin/orch-state" id '' 2>/dev/null; then fail "id: empty accepted"; fi
if "$bin/orch-state" id '-x' 2>/dev/null; then fail "id: -x accepted"; fi

# orch-worktree: add (new branch / detached at an existing one), slot, remove; guards
out=$("$bin/orch-worktree" add T-1 task/T-1-first)
rg -q "^dir=$project/.worktrees/T-1$" <<<"$out" || fail "worktree add: dir line wrong: $out"
rg -q '^slot=0$' <<<"$out" || fail "worktree add: first slot is not 0"
rg -q '^web_port=5180$' <<<"$out" || fail "worktree add: web_port is not port_base+0"
if rg -q '^api_port=' <<<"$out"; then fail "worktree add: api_port printed with no api capability"; fi
[ -d .worktrees/T-1 ] || fail "worktree add: no directory"
git -C "$project" rev-parse --verify --quiet task/T-1-first >/dev/null || fail "worktree add: branch not created"
grep -qxF '.worktrees/' .git/info/exclude || fail "worktree add: .worktrees/ not excluded"
[ "$("$bin/orch-worktree" slot T-1)" = 0 ] || fail "slot: T-1 is not 0"
[ "$("$bin/orch-worktree" slot T-2)" = 1 ] || fail "slot: T-2 is not 1"
# the same add again is idempotent (same dir, same slot)
out2=$("$bin/orch-worktree" add T-1 task/T-1-first)
[ "$out2" = "$out" ] || fail "worktree add twice differs: $out2"
# an existing branch is attached detached, so the implementer's checkout may keep it
"$bin/orch-worktree" remove T-1 >/dev/null
out=$("$bin/orch-worktree" add T-1 task/T-1-first)
[ "$(git -C .worktrees/T-1 rev-parse --abbrev-ref HEAD)" = HEAD ] || fail "worktree add on an existing branch is not detached"
rg -q '^slot=0$' <<<"$out" || fail "worktree add after remove: slot 0 was freed and is the lowest free index; got: $out"
rg -q '^T-2 1$' .worktrees/.orch-slots || fail "re-adding T-1 disturbed T-2's slot"
if "$bin/orch-worktree" add T-3 main 2>/dev/null; then fail "worktree add accepted the default base as a task branch"; fi
# a bad branch name is refused by orch-worktree itself (its own message), before git sees it
err=$("$bin/orch-worktree" add T-3 '-x' 2>&1 && echo ACCEPTED || true)
rg -q "^orch: bad branch name '-x'$" <<<"$err" || fail "worktree add: bad branch name not refused by the guard: $err"
[ ! -d .worktrees/T-3 ] || fail "worktree add: bad branch name created a worktree"
# branch == base with an EXISTING base: without the guard git would happily attach detached at it
git -C "$project" branch feat
if "$bin/orch-worktree" add T-3 feat feat 2>/dev/null; then fail "worktree add accepted branch == base"; fi
[ ! -d .worktrees/T-3 ] || fail "worktree add: branch == base created a worktree"
if "$bin/orch-worktree" add _t b 2>/dev/null; then fail "worktree add accepted a _ id"; fi
# the dir exists but holds another commit than <branch>: refused with the remove hint, dir kept
git -C "$project" -c user.email=t@t -c user.name=t commit -q --allow-empty -m second
git -C "$project" branch other HEAD
err=$("$bin/orch-worktree" add T-1 other 2>&1 && echo ACCEPTED || true)
rg -q "^orch: $project/.worktrees/T-1 is not at other; run orch-worktree remove T-1 first$" <<<"$err" ||
    fail "worktree add: existing dir at another commit not refused: $err"
[ -d .worktrees/T-1 ] || fail "worktree add: the refused add removed the dir"
# add with an existing base: the new branch starts at the base's commit
out=$("$bin/orch-worktree" add T-4 task/T-4-from-feat feat)
rg -q "^dir=$project/.worktrees/T-4$" <<<"$out" || fail "worktree add with base: dir line wrong: $out"
[ "$(git -C "$project" rev-parse task/T-4-from-feat)" = "$(git -C "$project" rev-parse feat)" ] || fail "worktree add with base: branch not at the base commit"
[ "$(git -C .worktrees/T-4 rev-parse --abbrev-ref HEAD)" = task/T-4-from-feat ] || fail "worktree add with base: new branch not checked out"
"$bin/orch-worktree" remove T-4 >/dev/null
"$bin/orch-worktree" remove T-1 >/dev/null
[ ! -d .worktrees/T-1 ] || fail "worktree remove left the directory"
if rg -q '^T-1 ' .worktrees/.orch-slots; then fail "worktree remove left the slot"; fi
rg -q '^T-2 1$' .worktrees/.orch-slots || fail "worktree remove dropped another id's slot"
[ ! -e .worktrees/.orch-slots.lock ] || fail "registry lock left behind"
[ -z "$(git -C "$project" status --short | rg -v '^\?\? \.orch/')" ] || fail ".worktrees leaked into git status"

# a project that is itself a git worktree (the orch run dir): .orch/ lives in the worktree, and
# both scripts resolve the root to the worktree, not to the main checkout
git -C "$project" worktree add -q "$tmp/run" -b orch/run >/dev/null 2>&1
run=$(cd -P "$tmp/run" && pwd)
mkdir -p "$run/.orch/tasks"
cp "$project/.orch/config.md" "$run/.orch/config.md"
(
    cd "$run"
    "$bin/orch-state" new W-1 "In a worktree" >/dev/null
    [ -f "$run/.orch/tasks/W-1.md" ] || fail "worktree project: orch-state wrote outside the worktree"
    rg -q '^W-1[[:space:]]+todo' <<<"$("$bin/orch-state" list)" || fail "worktree project: list misses W-1"
    out=$("$bin/orch-worktree" add W-1 task/W-1-x) || fail "worktree project: orch-worktree add failed: $out"
    rg -q "^dir=$run/.worktrees/W-1$" <<<"$out" || fail "worktree project: dir not under the worktree: $out"
    [ -d "$run/.worktrees/W-1" ] || fail "worktree project: no worktree dir"
    [ ! -e "$project/.worktrees/W-1" ] || fail "worktree project: worktree landed in the main checkout"
    "$bin/orch-worktree" remove W-1 >/dev/null
    [ ! -d "$run/.worktrees/W-1" ] || fail "worktree project: remove left the dir"
)

# orch-sync on the adhoc backend is a no-op in both directions
rg -q 'no-op' <<<"$("$bin/orch-sync" pull)" || fail "orch-sync pull (adhoc) is not a no-op"
rg -q 'no-op' <<<"$("$bin/orch-sync" push)" || fail "orch-sync push (adhoc) is not a no-op"

echo "orch tests passed"
