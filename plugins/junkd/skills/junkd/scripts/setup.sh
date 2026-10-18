#!/usr/bin/env bash
# SessionStart hook, main session only: once per plugin version, make `junkd:STE` (output-styles/STE.md, which
# Claude Code names <plugin>:<name>) the output style of a person who never chose one. The user settings.json
# (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json) gets `"outputStyle": "junkd:STE"` only while it has no
# `outputStyle` key at all; a key with any value stays. A missing or empty file is {}, as Claude Code reads it;
# one that does not parse, or is not a JSON object, is never written.
# The run is stamped under ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/ (one file per plugin version) once the key
# is there, set or found, so each version looks once. No stamp while the step is off or while settings.json is
# refused: the step applies once that changes. Off is the `output_style` setting at `off`, read from settings.json
# itself (pluginConfigs["junkd@<marketplace>"].options.output_style: a shell hook reads no plugin setting, and this
# hook runs before the hooks module does at a session start) or the flag file .../junkd/output-style-off the
# hooks module mirrors the setting into (the row's truth between session starts).
# Never into a subagent: skipped when CLAUDE_AGENT_ID is set or the hook input carries an agent_id. Skipped on a
# /clear or compaction too: that session runs with the plugin version it started with and would stamp an old one.
# Output: one `junkd: ...` line when the key was set, nothing otherwise. Always exits 0: a failing SessionStart
# hook would block the session.
set -u
# Hooks get no login-shell PATH when Claude Code is launched from the app: the usual dirs are added where PATH
# lacks them. JUNKD_SETUP_PATH_DIRS replaces that list (tests/junkd.sh sets it empty to run without jq).
IFS=: read -ra dirs <<<"${JUNKD_SETUP_PATH_DIRS-/opt/homebrew/bin:/usr/local/bin:${HOME:-}/.local/bin}"
for dir in ${dirs[@]+"${dirs[@]}"}; do # an empty list is unbound under set -u in bash 3.2
    case ":${PATH:-}:" in *":$dir:"*) ;; *) PATH="${PATH:-}${PATH:+:}$dir" ;; esac
done

input=""
[ -t 0 ] || input=$(cat)

[ -z "${CLAUDE_AGENT_ID:-}" ] || exit 0
# Matched as text, not with jq: jq may be missing, and a failed jq would let a subagent through.
re='"agent_id"[[:space:]]*:[[:space:]]*"'
[[ "$input" =~ $re ]] && exit 0
re='"source"[[:space:]]*:[[:space:]]*"(clear|compact)"'
[[ "$input" =~ $re ]] && exit 0

cfg="${CLAUDE_CONFIG_DIR:-${HOME:+$HOME/.claude}}"
[ -n "$cfg" ] || exit 0
[ ! -e "$cfg/junkd/output-style-off" ] || exit 0

# cd -P: this script is reached through the plugin-root symlink scripts -> skills/junkd/scripts, and the manifest
# sits beside the plugin root, not the skill.
root="$(cd -P "$(dirname "$0")" && cd ../../.. && pwd)"
manifest="$root/.claude-plugin/plugin.json"
# The manifest and the settings file are read and written with jq only: without it, nothing is touched and
# nothing is stamped. A manifest that does not parse, or has no version, stamps nothing either.
command -v jq >/dev/null 2>&1 || exit 0
ver=$(jq -r '.version // empty' "$manifest" 2>/dev/null) || exit 0
[ -n "$ver" ] || exit 0
stamp="$cfg/junkd/setup-$ver.stamp"
[ ! -e "$stamp" ] || exit 0

s="$cfg/settings.json"
if [ ! -s "$s" ]; then
    mkdir -p "$cfg" 2>/dev/null && printf '{}\n' > "$s" 2>/dev/null || exit 0
fi
jq -e 'type == "object"' "$s" >/dev/null 2>&1 || exit 0
# The setting itself, as Claude Code stores it: off under any marketplace's junkd entry skips, no stamp.
jq -e '[.pluginConfigs? // {} | to_entries[] | select(.key | startswith("junkd@")) | .value.options?.output_style] | index("off") == null' \
    "$s" >/dev/null 2>&1 || exit 0
if jq -e 'has("outputStyle")' "$s" >/dev/null 2>&1; then
    { mkdir -p "$cfg/junkd" && : > "$stamp"; } 2>/dev/null
    exit 0
fi

# Temp + mv beside the real file, so Claude Code never reads a half-written settings.json; through a symlink.
# jq keeps the key order and writes 2-space indent, Claude Code's own format.
real=$(readlink -f "$s" 2>/dev/null) || real="$s"
tmp=$(mktemp "$real.XXXXXX" 2>/dev/null) || exit 0
cp -p "$real" "$tmp" 2>/dev/null # the file's mode: a read-only settings.json fails the write below and stays
# The group's redirect also hides bash's own note on a redirect into a file it cannot write.
if { jq '.outputStyle = "junkd:STE"' "$real" > "$tmp" && mv -f "$tmp" "$real"; } 2>/dev/null; then
    { mkdir -p "$cfg/junkd" && : > "$stamp"; } 2>/dev/null
    echo "junkd: outputStyle set to junkd:STE in $s (new sessions; /output-style picks another)"
else
    rm -f "$tmp"
fi
exit 0
