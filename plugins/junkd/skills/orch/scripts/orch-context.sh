#!/usr/bin/env bash
# SessionStart hook: prints the orchestrator rule sheet (ORCHESTRATOR.md in this script's skill dir,
# skills/orch/) so it lands in the MAIN session's context. Plain stdout becomes context.
# Never into a subagent: skipped when CLAUDE_AGENT_ID is set or the hook input carries an
# agent_id. Off entirely with ORCH_INJECT_RULES=0, or when the orch_enabled or the orch_inject_rules
# setting is off. The settings are read from ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json
# itself (pluginConfigs["junkd@<marketplace>"].options.orch_enabled / .orch_inject_rules, the
# jd-rule entry: a shell hook reads no plugin setting, and this hook runs before the hooks
# module does at a session start): true goes on, any other value skips. Only for a setting that is
# not there (or when jq is missing, or the file does not parse) its flag file decides, which the
# hooks module writes while the setting is off: .../junkd/orch-off (orch_enabled) and
# .../junkd/orch-rules-off (orch_inject_rules). After the sheet come the lessons of the repo
# (`orch-state lesson inject`: the three stores' lessons whose stack meets the repo's), unless
# orch_lessons is off (its row, else the flag file .../junkd/orch-lessons-off). Always exits 0: a
# hook failure would block the session for a sheet of advice.
set -u

input=""
[ -t 0 ] || input=$(cat)

[ -z "${CLAUDE_AGENT_ID:-}" ] || exit 0
# Matched as text, not with jq: jq may be missing, and a failed jq would let a subagent through.
re='"agent_id"[[:space:]]*:[[:space:]]*"'
[[ "$input" =~ $re ]] && exit 0

[ "${ORCH_INJECT_RULES:-1}" != 0 ] || exit 0
# >>> jd-rule: which pluginConfigs entry holds junkd's options. The same block is in every reader of settings.json
# (tests/smoke.sh keeps the copies identical). junkd@<marketplace> when this copy runs from
# plugins/cache/<marketplace>/junkd/<version>/ and settings.json has that entry. Else the options of all junkd@*
# entries merged: junkd@inline lowest, the others in file order, a later one over an earlier one (one entry alone is
# read as it is). jd_opts takes .pluginConfigs. jd_warn <file> [key] prints one line to stderr when the file has more
# than one junkd@* entry (never to stdout: callers parse it).
jd_mk="" jd_d=. jd_p=""
case "$0" in */*) jd_d=${0%/*} ;; esac
for jd_p in "$(cd "$jd_d" 2>/dev/null && pwd -L)" "$(cd "$jd_d" 2>/dev/null && pwd -P)"; do
    case "$jd_p/" in */plugins/cache/*/junkd/*) jd_mk=${jd_p#*/plugins/cache/}; jd_mk=${jd_mk%%/*}; break ;; esac
done
jd_rule='def jd_opts($mk): [to_entries[] | select(.key | startswith("junkd@"))] as $e
  | if $mk != "" and any($e[]; .key == "junkd@" + $mk) then .["junkd@" + $mk].options
    elif ($e | length) < 2 then $e[0].value.options
    else [($e[] | select(.key == "junkd@inline")), ($e[] | select(.key != "junkd@inline"))]
      | reduce .[] as $x ({}; . * (($x.value | objects | .options | objects) // {})) end;
def jd_note($mk; $key): ((.pluginConfigs? | objects) // {}) | [keys_unsorted[] | select(startswith("junkd@"))] as $k
  | select(($k | length) > 1)
  | "junkd: \($k | length) junkd@* entries in settings.json (\($k | join(", "))); using \(if $key != "" then $key
      elif $mk != "" and any($k[]; . == "junkd@" + $mk) then "junkd@" + $mk else "merged" end)";
'
jd_warn() {
    local w
    w=$(jq -r --arg mk "$jd_mk" --arg key "${2:-}" "$jd_rule jd_note(\$mk; \$key)" "$1" 2>/dev/null) || return 0
    case "$w" in "junkd: "*) printf '%s\n' "$w" >&2 ;; esac
}
# <<< jd-rule

cfg="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"
# "<orch_enabled> <orch_inject_rules> <orch_lessons>", each true, false or unset.
jd_warn "$cfg/settings.json"
settings=$(jq -rs --arg mk "$jd_mk" "$jd_rule"'(if length == 1 then .[0] else error end).pluginConfigs
    | jd_opts($mk)
    | def sw($k): if has($k) then .[$k] == true else "unset" end;
      "\(sw("orch_enabled")) \(sw("orch_inject_rules")) \(sw("orch_lessons"))"' \
    "$cfg/settings.json" 2>/dev/null) || settings="unset unset unset"
read -r s_enabled s_rules s_lessons _ <<<"$settings"
# on <setting> <flag>: whether the switch is on; a file only is a flag (a directory of that name is none)
on() {
    case "$1" in
        true) return 0 ;;
        false) return 1 ;;
        *) [ ! -f "$2" ] ;;
    esac
}
on "${s_enabled:-unset}" "$cfg/junkd/orch-off" || exit 0
on "${s_rules:-unset}" "$cfg/junkd/orch-rules-off" || exit 0

# The sheet sits beside the REAL scripts dir, skills/orch/scripts. This file is reached through links
# (plugins/junkd/scripts -> skills/junkd/scripts, whose orch-context.sh -> ../../orch/scripts/orch-context.sh),
# so the file link is followed, not only the folder's (cd -P on dirname alone stops in skills/junkd/scripts).
src=$0
while [ -L "$src" ]; do
    dir=$(cd -P "$(dirname "$src")" && pwd) || break
    to=$(readlink "$src") || break
    case "$to" in /*) src=$to ;; *) src="$dir/$to" ;; esac
done
sheet="$(cd -P "$(dirname "$src")" && cd .. && pwd)/ORCHESTRATOR.md"
[ -f "$sheet" ] && cat "$sheet"
if on "${s_lessons:-unset}" "$cfg/junkd/orch-lessons-off"; then
    lessons=$("$(dirname "$sheet")/bin/orch-state" lesson inject 2>/dev/null) || true
    [ -z "$lessons" ] || printf '\n%s\n' "$lessons"
fi
exit 0
