#!/usr/bin/env bash
# tldr shell-side tests: bin/tldr-flag (on/off/status, each host's flag home) and bin/tldr-hook (the tldr_enabled
# gate read from settings.json, the tldr-off flag beside it, terse mode's tldr-on flag) over temp dirs, never the
# real ~/.claude. Both run as the hooks reach them: plugins/junkd/bin/<x> -> skills/junkd/bin/<x> -> skills/tldr/bin.
# Run: bash tests/tldr.sh. Every check is an explicit `if`/`[ ]` so `set -e` catches it.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/junkd"
flagbin="$plugin/bin/tldr-flag"
hookbin="$plugin/bin/tldr-hook"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cfg="$tmp/cfg"
settings="$cfg/settings.json"
on="$cfg/junkd/tldr-on"
off="$cfg/junkd/tldr-off"
TERSE='TL;DR MODE ON'

fail() { echo "tldr tests: $*" >&2; exit 1; }
# Claude Code: no other host's marker in the environment; stderr is stdout here, so any noise fails a check.
claude() { env -u KIMI_PLUGIN_ROOT -u PLUGIN_ROOT -u JUNK_DRAWER_RUNTIME CLAUDE_CONFIG_DIR="$cfg" "$@" 2>&1; }
hook() { claude "$hookbin"; }
reset() { rm -rf "$cfg"; mkdir -p "$cfg"; }
# settings.json with one pluginConfigs object (raw JSON); none when empty.
cfgjson() { if [ -n "$1" ]; then printf '{"theme": "dark", "pluginConfigs": %s}\n' "$1" > "$settings"; fi; }
enabled_is() { printf '{"junkd@junk-drawer": {"options": {"tldr_enabled": %s}}}' "$1"; }
# The hook's answer must be the terse line (want=terse) or nothing (want=silent).
expect() {
    local want=$1 what=$2 out
    out=$(hook) || fail "$what: hook exited non-zero"
    if [ "$want" = terse ]; then
        [ "$(wc -l <<<"$out" | tr -d ' ')" = 1 ] && rg -qF "$TERSE" <<<"$out" || fail "$what: expected the terse line, got: $out"
    else
        [ -z "$out" ] || fail "$what: expected silence, got: $out"
    fi
}

# ---------------------------------------------------------------- the links reach the real scripts
for x in tldr-flag tldr-hook; do
    [ -L "$plugin/skills/junkd/bin/$x" ] || fail "skills/junkd/bin/$x is not a link"
    [ -f "$plugin/skills/tldr/bin/$x" ] && [ -x "$plugin/skills/tldr/bin/$x" ] || fail "skills/tldr/bin/$x is not an executable file"
    [ "$(readlink -f "$plugin/bin/$x")" = "$(readlink -f "$plugin/skills/tldr/bin/$x")" ] ||
        fail "plugins/junkd/bin/$x does not resolve to skills/tldr/bin/$x"
done

# ---------------------------------------------------------------- tldr-flag on Claude Code: $CFG/junkd/tldr-on
rm -rf "$cfg"   # no config dir at all: tldr-flag makes $CFG/junkd
out=$(claude "$flagbin" status) || fail "status: exited non-zero"
[ "$out" = "TL;DR mode: OFF" ] || fail "status with no flag: got $out"
out=$(claude "$flagbin") || fail "no argument: exited non-zero"
[ "$out" = "TL;DR mode: OFF" ] || fail "no argument is status: got $out"
out=$(claude "$flagbin" on) || fail "on: exited non-zero"
rg -q '^TL;DR mode ON' <<<"$out" || fail "on: got $out"
[ -f "$on" ] || fail "on: no flag at \$CLAUDE_CONFIG_DIR/junkd/tldr-on"
[ ! -e "$cfg/tldr-on" ] || fail "on: the old flag path \$CLAUDE_CONFIG_DIR/tldr-on was written"
[ "$(claude "$flagbin" status)" = "TL;DR mode: ON" ] || fail "status after on is not ON"
out=$(claude "$flagbin" on) || fail "on twice: exited non-zero"
[ -f "$on" ] || fail "on twice: the flag is gone"
out=$(claude "$flagbin" off) || fail "off: exited non-zero"
[ "$out" = "TL;DR mode OFF." ] || fail "off: got $out"
[ ! -e "$on" ] || fail "off: the flag is still there"
[ "$(claude "$flagbin" status)" = "TL;DR mode: OFF" ] || fail "status after off is not OFF"
out=$(claude "$flagbin" off) || fail "off with no flag: exited non-zero"
# a flag left at the old path is not terse mode any more
reset
: > "$cfg/tldr-on"
[ "$(claude "$flagbin" status)" = "TL;DR mode: OFF" ] || fail "the old path \$CFG/tldr-on still reads as ON"
# no CLAUDE_CONFIG_DIR: $HOME/.claude/junkd/tldr-on
out=$(env -u KIMI_PLUGIN_ROOT -u PLUGIN_ROOT -u JUNK_DRAWER_RUNTIME -u CLAUDE_CONFIG_DIR HOME="$tmp/home" "$flagbin" on) || fail "HOME on: exited non-zero"
[ -f "$tmp/home/.claude/junkd/tldr-on" ] || fail "HOME on: no flag at \$HOME/.claude/junkd/tldr-on"
out=$(env -u KIMI_PLUGIN_ROOT -u PLUGIN_ROOT -u JUNK_DRAWER_RUNTIME -u CLAUDE_CONFIG_DIR HOME="$tmp/home" "$hookbin") || fail "HOME hook: exited non-zero"
rg -qF "$TERSE" <<<"$out" || fail "HOME hook: the flag under \$HOME/.claude/junkd is not read, got: $out"

# ---------------------------------------------------------------- tldr-flag and tldr-hook on Codex and Kimi: their own homes, unchanged
reset
out=$(env -u KIMI_PLUGIN_ROOT -u PLUGIN_ROOT CODEX_HOME="$tmp/codex" CLAUDE_CONFIG_DIR="$cfg" JUNK_DRAWER_RUNTIME=codex "$flagbin" on) || fail "codex on: exited non-zero"
[ -f "$tmp/codex/junk-drawer/tldr-on" ] || fail "codex on: no flag at \$CODEX_HOME/junk-drawer/tldr-on"
[ ! -e "$on" ] || fail "codex on: the Claude Code flag was written"
out=$(env -u KIMI_PLUGIN_ROOT -u JUNK_DRAWER_RUNTIME CODEX_HOME="$tmp/codex" PLUGIN_ROOT="$plugin" "$flagbin" status) || fail "codex status: exited non-zero"
[ "$out" = "TL;DR mode: ON" ] || fail "codex status (PLUGIN_ROOT): got $out"
out=$(env -u PLUGIN_ROOT -u JUNK_DRAWER_RUNTIME KIMI_CODE_HOME="$tmp/kimi" KIMI_PLUGIN_ROOT="$plugin" "$flagbin" on) || fail "kimi on: exited non-zero"
[ -f "$tmp/kimi/junk-drawer/tldr-on" ] || fail "kimi on: no flag at \$KIMI_CODE_HOME/junk-drawer/tldr-on"
out=$(env -u PLUGIN_ROOT -u KIMI_PLUGIN_ROOT KIMI_CODE_HOME="$tmp/kimi" JUNK_DRAWER_RUNTIME=kimi "$flagbin" status) || fail "kimi status: exited non-zero"
[ "$out" = "TL;DR mode: ON" ] || fail "kimi status (JUNK_DRAWER_RUNTIME): got $out"
# their hooks read only their flag: a Claude Code tldr_enabled off or tldr-off flag does not silence them
cfgjson "$(enabled_is false)"
mkdir -p "$cfg/junkd" && : > "$off"
out=$(env -u KIMI_PLUGIN_ROOT CODEX_HOME="$tmp/codex" PLUGIN_ROOT="$plugin" CLAUDE_CONFIG_DIR="$cfg" "$hookbin") || fail "codex hook: exited non-zero"
rg -qF "$TERSE" <<<"$out" || fail "codex hook: expected the terse line, got: $out"
out=$(env -u PLUGIN_ROOT KIMI_CODE_HOME="$tmp/kimi" KIMI_PLUGIN_ROOT="$plugin" CLAUDE_CONFIG_DIR="$cfg" "$hookbin") || fail "kimi hook: exited non-zero"
rg -qF "$TERSE" <<<"$out" || fail "kimi hook: expected the terse line, got: $out"
out=$(env -u PLUGIN_ROOT JUNK_DRAWER_RUNTIME=kimi KIMI_CODE_HOME="$tmp/kimi" CLAUDE_CONFIG_DIR="$cfg" "$flagbin" off) || fail "kimi off: exited non-zero"
out=$(env -u PLUGIN_ROOT KIMI_CODE_HOME="$tmp/kimi" KIMI_PLUGIN_ROOT="$plugin" CLAUDE_CONFIG_DIR="$cfg" "$hookbin") || fail "kimi hook off: exited non-zero"
[ -z "$out" ] || fail "kimi hook after off: expected silence, got: $out"
out=$(env -u KIMI_PLUGIN_ROOT JUNK_DRAWER_RUNTIME=codex CODEX_HOME="$tmp/codex" CLAUDE_CONFIG_DIR="$cfg" "$flagbin" off) || fail "codex off: exited non-zero"
[ ! -e "$tmp/codex/junk-drawer/tldr-on" ] || fail "codex off: the flag is still there"

# ---------------------------------------------------------------- tldr-hook on Claude Code: the gate matrix
# enabled (settings.json: true, false, unset) x the tldr-off flag (present, absent) x terse (tldr-on present, absent).
# Terse only while tldr-on is there and enabled is on: true wins over a tldr-off flag, false wins over its absence,
# and only an unset row leaves the flag in charge.
for enabled in true false unset; do
    for offflag in present absent; do
        for terse in on off; do
            reset
            [ "$enabled" = unset ] || cfgjson "$(enabled_is "$enabled")"
            mkdir -p "$cfg/junkd"
            [ "$offflag" = absent ] || : > "$off"
            [ "$terse" = off ] || : > "$on"
            want=silent
            if [ "$terse" = on ] && { [ "$enabled" = true ] || { [ "$enabled" = unset ] && [ "$offflag" = absent ]; }; }; then want=terse; fi
            expect "$want" "enabled=$enabled tldr-off=$offflag terse=$terse"
        done
    done
done
# every spelling the module takes: true, "true", "on" are on; any other value (false, "false", "off", 0, 1, "yes") off
for v in true '"true"' '"on"'; do
    reset; mkdir -p "$cfg/junkd"; : > "$on"; : > "$off"
    cfgjson "$(enabled_is "$v")"
    expect terse "tldr_enabled $v over a tldr-off flag"
done
for v in false '"false"' '"off"' 0 1 '"yes"' '""'; do
    reset; mkdir -p "$cfg/junkd"; : > "$on"
    cfgjson "$(enabled_is "$v")"
    expect silent "tldr_enabled $v with no tldr-off flag"
done
# null is no value: the flag decides
reset; mkdir -p "$cfg/junkd"; : > "$on"
cfgjson "$(enabled_is null)"
expect terse "tldr_enabled null, no tldr-off flag"
: > "$off"
expect silent "tldr_enabled null, a tldr-off flag"

# the first junkd@ entry decides, under any marketplace's name
reset; mkdir -p "$cfg/junkd"; : > "$on"
cfgjson '{"junkd@a": {"options": {"tldr_enabled": false}}, "junkd@b": {"options": {"tldr_enabled": true}}}'
expect silent "first junkd@ entry false, second true"
cfgjson '{"junkd@b": {"options": {"tldr_enabled": true}}, "junkd@a": {"options": {"tldr_enabled": false}}}'
expect terse "first junkd@ entry true, second false"
: > "$off"
expect terse "first junkd@ entry true wins over the tldr-off flag"
# a first junkd@ entry with no tldr_enabled is no value, even when a later one names one: the flag decides
cfgjson '{"junkd@a": {"options": {}}, "junkd@b": {"options": {"tldr_enabled": true}}}'
expect silent "first junkd@ entry unset (later true), a tldr-off flag"
rm "$off"
cfgjson '{"junkd@a": {}, "junkd@b": {"options": {"tldr_enabled": false}}}'
expect terse "first junkd@ entry without options (later false), no tldr-off flag"
# another plugin's entry, or a key that merely contains junkd@, is not junkd's: the flag decides
for other in '{"tldr@junk-drawer": {"options": {"tldr_enabled": false}}}' '{"xjunkd@m": {"options": {"tldr_enabled": false}}}' \
    '{"junkd": {"options": {"tldr_enabled": false}}}' '{"tldr@junk-drawer": {"options": {"enabled": false}}}'; do
    reset; mkdir -p "$cfg/junkd"; : > "$on"
    cfgjson "$other"
    expect terse "another entry $other, no tldr-off flag"
    : > "$off"
    expect silent "another entry $other, a tldr-off flag"
done
# another plugin's false ahead of junkd's true: junkd's decides
reset; mkdir -p "$cfg/junkd"; : > "$on"; : > "$off"
cfgjson '{"tldr@junk-drawer": {"options": {"tldr_enabled": false}}, "junkd@junk-drawer": {"options": {"tldr_enabled": true}}}'
expect terse "another plugin's false first, junkd's true"

# a settings.json that does not parse, is empty, is missing, or is not an object: the flag decides
for bad in '{"pluginConfigs": {"junkd@junk-drawer": {"options": {"tldr_enabled": false}}},' '' '[]' '"text"' \
    '{"pluginConfigs": []}' '{"pluginConfigs": {"junkd@junk-drawer": true}}' '{"pluginConfigs": {"junkd@junk-drawer": {"options": "x"}}}'; do
    reset; mkdir -p "$cfg/junkd"; : > "$on"
    printf '%s' "$bad" > "$settings"
    expect terse "settings.json '$bad', no tldr-off flag"
    : > "$off"
    expect silent "settings.json '$bad', a tldr-off flag"
done
reset; mkdir -p "$cfg/junkd"; : > "$on"
expect terse "no settings.json, no tldr-off flag"
: > "$off"
expect silent "no settings.json, a tldr-off flag"
# a directory in tldr-off's or tldr-on's place is no flag (the hook reads files only, as the module writes them)
reset; mkdir -p "$cfg/junkd/tldr-off"; : > "$on"
expect terse "a directory named tldr-off"
reset; mkdir -p "$cfg/junkd/tldr-on"
expect silent "a directory named tldr-on"

# ---------------------------------------------------------------- tldr-hook without jq: the flag decides
mkdir -p "$tmp/bin"
ln -s "$(command -v bash)" "$tmp/bin/bash"
nojq() { env -u KIMI_PLUGIN_ROOT -u PLUGIN_ROOT -u JUNK_DRAWER_RUNTIME PATH="$tmp/bin" JUNKD_TLDR_PATH_DIRS= HOME="$tmp/nohome" CLAUDE_CONFIG_DIR="$cfg" "$hookbin" 2>&1; }
reset; mkdir -p "$cfg/junkd"; : > "$on"
cfgjson "$(enabled_is false)"
out=$(nojq) || fail "no jq: hook exited non-zero"
rg -qF "$TERSE" <<<"$out" || fail "no jq, setting false, no tldr-off flag: expected the terse line (the flag decides), got: $out"
: > "$off"
cfgjson "$(enabled_is true)"
out=$(nojq) || fail "no jq, tldr-off: hook exited non-zero"
[ -z "$out" ] || fail "no jq, setting true, a tldr-off flag: expected silence (the flag decides), got: $out"
# a jq only in one of the tool dirs the hook adds to PATH (named through the override) is found and used
mkdir -p "$tmp/jqdir" && ln -s "$(command -v jq)" "$tmp/jqdir/jq"
out=$(env -u KIMI_PLUGIN_ROOT -u PLUGIN_ROOT -u JUNK_DRAWER_RUNTIME PATH="$tmp/bin" JUNKD_TLDR_PATH_DIRS="$tmp/jqdir" CLAUDE_CONFIG_DIR="$cfg" "$hookbin" 2>&1) ||
    fail "jq in a tool dir: hook exited non-zero"
rg -qF "$TERSE" <<<"$out" || fail "jq in a tool dir: setting true over a tldr-off flag, expected the terse line, got: $out"

# ---------------------------------------------------------------- tldr-flag and tldr-hook together, as /junkd:tldr on|off runs them
reset
claude "$flagbin" on >/dev/null
expect terse "after tldr-flag on"
cfgjson "$(enabled_is false)"
expect silent "tldr-flag on, then tldr_enabled false"
[ "$(claude "$flagbin" status)" = "TL;DR mode: ON" ] || fail "status reports the terse flag, whatever enabled says"
cfgjson "$(enabled_is true)"
claude "$flagbin" off >/dev/null
expect silent "after tldr-flag off"

echo "tldr tests passed"
