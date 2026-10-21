#!/usr/bin/env bash
# scripts/cache-check.sh (the prompt-cache check the hooks module runs at session start) over fixture transcripts
# written into a temp project folder: the subagent-ratio line, the gap-share line, nothing while both are fine,
# nothing for N=0 / a missing folder / no jq, one count per message id, a file over 50 MB read from its tail, the
# 3 s cap. Run: bash tests/cache-check.sh (tests/smoke.sh runs it too). Every check is an explicit `if`/`[ ]`.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/junkd"
script="$plugin/scripts/cache-check.sh"
tmp=$(cd -P "$(mktemp -d "${TMPDIR:-/tmp}/junkd-cache-check.XXXXXX")" && pwd)
trap 'rm -rf "$tmp"' EXIT
proj="$tmp/proj"

fail() { echo "cache-check tests: $*" >&2; exit 1; }
reset() { rm -rf "$proj"; mkdir -p "$proj"; }
# run <N> [folder]: the script's stdout in $out, its exit code in $rc.
run() { rc=0; out=$("$script" "$1" "${2-$proj}") || rc=$?; }
# expect_line <case> <line>: exit 0 and exactly this line.
expect_line() { [ "$rc" = 0 ] || fail "$1: exit $rc"; [ "$out" = "$2" ] || fail "$1: expected '$2', got '$out'"; }
expect_none() { [ "$rc" = 0 ] || fail "$1: exit $rc"; [ -z "$out" ] || fail "$1: expected nothing, got '$out'"; }
# gone <pid>: true once the process is gone, polled for up to 10 s (a loaded machine is slow to reap it).
gone() { local _; for _ in $(seq 200); do kill -0 "$1" 2>/dev/null || return 0; sleep 0.05; done; return 1; }
now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }

# An ISO timestamp <offset> seconds after 2026-10-01T08:00:00, with the milliseconds a transcript carries.
iso() { local s=$((8 * 3600 + $1)); printf '2026-10-01T%02d:%02d:%02d.123Z' $((s / 3600)) $((s % 3600 / 60)) $((s % 60)); }
# req <session> <message id> <offset s> <input> <cache read> <cache write> [1h write] [agent id]: one assistant line
# as a transcript writes it.
req() {
    local agent=""
    [ -z "${8-}" ] || agent="\"agentId\":\"$8\","
    printf '{"type":"assistant",%s"sessionId":"%s","timestamp":"%s","message":{"id":"%s","usage":{"input_tokens":%d,"cache_read_input_tokens":%d,"cache_creation_input_tokens":%d,"cache_creation":{"ephemeral_1h_input_tokens":%d,"ephemeral_5m_input_tokens":0},"output_tokens":7}}}\n' \
        "$agent" "$1" "$(iso "$3")" "$2" "$4" "$5" "$6" "${7-0}"
}
# main <session> <offsets...>: main requests at a 75% hit ratio (75 read, 25 input), one per offset, into <session>.jsonl.
main() { local s=$1 t i=0; shift; for t in "$@"; do req "$s" "$s-m$((i += 1))" "$t" 25 75 0 >>"$proj/$s.jsonl"; done; }
# sub <session> <agent> <count> <input> <read> <write>: <count> subagent requests of one agent, 60 s apart.
sub() {
    local f="$proj/$1/subagents/agent-$2.jsonl" i
    mkdir -p "${f%/*}"
    for ((i = 1; i <= $3; i++)); do req "$1" "$2-m$i" $((i * 60)) "$4" "$5" "$6" 0 "$2" >>"$f"; done
}
# pad <bytes>: exactly that many bytes of 1 KiB lines with no usage in them.
pad() { perl -e '$b = shift; $l = ("p" x 1023) . "\n"; print $l x int($b / 1024); $r = $b % 1024; print(("p" x ($r - 1)) . "\n") if $r' "$1"; }
MB50=52428800

SUB_LINE='cache, last session: subagent hit 50%, main 75% → reuse implementers via SendMessage instead of spawning new ones'
GAP_LINE='cache, last session: 100% of main requests came 5–60 min after the previous one → a 1h cache TTL would pay off'

# ---------------------------------------------------------------- layout
[ -x "$plugin/skills/junkd/scripts/cache-check.sh" ] && [ ! -L "$plugin/skills/junkd/scripts/cache-check.sh" ] ||
    fail "skills/junkd/scripts/cache-check.sh is not an executable file"
[ "$script" -ef "$plugin/skills/junkd/scripts/cache-check.sh" ] || fail "scripts/cache-check.sh at the plugin root is not the skill's script"
rg -qF '`${$.plugin.root}/scripts/cache-check.sh`' "$plugin/hooks/cache.tsx" || fail "hooks/cache.tsx does not run \${\$.plugin.root}/scripts/cache-check.sh"
# no min or max in the manifest: the host would refuse the whole module's load on an out-of-range hand edit; the
# module clamps (hooks/cache-lib.ts)
jq -e '.userConfig.core_cache_check_sessions | .type == "number" and .default == 10 and (has("min") | not) and (has("max") | not)' "$plugin/.claude-plugin/plugin.json" >/dev/null ||
    fail "plugin.json: userConfig.core_cache_check_sessions is not a number defaulting to 10 with no min or max"

# ================================================================ the subagent line
# 50 subagent requests over two agents at 50% (50 read, 50 write), the main session at 75%
reset; main s1 0 60; sub s1 a1 25 0 50 50; sub s1 a2 25 0 50 50
run 10; expect_line "subagent 50%" "$SUB_LINE"
# 49 requests are too few to judge
reset; main s1 0 60; sub s1 a1 25 0 50 50; sub s1 a2 24 0 50 50
run 10; expect_none "49 subagent requests"
# exactly 60% is no line; 59.9% is (the threshold is < 0.6)
reset; main s1 0 60; sub s1 a1 50 0 60 40
run 10; expect_none "subagent exactly 60%"
reset; main s1 0 60; sub s1 a1 50 0 599 401
run 10; expect_line "subagent 59.9%" 'cache, last session: subagent hit 59%, main 75% → reuse implementers via SendMessage instead of spawning new ones'
# the input counts in the ratio as the cache write does (59 read, 41 input: 59%)
reset; main s1 0 60; sub s1 a1 50 41 59 0
run 10; expect_line "subagent input" 'cache, last session: subagent hit 59%, main 75% → reuse implementers via SendMessage instead of spawning new ones'
# the subagent line wins over the gap line when both are hit
reset; main s1 0 600; sub s1 a1 50 0 50 50
run 10; expect_line "both hit" "$SUB_LINE"
# no main request with usage beside the subagents: main 0%
reset; printf '{"type":"assistant","sessionId":"s1","timestamp":"%s","message":{"id":"x","usage":{}}}\n' "$(iso 0)" >"$proj/s1.jsonl"
sub s1 a1 50 0 50 50
run 10; expect_line "no main tokens" 'cache, last session: subagent hit 50%, main 0% → reuse implementers via SendMessage instead of spawning new ones'

# ================================================================ the gap line
reset; main s1 0 600
run 10; expect_line "one 10 min gap" "$GAP_LINE"
# the bounds: more than 300 s, at most 3600 s
reset; main s1 0 300; run 10; expect_none "gap of exactly 300 s"
reset; main s1 0 301; run 10; expect_line "gap of 301 s" "$GAP_LINE"
reset; main s1 0 3600; run 10; expect_line "gap of exactly 3600 s" "$GAP_LINE"
reset; main s1 0 3601; run 10; expect_none "gap of 3601 s"
# the share: exactly 30% is no line (3 of 10 gaps), 40% is
reset; main s1 0 600 1200 1800 1860 1920 1980 2040 2100 2160 2220
run 10; expect_none "gap share exactly 30%"
reset; main s1 0 600 1200 1800 2400 2460 2520 2580 2640 2700 2760
run 10; expect_line "gap share 40%" 'cache, last session: 40% of main requests came 5–60 min after the previous one → a 1h cache TTL would pay off'
# a request that wrote 1h cache: the gap after it does not count
reset; req s1 m1 0 25 75 0 100 >"$proj/s1.jsonl"; req s1 m2 600 25 75 0 >>"$proj/s1.jsonl"
run 10; expect_none "gap after a 1h write"
# gaps are within a session: two sessions' requests 10 min apart are no gap
reset; main s1 0; main s2 600
run 10; expect_none "gap across sessions"
# the requests are put in time order first (written 0, 4000, 600: gaps 600 and 3400)
reset; main s1 0 4000 600
run 10; expect_line "out-of-order lines" "$GAP_LINE"
# subagent requests make no gaps
reset; main s1 0 60; sub s1 a1 3 0 90 10; req s1 a1-m9 2000 0 90 10 0 a1 >>"$proj/s1/subagents/agent-a1.jsonl"
run 10; expect_none "subagent gaps"

# ================================================================ nothing
# both fine: subagents at 90%, main gaps of a minute
reset; main s1 0 60 120 180; sub s1 a1 60 0 90 10
run 10; expect_none "both fine"
# N=0, a non-number N, a missing folder: nothing, exit 0
reset; main s1 0 600
for n in 0 x '' -1; do run "$n"; expect_none "N='$n'"; done
# N is checked as digits before any arithmetic: bash's -gt would run a command in an array subscript
run 'x[$(touch "'"$tmp"'/pwned")]'; expect_none "N with a subscript"
[ ! -e "$tmp/pwned" ] || fail "N with a subscript ran a command"
run 10 "$tmp/nowhere"; expect_none "missing folder"
reset; run 10; expect_none "empty folder"
reset; printf '{"type":"user"}\n' >"$proj/s1.jsonl"; run 10; expect_none "no request yet"

# no jq: only the tools the script needs, none of the dirs it adds (JUNKD_CACHE_PATH_DIRS empty); /usr/bin has a jq
# on recent macOS, so PATH is a folder of links. With jq linked in too, the line comes: nothing else was missing.
mkdir -p "$tmp/bin" "$tmp/jqdir"
for t in bash perl ls grep head find tail sed; do ln -sf "$(command -v "$t")" "$tmp/bin/$t"; done
reset; main s1 0 600
rc=0; out=$(PATH="$tmp/bin" JUNKD_CACHE_PATH_DIRS= "$script" 10 "$proj") || rc=$?
expect_none "no jq"
ln -sf "$(command -v jq)" "$tmp/jqdir/jq"
rc=0; out=$(PATH="$tmp/bin:$tmp/jqdir" JUNKD_CACHE_PATH_DIRS= "$script" 10 "$proj") || rc=$?
expect_line "jq on PATH" "$GAP_LINE"
# a jq only in one of the dirs the script adds to PATH (named through the override) is found
rc=0; out=$(PATH="$tmp/bin" JUNKD_CACHE_PATH_DIRS="$tmp/nowhere:$tmp/jqdir" "$script" 10 "$proj") || rc=$?
expect_line "jq in an added dir" "$GAP_LINE"
# a jq that fails is a failure: exit 1, nothing printed
mkdir -p "$tmp/badjq"; printf '#!/bin/sh\nexit 5\n' >"$tmp/badjq/jq"; chmod +x "$tmp/badjq/jq"
rc=0; out=$(PATH="$tmp/badjq:$tmp/bin" JUNKD_CACHE_PATH_DIRS= "$script" 10 "$proj") || rc=$?
[ "$rc" = 1 ] && [ -z "$out" ] || fail "failing jq: expected exit 1 and nothing, got $rc '$out'"

# ================================================================ one count per message id
# streaming: 25 subagent messages, each written as two lines with the same id, are 25 requests, too few
reset; main s1 0 60; sub s1 a1 25 0 50 50
f="$proj/s1/subagents/agent-a1.jsonl"; cat "$f" "$f" >"$tmp/dup.jsonl"; mv "$tmp/dup.jsonl" "$f"
run 10; expect_none "25 messages on 50 lines"
# the same message id later on: its first line counts, so no 10 min gap
reset; req s1 m1 0 25 75 0 >"$proj/s1.jsonl"; req s1 m1 600 25 75 0 >>"$proj/s1.jsonl"
run 10; expect_none "a message id repeated"
# the first line of a message id counts, not a later one: m1 at 0 and 60 s later m2 (a minute gap); m1 again at
# 700 s would make a 640 s gap if it replaced the first
reset; req s1 m1 0 25 75 0 >"$proj/s1.jsonl"; req s1 m2 60 25 75 0 >>"$proj/s1.jsonl"; req s1 m1 700 25 75 0 >>"$proj/s1.jsonl"
run 10; expect_none "the first line of a message id counts"
# with no message id, the requestId is the key
reset
printf '{"type":"assistant","requestId":"r1","sessionId":"s1","timestamp":"%s","uuid":"u1","message":{"usage":{"input_tokens":1}}}\n' "$(iso 0)" >"$proj/s1.jsonl"
printf '{"type":"assistant","requestId":"r1","sessionId":"s1","timestamp":"%s","uuid":"u2","message":{"usage":{"input_tokens":1}}}\n' "$(iso 600)" >>"$proj/s1.jsonl"
run 10; expect_none "a requestId repeated"
# a line that does not parse, one with an odd timestamp and a user line are passed over
reset; main s1 0 600
printf '{"type":"assistant","message":{"usage":{"input_to\n' >>"$proj/s1.jsonl"
printf '{"type":"assistant","sessionId":"s1","timestamp":"yesterday","message":{"id":"z","usage":{"input_tokens":1}}}\n' >>"$proj/s1.jsonl"
printf '{"type":"user","sessionId":"s1","timestamp":"%s","message":{"usage":{"input_tokens":1}}}\n' "$(iso 660)" >>"$proj/s1.jsonl"
run 10; expect_line "broken lines" "$GAP_LINE"

# ================================================================ the newest N with a request
# newest: the current session (no request yet); then s2 (a 10 min gap); oldest: s3 (minute gaps that outweigh it)
reset
printf '{"type":"user"}\n' >"$proj/s1.jsonl"
main s2 0 600
main s3 0 60 120 180 240 300 360
touch -t 202610011200 "$proj/s3.jsonl"; touch -t 202610011300 "$proj/s2.jsonl"; touch -t 202610011400 "$proj/s1.jsonl"
run 1; expect_line "N=1: the newest with a request" "$GAP_LINE"
run 2; expect_none "N=2: the two newest with a request"
# the span names the sessions read: "last 2 sessions" (s3 now with a gap of its own)
reset; main s2 0 600; main s3 0 600
run 5; expect_line "two sessions" 'cache, last 2 sessions: 100% of main requests came 5–60 min after the previous one → a 1h cache TTL would pay off'

# ================================================================ a file over 50 MB: its last 50 MB alone
# the head's 10 min gaps are past the last 50 MB: only the tail's minute gaps are read
reset
{ main_lines() { local t; for t in "$@"; do req s1 "m$t" "$t" 25 75 0; done; }
  main_lines 0 600 1200; pad $((MB50 + 4096)); main_lines 5000 5060 5120; } >"$proj/s1.jsonl"
run 10; expect_none "big file: the head is not read"
# the tail's 10 min gaps are read (the whole file would be 40%)
reset
{ main_lines 0 60 120; pad $((MB50 + 4096)); main_lines 5000 5600 6200; } >"$proj/s1.jsonl"
run 10; expect_line "big file: the tail is read" "$GAP_LINE"
# exactly 50 MB is read whole, its first line too; one byte more and the cut first line is dropped, even where the
# cut lands on a whole JSON object (the byte before it makes the line no JSON)
reset
first=$(req s1 m1 0 25 75 0); last=$(req s1 m2 600 25 75 0)
{ printf '%s\n' "$first"; pad $((MB50 - ${#first} - ${#last} - 2)); printf '%s\n' "$last"; } >"$tmp/exact.jsonl"
[ "$(wc -c <"$tmp/exact.jsonl" | tr -d ' ')" = "$MB50" ] || fail "the 50 MB fixture is not exactly $MB50 bytes"
mv "$tmp/exact.jsonl" "$proj/s1.jsonl"
run 10; expect_line "exactly 50 MB: read whole" "$GAP_LINE"
{ printf 'x'; cat "$proj/s1.jsonl"; } >"$tmp/over.jsonl"; mv "$tmp/over.jsonl" "$proj/s1.jsonl"
run 10; expect_none "50 MB + 1 byte: the first line is cut"
# 50 MB + 1 byte with a whole first request: read from the tail, that line is cut and dropped (read whole, it would
# make the 10 min gap)
{ printf '%s\n' "$first"; pad $((MB50 - ${#first} - ${#last} - 1)); printf '%s\n' "$last"; } >"$tmp/over.jsonl"
[ "$(wc -c <"$tmp/over.jsonl" | tr -d ' ')" = "$((MB50 + 1))" ] || fail "the 50 MB + 1 fixture is not $((MB50 + 1)) bytes"
mv "$tmp/over.jsonl" "$proj/s1.jsonl"
run 10; expect_none "50 MB + 1 byte: over the bound, read from the tail"
reset

# ================================================================ the 3 s cap
# a huge project: 10 sessions of 60000 requests (about 110 MB of usage lines) take jq longer than 3 s
reset
perl -e 'for $f (1..10) { open F, ">", "$ARGV[0]/s$f.jsonl" or die; for $i (1..60000) {
  printf F "{\"type\":\"assistant\",\"sessionId\":\"s%d\",\"timestamp\":\"2026-10-01T%02d:%02d:%02d.123Z\",\"message\":{\"id\":\"m%d_%d\",\"usage\":{\"input_tokens\":1,\"cache_read_input_tokens\":100,\"cache_creation_input_tokens\":5}}}\n",
    $f, int($i / 3600), int($i / 60) % 60, $i % 60, $f, $i } close F }' "$proj"
t0=$(now); run 10; t1=$(now)
[ "$rc" = 142 ] && [ -z "$out" ] || fail "huge project: expected the cap (exit 142, nothing), got $rc '$out'"
perl -e 'exit($ARGV[1] - $ARGV[0] < 20 ? 0 : 1)' "$t0" "$t1" || fail "huge project: took $t0 -> $t1, over 3 s plus start-up (a ceiling of 20 s: a loaded machine is slow to start and to kill)"
reset

# the cap kills the whole group: a jq that sleeps is gone after it (its pid written where the test reads it)
mkdir -p "$tmp/slowjq"
printf '#!/bin/sh\necho $$ >"%s"\nexec sleep 30\n' "$tmp/jq.pid" >"$tmp/slowjq/jq"; chmod +x "$tmp/slowjq/jq"
main s1 0 600
rm -f "$tmp/jq.pid"
t0=$(now); rc=0; out=$(PATH="$tmp/slowjq:$PATH" "$script" 10 "$proj") || rc=$?; t1=$(now)
[ "$rc" = 142 ] && [ -z "$out" ] || fail "slow jq: expected exit 142 and nothing, got $rc '$out'"
perl -e 'exit($ARGV[1] - $ARGV[0] < 20 ? 0 : 1)' "$t0" "$t1" || fail "slow jq: took $t0 -> $t1"
[ -s "$tmp/jq.pid" ] || fail "slow jq: the fake jq never ran"
gone "$(cat "$tmp/jq.pid")" || fail "slow jq: the jq the cap should have killed still runs"

# a TERM to the script (the module's own timeout) kills the group too, at once
rm -f "$tmp/jq.pid"
t0=$(now)
PATH="$tmp/slowjq:$PATH" "$script" 10 "$proj" >"$tmp/term.out" &
pid=$!
for _ in $(seq 400); do [ -s "$tmp/jq.pid" ] && break; sleep 0.05; done
[ -s "$tmp/jq.pid" ] || fail "TERM: the fake jq never ran"
kill -TERM "$pid"
rc=0; wait "$pid" || rc=$?; t1=$(now)
[ "$rc" = 142 ] && [ ! -s "$tmp/term.out" ] || fail "TERM: expected exit 142 and nothing, got $rc '$(cat "$tmp/term.out")'"
perl -e 'exit($ARGV[1] - $ARGV[0] < 10 ? 0 : 1)' "$t0" "$t1" || fail "TERM: the script outlived the TERM ($t0 -> $t1)"
gone "$(cat "$tmp/jq.pid")" || fail "TERM: the jq of the killed group still runs"

echo "cache-check tests passed"
