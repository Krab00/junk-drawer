#!/usr/bin/env bash
# SessionStart hook: prints the orchestrator rule sheet (ORCHESTRATOR.md in this script's skill dir,
# skills/orch/) so it lands in the MAIN session's context. Plain stdout becomes context.
# Never into a subagent: skipped when CLAUDE_AGENT_ID is set or the hook input carries an
# agent_id. Off entirely with ORCH_INJECT_RULES=0, or when the orch_enabled or the orch_inject_rules
# setting is off. The settings are read from ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json
# itself (pluginConfigs["junkd@<marketplace>"].options.orch_enabled / .orch_inject_rules, the
# first junkd@ entry: a shell hook reads no plugin setting, and this hook runs before the hooks
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
cfg="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"
# "<orch_enabled> <orch_inject_rules> <orch_lessons>", each true, false or unset.
settings=$(jq -rs '(if length == 1 then .[0] else error end).pluginConfigs
    | [to_entries[] | select(.key | startswith("junkd@"))][0].value.options
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
