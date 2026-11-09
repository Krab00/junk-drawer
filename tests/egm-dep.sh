#!/usr/bin/env bash
# junkd's EGM dependency: the Claude manifest
# pins egm@egm at exactly 0.1.1, the root marketplace allowlists the egm marketplace, and the SessionStart step
# (skills/junkd/scripts/setup.sh) prints nothing about egm or task-draft, even with egm_enabled on and no egm
# installed. Runs over a temp HOME and CLAUDE_CONFIG_DIR; nothing is installed and no model is called.
# Each case prints `case: <name>` and fails with a line on the first mismatch.
# Run: bash tests/egm-dep.sh (tests/smoke.sh runs it too).
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd -P)
plugin="$root/plugins/junkd"
manifest="$plugin/.claude-plugin/plugin.json"
marketplace="$root/.claude-plugin/marketplace.json"
setup="$plugin/skills/junkd/scripts/setup.sh"
command -v jq >/dev/null || { echo "egm-dep tests: jq is needed"; exit 1; }

tmp=$(cd "$(mktemp -d)" && pwd -P) # the physical path: a TMPDIR ending in `/` gives mktemp a `//`
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" CLAUDE_CONFIG_DIR="$tmp/cfg"
# A caller's agent id would make setup.sh exit before it reads anything; an EGM_ROOT would make egm look installed.
unset CLAUDE_AGENT_ID EGM_ROOT JUNK_DRAWER_RUNTIME
mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR"

fail() { echo "egm-dep tests: $*" >&2; exit 1; }
case_() { echo "case: $*"; }

# ---------------------------------------------------------------- manifest dependency
case_ "manifest dependency"
[ -f "$manifest" ] || fail "no $manifest"
dep=$(jq -c .dependencies "$manifest")
[ "$dep" = '[{"name":"egm","marketplace":"egm","version":"0.1.1"}]' ] ||
    fail "the Claude manifest's dependencies are not exactly egm@egm 0.1.1: $dep"

# ---------------------------------------------------------------- marketplace allowlist
case_ "marketplace allowlist"
[ -f "$marketplace" ] || fail "no $marketplace"
jq -e '.allowCrossMarketplaceDependenciesOn == ["egm"]' "$marketplace" >/dev/null ||
    fail "marketplace.json does not allowlist exactly the egm marketplace: $(jq -c '.allowCrossMarketplaceDependenciesOn' "$marketplace")"

# ---------------------------------------------------------------- setup.sh is silent about egm
case_ "setup.sh is silent about egm"
[ -f "$setup" ] || fail "no $setup"
if grep -nE 'egm|task-draft' "$setup"; then
    fail "setup.sh still names egm or task-draft (lines above)"
fi
printf '%s\n' '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"egm_enabled":true,"taskdraft_enabled":true}}}}' \
    > "$CLAUDE_CONFIG_DIR/settings.json"
[ ! -e "$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json" ] || fail "the fixture has an installed_plugins.json"
rc=0
out=$(JUNKD_SETUP_PATH_DIRS= bash "$setup" </dev/null 2>&1) || rc=$?
[ "$rc" = 0 ] || fail "setup.sh exited $rc: $out"
# The run reached the end of the script: it set the output style of a settings.json that names none, so the
# silence below is not an early exit.
case "$out" in
    *"junkd: outputStyle set to junkd:STE"*) ;;
    *) fail "setup.sh did not run to its output-style step (no outputStyle line): $out" ;;
esac
[ "$(jq -r '.outputStyle' "$CLAUDE_CONFIG_DIR/settings.json")" = "junkd:STE" ] ||
    fail "setup.sh did not write outputStyle into the fixture settings.json"
# The temp path is masked first: a random mktemp name could itself hold the letters `egm`.
if printf '%s\n' "${out//"$tmp"/<tmp>}" | grep -E 'egm|task-draft'; then
    fail "setup.sh printed a line about egm or task-draft (above)"
fi

echo "egm-dep tests: all passed"
