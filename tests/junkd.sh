#!/usr/bin/env bash
# junkd plugin tests: the STE output style and the SessionStart setup step (scripts/setup.sh) over a temp
# CLAUDE_CONFIG_DIR, never the real one. Run: bash tests/junkd.sh (tests/smoke.sh runs it too). Every check is
# an explicit `if`/`[ ]` so `set -e` catches it.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/junkd"
hook="$plugin/scripts/setup.sh"
style="$plugin/output-styles/STE.md"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export CLAUDE_CONFIG_DIR="$tmp/cfg"
settings="$CLAUDE_CONFIG_DIR/settings.json"
flag="$CLAUDE_CONFIG_DIR/junkd/output-style-off"
ver=$(jq -r .version "$plugin/.claude-plugin/plugin.json")
stamp="$CLAUDE_CONFIG_DIR/junkd/setup-$ver.stamp"

fail() { echo "junkd tests: $*" >&2; exit 1; }
# The hook as a main session runs it: no agent marker, the given hook input on stdin; stderr is stdout here, so
# any noise fails the one-line and the silent checks.
main() { printf '%s' "${1:-{\"session_id\":\"s1\",\"hook_event_name\":\"SessionStart\"\}}" | env -u CLAUDE_AGENT_ID "$hook" 2>&1; }
reset() { rm -rf "$CLAUDE_CONFIG_DIR"; mkdir -p "$CLAUDE_CONFIG_DIR"; }

# ---------------------------------------------------------------- the style (AC1)
[ -f "$style" ] || fail "no output-styles/STE.md"
front=$(awk 'NR==1 && !/^---/ {exit} /^---/ {n++; if (n==2) exit; next} {print}' "$style")
rg -q '^name: STE$' <<<"$front" || fail "STE.md: frontmatter name is not STE"
rg -q '^description: .+' <<<"$front" || fail "STE.md: no description in the frontmatter"
if rg -q 'force-for-plugin' "$style"; then fail "STE.md must not set force-for-plugin"; fi
rg -q 'ASD-STE100' "$style" || fail "STE.md does not name ASD-STE100"

# ---------------------------------------------------------------- the hook's wiring (AC2)
jq -e '.hooks.SessionStart[0].hooks[] | select(.type == "command" and (.command | contains("/scripts/setup.sh")))' \
    "$plugin/hooks/hooks.json" >/dev/null || fail "hooks.json has no SessionStart hook for scripts/setup.sh"
[ -L "$plugin/scripts" ] || fail "plugins/junkd/scripts must be a symlink into skills/"
[ -x "$plugin/skills/junkd/scripts/setup.sh" ] || fail "setup.sh is not executable"
jq -e '.userConfig.core_output_style | .type == "string" and .options == ["ste", "off"] and .default == "ste"' \
    "$plugin/.claude-plugin/plugin.json" >/dev/null || fail "plugin.json: userConfig.core_output_style is not string ste|off, default ste"

# ---------------------------------------------------------------- no key -> set, one line, stamped (AC2, AC4)
reset
printf '{\n  "theme": "dark",\n  "enabledPlugins": {\n    "tldr@junk-drawer": true\n  }\n}\n' > "$settings"
out=$(main) || fail "no key: hook exited non-zero"
[ "$(wc -l <<<"$out" | tr -d ' ')" = 1 ] || fail "no key: expected one line, got: $out"
rg -q '^junkd: ' <<<"$out" || fail "no key: the line does not start with 'junkd: ': $out"
rg -qF 'junkd:STE' <<<"$out" || fail "no key: the line does not name junkd:STE: $out"
[ "$(jq -r .outputStyle "$settings")" = "junkd:STE" ] || fail "no key: outputStyle not set"
[ "$(jq -r .theme "$settings")" = dark ] || fail "no key: theme lost"
[ "$(jq -r '.enabledPlugins["tldr@junk-drawer"]' "$settings")" = true ] || fail "no key: enabledPlugins lost"
[ "$(jq -r 'keys_unsorted[0]' "$settings")" = theme ] || fail "no key: key order changed"
[ -e "$stamp" ] || fail "no key: not stamped at $stamp"
[ -z "$(ls "$CLAUDE_CONFIG_DIR" | rg -v '^(settings\.json|junkd)$')" ] || fail "no key: a temp file was left: $(ls "$CLAUDE_CONFIG_DIR")"
# the same version again: silent, the file untouched (the stamp)
before=$(cat "$settings")
out=$(main) || fail "stamped: hook exited non-zero"
[ -z "$out" ] || fail "stamped: hook printed output: $out"
[ "$(cat "$settings")" = "$before" ] || fail "stamped: settings.json changed"
# stamped, and the key removed by hand: still silent until the next version
jq 'del(.outputStyle)' "$settings" > "$settings.new" && mv "$settings.new" "$settings"
out=$(main) || fail "stamped, key removed: hook exited non-zero"
[ -z "$out" ] || fail "stamped, key removed: hook printed output: $out"
if jq -e 'has("outputStyle")' "$settings" >/dev/null; then fail "stamped, key removed: the key was set again"; fi
# the next plugin version runs again (a copy of the plugin with a bumped manifest)
cp -R "$plugin/." "$tmp/next"
jq '.version = "99.0.0"' "$plugin/.claude-plugin/plugin.json" > "$tmp/next/.claude-plugin/plugin.json"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID "$tmp/next/scripts/setup.sh") || fail "next version: hook exited non-zero"
rg -q '^junkd: ' <<<"$out" || fail "next version: expected the junkd: line, got: $out"
[ "$(jq -r .outputStyle "$settings")" = "junkd:STE" ] || fail "next version: outputStyle not set"
[ -e "$CLAUDE_CONFIG_DIR/junkd/setup-99.0.0.stamp" ] || fail "next version: not stamped under its own version"
# a manifest that does not parse, even with a version line in it: nothing set, nothing stamped
cp -R "$plugin/." "$tmp/broken"
printf '{"name": "junkd", "version": "7.7.7",\n' > "$tmp/broken/.claude-plugin/plugin.json"
reset
printf '{"theme": "dark"}\n' > "$settings"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID "$tmp/broken/scripts/setup.sh" 2>&1) || fail "broken manifest: hook exited non-zero"
[ -z "$out" ] || fail "broken manifest: hook printed output: $out"
[ "$(cat "$settings")" = '{"theme": "dark"}' ] || fail "broken manifest: settings.json changed"
[ ! -e "$CLAUDE_CONFIG_DIR/junkd/setup-7.7.7.stamp" ] || fail "broken manifest: stamped from the version line"

# ---------------------------------------------------------------- key present -> untouched, silent, stamped (AC2, AC4)
for value in '"Explanatory"' '"junkd:STE"' 'null' '""' '{"name":"x"}'; do
    reset
    printf '{"outputStyle": %s, "theme": "dark"}\n' "$value" > "$settings"
    before=$(cat "$settings")
    out=$(main) || fail "key $value: hook exited non-zero"
    [ -z "$out" ] || fail "key $value: hook printed output: $out"
    [ "$(cat "$settings")" = "$before" ] || fail "key $value: settings.json changed"
    [ -e "$stamp" ] || fail "key $value: not stamped"
done

# ---------------------------------------------------------------- missing or empty file -> created with the key
reset
out=$(main) || fail "missing file: hook exited non-zero"
rg -q '^junkd: ' <<<"$out" || fail "missing file: expected the junkd: line, got: $out"
[ "$(jq -c . "$settings")" = '{"outputStyle":"junkd:STE"}' ] || fail "missing file: expected {\"outputStyle\":\"junkd:STE\"}, got $(cat "$settings")"
rm -rf "$CLAUDE_CONFIG_DIR"   # no config dir at all: made
out=$(main) || fail "missing dir: hook exited non-zero"
[ "$(jq -c . "$settings")" = '{"outputStyle":"junkd:STE"}' ] || fail "missing dir: settings.json not created"
reset
: > "$settings"
out=$(main) || fail "empty file: hook exited non-zero"
[ "$(jq -c . "$settings")" = '{"outputStyle":"junkd:STE"}' ] || fail "empty file: expected the key, got $(cat "$settings")"

# ---------------------------------------------------------------- not a JSON object -> untouched, silent, no stamp (AC2)
for bad in '{"theme": "dark",' '[]' '"text"' '42' 'null' '{"a":1}}'; do
    reset
    printf '%s' "$bad" > "$settings"
    out=$(main) || fail "bad $bad: hook exited non-zero"
    [ -z "$out" ] || fail "bad $bad: hook printed output: $out"
    [ "$(cat "$settings")" = "$bad" ] || fail "bad $bad: settings.json changed to $(cat "$settings")"
    [ ! -e "$stamp" ] || fail "bad $bad: stamped although refused"
    [ -z "$(ls "$CLAUDE_CONFIG_DIR" | rg -v '^settings\.json$')" ] || fail "bad $bad: something else written: $(ls "$CLAUDE_CONFIG_DIR")"
done

# ---------------------------------------------------------------- off flag -> skipped, no stamp; on again -> applies (AC3)
reset
printf '{"theme": "dark"}\n' > "$settings"
mkdir -p "$(dirname "$flag")" && : > "$flag"
out=$(main) || fail "off: hook exited non-zero"
[ -z "$out" ] || fail "off: hook printed output: $out"
[ "$(cat "$settings")" = '{"theme": "dark"}' ] || fail "off: settings.json changed"
[ ! -e "$stamp" ] || fail "off: stamped although skipped"
rm "$flag"
out=$(main) || fail "on again: hook exited non-zero"
rg -q '^junkd: ' <<<"$out" || fail "on again: expected the junkd: line, got: $out"
[ "$(jq -r .outputStyle "$settings")" = "junkd:STE" ] || fail "on again: outputStyle not set"
# the setting itself in settings.json (the hooks module runs after this hook at a session start, so the flag
# file is not yet there on a first session): core_output_style off under any marketplace's junkd entry skips, no
# stamp; the first junkd@ entry decides, past another plugin's entry and before a later junkd@ one
for cfgjson in '{"junkd@junk-drawer": {"options": {"core_output_style": "off"}}}' '{"junkd@other": {"options": {"core_output_style": "off"}}}' \
    '{"tldr@junk-drawer": {"options": {"core_output_style": "ste"}}, "junkd@a": {"options": {"core_output_style": "off"}}, "junkd@b": {"options": {"core_output_style": "ste"}}}'; do
    reset
    printf '{"theme": "dark", "pluginConfigs": %s}\n' "$cfgjson" > "$settings"
    before=$(cat "$settings")
    out=$(main) || fail "setting off ($cfgjson): hook exited non-zero"
    [ -z "$out" ] || fail "setting off ($cfgjson): hook printed output: $out"
    [ "$(cat "$settings")" = "$before" ] || fail "setting off ($cfgjson): settings.json changed"
    [ ! -e "$stamp" ] || fail "setting off ($cfgjson): stamped although skipped"
done
# ste there, a value the options do not name (the module reads it as ste), another plugin's off (alone, or ahead of
# junkd's ste), a later junkd@ entry's off behind the first one's ste, the pre-T11 key output_style (no row any
# more), or no options: the step applies
for cfgjson in '{"junkd@junk-drawer": {"options": {"core_output_style": "ste"}}}' '{"junkd@junk-drawer": {"options": {"core_output_style": "blue"}}}' \
    '{"tldr@junk-drawer": {"options": {"core_output_style": "off"}}}' \
    '{"other@x": {"options": {"core_output_style": "off"}}, "junkd@junk-drawer": {"options": {"core_output_style": "ste"}}}' \
    '{"my-junkd@x": {"options": {"core_output_style": "off"}}, "junkd-x@y": {"options": {"core_output_style": "off"}}, "junkd@junk-drawer": {"options": {"core_output_style": "ste"}}}' \
    '{"junkd@a": {"options": {"core_output_style": "ste"}}, "junkd@b": {"options": {"core_output_style": "off"}}}' \
    '{"junkd@a": {"options": {}}, "junkd@b": {"options": {"core_output_style": "off"}}}' \
    '{"junkd@junk-drawer": {"options": {"output_style": "off"}}}' '{"junkd@junk-drawer": {}}' '{}'; do
    reset
    printf '{"theme": "dark", "pluginConfigs": %s}\n' "$cfgjson" > "$settings"
    out=$(main) || fail "pluginConfigs $cfgjson: hook exited non-zero"
    rg -q '^junkd: ' <<<"$out" || fail "pluginConfigs $cfgjson: expected the junkd: line, got: $out"
    [ "$(jq -r .outputStyle "$settings")" = "junkd:STE" ] || fail "pluginConfigs $cfgjson: outputStyle not set"
    [ "$(jq -c .pluginConfigs "$settings")" = "$(jq -c . <<<"$cfgjson")" ] || fail "pluginConfigs $cfgjson: pluginConfigs changed"
done
# the setting in settings.json wins over the flag file, which only stands in where settings.json names none: a
# hand edit off -> ste applies at once, though the flag the last session left is still there; an entry with no
# core_output_style (the first junkd@ entry's: a later one's ste, another plugin's, or the old output_style key do
# not count) leaves the flag in charge
reset
mkdir -p "$(dirname "$flag")" && : > "$flag"
printf '{"theme": "dark", "pluginConfigs": {"junkd@junk-drawer": {"options": {"core_output_style": "ste"}}}}\n' > "$settings"
out=$(main) || fail "flag + setting ste: hook exited non-zero"
rg -q '^junkd: ' <<<"$out" || fail "flag + setting ste: expected the junkd: line, got: $out"
[ "$(jq -r .outputStyle "$settings")" = "junkd:STE" ] || fail "flag + setting ste: outputStyle not set"
[ -e "$stamp" ] || fail "flag + setting ste: not stamped"
for cfgjson in '{"junkd@junk-drawer": {"options": {}}}' '{"junkd@a": {"options": {}}, "junkd@b": {"options": {"core_output_style": "ste"}}}' \
    '{"tldr@junk-drawer": {"options": {"core_output_style": "ste"}}}' '{"junkd@junk-drawer": {"options": {"output_style": "ste"}}}'; do
    reset
    mkdir -p "$(dirname "$flag")" && : > "$flag"
    printf '{"theme": "dark", "pluginConfigs": %s}\n' "$cfgjson" > "$settings"
    before=$(cat "$settings")
    out=$(main) || fail "flag + no setting ($cfgjson): hook exited non-zero"
    [ -z "$out" ] || fail "flag + no setting ($cfgjson): hook printed output: $out"
    [ "$(cat "$settings")" = "$before" ] || fail "flag + no setting ($cfgjson): settings.json changed"
    [ ! -e "$stamp" ] || fail "flag + no setting ($cfgjson): stamped although skipped"
done
# neither CLAUDE_CONFIG_DIR nor HOME: nothing to do, exit 0, silent
out=$(printf '{}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR -u HOME "$hook" 2>&1) || fail "no HOME: hook exited non-zero"
[ -z "$out" ] || fail "no HOME: hook printed output: $out"
# the stamp dir cannot be made (a file in its place): the key is still set, one line, no noise
reset
printf '{"theme": "dark"}\n' > "$settings"
: > "$CLAUDE_CONFIG_DIR/junkd"
out=$(main) || fail "stamp dir blocked: hook exited non-zero"
[ "$(wc -l <<<"$out" | tr -d ' ')" = 1 ] && rg -q '^junkd: ' <<<"$out" || fail "stamp dir blocked: expected one junkd: line, got: $out"
[ "$(jq -r .outputStyle "$settings")" = "junkd:STE" ] || fail "stamp dir blocked: outputStyle not set"
rm "$CLAUDE_CONFIG_DIR/junkd"
# with no CLAUDE_CONFIG_DIR, everything lives under $HOME/.claude
mkdir -p "$tmp/home/.claude/junkd" && : > "$tmp/home/.claude/junkd/output-style-off"
printf '{}' > "$tmp/home/.claude/settings.json"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR HOME="$tmp/home" "$hook") || fail "HOME flag: hook exited non-zero"
[ -z "$out" ] || fail "HOME flag: hook printed output: $out"
rm "$tmp/home/.claude/junkd/output-style-off"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR HOME="$tmp/home" "$hook") || fail "HOME: hook exited non-zero"
[ "$(jq -r .outputStyle "$tmp/home/.claude/settings.json")" = "junkd:STE" ] || fail "HOME: outputStyle not set under \$HOME/.claude"
[ -e "$tmp/home/.claude/junkd/setup-$ver.stamp" ] || fail "HOME: not stamped under \$HOME/.claude/junkd"

# the script's real path (skills/junkd/scripts/setup.sh, not through the plugin-root link) finds the same manifest
reset
printf '{"theme": "dark"}\n' > "$settings"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID "$plugin/skills/junkd/scripts/setup.sh") || fail "real path: hook exited non-zero"
rg -q '^junkd: ' <<<"$out" || fail "real path: expected the junkd: line, got: $out"
[ -e "$stamp" ] || fail "real path: not stamped under the manifest's version"

# ---------------------------------------------------------------- not the main session -> silent, nothing written (AC2)
reset
printf '{"theme": "dark"}\n' > "$settings"
out=$(printf '{"session_id":"s1"}' | CLAUDE_AGENT_ID=agent-1 "$hook") || fail "CLAUDE_AGENT_ID: hook exited non-zero"
[ -z "$out" ] || fail "CLAUDE_AGENT_ID set: hook printed output: $out"
for payload in '{"session_id":"s1","agent_id":"a1"}' '{"agent_id" : "a1"}' '{ "agent_id":"" }' \
    '{"source":"clear"}' '{"source" : "compact"}'; do
    out=$(main "$payload") || fail "payload $payload: hook exited non-zero"
    [ -z "$out" ] || fail "payload $payload: hook printed output: $out"
done
[ "$(cat "$settings")" = '{"theme": "dark"}' ] || fail "not main: settings.json changed"
[ ! -e "$stamp" ] || fail "not main: stamped"
# a key that merely contains the text (agent_identity), or another source, is the main session
for payload in '{"agent_identity":"a1"}' '{"source":"startup"}' '{"source":"resume"}'; do
    reset
    printf '{"theme": "dark"}\n' > "$settings"
    out=$(main "$payload") || fail "payload $payload: hook exited non-zero"
    rg -q '^junkd: ' <<<"$out" || fail "payload $payload: expected the junkd: line, got: $out"
done
# no stdin at all (a tty-less hook with closed input) still runs
reset
printf '{"theme": "dark"}\n' > "$settings"
out=$(env -u CLAUDE_AGENT_ID "$hook" < /dev/null) || fail "no stdin: hook exited non-zero"
rg -q '^junkd: ' <<<"$out" || fail "no stdin: expected the junkd: line, got: $out"

# ---------------------------------------------------------------- a symlinked settings.json is written through, the link kept
reset
mkdir -p "$tmp/dotfiles"
printf '{"theme": "dark"}\n' > "$tmp/dotfiles/settings.json"
ln -s "$tmp/dotfiles/settings.json" "$settings"
out=$(main) || fail "symlink: hook exited non-zero"
rg -q '^junkd: ' <<<"$out" || fail "symlink: expected the junkd: line, got: $out"
[ -L "$settings" ] || fail "symlink: the link was replaced by a file"
[ "$(jq -r .outputStyle "$tmp/dotfiles/settings.json")" = "junkd:STE" ] || fail "symlink: the target was not written"
[ -z "$(ls "$tmp/dotfiles" | rg -v '^settings\.json$')" ] || fail "symlink: a temp file was left beside the target: $(ls "$tmp/dotfiles")"

# ---------------------------------------------------------------- a read-only settings.json stays, no stamp, exit 0
# The file read-only (the temp copy takes its mode, so the jq write into it fails): the failure branch, silent,
# the temp file removed. The dir read-only too: no temp file can be made at all.
if [ "$(id -u)" != 0 ]; then
    reset
    printf '{"theme": "dark"}\n' > "$settings"
    chmod 444 "$settings"
    out=$(main) || fail "read-only file: hook exited non-zero"
    [ -z "$out" ] || fail "read-only file: hook printed output: $out"
    [ "$(cat "$settings")" = '{"theme": "dark"}' ] || fail "read-only file: settings.json changed"
    [ ! -e "$stamp" ] || fail "read-only file: stamped"
    [ -z "$(ls "$CLAUDE_CONFIG_DIR" | rg -v '^settings\.json$')" ] || fail "read-only file: a temp file was left: $(ls "$CLAUDE_CONFIG_DIR")"
    chmod 555 "$CLAUDE_CONFIG_DIR"
    out=$(main) || fail "read-only dir: hook exited non-zero"
    chmod 755 "$CLAUDE_CONFIG_DIR"
    [ -z "$out" ] || fail "read-only dir: hook printed output: $out"
    [ "$(cat "$settings")" = '{"theme": "dark"}' ] || fail "read-only dir: settings.json changed"
    [ ! -e "$stamp" ] || fail "read-only dir: stamped"
    chmod 644 "$settings"
fi

# ---------------------------------------------------------------- a manifest without a version: nothing done
cp -R "$plugin/." "$tmp/nover"
jq 'del(.version)' "$plugin/.claude-plugin/plugin.json" > "$tmp/nover/.claude-plugin/plugin.json"
reset
printf '{"theme": "dark"}\n' > "$settings"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID "$tmp/nover/scripts/setup.sh" 2>&1) || fail "no version: hook exited non-zero"
[ -z "$out" ] || fail "no version: hook printed output: $out"
[ "$(cat "$settings")" = '{"theme": "dark"}' ] || fail "no version: settings.json changed"
[ -z "$(ls "$CLAUDE_CONFIG_DIR" | rg -v '^settings\.json$')" ] || fail "no version: something written: $(ls "$CLAUDE_CONFIG_DIR")"

# ---------------------------------------------------------------- without jq: nothing touched, nothing stamped, exit 0
reset
printf '{"theme": "dark"}\n' > "$settings"
mkdir -p "$tmp/bin"
for t in bash cat mkdir cp mv rm readlink sed head mktemp dirname env; do ln -s "$(command -v "$t")" "$tmp/bin/$t"; done
# The script adds the usual tool dirs to PATH; JUNKD_SETUP_PATH_DIRS= keeps a brew or system jq out of reach.
out=$(printf '{}' | env -u CLAUDE_AGENT_ID PATH="$tmp/bin" JUNKD_SETUP_PATH_DIRS= HOME="$tmp/nohome" "$hook" 2>&1) || fail "no jq: hook exited non-zero"
[ -z "$out" ] || fail "no jq: hook printed output: $out"
[ "$(cat "$settings")" = '{"theme": "dark"}' ] || fail "no jq: settings.json changed"
[ ! -e "$stamp" ] || fail "no jq: stamped"
# a jq only in one of the tool dirs the script adds to PATH (here a dir named through the override) is found
mkdir -p "$tmp/jqdir" && ln -s "$(command -v jq)" "$tmp/jqdir/jq"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID PATH="$tmp/bin" JUNKD_SETUP_PATH_DIRS="$tmp/jqdir" "$hook" 2>&1) || fail "jq in a tool dir: hook exited non-zero"
rg -q '^junkd: ' <<<"$out" || fail "jq in a tool dir: expected the junkd: line, got: $out"
[ "$(jq -r .outputStyle "$settings")" = "junkd:STE" ] || fail "jq in a tool dir: outputStyle not set"
reset   # and a missing settings.json is not even created without jq
out=$(printf '{}' | env -u CLAUDE_AGENT_ID PATH="$tmp/bin" JUNKD_SETUP_PATH_DIRS= HOME="$tmp/nohome" "$hook" 2>&1) || fail "no jq, no file: hook exited non-zero"
[ -z "$out" ] || fail "no jq, no file: hook printed output: $out"
[ ! -e "$settings" ] || fail "no jq, no file: settings.json was created"

echo "junkd tests passed"
