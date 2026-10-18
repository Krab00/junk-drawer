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
# The hook reads the inject_rules flag file under the config dir: point it at a fresh one so a real
# ~/.claude/orch/rules-off never decides a test.
export CLAUDE_CONFIG_DIR="$tmp/cfg"

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

# the flag file the hooks module writes for inject_rules off: nothing while it exists, the sheet once it is gone
mkdir -p "$CLAUDE_CONFIG_DIR/orch" && : > "$CLAUDE_CONFIG_DIR/orch/rules-off"
flagged=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook") || fail "rules-off flag: hook exited non-zero"
[ -z "$flagged" ] || fail "rules-off flag present: hook printed output, expected nothing"
rm "$CLAUDE_CONFIG_DIR/orch/rules-off"
unflagged=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook")
[ "$unflagged" = "$(cat "$sheet")" ] || fail "rules-off flag removed: expected the sheet"
# a directory of that name (what a Write under orch/rules-off/ would leave) is no flag: the sheet still comes
mkdir -p "$CLAUDE_CONFIG_DIR/orch/rules-off/x"
dirflag=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook") || fail "rules-off dir: hook exited non-zero"
[ "$dirflag" = "$(cat "$sheet")" ] || fail "rules-off as a directory read as the flag: expected the sheet"
rm -r "$CLAUDE_CONFIG_DIR/orch/rules-off"
# with no CLAUDE_CONFIG_DIR the flag is read under $HOME/.claude
mkdir -p "$tmp/home/.claude/orch" && : > "$tmp/home/.claude/orch/rules-off"
homeflag=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR HOME="$tmp/home" ORCH_INJECT_RULES= "$hook")
[ -z "$homeflag" ] || fail "rules-off flag under HOME/.claude: hook printed output, expected nothing"

# the setting itself in settings.json (the hooks module writes the flag only at its own session start, after this
# hook): true injects even past a stale flag, any other value skips; only without a value does the flag decide
hsettings="$CLAUDE_CONFIG_DIR/settings.json"
flag="$CLAUDE_CONFIG_DIR/orch/rules-off"
hook_main() { printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook"; }
# expect <sheet|none> <what>: the hook's output, exit 0
expect() {
    local out
    out=$(hook_main) || fail "$2: hook exited non-zero"
    if [ "$1" = sheet ]; then [ "$out" = "$(cat "$sheet")" ] || fail "$2: expected the sheet"
    else [ -z "$out" ] || fail "$2: expected nothing, got $(wc -c <<<"$out") bytes"; fi
}
for key in 'orch@junk-drawer' 'orch@other'; do
    for v in false null 0 '"true"'; do
        rm -f "$flag"
        printf '{"theme":"dark","pluginConfigs":{"%s":{"options":{"inject_rules":%s}}}}' "$key" "$v" > "$hsettings"
        expect none "setting $key inject_rules=$v, no flag"
    done
    printf '{"pluginConfigs":{"%s":{"options":{"inject_rules":true}}}}' "$key" > "$hsettings"
    : > "$flag"
    expect sheet "setting $key inject_rules=true past a stale flag"
done
# the first orch@ entry decides
printf '{"pluginConfigs":{"orch@a":{"options":{"inject_rules":true}},"orch@b":{"options":{"inject_rules":false}}}}' > "$hsettings"
expect sheet "first orch@ entry true, flag present"
# never into a subagent, whatever the setting says
printf '{"pluginConfigs":{"orch@junk-drawer":{"options":{"inject_rules":true}}}}' > "$hsettings"
sub=$(printf '{"agent_id":"a1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook") || fail "subagent with setting true: exit non-zero"
[ -z "$sub" ] || fail "subagent with setting true: hook printed output"
# ORCH_INJECT_RULES=0 still wins over a true setting
off=$(printf '{}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES=0 "$hook") || fail "ORCH_INJECT_RULES=0 with setting true: exit non-zero"
[ -z "$off" ] || fail "ORCH_INJECT_RULES=0 with setting true: hook printed output"
# no value: another plugin's entry, a name that only starts with orch, no options, no key, no pluginConfigs, a file
# that does not parse or holds two values, no file: the flag decides, both ways
for content in '{"pluginConfigs":{"tldr@junk-drawer":{"options":{"inject_rules":true}}}}' \
    '{"pluginConfigs":{"orchard@x":{"options":{"inject_rules":true}}}}' '{"pluginConfigs":{"orch@junk-drawer":{}}}' \
    '{"pluginConfigs":{"orch@junk-drawer":{"options":{"rounds":5}}}}' '{"theme":"dark"}' '{"pluginConfigs":' \
    '{"pluginConfigs":{"orch@a":{"options":{"inject_rules":true}}}} {}' 'NOFILE'; do
    if [ "$content" = NOFILE ]; then rm -f "$hsettings"; else printf '%s' "$content" > "$hsettings"; fi
    : > "$flag"
    expect none "settings $content with the flag"
    rm -f "$flag"
    expect sheet "settings $content without the flag"
done
# no jq on PATH (nothing added to it): the flag decides, a setting it cannot read does not
mkdir -p "$tmp/nojq-hook"
for t in bash cat dirname; do ln -sf "$(command -v "$t")" "$tmp/nojq-hook/$t"; done
printf '{"pluginConfigs":{"orch@junk-drawer":{"options":{"inject_rules":true}}}}' > "$hsettings"
: > "$flag"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID PATH="$tmp/nojq-hook" ORCH_INJECT_RULES= "$hook") || fail "no jq: exit non-zero"
[ -z "$out" ] || fail "no jq, flag present: expected nothing (the setting can't be read)"
rm -f "$flag"
printf '{"pluginConfigs":{"orch@junk-drawer":{"options":{"inject_rules":false}}}}' > "$hsettings"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID PATH="$tmp/nojq-hook" ORCH_INJECT_RULES= "$hook") || fail "no jq: exit non-zero"
[ "$out" = "$(cat "$sheet")" ] || fail "no jq, no flag: expected the sheet"
rm -f "$hsettings"
# with no CLAUDE_CONFIG_DIR the setting is read from $HOME/.claude/settings.json; with neither, exit 0 and the sheet
mkdir -p "$tmp/hhome/.claude"
printf '{"pluginConfigs":{"orch@junk-drawer":{"options":{"inject_rules":false}}}}' > "$tmp/hhome/.claude/settings.json"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR HOME="$tmp/hhome" ORCH_INJECT_RULES= "$hook") || fail "HOME settings: exit non-zero"
[ -z "$out" ] || fail "HOME settings inject_rules false: expected nothing"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR -u HOME ORCH_INJECT_RULES= "$hook") || fail "no HOME: exit non-zero"
[ "$out" = "$(cat "$sheet")" ] || fail "no HOME: expected the sheet"

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

# from inside a task worktree (<project>/.worktrees/<id>, which has no .orch/ of its own) the scripts work on the
# project: list its tasks, its slot registry, its config
"$bin/orch-worktree" add T-5 task/T-5-x >/dev/null
(
    cd "$project/.worktrees/T-5/"
    [ ! -e .orch ] || fail "task worktree setup: it has a .orch/ of its own"
    rg -q '^T-1[[:space:]]+todo' <<<"$("$bin/orch-state" list 2>&1)" || fail "task worktree: orch-state list misses the project's T-1"
    [ "$("$bin/orch-worktree" slot T-2 2>&1)" = 1 ] || fail "task worktree: orch-worktree does not use the project's slot registry"
    [ ! -e .worktrees ] || fail "task worktree: orch-worktree made a .worktrees/ inside the task worktree"
    rg -q 'no-op' <<<"$("$bin/orch-sync" pull 2>&1)" || fail "task worktree: orch-sync does not find the project's config"
    [ "$("$bin/orch-state" root)" = "$project" ] || fail "task worktree: root is $("$bin/orch-state" root), expected $project"
    mkdir -p sub && cd sub   # a subdir of the task worktree
    [ "$("$bin/orch-state" root)" = "$project" ] || fail "task worktree subdir: root is not the project"
)
"$bin/orch-worktree" remove T-5 >/dev/null
# the project itself a worktree inside the main checkout's .worktrees/ (<main>/.worktrees/orch), with its own .orch/:
# its task worktree resolves to it, the nearest checkout with a .orch/, never past it to the main checkout
git -C "$project" worktree add -q "$project/.worktrees/orchrun" -b orch/nested >/dev/null 2>&1
nested="$project/.worktrees/orchrun"
mkdir -p "$nested/.orch/tasks"
cp "$project/.orch/config.md" "$nested/.orch/config.md"
(
    cd "$nested"
    [ "$("$bin/orch-state" root)" = "$nested" ] || fail "nested project: its own .orch/ is not its root"
    "$bin/orch-state" new N-1 "Nested" >/dev/null
    [ -f "$nested/.orch/tasks/N-1.md" ] || fail "nested project: orch-state new wrote outside it"
    out=$("$bin/orch-worktree" add N-1 task/N-1-x) || fail "nested project: orch-worktree add failed: $out"
    rg -q "^dir=$nested/.worktrees/N-1$" <<<"$out" || fail "nested project: dir not under it: $out"
    cd "$nested/.worktrees/N-1"
    [ "$("$bin/orch-state" root)" = "$nested" ] || fail "nested task worktree: root is $("$bin/orch-state" root), expected $nested"
    list=$("$bin/orch-state" list)
    rg -q '^N-1[[:space:]]+todo' <<<"$list" || fail "nested task worktree: list misses N-1"
    if rg -q '^T-1[[:space:]]' <<<"$list"; then fail "nested task worktree: listed the main checkout's tasks"; fi
    cd "$nested"
    "$bin/orch-worktree" remove N-1 >/dev/null
)
# outside any repo orch-worktree refuses (nothing is created under the cwd)
mkdir -p "$tmp/nogit"
err=$(cd "$tmp/nogit" && "$bin/orch-worktree" slot X-1 2>&1 && echo ACCEPTED || true)
[ "$err" = "orch: not inside a git repo" ] || fail "orch-worktree outside a repo: $err"
[ ! -e "$tmp/nogit/.worktrees" ] || fail "orch-worktree outside a repo made .worktrees/"
# escapes: no .orch/ anywhere above -> the own root stays (and the config is missing); a .worktrees in a name is no
# /.worktrees/ segment
git init -q "$tmp/bare"
git -C "$tmp/bare" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$tmp/bare" worktree add -q "$tmp/bare/.worktrees/X-1" -b x1 >/dev/null 2>&1
bare=$(cd -P "$tmp/bare" && pwd)
[ "$(cd "$bare/.worktrees/X-1" && "$bin/orch-state" root)" = "$bare/.worktrees/X-1" ] || fail "no .orch above: root moved"
if (cd "$bare/.worktrees/X-1" && "$bin/orch-state" list >/dev/null 2>&1); then fail "no .orch above: list found a config"; fi
mkdir -p "$tmp/a.worktrees/p" && cp -R "$project/.orch" "$tmp/a.worktrees/.orch"
git init -q "$tmp/a.worktrees/p"
[ "$(cd "$tmp/a.worktrees/p" && "$bin/orch-state" root)" = "$(cd -P "$tmp/a.worktrees/p" && pwd)" ] || fail "a.worktrees/p: a name ending in .worktrees taken as the segment"
mkdir -p "$tmp/w/.worktreesX/p" && cp -R "$project/.orch" "$tmp/w/.orch"
git init -q "$tmp/w/.worktreesX/p"
[ "$(cd "$tmp/w/.worktreesX/p" && "$bin/orch-state" root)" = "$(cd -P "$tmp/w/.worktreesX/p" && pwd)" ] || fail ".worktreesX/p: a name starting with .worktrees taken as the segment"

# orch-state settings: the user settings /orch runs with, from settings.json pluginConfigs (no config needed)
settings_json="$CLAUDE_CONFIG_DIR/settings.json"
defaults=$'rounds=3\nui_review=true\nimplementer_ctx_k=400\ninject_rules=true'
settings() { (cd "$tmp" && "$bin/orch-state" settings); }   # $tmp: no repo, no .orch/config.md
mkdir -p "$CLAUDE_CONFIG_DIR"
rm -f "$settings_json"
[ "$(settings)" = "$defaults" ] || fail "settings, no settings.json: expected the defaults, got: $(settings)"
# opts <json of orch@junk-drawer's options> -> what settings prints
opts() { printf '{"theme":"dark","pluginConfigs":{"tldr@junk-drawer":{"options":{"rounds":9}},"orch@junk-drawer":{"options":%s}}}\n' "$1" > "$settings_json"; settings; }
[ "$(opts '{"rounds":5,"ui_review":false,"implementer_ctx_k":600,"inject_rules":false}')" = $'rounds=5\nui_review=false\nimplementer_ctx_k=600\ninject_rules=false' ] ||
    fail "settings: values not read: $(settings)"
[ "$(opts '{"ui_review":true,"inject_rules":true}')" = "$defaults" ] || fail "settings: explicit true switches: $(settings)"
# the exact bounds, one assertion each: in range kept, one past clamped
for pair in rounds:0:1 rounds:1:1 rounds:10:10 rounds:11:10 rounds:-4:1 implementer_ctx_k:49:50 implementer_ctx_k:50:50 \
    implementer_ctx_k:1000:1000 implementer_ctx_k:1001:1000; do
    IFS=: read -r key in want <<<"$pair"
    got=$(opts "{\"$key\":$in}" | rg "^$key=")
    [ "$got" = "$key=$want" ] || fail "settings: $key $in: expected $want, got $got"
done
# not a whole number: rounded like the hooks module; a numeric string counts; anything else is the default
for pair in '2.5:3' '2.4:2' '"4":4' '" 6 ":6' '"abc":3' '"":3' '" ":3' '"\t6\n":6' '"\u00a07":7' 'true:3' 'null:3' '[5]:3' '{}:3' '"nan":3' '"Infinity":3' '"1e999":3' '1e999:3'; do
    in=${pair%:*} want=${pair##*:}
    got=$(opts "{\"rounds\":$in}" | rg '^rounds=')
    [ "$got" = "rounds=$want" ] || fail "settings: rounds $in: expected $want, got $got"
done
got=$(opts '{"implementer_ctx_k":"250"}' | rg '^implementer_ctx_k=')
[ "$got" = implementer_ctx_k=250 ] || fail "settings: implementer_ctx_k \"250\": got $got"
# a switch: missing = true, only a JSON true is true
for in in false null 0 1 '"true"' '"on"'; do
    got=$(opts "{\"ui_review\":$in,\"inject_rules\":$in}" | rg '^(ui_review|inject_rules)=' | tr '\n' ' ')
    [ "$got" = "ui_review=false inject_rules=false " ] || fail "settings: switch $in: got $got"
done
# no orch@ entry (another plugin, a name that only starts with orch), no options, options not an object, the file
# not one JSON object: the defaults
for content in '{"pluginConfigs":{"tldr@junk-drawer":{"options":{"rounds":9}}}}' '{"pluginConfigs":{"orchard@x":{"options":{"rounds":9}}}}' \
    '{"pluginConfigs":{"xorch@x":{"options":{"rounds":9}}}}' '{"pluginConfigs":{"orch@junk-drawer":{}}}' \
    '{"pluginConfigs":{"orch@junk-drawer":{"options":[9]}}}' '{"pluginConfigs":[]}' '{}' '' '{"pluginConfigs":' '[]' '"x"' \
    '{"pluginConfigs":{"orch@a":{"options":{"rounds":9}}}} {}' 'not json'; do
    printf '%s' "$content" > "$settings_json"
    [ "$(settings)" = "$defaults" ] || fail "settings, file $content: expected the defaults, got: $(settings)"
done
# the first orch@ entry decides (any marketplace)
printf '{"pluginConfigs":{"orch@other":{"options":{"rounds":7}},"orch@junk-drawer":{"options":{"rounds":2}}}}' > "$settings_json"
[ "$(settings | rg '^rounds=')" = rounds=7 ] || fail "settings: the first orch@ entry does not decide"
# no jq on PATH: the defaults, exit 0
mkdir -p "$tmp/nojq"
ln -sf "$(command -v bash)" "$tmp/nojq/bash"
out=$(cd "$tmp" && PATH="$tmp/nojq" "$bin/orch-state" settings) || fail "settings without jq exited non-zero"
[ "$out" = "$defaults" ] || fail "settings without jq: expected the defaults, got: $out"
# with no CLAUDE_CONFIG_DIR the file is $HOME/.claude/settings.json
mkdir -p "$tmp/shome/.claude"
printf '{"pluginConfigs":{"orch@junk-drawer":{"options":{"rounds":4}}}}' > "$tmp/shome/.claude/settings.json"
[ "$(cd "$tmp" && env -u CLAUDE_CONFIG_DIR HOME="$tmp/shome" "$bin/orch-state" settings | rg '^rounds=')" = rounds=4 ] ||
    fail "settings: \$HOME/.claude/settings.json not read without CLAUDE_CONFIG_DIR"
# inside a project, and inside a project that is itself a worktree: the same user settings
printf '{"pluginConfigs":{"orch@junk-drawer":{"options":{"rounds":6}}}}' > "$settings_json"
[ "$(cd "$project" && "$bin/orch-state" settings | rg '^rounds=')" = rounds=6 ] || fail "settings in the project"
[ "$(cd "$run" && "$bin/orch-state" settings | rg '^rounds=')" = rounds=6 ] || fail "settings in a worktree project"
rm -f "$settings_json"

# orch-sync on the adhoc backend is a no-op in both directions
# orch-sync takes plain task ids only (they name task files and reach gh): an option, a path or a reserved id is
# refused before any backend runs, in the project and in a project that is itself a worktree
for dir in "$project" "$run"; do
    for cmd in push pull; do
        for bad in '../../x' '--web' '-R' 'a/b' 'a..b' '_lessons' '' 'GH-1;x'; do
            err=$(cd "$dir" && "$bin/orch-sync" "$cmd" GH-1 "$bad" 2>&1 && echo ACCEPTED || true)
            [ "$err" = "orch: bad task id '$bad' (letters, digits, . _ -; not starting with _)" ] ||
                fail "orch-sync $cmd '$bad' in $dir: not refused: $err"
        done
        # the first id is checked too
        err=$(cd "$dir" && "$bin/orch-sync" "$cmd" ../../x 2>&1 && echo ACCEPTED || true)
        [ "$err" = "orch: bad task id '../../x' (letters, digits, . _ -; not starting with _)" ] || fail "orch-sync $cmd ../../x (first id) in $dir: $err"
        rg -q 'no-op' <<<"$(cd "$dir" && "$bin/orch-sync" "$cmd" GH-1 T-1.x)" || fail "orch-sync $cmd with good ids in $dir: not a no-op"
    done
done
rg -q 'no-op' <<<"$("$bin/orch-sync" pull)" || fail "orch-sync pull (adhoc) is not a no-op"
# the command word is no id: --help still prints the usage
rg -q '^  orch-sync pull \[id\.\.\.\]' <<<"$("$bin/orch-sync" --help)" || fail "orch-sync --help: no usage"
rg -q 'no-op' <<<"$("$bin/orch-sync" push)" || fail "orch-sync push (adhoc) is not a no-op"

# tasks_dir steers where the scripts write, so it must be a folder under the project's .orch/: relative, no `..`
# segment, its real path (symlinks resolved, from the nearest existing folder) below .orch/, never .orch/ itself
fence="$tmp/fence"; mkdir -p "$fence/.orch/tasks" "$tmp/outside"
fence=$(cd -P "$fence" && pwd)
git -C "$fence" init -q
ln -s "$tmp/outside" "$fence/.orch/link"
ln -s "$tmp/outside" "$fence/linked"
fence_cfg() { printf -- '---\nbackend: adhoc\ntasks_dir: %s\n---\n' "$1" > "$fence/.orch/config.md"; }
for bad in '../outside' '/tmp/x' '/.orch/tasks' '.orch/a/../../src' '.orch/nope/../../../outside' '.orch/../../outside' '.orch/tasks/../../../outside' '.orch/link' '.orch/link/new/deep' 'linked' '.git' '.git/tasks' '"../outside"' 'tasks' '.' '.orch' '.orch/' './.orch' '.orchard/tasks' 'x.orch/tasks'; do
    fence_cfg "$bad"
    for cmd in "orch-state list" "orch-state tasks-dir" "orch-state new T-9" "orch-state reset-stale" "orch-sync pull"; do
        if out=$(cd "$fence" && $bin/$cmd 2>&1); then fail "tasks_dir $bad: $cmd ran: $out"; fi
        rg -q '^orch: tasks_dir ' <<<"$out" || fail "tasks_dir $bad: $cmd stopped for another reason: $out"
    done
    [ -z "$(ls -A "$tmp/outside")" ] || fail "tasks_dir $bad: something was written outside the project"
    [ ! -e "$fence/src" ] && [ ! -e "$fence/.orch/a" ] || fail "tasks_dir $bad: something was written outside .orch/ (src/ or .orch/a/)"
    rc=0; (cd "$fence" && "$bin/orch-state" new X1 >/dev/null 2>&1) || rc=$?
    [ $rc = 2 ] || fail "tasks_dir $bad: orch-state new exited $rc, expected 2"
done
# under .orch/: the usual dir, a quoted one, one not created yet, a ./ spelling
for good in '.orch/tasks' '".orch/tasks"' '.orch/new/deep' './.orch/tasks'; do
    fence_cfg "$good"
    out=$(cd "$fence" && "$bin/orch-state" tasks-dir) || fail "tasks_dir $good refused: $out"
    want=${good//\"/}; [ "$out" = "$fence/$want" ] || fail "tasks_dir $good: printed $out"
    (cd "$fence" && "$bin/orch-state" list >/dev/null && "$bin/orch-sync" pull >/dev/null) || fail "tasks_dir $good: list or orch-sync refused"
done
rm -f "$fence/.orch/config.md"

echo "orch tests passed"
