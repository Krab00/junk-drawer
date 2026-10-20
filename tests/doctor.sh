#!/usr/bin/env bash
# junkd-doctor tests: the five checks over a fixture CLAUDE_CONFIG_DIR and a fixture checkout (a directory
# marketplace), never the real ~/.claude. The doctor runs as a user reaches it: plugins/junkd/bin/junkd-doctor ->
# skills/junkd/bin/junkd-doctor. Run: bash tests/doctor.sh (tests/smoke.sh runs it). Every check is an explicit test.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/junkd"
doctor="$plugin/bin/junkd-doctor"
tmp=$(cd "$(mktemp -d)" && pwd -P) # the physical path: a TMPDIR ending in `/` gives mktemp a `//`
trap 'rm -rf "$tmp"' EXIT
cfg="$tmp/cfg"
checkout="$tmp/checkout"
sid=0f1e2d3c-aaaa-4bbb-8ccc-123456789abc

fail() { echo "doctor tests: $*" >&2; exit 1; }
noh=(env -u CLAUDECODE -u CLAUDE_PLUGIN_ROOT -u CLAUDE_CONFIG_DIR -u CODEX_THREAD_ID -u CODEX_HOME -u PLUGIN_ROOT
    -u KIMI_PLUGIN_ROOT -u KIMI_CODE_HOME -u KIMI_SESSION_ID -u OPENCODE -u OPENCODE_PID -u JUNK_DRAWER_RUNTIME
    -u CLAUDE_CODE_SESSION_ID)
# run [VAR=value...]: the doctor as Claude Code runs it (CLAUDECODE=1, the session id), stdout and stderr together;
# sets out and rc.
run() {
    rc=0
    out=$("${noh[@]}" CLAUDECODE=1 CLAUDE_CONFIG_DIR="$cfg" CLAUDE_CODE_SESSION_ID="$sid" "$@" "$doctor" 2>&1) || rc=$?
}
count() { local n; n=$(rg -c "^$1 " <<<"$out" || true); echo "${n:-0}"; }
line() { rg "^[A-Z]+ +$1 " <<<"$out" || true; }
# expect <rc> <PASS count> <FAIL count> <what>
expect() {
    [ "$rc" = "$1" ] || fail "$4: exit $rc, expected $1; output:
$out"
    [ "$(count PASS)" = "$2" ] && [ "$(count FAIL)" = "$3" ] ||
        fail "$4: expected $2 PASS and $3 FAIL lines, got:
$out"
}
lines_are() { # <n> <what>: exactly n output lines
    [ "$(wc -l <<<"$out" | tr -d ' ')" = "$1" ] || fail "$2: expected $1 lines, got:
$out"
}

# A healthy world: junkd enabled and installed from a directory marketplace at $checkout, the checkout's plugin root
# with its three relative links, and this session's _agents folder.
world() {
    rm -rf "$cfg" "$checkout"
    mkdir -p "$cfg/plugins" "$cfg/junkd/orch/_agents/$sid" "$checkout/.claude-plugin" \
        "$checkout/plugins/junkd/skills/junkd/bin" "$checkout/plugins/junkd/skills/junkd/scripts" \
        "$checkout/plugins/junkd/skills/orch/roles"
    ln -s skills/junkd/bin "$checkout/plugins/junkd/bin"
    ln -s skills/orch/roles "$checkout/plugins/junkd/agents"
    ln -s skills/junkd/scripts "$checkout/plugins/junkd/scripts"
    cat > "$checkout/.claude-plugin/marketplace.json" <<'JSON'
{"name": "junk-drawer", "plugins": [{"name": "junk-drawer", "source": "./plugins/junk-drawer"}, {"name": "junkd", "source": "./plugins/junkd"}]}
JSON
    cat > "$cfg/settings.json" <<'JSON'
{"theme": "dark", "enabledPlugins": {"statusline@junk-drawer": true, "junkd@junk-drawer": true}}
JSON
    cat > "$cfg/plugins/installed_plugins.json" <<JSON
{"version": 2, "plugins": {"junkd@junk-drawer": [{"scope": "user", "installPath": "$cfg/plugins/cache/junk-drawer/junkd/0.7.0", "version": "0.7.0"}]}}
JSON
    known_source "{\"source\": \"directory\", \"path\": \"$checkout\"}"
}
known_source() { printf '{"junk-drawer": {"source": %s, "installLocation": "x"}}\n' "$1" > "$cfg/plugins/known_marketplaces.json"; }
edit() { # <file> <jq filter>
    jq "$2" "$1" > "$tmp/edit.json" && mv "$tmp/edit.json" "$1"
}

# ---------------------------------------------------------------- the layout: a real file reached through bin/
real="$plugin/skills/junkd/bin/junkd-doctor"
[ -f "$real" ] && [ ! -L "$real" ] && [ -x "$real" ] || fail "skills/junkd/bin/junkd-doctor is not a real executable"
[ -L "$plugin/bin" ] && [ "$(readlink "$plugin/bin")" = skills/junkd/bin ] || fail "plugins/junkd/bin is not the relative link skills/junkd/bin"
[ "$doctor" -ef "$real" ] || fail "plugins/junkd/bin/junkd-doctor does not reach skills/junkd/bin/junkd-doctor"

# ---------------------------------------------------------------- healthy: five PASS lines, exit 0
world
before=$(cd "$tmp" && find . | LC_ALL=C sort)
run
expect 0 5 0 "healthy world"
lines_are 5 "healthy world"
for check in enabled installed marketplace symlinks agents; do
    rg -q "^PASS +$check " <<<"$out" || fail "healthy world: no PASS line for $check:
$out"
done
rg -qF "$checkout" <<<"$(line marketplace)" || fail "healthy world: the marketplace line does not name the checkout"
[ "$(cd "$tmp" && find . | LC_ALL=C sort)" = "$before" ] || fail "the doctor wrote or removed a file"
# The same with a trailing slash on the marketplace path.
known_source "{\"source\": \"directory\", \"path\": \"$checkout/\"}"
run
expect 0 5 0 "marketplace path with a trailing slash"
rg -qF "in $checkout/plugins/junkd" <<<"$(line symlinks)" || fail "trailing slash: the symlinks line names $(line symlinks)"

# ---------------------------------------------------------------- enabled
world
edit "$cfg/settings.json" 'del(.enabledPlugins["junkd@junk-drawer"])'
run
expect 1 4 1 "enabledPlugins entry removed"
rg -q '^FAIL +enabled ' <<<"$out" || fail "entry removed: the FAIL is not the enabled line:
$out"
world
edit "$cfg/settings.json" '.enabledPlugins["junkd@junk-drawer"] = false'
run
expect 1 4 1 "junkd disabled (false)"
rg -q '^FAIL +enabled ' <<<"$out" || fail "disabled: no FAIL enabled line"
world
edit "$cfg/settings.json" '.enabledPlugins["junkd@junk-drawer"] = "true"'
run
expect 1 4 1 "enabled as the string \"true\""
world
edit "$cfg/settings.json" '.enabledPlugins = {"junkd@other": true}'
run
expect 1 4 1 "junkd enabled from another marketplace only"
world
rm "$cfg/settings.json"
run
expect 1 4 1 "no settings.json"
rg -q '^FAIL +enabled ' <<<"$out" || fail "no settings.json: no FAIL enabled line"

# ---------------------------------------------------------------- installed
world
edit "$cfg/plugins/installed_plugins.json" 'del(.plugins["junkd@junk-drawer"])'
run
expect 1 4 1 "installed_plugins entry removed"
rg -q '^FAIL +installed ' <<<"$out" || fail "installed entry removed: no FAIL installed line"
world
edit "$cfg/plugins/installed_plugins.json" '.plugins["junkd@junk-drawer"] = []'
run
expect 1 4 1 "installed_plugins entry is an empty list"
world
rm "$cfg/plugins/installed_plugins.json"
run
expect 1 4 1 "no installed_plugins.json"

# ---------------------------------------------------------------- marketplace (and symlinks, which needs it)
world
known_source '{"source": "github", "repo": "Krab00/junk-drawer"}'
run
expect 1 3 2 "github marketplace"
rg -q '^FAIL +marketplace .*github source, not a directory' <<<"$out" || fail "github: the marketplace line does not say so:
$out"
rg -q '^FAIL +symlinks ' <<<"$out" || fail "github: the symlinks line is not a FAIL"
world
known_source '{"source": "git", "url": "https://github.com/Krab00/junk-drawer.git"}'
run
expect 1 3 2 "git marketplace"
rg -q '^FAIL +marketplace .*a git source, not a directory' <<<"$out" || fail "git: the marketplace line does not say so:
$out"
world
printf '{"other": {"source": {"source": "directory", "path": "%s"}}}\n' "$checkout" > "$cfg/plugins/known_marketplaces.json"
run
expect 1 3 2 "no junk-drawer marketplace"
rg -q '^FAIL +marketplace .*has no junk-drawer marketplace' <<<"$out" || fail "no marketplace: wrong line:
$out"
world
rm "$cfg/plugins/known_marketplaces.json"
run
expect 1 3 2 "no known_marketplaces.json"
world
known_source "{\"source\": \"directory\", \"path\": \"$tmp/gone\"}"
run
expect 1 3 2 "directory source whose folder is gone"
rg -q "^FAIL +marketplace .*not a folder" <<<"$out" || fail "gone folder: wrong line:
$out"
world
known_source '{"source": "directory"}'
run
expect 1 3 2 "directory source without a path"
world
: > "$tmp/afile"
known_source "{\"source\": \"directory\", \"path\": \"$tmp/afile\"}"
run
expect 1 3 2 "directory source pointing at a file"
rg -q "^FAIL +marketplace .*afile', which is not a folder" <<<"$out" || fail "file path: wrong line:
$out"
world
rm "$checkout/.claude-plugin/marketplace.json"
run
expect 1 3 2 "checkout without .claude-plugin/marketplace.json"
rg -q "^FAIL +marketplace .*not a junk-drawer checkout" <<<"$out" || fail "no marketplace.json: wrong line:
$out"
world
printf '{"name": "junk-drawer", "plugins": [{"name": "junk-drawer", "source": "./plugins/junk-drawer"}]}\n' > "$checkout/.claude-plugin/marketplace.json"
run
expect 1 3 2 "checkout whose marketplace.json does not list junkd"

# ---------------------------------------------------------------- symlinks: each one broken, then a real folder
for link in bin agents scripts; do
    world
    rm "$checkout/plugins/junkd/$link"
    ln -s skills/nowhere "$checkout/plugins/junkd/$link"
    run
    expect 1 4 1 "broken $link link"
    rg -q "^FAIL +symlinks .*: $link\$" <<<"$out" || fail "broken $link: the symlinks line does not name only $link:
$out"
    world
    rm "$checkout/plugins/junkd/$link"
    run
    expect 1 4 1 "missing $link link"
    world
    rm "$checkout/plugins/junkd/$link"
    mkdir "$checkout/plugins/junkd/$link"
    run
    expect 1 4 1 "$link a real folder, not a link"
done
world
rm "$checkout/plugins/junkd/bin" "$checkout/plugins/junkd/scripts"
run
expect 1 4 1 "two links missing"
rg -q "^FAIL +symlinks .*: bin scripts\$" <<<"$out" || fail "two links: the line does not name bin and scripts:
$out"
# The plugin root comes from the marketplace's source for junkd, not a fixed ./plugins/junkd.
world
mv "$checkout/plugins/junkd" "$checkout/plugins/jd"
edit "$checkout/.claude-plugin/marketplace.json" '(.plugins[] | select(.name == "junkd") | .source) = "./plugins/jd"'
run
expect 0 5 0 "junkd at another source path"

# ---------------------------------------------------------------- agents: INFO, never a FAIL
world
rmdir "$cfg/junkd/orch/_agents/$sid"
mkdir "$cfg/junkd/orch/_agents/other-session"
run
expect 0 4 0 "no subagent stopped yet in this session"
rg -q "^INFO +agents +no subagent stopped yet in session $sid" <<<"$out" || fail "no _agents dir: wrong line:
$out"
lines_are 5 "no _agents dir"
world
rm -r "$cfg/junkd/orch/_agents/$sid"
: > "$cfg/junkd/orch/_agents/$sid"
run
expect 0 4 0 "the session's _agents entry is a file, not a folder"
world
run CLAUDE_CODE_SESSION_ID=
expect 0 4 0 "no session id"
rg -q '^INFO +agents +no CLAUDE_CODE_SESSION_ID' <<<"$out" || fail "no session id: wrong line:
$out"
world
run "CLAUDE_CODE_SESSION_ID=../_agents"
expect 0 4 0 "a session id that is a path"
rg -q '^INFO +agents .*not a plain id' <<<"$out" || fail "path session id: wrong line:
$out"
# A dot-only id has no `/`, yet _agents/.. is a folder (junkd/orch): still INFO, never a PASS.
world
run "CLAUDE_CODE_SESSION_ID=.."
expect 0 4 0 "the session id .."
rg -q "^INFO +agents .*'\.\.' is not a plain id" <<<"$out" || fail "session id ..: wrong line:
$out"
# Everything wrong at once: four FAIL lines, the agents line still INFO.
world
rm "$cfg/settings.json" "$cfg/plugins/installed_plugins.json" "$cfg/plugins/known_marketplaces.json"
rm -r "$cfg/junkd"
run
expect 1 0 4 "nothing installed"
lines_are 5 "nothing installed"

# ---------------------------------------------------------------- jq missing
world
rc=0
out=$("${noh[@]}" PATH="$tmp/nobin" CLAUDECODE=1 CLAUDE_CONFIG_DIR="$cfg" CLAUDE_CODE_SESSION_ID="$sid" "$BASH" "$doctor" 2>&1) || rc=$?
expect 1 0 1 "no jq on PATH"
rg -q '^FAIL +jq ' <<<"$out" || fail "no jq: wrong line:
$out"

# ---------------------------------------------------------------- hosts
world
for host in codex kimi opencode; do
    rc=0
    out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=$host CLAUDE_CONFIG_DIR="$cfg" "$doctor" 2>&1) || rc=$?
    [ "$rc" = 0 ] || fail "$host: exit $rc"
    [ "$out" = "junkd-doctor: Claude Code only (this host is $host)" ] || fail "$host: got $out"
done
rc=0
out=$("${noh[@]}" CODEX_THREAD_ID=t1 CLAUDE_CONFIG_DIR="$cfg" "$doctor" 2>&1) || rc=$?
[ "$rc" = 0 ] && [ "$out" = "junkd-doctor: Claude Code only (this host is codex)" ] || fail "Codex detected by CODEX_THREAD_ID: $rc $out"
rc=0
out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=claude CLAUDE_CONFIG_DIR="$cfg" CLAUDE_CODE_SESSION_ID="$sid" "$doctor" 2>&1) || rc=$?
expect 0 5 0 "JUNK_DRAWER_RUNTIME=claude"
rc=0
out=$("${noh[@]}" HOME="$tmp/home" "$doctor" 2>&1) || rc=$?
[ "$rc" = 2 ] && rg -qF 'JUNK_DRAWER_RUNTIME' <<<"$out" || fail "no host signal: expected exit 2 naming JUNK_DRAWER_RUNTIME, got $rc $out"
[ ! -e "$tmp/home" ] || fail "no host signal: something was written under HOME"
rc=0
out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=vim "$doctor" 2>&1) || rc=$?
[ "$rc" = 2 ] || fail "unknown JUNK_DRAWER_RUNTIME: exit $rc"
# CLAUDE_CONFIG_DIR unset: the doctor reads $HOME/.claude.
mkdir -p "$tmp/home"
mv "$cfg" "$tmp/home/.claude"
rc=0
out=$("${noh[@]}" CLAUDECODE=1 HOME="$tmp/home" CLAUDE_CODE_SESSION_ID="$sid" "$doctor" 2>&1) || rc=$?
expect 0 5 0 "HOME/.claude without CLAUDE_CONFIG_DIR"
rg -qF "$tmp/home/.claude/settings.json" <<<"$(line enabled)" || fail "HOME/.claude: the enabled line names $(line enabled)"

echo "doctor tests passed"
