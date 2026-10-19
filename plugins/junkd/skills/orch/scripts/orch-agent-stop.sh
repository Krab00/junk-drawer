#!/usr/bin/env bash
# SubagentStop hook: the stopped agent's record for the orch guard's SendMessage rule (hooks/orch.tsx): its type
# and the tokens of its context, which is the input + cache-write + cache-read tokens of the last usage record in
# its transcript (the last iteration when that request ran server tools: the top level then sums the iterations).
# Writes ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/orch/_agents/<session_id>/<agent_id>.json, and <name>.json too
# for a named agent (the name from the .meta.json beside its transcript), as {"type":...,"tokens":...}. The hooks
# module reads that path, so the context cap holds after a /reload-plugins. Ids and names outside
# [A-Za-z0-9_-] are ignored: never a path. The records are never pruned (about 50 bytes each).
# Off when the orch_enabled setting holds anything but true, or orch_guard is off, read from settings.json
# (pluginConfigs["junkd@<marketplace>"].options, the first junkd@ entry: a shell hook reads no plugin setting); no
# file, no entry or no key = on. Always exits 0: a failed record only leaves the cap unknown.
set -u

cfg="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}"
# "<enabled> <guard>": enabled is false only for a key that holds anything but true; guard is off only for "off"
# (trimmed, any case, as the module reads it).
gate=$(jq -rs '(if length == 1 then .[0] else error end).pluginConfigs // {}
    | [to_entries[] | select(.key | startswith("junkd@"))][0].value.options // {}
    | "\(if has("orch_enabled") then .orch_enabled == true else true end) \(.orch_guard | tostring | ascii_downcase | gsub("^\\s+|\\s+$"; ""))"' \
    "$cfg/settings.json" 2>/dev/null) || gate="true on"
[ "${gate%% *}" = true ] || exit 0
[ "${gate#* }" != off ] || exit 0

input=$(cat)
# field <key> [plain]: a string field of the input; with `plain`, only when it is a plain id. Tested in jq, not only
# after $(...), which drops a trailing newline ("a1\n" would pass as a1); by its other characters, as jq's `$` also
# matches before a final newline.
plain='^[A-Za-z0-9_-]+$'
isplain='length > 0 and (test("[^A-Za-z0-9_-]") | not)'
field() { jq -r --arg k "$1" --arg p "${2:-}" ".[\$k] | strings | select(\$p == \"\" or ($isplain))" <<<"$input" 2>/dev/null; }
sid=$(field session_id plain)
id=$(field agent_id plain)
transcript=$(field agent_transcript_path)
[[ "$sid" =~ $plain && "$id" =~ $plain ]] || exit 0

# Each line on its own (fromjson?): a line that does not parse is skipped, not the end of the stream.
tokens=$(grep -F '"usage"' "$transcript" 2>/dev/null |
    jq -cR 'fromjson? | .message.usage? | objects' 2>/dev/null | tail -n1 |
    jq '(if (.iterations | type) == "array" and (.iterations | length) > 0 then .iterations[-1] else . end)
        | def n($k): (.[$k]? | numbers) // 0; n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens")' 2>/dev/null)
[[ "$tokens" =~ ^[0-9]+$ ]] || tokens=null
record=$(jq -nc --arg type "$(field agent_type)" --argjson tokens "$tokens" '{type: $type, tokens: $tokens}') || exit 0

dir="$cfg/junkd/orch/_agents/$sid"
mkdir -p "$dir" 2>/dev/null || exit 0
printf '%s\n' "$record" >"$dir/$id.json" 2>/dev/null || exit 0
name=$(jq -r ".name | strings | select($isplain)" "${transcript%.jsonl}.meta.json" 2>/dev/null)
if [[ "$name" =~ $plain ]]; then printf '%s\n' "$record" >"$dir/$name.json" 2>/dev/null; fi
exit 0
