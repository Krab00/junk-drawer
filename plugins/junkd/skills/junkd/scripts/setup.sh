#!/usr/bin/env bash
# SessionStart hook, main session only: once per plugin version, make `junkd:STE` (output-styles/STE.md, which
# Claude Code names <plugin>:<name>) the output style of a person who never chose one. The user settings.json
# (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json) gets `"outputStyle": "junkd:STE"` only while it has no
# `outputStyle` key at all; a key with any value stays. A missing or empty file is {}, as Claude Code reads it;
# one that does not parse, or is not a JSON object, is never written.
# The run is stamped under ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/ (one file per plugin version) once the key
# is there, set or found, so each version looks once. No stamp while the step is off or while settings.json is
# refused: the step applies once that changes. Off is the `core_output_style` setting at `off`, read from
# settings.json itself (the first pluginConfigs entry whose key starts with `junkd@`, its
# options.core_output_style: a shell hook reads no plugin setting, and this hook runs before the hooks module does
# at a session start), which wins whenever it names a value; only where it names none, the flag file
# .../junkd/output-style-off the hooks module mirrors the setting into.
# Never into a subagent: skipped when CLAUDE_AGENT_ID is set or the hook input carries an agent_id. Skipped on a
# /clear or compaction too: that session runs with the plugin version it started with and would stamp an old one.
# Also the CLAUDE.md pointer block step (orch_claude_md), see below. Output: one `junkd: ...` line when the key was
# set, and one when CLAUDE.md changed or was refused; nothing otherwise. Always exits 0: a failing SessionStart
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

# cd -P: this script is reached through the plugin-root symlink scripts -> skills/junkd/scripts, and the manifest
# sits beside the plugin root, not the skill.
root="$(cd -P "$(dirname "$0")" && cd ../../.. && pwd)"
manifest="$root/.claude-plugin/plugin.json"
# The manifest and the settings file are read and written with jq only: without it, nothing is touched and
# nothing is stamped. A manifest that does not parse, or has no version, stamps nothing either.
command -v jq >/dev/null 2>&1 || exit 0

# The CLAUDE.md pointer block (orch_claude_md, off by default), every session start, before the stamp below:
# skills/orch/scripts/orch-claude-md.sh on while the setting is true, off otherwise (no block: nothing happens).
# Read from settings.json as the style step reads its own (the first junkd@ entry's options). Not run while orch is
# disabled: orch_enabled false there, or, where the entry names no orch_enabled, the flag file .../junkd/orch-off
# (a file only). Not run either while settings.json is missing, empty or not an object. Its `updated` line, or the
# reason it refused, becomes one `junkd: ...` line.
claude_md=$(jq -r '[(.pluginConfigs // {}) | to_entries[] | select(.key | startswith("junkd@"))][0].value.options // {}
    | def sw($k): if has($k) then .[$k] == true else "unset" end;
      "\(sw("orch_enabled")) \(sw("orch_claude_md"))"' "$cfg/settings.json" 2>/dev/null) || claude_md=""
case "${claude_md%% *}" in
    true) ;;
    false) claude_md="" ;;
    *) [ ! -f "$cfg/junkd/orch-off" ] || claude_md="" ;;
esac
if [ -n "$claude_md" ]; then
    mode=off
    [ "${claude_md##* }" != true ] || mode=on
    if out=$("$root/skills/orch/scripts/orch-claude-md.sh" "$mode" 2>&1); then
        while IFS= read -r line; do
            case "$line" in "updated "*) echo "junkd: $line" ;; esac
        done <<<"$out"
    else
        echo "junkd: ${out##*$'\n'}"
    fi
fi

ver=$(jq -r '.version // empty' "$manifest" 2>/dev/null) || exit 0
[ -n "$ver" ] || exit 0
stamp="$cfg/junkd/setup-$ver.stamp"
[ ! -e "$stamp" ] || exit 0

s="$cfg/settings.json"
# The setting itself, as Claude Code stores it, is the truth: the first junkd@<marketplace> entry decides (another
# plugin's entry, or a later junkd@ one, never does); off there skips (no stamp), any other value applies (the
# module reads a value the options do not name as the default, ste). The flag file stands in only where that entry
# names no core_output_style.
style=$(jq -r '[.pluginConfigs? // {} | to_entries[] | select(.key | startswith("junkd@"))][0].value.options?.core_output_style
    // empty | if . == "off" then "off" else "ste" end' "$s" 2>/dev/null) || style=""
case "$style" in
    off) exit 0 ;;
    "") [ ! -e "$cfg/junkd/output-style-off" ] || exit 0 ;;
esac
if [ ! -s "$s" ]; then
    mkdir -p "$cfg" 2>/dev/null && printf '{}\n' > "$s" 2>/dev/null || exit 0
fi
jq -e 'type == "object"' "$s" >/dev/null 2>&1 || exit 0
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
