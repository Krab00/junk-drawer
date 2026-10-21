#!/usr/bin/env bash
# bin/orch-watch: the watchdog table of the hosts with no hooks module, over a fixture _agents dir and a stub
# ps/lsof on PATH. Run: bash tests/orch-watch.sh (tests/smoke.sh runs it too).
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
watch="$root/plugins/junkd/bin/orch-watch"
tmp=$(cd "$(mktemp -d)" && pwd -P) # the physical path: a TMPDIR ending in `/` gives mktemp a `//`
loop=''
trap '[ -z "$loop" ] || kill "$loop" 2>/dev/null || true; rm -rf "$tmp"' EXIT
fail() { echo "orch-watch tests: $*" >&2; exit 1; }

[ -L "$watch" ] || fail "plugins/junkd/bin/orch-watch is not a link"
[ -x "$root/plugins/junkd/skills/orch/bin/orch-watch" ] || fail "skills/orch/bin/orch-watch is not executable"

# The project: a repo whose .orch/tasks holds T17 in progress, T18 done (orch-state finds the tasks through it).
repo="$tmp/repo"
mkdir -p "$repo/.orch/tasks"
git -C "$repo" init -q
printf -- '---\nbackend: adhoc\ntasks_dir: .orch/tasks\n---\n' >"$repo/.orch/config.md"
printf -- '---\nid: T17\nstatus: in_progress\n---\n' >"$repo/.orch/tasks/T17.md"
printf -- '---\nid: T18\nstatus: done\n---\n' >"$repo/.orch/tasks/T18.md"
wt="$repo/.worktrees"

# The records of session s1 as orch-agent-stop.sh writes them; the times by touch (OLD = 2020, an hour of idle and
# more; the rest now).
export CLAUDE_CONFIG_DIR="$tmp/cfg"
recs="$CLAUDE_CONFIG_DIR/junkd/orch/_agents/s1"
mkdir -p "$recs"
rec() { printf '%s\n' "$2" >"$recs/$1.json"; [ -z "${3:-}" ] || touch -t "$3" "$recs/$1.json"; }
OLD=202001010000
rec verify-T17 '{"type":"junkd:verify-coordinator","tokens":900}' 202001010000
rec a1b2c3d4e5f6 '{"type":"junkd:verify-coordinator","tokens":900}' 202001010000 # the same agent by id
rec impl-T17 '{"type":"junkd:implementer","tokens":1000}' 202001010100
rec impl-T18 '{"type":"junkd:implementer","tokens":1000}' "$OLD"
rec impl-T19 '{"type":"junkd:implementer","tokens":null,"deadNote":"no SubagentStop record · last: Bash tests/smoke.sh"}'
rec tplan-T22 '{"type":"junkd:test-planner","tokens":5}'
rec helper-T23 '{"type":"general-purpose","tokens":5}'
rec helper-T24 '{"type":"general-purpose","tokens":5}' "$OLD"
rec pr-T25 '{"type":"general-purpose","tokens":5}'
rec 'bad name' '{"type":"junkd:implementer"}'
printf 'not json' >"$recs/broken-T26.json"

# The stubs: ps lists the processes, lsof answers each one's cwd (105 has none it can read).
stubs="$tmp/stubs"
mkdir -p "$stubs"
cat >"$stubs/ps" <<EOF
#!/usr/bin/env bash
cat <<'LIST'
  101 /usr/local/bin/claude --print
  102 codex exec run
  103 kimi
  104 bash -c true
  105 claude
  106 /opt/bin/claude
  107 claude
  108 claude
  109 claude
  110 claude
LIST
EOF
cat >"$stubs/lsof" <<EOF
#!/usr/bin/env bash
pid=''
while [ \$# -gt 0 ]; do [ "\$1" = -p ] && pid=\$2; shift; done
case "\$pid" in
  101) d="$wt/T17" ;; 102) d="$wt/T18/sub" ;; 103) d="$wt/T21" ;; 104) d="$wt/T17" ;; 106) d="$wt/T22" ;;
  107) d="$repo" ;; 108) d="$wt/T23" ;; 109) d="$wt/T24" ;; 110) d="$wt/T25" ;;
  *) exit 1 ;;
esac
printf 'p%s\nfcwd\nn%s\n' "\$pid" "\$d"
EOF
chmod +x "$stubs/ps" "$stubs/lsof"
export PATH="$stubs:$PATH"

run() { (cd "$repo" && "$watch" "$@"); }
row() { grep -E "^$1 " <<<"$out" | sed -E 's/  +/|/g'; }

out=$(run --once --idle-minutes 5) || fail "--once exited non-zero"
head -n1 <<<"$out" | grep -qF 'orch-watch · session s1 · idle stop after 5 min · report only: this host has no agent stop command' ||
    fail "header: $(head -n1 <<<"$out")"
[ "$(sed -n 2p <<<"$out" | sed -E 's/ +/ /g')" = 'agent role status idle verdict' ] || fail "column header: $(sed -n 2p <<<"$out")"
# the implementer alive in its worktree while its task is in progress: kept, however long it idles
[ "$(row impl-T17)" = "impl-T17|implementer|idle (pid 101)|$(( ($(date +%s) - $(stat -f %m "$recs/impl-T17.json" 2>/dev/null || stat -c %Y "$recs/impl-T17.json")) / 60 ))m|kept (T17 in progress)" ] ||
    fail "impl-T17: $(row impl-T17)"
# the older verify of T17 lost the worktree's one process to impl-T17: done; its id file is no second row
row verify-T17 | grep -qE '\|done\|[0-9]+m\|done$' || fail "verify-T17: $(row verify-T17)"
! grep -q a1b2c3d4e5f6 <<<"$out" || fail "the id record of verify-T17 is a row of its own"
# the implementer whose task is done: due for a stop, reported only (a cwd below the worktree counts)
row impl-T18 | grep -qF 'idle (pid 102)' || fail "impl-T18 pid: $(row impl-T18)"
row impl-T18 | grep -qE '\|stop, report only \(T18 is done\)$' || fail "impl-T18: $(row impl-T18)"
# the watchdog's own death record
row impl-T19 | grep -qE '^impl-T19\|implementer\|gone\|0m\|dead \(no SubagentStop record · last: Bash tests/smoke.sh\)$' || fail "impl-T19: $(row impl-T19)"
# a reviewer that reported and is still alive: due at once, idle 0
row tplan-T22 | grep -qE '\|0m\|stop, report only \(reviewers are never messaged again\)$' || fail "tplan-T22: $(row tplan-T22)"
# a pr-/gh- name is a reviewer whatever its type
row pr-T25 | grep -qE 'stop, report only \(reviewers are never messaged again\)$' || fail "pr-T25: $(row pr-T25)"
# anything else by the idle minutes: under, kept; over, due
row helper-T23 | grep -qE 'kept \(idle under 5 min\)$' || fail "helper-T23: $(row helper-T23)"
row helper-T24 | grep -qE 'stop, report only \(idle over 5 min\)$' || fail "helper-T24: $(row helper-T24)"
# a live agent no record names: running; a process whose cwd cannot be read: by name only
row 'kimi:103' | grep -qE '^kimi:103 \(T21\)\|-\|running\|-\|ok$' || fail "kimi:103: $(row 'kimi:103')"
row 'claude:105' | grep -qE '^claude:105\|-\|alive\|-\|unknown \(cwd unreadable\)$' || fail "claude:105: $(row 'claude:105')"
# not agents: a shell in a worktree, a claude outside any task worktree (the main loop); no row for a bad name or
# a record that does not parse
! grep -qE '(:104|:107)' <<<"$out" || fail "a non-agent process is listed"
! grep -qE 'bad name|broken-T26' <<<"$out" || fail "a bad record is listed"
[ "$(grep -c . <<<"$out")" = 12 ] || fail "expected 10 rows under the two header lines (helper-T23 and pr-T25 share a time and a text: two rows), got: $out"

# --no-stop says so; the verdicts stay
out=$(run --once --no-stop --idle-minutes 5) || fail "--no-stop exited non-zero"
head -n1 <<<"$out" | grep -qF 'report only (--no-stop)' || fail "--no-stop header: $(head -n1 <<<"$out")"
row impl-T18 | grep -qF 'stop, report only (T18 is done)' || fail "--no-stop impl-T18: $(row impl-T18)"

# the idle minutes: clamped 1-120; from settings.json when not given (a numeric string counts), else 10
for pair in '0 1' '1 1' '120 120' '121 120'; do
    out=$(run --once --idle-minutes "${pair% *}")
    head -n1 <<<"$out" | grep -qF "idle stop after ${pair#* } min" || fail "--idle-minutes ${pair% *}: $(head -n1 <<<"$out")"
done
out=$(run --once)
head -n1 <<<"$out" | grep -qF 'idle stop after 10 min' || fail "default minutes: $(head -n1 <<<"$out")"
printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_idle_stop_minutes":" 7 "}}}}' >"$CLAUDE_CONFIG_DIR/settings.json"
head -n1 <<<"$(run --once)" | grep -qF 'idle stop after 7 min' || fail "settings minutes not read"
printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_idle_stop_minutes":500}}}}' >"$CLAUDE_CONFIG_DIR/settings.json"
head -n1 <<<"$(run --once)" | grep -qF 'idle stop after 120 min' || fail "settings minutes not clamped"
printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_idle_stop_minutes":"soon"}}}}' >"$CLAUDE_CONFIG_DIR/settings.json"
head -n1 <<<"$(run --once)" | grep -qF 'idle stop after 10 min' || fail "a word in settings is not the default"
printf 'not json' >"$CLAUDE_CONFIG_DIR/settings.json"
head -n1 <<<"$(run --once)" | grep -qF 'idle stop after 10 min' || fail "a broken settings.json is not the default"
rm "$CLAUDE_CONFIG_DIR/settings.json"

# bad arguments: exit 2 with the reason (each with --once, so a lost bound fails here instead of looping)
for args in '--interval 0' '--interval 3601' '--interval x' '--idle-minutes -3' '--idle-minutes 2.5' '--session ../s1' '--bogus' '--interval'; do
    set +e
    err=$(run $args --once 2>&1 >/dev/null)
    rc=$?
    set -e
    [ $rc = 2 ] || fail "$args: exit $rc, expected 2"
    grep -q '^orch-watch: ' <<<"$err" || fail "$args: no reason ($err)"
done

# the session: the newest folder, else --session
mkdir -p "$CLAUDE_CONFIG_DIR/junkd/orch/_agents/s2"
printf '{"type":"junkd:ui-reviewer","tokens":1}\n' >"$CLAUDE_CONFIG_DIR/junkd/orch/_agents/s2/ui-T30.json"
touch -t 202001010000 "$recs"
out=$(run --once)
head -n1 <<<"$out" | grep -qF 'session s2' || fail "newest session: $(head -n1 <<<"$out")"
grep -q '^ui-T30 ' <<<"$out" && ! grep -q '^impl-T17 ' <<<"$out" || fail "s2's rows: $out"
out=$(run --once --session s1)
head -n1 <<<"$out" | grep -qF 'session s1' && grep -q '^impl-T17 ' <<<"$out" || fail "--session s1: $out"
out=$(run --once --session nope)
[ "$(grep -cE '^(impl|verify|tplan|helper|pr|ui)-' <<<"$out")" = 0 ] || fail "--session nope lists records: $out"

# an implementer by its task's status: blocked is stopped at once, idle or not; todo (left in_progress) goes by the
# idle minutes alone, kept under them, due over them; a process only pwdx can read (no lsof answer) still counts
printf -- '---\nid: T27\nstatus: blocked\n---\n' >"$repo/.orch/tasks/T27.md"
printf -- '---\nid: T28\nstatus: todo\n---\n' >"$repo/.orch/tasks/T28.md"
printf -- '---\nid: T29\nstatus: todo\n---\n' >"$repo/.orch/tasks/T29.md"
s3="$CLAUDE_CONFIG_DIR/junkd/orch/_agents/s3"
mkdir -p "$s3"
printf '{"type":"junkd:implementer","tokens":1}\n' >"$s3/impl-T27.json"
printf '{"type":"junkd:implementer","tokens":1}\n' >"$s3/impl-T28.json"
printf '{"type":"junkd:lead-implementer","tokens":1}\n' >"$s3/impl-T29.json"
touch -t "$OLD" "$s3/impl-T29.json"
cp "$stubs/ps" "$tmp/ps.main"
cp "$stubs/lsof" "$tmp/lsof.main"
printf '#!/usr/bin/env bash\nprintf "  201 claude\\n  202 claude\\n  203 claude\\n  204 claude\\n"\n' >"$stubs/ps"
cat >"$stubs/lsof" <<EOF
#!/usr/bin/env bash
pid=''
while [ \$# -gt 0 ]; do [ "\$1" = -p ] && pid=\$2; shift; done
case "\$pid" in 201) d="$wt/T27" ;; 202) d="$wt/T28" ;; 203) d="$wt/T29" ;; *) exit 1 ;; esac
printf 'p%s\nfcwd\nn%s\n' "\$pid" "\$d"
EOF
cat >"$stubs/pwdx" <<EOF
#!/usr/bin/env bash
[ "\$1" = 204 ] && echo "204: $wt/T30" || exit 1
EOF
chmod +x "$stubs/ps" "$stubs/lsof" "$stubs/pwdx"
out=$(run --once --session s3 --idle-minutes 5) || fail "s3 exited non-zero"
row impl-T27 | grep -qE '^impl-T27\|implementer\|idle \(pid 201\)\|0m\|stop, report only \(T27 is blocked\)$' || fail "impl-T27 (blocked): $(row impl-T27)"
row impl-T28 | grep -qE '^impl-T28\|implementer\|idle \(pid 202\)\|0m\|kept \(idle under 5 min\)$' || fail "impl-T28 (todo, fresh): $(row impl-T28)"
row impl-T29 | grep -qE '^impl-T29\|lead-implementer\|idle \(pid 203\)\|[0-9]+m\|stop, report only \(idle over 5 min\)$' || fail "impl-T29 (todo, old): $(row impl-T29)"
row 'claude:204' | grep -qE '^claude:204 \(T30\)\|-\|running\|-\|ok$' || fail "claude:204 (pwdx): $(row 'claude:204')"
mv "$tmp/ps.main" "$stubs/ps"
mv "$tmp/lsof.main" "$stubs/lsof"
rm "$stubs/pwdx"

# the project of a session is where its transcript sits: this project's folder or one of its worktrees' (`--` is
# the `/.` of `/.worktrees`); the newest session of another project, or of a sibling folder that merely starts with
# this one's name, is not this project's. --all takes the newest of any project, --session names one.
penc=${repo//[^A-Za-z0-9]/-}
cfg2="$tmp/cfg2"
for s in s7 s6 s8; do
    mkdir -p "$cfg2/junkd/orch/_agents/$s"
    printf '{"type":"general-purpose","tokens":1}\n' >"$cfg2/junkd/orch/_agents/$s/note-$s.json"
done
mkdir -p "$cfg2/projects/${penc}--worktrees-orch" "$cfg2/projects/-elsewhere-other" "$cfg2/projects/${penc}-two"
: >"$cfg2/projects/${penc}--worktrees-orch/s7.jsonl"
: >"$cfg2/projects/-elsewhere-other/s6.jsonl"
: >"$cfg2/projects/${penc}-two/s8.jsonl"
touch -t 202101010000 "$cfg2/junkd/orch/_agents/s7"
touch -t 202201010000 "$cfg2/junkd/orch/_agents/s6"
touch -t 202301010000 "$cfg2/junkd/orch/_agents/s8"
run2() { (cd "$repo" && CLAUDE_CONFIG_DIR="$cfg2" "$watch" --once "$@"); }
head -n1 <<<"$(run2)" | grep -qF 'session s7' || fail "this project's newest session: $(head -n1 <<<"$(run2)")"
head -n1 <<<"$(run2 --all)" | grep -qF 'session s8' || fail "--all: the newest session of any project: $(head -n1 <<<"$(run2 --all)")"
head -n1 <<<"$(run2 --session s6)" | grep -qF 'session s6' || fail "--session names a session of another project"
grep -q '^note-s7 ' <<<"$(run2)" && ! grep -q '^note-s[68] ' <<<"$(run2)" || fail "s7's rows: $(run2)"

# the agents of this project, of another and the finished: 3 live and 5 finished here, 2 live in another repo's
# task worktrees
other="$tmp/other"
s5="$CLAUDE_CONFIG_DIR/junkd/orch/_agents/s5"
mkdir -p "$s5"
for n in 41 42 43; do
    printf -- "---\nid: T$n\nstatus: in_progress\n---\n" >"$repo/.orch/tasks/T$n.md"
    printf '{"type":"junkd:implementer","tokens":1}\n' >"$s5/impl-T$n.json"
done
for n in 51 52 53 54 55; do printf '{"type":"general-purpose","tokens":1}\n' >"$s5/fin-T$n.json"; done
cp "$stubs/ps" "$tmp/ps.main"
cp "$stubs/lsof" "$tmp/lsof.main"
printf '#!/usr/bin/env bash\nprintf "  301 claude\\n  302 claude\\n  303 claude\\n  304 claude\\n  305 claude\\n"\n' >"$stubs/ps"
cat >"$stubs/lsof" <<EOF
#!/usr/bin/env bash
pid=''
while [ \$# -gt 0 ]; do [ "\$1" = -p ] && pid=\$2; shift; done
case "\$pid" in
  301) d="$wt/T41" ;; 302) d="$wt/T42" ;; 303) d="$wt/T43" ;; 304) d="$other/.worktrees/T91" ;; 305) d="$other/.worktrees/T92" ;;
  *) exit 1 ;;
esac
printf 'p%s\nfcwd\nn%s\n' "\$pid" "\$d"
EOF
body() { grep -vE '^(orch-watch ·|agent )' <<<"$1"; }
out=$(run --once --session s5)
[ "$(body "$out" | grep -cE '^(impl|fin)-T')" = 8 ] && ! grep -qE ':30[45]' <<<"$out" || fail "default: this project's 8, none of the other: $out"
[ "$(tail -n1 <<<"$out")" = '2 other projects' ] || fail "footer of the default: $(tail -n1 <<<"$out")"
out=$(run --once --session s5 --active)
[ "$(body "$out" | grep -cE '^impl-T4[123] ')" = 3 ] && [ "$(body "$out" | grep -cE '^fin-T')" = 0 ] || fail "--active: the 3 live: $out"
[ "$(tail -n1 <<<"$out")" = '5 finished · 2 other projects' ] || fail "footer of --active: $(tail -n1 <<<"$out")"
out=$(run --once --session s5 --all)
[ "$(( $(grep -c . <<<"$out") - 2 ))" = 10 ] && grep -q '^claude:304 ' <<<"$out" && grep -q '^claude:305 ' <<<"$out" || fail "--all: all 10: $out"
! grep -qE 'finished|other project' <<<"$out" || fail "--all has a footer: $out"
out=$(run --once --session s5 --all --active)
[ "$(( $(grep -c . <<<"$out") - 3 ))" = 5 ] && [ "$(tail -n1 <<<"$out")" = '5 finished' ] || fail "--all --active: 3 + 2 live, 5 finished: $out"
printf '#!/usr/bin/env bash\nprintf "  301 claude\\n  304 claude\\n"\n' >"$stubs/ps"
[ "$(tail -n1 <<<"$(run --once --session s5)")" = '1 other project' ] || fail "one other project: $(run --once --session s5)"
mv "$tmp/ps.main" "$stubs/ps"
mv "$tmp/lsof.main" "$stubs/lsof"

# AC5: no records, no agents: the header and exit 0
empty="$tmp/empty-cfg"
mkdir -p "$empty"
printf '#!/usr/bin/env bash\n' >"$stubs/ps"
out=$(cd "$repo" && CLAUDE_CONFIG_DIR="$empty" "$watch" --once) || fail "an empty world exited non-zero"
[ "$(head -n1 <<<"$out")" = 'orch-watch · session none · idle stop after 10 min · report only: this host has no agent stop command (Claude Code: the junkd module stops)' ] ||
    fail "empty header: $(head -n1 <<<"$out")"
[ "$(sed -n '2,$p' <<<"$out" | sed -E 's/ +/ /g')" = 'agent role status idle verdict' ] || fail "empty table: $out"

# the loop: a table every S seconds until a signal; exit 0 on Ctrl-C (INT)
# job control on: a background job of a script starts with INT ignored otherwise, as no terminal's Ctrl-C would
set -m
(cd "$repo" && CLAUDE_CONFIG_DIR="$empty" exec "$watch" --interval 1) >"$tmp/loop.out" 2>&1 &
loop=$!
set +m
# wait for two tables (a loaded machine is slow to print the first), at most 60 s
for _ in $(seq 600); do [ "$(grep -c '^orch-watch · ' "$tmp/loop.out")" -ge 2 ] && break; sleep 0.1; done
kill -INT "$loop"
set +e
wait "$loop"
rc=$?
loop=''
set -e
[ $rc = 0 ] || fail "the loop exited $rc on INT, expected 0"
[ "$(grep -c '^orch-watch · ' "$tmp/loop.out")" -ge 2 ] || fail "the loop printed $(grep -c '^orch-watch · ' "$tmp/loop.out") tables in 60 s"

# no jq: a clear message, exit 0, nothing else read
nojq="$tmp/nojq"
mkdir -p "$nojq"
ln -s "$(command -v dirname)" "$nojq/dirname"
out=$(cd "$repo" && PATH="$nojq" "$(command -v bash)" "$watch" --once) || fail "no jq exited non-zero"
[ "$out" = 'orch-watch: needs jq (brew install jq, apt install jq); nothing checked' ] || fail "no jq: $out"

echo "orch-watch tests: ok"
