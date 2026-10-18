#!/usr/bin/env bash
# SessionStart hook: prints the orchestrator rule sheet (ORCHESTRATOR.md next to this script's
# skill dir) so it lands in the MAIN session's context. Plain stdout becomes context.
# Never into a subagent: skipped when CLAUDE_AGENT_ID is set or the hook input carries an
# agent_id. Off entirely with ORCH_INJECT_RULES=0, or when the inject_rules setting is off. The
# setting is read from ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json itself
# (pluginConfigs["orch@<marketplace>"].options.inject_rules, the first orch@ entry: a shell hook
# reads no plugin setting, and this hook runs before the hooks module does at a session start):
# true injects, any other value skips. Only when it is not there (or jq is missing, or the file
# does not parse) the flag file .../orch/rules-off decides, which the hooks module writes while
# the setting is off. Always exits 0: a hook failure would block the session for a sheet of advice.
set -u

input=""
[ -t 0 ] || input=$(cat)

[ -z "${CLAUDE_AGENT_ID:-}" ] || exit 0
# Matched as text, not with jq: jq may be missing, and a failed jq would let a subagent through.
re='"agent_id"[[:space:]]*:[[:space:]]*"'
[[ "$input" =~ $re ]] && exit 0

[ "${ORCH_INJECT_RULES:-1}" != 0 ] || exit 0
cfg="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"
setting=$(jq -rs '(if length == 1 then .[0] else error end).pluginConfigs
    | [to_entries[] | select(.key | startswith("orch@"))][0].value.options
    | if has("inject_rules") then .inject_rules == true else "unset" end' \
    "$cfg/settings.json" 2>/dev/null) || setting=unset
case "$setting" in
    true) ;;
    false) exit 0 ;;
    *) [ ! -f "$cfg/orch/rules-off" ] || exit 0 ;;   # a file only: a directory of that name is no flag
esac

# cd -P: this script is reached through the plugin-root symlink scripts -> skills/orch/scripts,
# and the sheet sits next to the REAL scripts dir, not the symlink.
sheet="$(cd -P "$(dirname "$0")" && cd .. && pwd)/ORCHESTRATOR.md"
[ -f "$sheet" ] && cat "$sheet"
exit 0
