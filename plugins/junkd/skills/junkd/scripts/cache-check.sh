#!/usr/bin/env bash
# Prompt-cache health of one project, run by junkd's hooks module (hooks/cache.tsx) at every main session start but
# a compaction. It reads the newest N main transcripts in <project folder> (<config dir>/projects/<slug>) that hold
# a request, and their subagents' transcripts, from their usage lines alone. It prints one suggestion line when a
# threshold is hit, else nothing, and nothing after 3 s. A failure exits non-zero; the module logs it to debug.
# - hit ratio, main and subagents: cache_read / (cache_read + cache_creation + input), one count per message id.
# - subagent hit under 60% over at least 50 subagent requests: reuse agents. Below 50 requests, the first request of
#   each agent (nearly all cache write) pulls the ratio down by itself.
# - gap share: the main requests 5-60 min (more than 300 s, at most 3600 s) after the previous one of the same
#   session, of all main requests after one on the 5m TTL (a request that wrote 1h cache has the long TTL already).
#   Over 30%: a 1h TTL would pay. A 1h TTL helps within the hour only.
# Usage: cache-check.sh <N> <project folder>       N = 0, a missing folder or no jq: nothing, exit 0.
#
# Hooks get no login-shell PATH when Claude Code is launched from the app: the usual dirs are added at the end of
# PATH where it lacks them. JUNKD_CACHE_PATH_DIRS replaces that list (tests/cache-check.sh sets it empty to run
# without jq).
IFS=: read -ra dirs <<<"${JUNKD_CACHE_PATH_DIRS-/opt/homebrew/bin:/usr/local/bin:${HOME:-}/.local/bin}"
for d in ${dirs[@]+"${dirs[@]}"}; do
  case ":${PATH:-}:" in *":$d:"*) ;; *) PATH="${PATH:-}${PATH:+:}$d" ;; esac
done

# The 3 s cap, with perl's alarm (macOS has no timeout(1)): the script runs itself again in a process group of its
# own, which the alarm kills whole, jq and grep included (exit 142). A TERM, INT or HUP to the script (the module's
# own timeout) kills the group too: a kill of the caller's group does not reach it. The line is printed at the very
# end, so a killed run prints nothing.
[[ ${1-} == --capped ]] && shift ||
  exec perl -e '$p = fork // exit 1; if (!$p) { setpgrp; exec @ARGV }
    $SIG{$_} = sub { kill KILL => -$p; exit 142 } for qw(ALRM TERM INT HUP);
    alarm 3; waitpid $p, 0; exit $? >> 8' "$0" --capped "$@"
n=${1-} dir=${2-}
[[ $n =~ ^[0-9]+$ && $n -gt 0 && -d $dir ]] || exit 0
command -v jq >/dev/null 2>&1 || exit 0

# The newest N with a request: the current session's file has none yet.
all=()
while IFS= read -r f; do all+=("$f"); done < <(ls -t -- "$dir"/*.jsonl 2>/dev/null)
((${#all[@]})) || exit 0
files=()
mains=0
while IFS= read -r f; do
  files+=("$f")
  for a in "${f%.jsonl}"/subagents/agent-*.jsonl; do [[ -f $a ]] && files+=("$a"); done
  ((++mains))
done < <(grep -l '"usage"' "${all[@]}" | head -n "$n")
((mains)) || exit 0

# Their usage lines: one grep over them all, but a file over 50 MB is read from its last 50 MB alone, from the first
# whole line on. A process per file would cost more than the grep itself.
big=$(find "${files[@]}" -size +51200k)
usage_lines() {
  local f small=()
  for f in "${files[@]}"; do [[ $'\n'$big$'\n' == *$'\n'"$f"$'\n'* ]] || small+=("$f"); done
  ((${#small[@]})) && grep -h '"usage"' "${small[@]}"
  while IFS= read -r f; do [[ -n $f ]] && tail -c 52428800 "$f" | LC_ALL=C sed 1d | grep '"usage"'; done <<<"$big"
}

# Raw lines: one that does not parse (a session still writing it) or has an odd timestamp is passed over.
line=$(usage_lines | jq -nrR --arg n "$mains" '
  def ratio: (map(.r) | add // 0) as $r | (map(.r + .c + .i) | add // 0) as $all | if $all > 0 then $r / $all else null end;
  def pct: "\(. * 100 | floor)%";
  # Streaming writes one line per content block, each with the same message id and usage: the first one counts.
  (reduce (inputs | fromjson? | objects | select(.type == "assistant" and (.message.usage? | type) == "object")
      | .t = (try (.timestamp | sub("\\.[0-9]+"; "") | fromdateiso8601) catch null) | select(.t != null)) as $l ({};
    ($l.message.id // $l.requestId // $l.uuid // "") as $k
    | if has($k) then . else .[$k] = ($l | .message.usage as $u | {
        a: .agentId, s: .sessionId, t,
        i: ($u.input_tokens // 0), r: ($u.cache_read_input_tokens // 0), c: ($u.cache_creation_input_tokens // 0),
        h: ($u.cache_creation.ephemeral_1h_input_tokens // 0)}) end)
  | [.[]]) as $all
  | ($all | map(select(.a == null))) as $main
  | ($all | map(select(.a != null))) as $sub
  | ([$main | group_by(.s)[] | sort_by(.t) | . as $q | range(1; length) | select($q[. - 1].h == 0) | $q[.].t - $q[. - 1].t]) as $gaps
  | (if ($gaps | length) > 0 then ($gaps | map(select(. > 300 and . <= 3600)) | length) / ($gaps | length) else null end) as $gap
  | (if $n == "1" then "last session" else "last \($n) sessions" end) as $span
  | if ($sub | length) >= 50 and ($sub | ratio) < 0.6 then
      "cache, \($span): subagent hit \($sub | ratio | pct), main \($main | ratio // 0 | pct) → reuse implementers via SendMessage instead of spawning new ones"
    elif $gap != null and $gap > 0.3 then
      "cache, \($span): \($gap | pct) of main requests came 5–60 min after the previous one → a 1h cache TTL would pay off"
    else empty end') || exit 1
[[ -n $line ]] && printf '%s\n' "$line"
exit 0
