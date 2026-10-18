#!/usr/bin/env bash
# SessionStart hook: prints the orchestrator rule sheet (ORCHESTRATOR.md next to this script's
# skill dir) so it lands in the MAIN session's context. Plain stdout becomes context.
# Never into a subagent: skipped when CLAUDE_AGENT_ID is set or the hook input carries an
# agent_id. Off entirely with ORCH_INJECT_RULES=0. Always exits 0: a hook failure would block
# the session for a sheet of advice.
set -u

input=""
[ -t 0 ] || input=$(cat)

[ -z "${CLAUDE_AGENT_ID:-}" ] || exit 0
# Matched as text, not with jq: jq may be missing, and a failed jq would let a subagent through.
re='"agent_id"[[:space:]]*:[[:space:]]*"'
[[ "$input" =~ $re ]] && exit 0

[ "${ORCH_INJECT_RULES:-1}" != 0 ] || exit 0

# cd -P: this script is reached through the plugin-root symlink scripts -> skills/orch/scripts,
# and the sheet sits next to the REAL scripts dir, not the symlink.
sheet="$(cd -P "$(dirname "$0")" && cd .. && pwd)/ORCHESTRATOR.md"
[ -f "$sheet" ] && cat "$sheet"
exit 0
