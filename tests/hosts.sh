#!/usr/bin/env bash
# Host detection and handoff ids: handoff-path, handoff-load, tldr-flag and tldr-hook (skills/handoff/bin/host-lib)
# over a temp HOME, never the real one. Each host signal must land every helper in that host's data root; no signal
# exits 2 naming JUNK_DRAWER_RUNTIME and writes nothing; short ids are 8 hex chars and never a timestamp prefix;
# handoff-load lists an ambiguous fragment instead of guessing.
# Run: bash tests/hosts.sh. Every check is an explicit `if`/`[ ]` so `set -e` catches it.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
skills="$root/plugins/junkd/skills"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/T15-hosts-$$.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
H="$tmp/home"
TERSE='TL;DR MODE ON'

fail() { echo "hosts tests: $*" >&2; exit 1; }
# A pbcopy stub first on PATH: handoff-path copies the id, and a test must not touch the real clipboard.
mkdir -p "$tmp/stub"
printf '#!/bin/sh\ncat >/dev/null\n' > "$tmp/stub/pbcopy" && chmod +x "$tmp/stub/pbcopy"
# No host signal at all; each call adds the ones the host it plays sets.
noh=(env -u CLAUDECODE -u CLAUDE_PLUGIN_ROOT -u CLAUDE_CONFIG_DIR -u CLAUDE_CODE_SESSION_ID -u CODEX_THREAD_ID
    -u CODEX_HOME -u PLUGIN_ROOT -u KIMI_PLUGIN_ROOT -u KIMI_CODE_HOME -u KIMI_SESSION_ID -u OPENCODE -u OPENCODE_PID
    -u XDG_DATA_HOME -u JUNK_DRAWER_RUNTIME HOME="$H" PATH="$tmp/stub:$PATH")

# The helpers as an installed copy at <dir>/skills/<skill>/bin (what a host's $0 shows), real files as installers
# leave them.
install_at() { # <dir>
    mkdir -p "$1/skills"
    for s in handoff tldr handon; do cp -RL "$skills/$s" "$1/skills/$s"; done
}

# ---------------------------------------------------------------- each signal -> that host's data root, for all four
# probe <what> <handoffs dir> <flag dir> <skills dir> [VAR=value ...]: handoff-path's path, handoff-load's source,
# tldr-flag's flag file and tldr-hook's reading of it all sit in that host's root; nothing else appears under $HOME.
probe() {
    local what=$1 handoffs=$2 flags=$3 dir=$4 out path
    shift 4
    rm -rf "$H" "$tmp/xdg"
    mkdir -p "$H"
    out=$("${noh[@]}" "$@" "$dir/handoff/bin/handoff-path") || fail "$what: handoff-path exited non-zero"
    path=$(head -1 <<<"$out")
    [ "${path%/*}" = "$handoffs" ] || fail "$what: handoff-path wrote to ${path%/*}, expected $handoffs"
    [ -d "$handoffs" ] || fail "$what: handoff-path did not create $handoffs"
    printf '# fixture %s\n' "$what" > "$handoffs/2026-01-01T00-00_f1x7a9e0.md"
    for load in "$dir/handoff/bin/handoff-load" "$dir/handon/bin/handoff-load"; do
        out=$("${noh[@]}" "$@" "$load" f1x7a9e0) || fail "$what: $load exited non-zero"
        rg -qF "# fixture $what" <<<"$out" || fail "$what: $load did not read $handoffs, got: $out"
    done
    out=$("${noh[@]}" "$@" "$dir/tldr/bin/tldr-flag" on) || fail "$what: tldr-flag on exited non-zero"
    [ -f "$flags/tldr-on" ] || fail "$what: tldr-flag on did not write $flags/tldr-on"
    out=$("${noh[@]}" "$@" "$dir/tldr/bin/tldr-hook") || fail "$what: tldr-hook exited non-zero"
    rg -qF "$TERSE" <<<"$out" || fail "$what: tldr-hook did not read $flags/tldr-on, got: $out"
    "${noh[@]}" "$@" "$dir/tldr/bin/tldr-flag" off >/dev/null || fail "$what: tldr-flag off exited non-zero"
    out=$("${noh[@]}" "$@" "$dir/tldr/bin/tldr-hook") || fail "$what: tldr-hook (off) exited non-zero"
    [ -z "$out" ] || fail "$what: tldr-hook after off is not silent, got: $out"
    # nothing outside the host's root: only its top folder exists under $HOME
    local top
    top=$(cd "$H" && find . -mindepth 1 -maxdepth 1 | sort | tr '\n' ' ')
    case "$handoffs" in
        "$H"/*) [ "$top" = "./$(cut -d/ -f1 <<<"${handoffs#"$H"/}") " ] || fail "$what: wrote under \$HOME: $top" ;;
        *) [ -z "$top" ] || fail "$what: wrote under \$HOME although its root is elsewhere: $top" ;;
    esac
}

repo="$skills"
claude_h="$H/.claude/handoffs" claude_f="$H/.claude/junkd"
codex_h="$H/.codex/junk-drawer/handoffs" codex_f="$H/.codex/junk-drawer"
kimi_h="$H/.kimi-code/junk-drawer/handoffs" kimi_f="$H/.kimi-code/junk-drawer"
oc_h="$H/.local/share/opencode/junk-drawer/handoffs" oc_f="$H/.local/share/opencode/junk-drawer"

# explicit runtime, each value, and over a contrary signal
probe "runtime claude" "$claude_h" "$claude_f" "$repo" JUNK_DRAWER_RUNTIME=claude
probe "runtime codex" "$codex_h" "$codex_f" "$repo" JUNK_DRAWER_RUNTIME=codex CLAUDECODE=1
probe "runtime kimi" "$kimi_h" "$kimi_f" "$repo" JUNK_DRAWER_RUNTIME=kimi CLAUDECODE=1
probe "runtime opencode" "$oc_h" "$oc_f" "$repo" JUNK_DRAWER_RUNTIME=opencode CLAUDECODE=1
# Claude Code
probe "CLAUDECODE" "$claude_h" "$claude_f" "$repo" CLAUDECODE=1
probe "CLAUDECODE over CODEX_THREAD_ID" "$claude_h" "$claude_f" "$repo" CLAUDECODE=1 CODEX_THREAD_ID=x
probe "CLAUDE_PLUGIN_ROOT" "$claude_h" "$claude_f" "$repo" CLAUDE_PLUGIN_ROOT="$root/plugins/junkd"
probe "CLAUDECODE with CLAUDE_CONFIG_DIR" "$tmp/cc/handoffs" "$tmp/cc/junkd" "$repo" CLAUDECODE=1 CLAUDE_CONFIG_DIR="$tmp/cc"
probe "CLAUDE_CONFIG_DIR alone" "$tmp/cc/handoffs" "$tmp/cc/junkd" "$repo" CLAUDE_CONFIG_DIR="$tmp/cc"
# Codex: its bash tool's thread id; its hooks' PLUGIN_ROOT (with CLAUDE_PLUGIN_ROOT, the same path)
probe "CODEX_THREAD_ID" "$codex_h" "$codex_f" "$repo" CODEX_THREAD_ID=0199c3a2-7b1e-7cc0-9a51-3f2b8d7e6a10
probe "CODEX_THREAD_ID over CLAUDE_CONFIG_DIR" "$codex_h" "$codex_f" "$repo" CODEX_THREAD_ID=x CLAUDE_CONFIG_DIR="$tmp/cc"
probe "Codex hook, PLUGIN_ROOT under .codex" "$codex_h" "$codex_f" "$repo" \
    PLUGIN_ROOT="$H/.codex/plugins/cache/junk-drawer/junkd/0.4.0" CLAUDE_PLUGIN_ROOT="$H/.codex/plugins/cache/junk-drawer/junkd/0.4.0"
probe "Codex hook, PLUGIN_ROOT under CODEX_HOME" "$tmp/cx/junk-drawer/handoffs" "$tmp/cx/junk-drawer" "$repo" CODEX_HOME="$tmp/cx" \
    PLUGIN_ROOT="$tmp/cx/plugins/cache/junk-drawer/junkd/0.4.0" CLAUDE_PLUGIN_ROOT="$tmp/cx/plugins/cache/junk-drawer/junkd/0.4.0" \
    CLAUDE_CONFIG_DIR="$tmp/cc"
# a PLUGIN_ROOT outside any Codex home is no Codex signal: CLAUDE_PLUGIN_ROOT beside it still means Claude Code,
# also when the Codex home's path appears inside it further down
probe "PLUGIN_ROOT outside .codex, no CODEX_HOME" "$claude_h" "$claude_f" "$repo" PLUGIN_ROOT="$tmp/elsewhere/junkd" \
    CLAUDE_PLUGIN_ROOT="$tmp/elsewhere/junkd"
probe "PLUGIN_ROOT holding CODEX_HOME's path further down" "$claude_h" "$claude_f" "$repo" CODEX_HOME="$tmp/cx" \
    PLUGIN_ROOT="$tmp/elsewhere$tmp/cx/plugins/junkd" CLAUDE_PLUGIN_ROOT="$tmp/elsewhere$tmp/cx/plugins/junkd"
# a sibling of the Codex home (its path plus a suffix) is outside it: no Codex signal
probe "PLUGIN_ROOT under a sibling of CODEX_HOME" "$claude_h" "$claude_f" "$repo" CODEX_HOME="$tmp/cx" \
    PLUGIN_ROOT="$tmp/cx2/plugins/junkd" CLAUDE_PLUGIN_ROOT="$tmp/cx2/plugins/junkd"
# a CODEX_HOME spelled with a trailing slash still contains its plugins
probe "PLUGIN_ROOT under CODEX_HOME with a trailing slash" "$tmp/cx//junk-drawer/handoffs" "$tmp/cx//junk-drawer" "$repo" \
    CODEX_HOME="$tmp/cx/" PLUGIN_ROOT="$tmp/cx/plugins/junkd" CLAUDE_PLUGIN_ROOT="$tmp/cx/plugins/junkd"
probe "CODEX_HOME alone" "$tmp/cx/junk-drawer/handoffs" "$tmp/cx/junk-drawer" "$repo" CODEX_HOME="$tmp/cx"
# Kimi Code: its hooks' KIMI_PLUGIN_ROOT; its bash tool runs the helper from <home>/plugins/managed/<plugin>/
probe "KIMI_PLUGIN_ROOT" "$kimi_h" "$kimi_f" "$repo" KIMI_PLUGIN_ROOT="$root/plugins/junkd"
install_at "$tmp/km/plugins/managed/junkd"
probe "\$0 under plugins/managed" "$tmp/km/junk-drawer/handoffs" "$tmp/km/junk-drawer" "$tmp/km/plugins/managed/junkd/skills" \
    KIMI_CODE_HOME="$tmp/km" CLAUDE_CONFIG_DIR="$tmp/cc"
probe "\$0 under plugins/managed, no KIMI_CODE_HOME" "$kimi_h" "$kimi_f" "$tmp/km/plugins/managed/junkd/skills"
# Kimi's helper path wins over an OPENCODE inherited from a parent OpenCode shell: the script's own location names
# the install that runs it
probe "\$0 under plugins/managed over OPENCODE" "$kimi_h" "$kimi_f" "$tmp/km/plugins/managed/junkd/skills" OPENCODE=1 \
    OPENCODE_PID=4242
probe "KIMI_CODE_HOME alone" "$tmp/km/junk-drawer/handoffs" "$tmp/km/junk-drawer" "$repo" KIMI_CODE_HOME="$tmp/km"
# step 3 order: with only config-dir variables, CODEX_HOME comes before KIMI_CODE_HOME
probe "CODEX_HOME over KIMI_CODE_HOME" "$tmp/cx/junk-drawer/handoffs" "$tmp/cx/junk-drawer" "$repo" CODEX_HOME="$tmp/cx" \
    KIMI_CODE_HOME="$tmp/km"
# Kimi keeps a local-path install's plugin-root bin/ as an absolute symlink into the checkout: the helper reached
# through it is still under plugins/managed/ (the logical path, not the resolved one)
mkdir -p "$tmp/km2/plugins/managed/junkd"
ln -s "$repo/junkd/bin" "$tmp/km2/plugins/managed/junkd/bin"
rm -rf "$H" && mkdir -p "$H"
out=$("${noh[@]}" "$tmp/km2/plugins/managed/junkd/bin/handoff-path") || fail "managed bin link: handoff-path exited non-zero"
[ "$(head -1 <<<"$out" | sed 's#/[^/]*$##')" = "$kimi_h" ] || fail "managed bin link: handoff-path wrote $(head -1 <<<"$out"), expected under $kimi_h"
"${noh[@]}" "$tmp/km2/plugins/managed/junkd/bin/tldr-flag" on >/dev/null || fail "managed bin link: tldr-flag on exited non-zero"
[ -f "$kimi_f/tldr-on" ] || fail "managed bin link: tldr-flag on did not write $kimi_f/tldr-on"

# OpenCode: what it exports to its bash tool (OPENCODE, OPENCODE_PID), even beside a profile's CLAUDE_CONFIG_DIR
# (the observed leak into Claude Code); a skills install under .agents/skills or .opencode
probe "OPENCODE" "$oc_h" "$oc_f" "$repo" OPENCODE=1
probe "OPENCODE_PID over CLAUDE_CONFIG_DIR" "$oc_h" "$oc_f" "$repo" OPENCODE_PID=4242 CLAUDE_CONFIG_DIR="$tmp/cc"
probe "OPENCODE with XDG_DATA_HOME" "$tmp/xdg/opencode/junk-drawer/handoffs" "$tmp/xdg/opencode/junk-drawer" "$repo" OPENCODE=1 \
    XDG_DATA_HOME="$tmp/xdg"
install_at "$tmp/proj/.agents"
probe "\$0 under .agents/skills" "$oc_h" "$oc_f" "$tmp/proj/.agents/skills" CLAUDE_CONFIG_DIR="$tmp/cc"
install_at "$tmp/proj2/.opencode"
probe "\$0 under .opencode" "$oc_h" "$oc_f" "$tmp/proj2/.opencode/skills"

# OpenCode runs no hook: `on` says it only records the flag; the hosts with a hook do not say so
rm -rf "$H" && mkdir -p "$H"
out=$("${noh[@]}" OPENCODE=1 "$repo/tldr/bin/tldr-flag" on) || fail "opencode on: exited non-zero"
rg -qF 'OpenCode runs no hook' <<<"$out" || fail "opencode on: does not say OpenCode runs no hook, got: $out"
for host in claude codex kimi; do
    out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=$host "$repo/tldr/bin/tldr-flag" on) || fail "$host on: exited non-zero"
    [ "$out" = "TL;DR mode ON (all sessions with the plugin). Use tldr off to stop." ] || fail "$host on: got $out"
done

# ---------------------------------------------------------------- no signal: exit 2, the message, nothing written
for helper in handoff/bin/handoff-path handoff/bin/handoff-load handon/bin/handoff-load "tldr/bin/tldr-flag on" \
    "tldr/bin/tldr-flag status" tldr/bin/tldr-hook; do
    for dir in "$repo" "$tmp/proj-none"; do
        rm -rf "$H" && mkdir -p "$H"
        [ "$dir" = "$repo" ] || { rm -rf "$dir"; install_at "$dir"; dir="$dir/skills"; }
        set +e
        out=$("${noh[@]}" $dir/$helper 2>&1)
        rc=$?
        set -e
        [ "$rc" = 2 ] || fail "no signal: $helper exited $rc, expected 2 ($out)"
        [ "$(wc -l <<<"$out" | tr -d ' ')" = 1 ] && rg -qF 'JUNK_DRAWER_RUNTIME' <<<"$out" ||
            fail "no signal: $helper did not print one line naming JUNK_DRAWER_RUNTIME, got: $out"
        [ -z "$(find "$H" -mindepth 1)" ] || fail "no signal: $helper wrote under \$HOME: $(find "$H" -mindepth 1)"
    done
done
# a value that names no host is the same error
set +e
out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=cursor CLAUDECODE=1 "$repo/tldr/bin/tldr-flag" on 2>&1)
rc=$?
set -e
[ "$rc" = 2 ] && rg -qF 'JUNK_DRAWER_RUNTIME' <<<"$out" || fail "JUNK_DRAWER_RUNTIME=cursor: exited $rc, got: $out"
[ ! -e "$H/.claude" ] || fail "JUNK_DRAWER_RUNTIME=cursor: wrote under \$HOME/.claude"

# ---------------------------------------------------------------- status and off create nothing
for host in claude codex kimi opencode; do
    for arg in status off; do
        rm -rf "$H" && mkdir -p "$H"
        out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=$host "$repo/tldr/bin/tldr-flag" $arg) || fail "$host $arg: exited non-zero"
        [ -z "$(find "$H" -mindepth 1)" ] || fail "$host tldr-flag $arg created $(find "$H" -mindepth 1 | head -3)"
    done
done

# ---------------------------------------------------------------- handoff-path failures leave nothing behind
# an unwritable data root: exit 1, no path printed
rm -rf "$H" && mkdir -p "$H" && chmod 555 "$H"
set +e
out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=codex "$repo/handoff/bin/handoff-path" 2>/dev/null)
rc=$?
set -e
chmod 755 "$H"
[ "$rc" = 1 ] && [ -z "$out" ] || fail "unwritable root: handoff-path exited $rc and printed: $out"
[ -z "$(find "$H" -mindepth 1)" ] || fail "unwritable root: handoff-path left $(find "$H" -mindepth 1)"

# ---------------------------------------------------------------- short ids
path_id() { "${noh[@]}" "$@" "$repo/handoff/bin/handoff-path" | tail -1; }
is_hex8() { [[ "$1" =~ ^[0-9a-f]{8}$ ]]; }
# no session id (OpenCode, Kimi, Codex without one): two calls in the same second differ
for host in opencode kimi codex; do
    for _ in 1 2 3 4 5; do
        s1=$(date +%s)
        a=$(path_id JUNK_DRAWER_RUNTIME=$host)
        b=$(path_id JUNK_DRAWER_RUNTIME=$host)
        [ "$(date +%s)" = "$s1" ] && break
    done
    [ "$(date +%s)" = "$s1" ] || fail "$host: could not make two calls within one second"
    is_hex8 "$a" && is_hex8 "$b" || fail "$host: ids are not 8 hex chars: $a $b"
    [ "$a" != "$b" ] || fail "$host: two calls in the same second gave the same id $a"
    case "$s1" in "$a"*) fail "$host: the id $a is a prefix of the epoch $s1" ;; esac
done
# a Codex thread id is a UUIDv7: never its timestamp prefix, the same thread keeps its id, two threads of the same
# moment differ
v7a=01a15435-f9b6-7351-b2f0-8b19650c5d20
v7b=01a15435-f9b6-7aaa-9c01-0d1e2f3a4b5c
a=$(path_id CODEX_THREAD_ID=$v7a)
is_hex8 "$a" || fail "UUIDv7: id is not 8 hex chars: $a"
[ "$a" != "${v7a:0:8}" ] || fail "UUIDv7: the id is the thread id's timestamp prefix $a"
[ "$a" = "$(printf '%s' "$v7a" | shasum -a 1 | cut -c1-8)" ] || fail "UUIDv7: the id $a is not the hash of the thread id"
[ "$(path_id CODEX_THREAD_ID=$v7a)" = "$a" ] || fail "UUIDv7: the same thread gave a different id"
[ "$(path_id CODEX_THREAD_ID=$v7b)" != "$a" ] || fail "UUIDv7: two threads with the same timestamp share an id"
# a Kimi session id is hashed too
k=$(path_id JUNK_DRAWER_RUNTIME=kimi KIMI_SESSION_ID=session_a9cdb046-fa37-4906-9616-86a5c6b1782f)
[ "$k" = "$(printf '%s' session_a9cdb046-fa37-4906-9616-86a5c6b1782f | shasum -a 1 | cut -c1-8)" ] ||
    fail "kimi: the id $k is not the hash of KIMI_SESSION_ID"
# Claude Code: a UUIDv4 session id, whose first 8 hex chars are random, is used as it is (the pane spells ids so)
[ "$(path_id CLAUDECODE=1 CLAUDE_CODE_SESSION_ID=9f3e2a71-5c4b-4d2e-8f10-123456789abc)" = 9f3e2a71 ] ||
    fail "claude: the id is not the session id's first 8 chars"
c1=$(path_id CLAUDECODE=1)
c2=$(path_id CLAUDECODE=1)
is_hex8 "$c1" && [ "$c1" != "$c2" ] || fail "claude without a session id: ids $c1 $c2"

# no shasum: md5sum, else md5 -q, hashes the id (stubs that print the real MD5, so the fallback is pinned on any
# platform); no hash tool at all: exit 1, no path, no folder
py=$(command -v python3)
mkdir -p "$tmp/m5" "$tmp/m5q" "$tmp/nohash"
for d in m5 m5q nohash; do
    for t in bash mkdir date od tr cut; do ln -s "$(command -v $t)" "$tmp/$d/$t"; done
    cp "$tmp/stub/pbcopy" "$tmp/$d/pbcopy"
done
printf '#!%s\nimport hashlib, sys\nprint(hashlib.md5(sys.stdin.buffer.read()).hexdigest() + "  -")\n' "$py" > "$tmp/m5/md5sum"
printf '#!%s\nimport hashlib, sys\nassert sys.argv[1:] == ["-q"]\nprint(hashlib.md5(sys.stdin.buffer.read()).hexdigest())\n' "$py" > "$tmp/m5q/md5"
chmod +x "$tmp/m5/md5sum" "$tmp/m5q/md5"
want=$("$py" -c 'import hashlib, sys; print(hashlib.md5(sys.argv[1].encode()).hexdigest()[:8])' "$v7a")
for d in m5 m5q; do
    rm -rf "$H" && mkdir -p "$H"
    got=$("${noh[@]}" PATH="$tmp/$d" CODEX_THREAD_ID=$v7a "$tmp/$d/bash" "$repo/handoff/bin/handoff-path" | tail -1) ||
        fail "no shasum ($d): handoff-path exited non-zero"
    [ "$got" = "$want" ] || fail "no shasum ($d): id $got, expected the MD5 prefix $want"
done
rm -rf "$H" && mkdir -p "$H"
set +e
out=$("${noh[@]}" PATH="$tmp/nohash" CODEX_THREAD_ID=$v7a "$tmp/nohash/bash" "$repo/handoff/bin/handoff-path" 2>"$tmp/err")
rc=$?
set -e
[ "$rc" = 1 ] && [ -z "$out" ] || fail "no hash tool: handoff-path exited $rc and printed: $out"
rg -qF 'could not derive a short id' "$tmp/err" || fail "no hash tool: no reason given: $(cat "$tmp/err")"
[ -z "$(find "$H" -mindepth 1)" ] || fail "no hash tool: handoff-path left $(find "$H" -mindepth 1)"

# ---------------------------------------------------------------- handoff-load: a fragment, an exact id, the newest
rm -rf "$H" && mkdir -p "$codex_h"
printf '# first topic\n' > "$codex_h/2026-01-01T10-00_ab12cd34.md"
printf '# second topic\n' > "$codex_h/2026-01-01T11-00_ab12ef56.md"
touch -t 202601011000 "$codex_h/2026-01-01T10-00_ab12cd34.md"
touch -t 202601011100 "$codex_h/2026-01-01T11-00_ab12ef56.md"
for load in "$repo/handoff/bin/handoff-load" "$repo/handon/bin/handoff-load"; do
    set +e
    out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=codex "$load" ab12 2>"$tmp/err")
    rc=$?
    set -e
    [ "$rc" = 1 ] || fail "two matches: $load exited $rc, expected 1"
    [ -z "$out" ] || fail "two matches: $load printed a handoff: $out"
    rg -qF "several handoffs match 'ab12' in $codex_h; run again with one of these ids:" "$tmp/err" ||
        fail "two matches: $load did not say why it lists: $(cat "$tmp/err")"
    rg -q 'ab12cd34 +first topic' "$tmp/err" && rg -q 'ab12ef56 +second topic' "$tmp/err" ||
        fail "two matches: $load did not list both ids with their titles: $(cat "$tmp/err")"
    out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=codex "$load" ab12cd34) || fail "exact id: $load exited non-zero"
    rg -qF '# first topic' <<<"$out" && rg -qF '# handoff: 2026-01-01T10-00_ab12cd34.md' <<<"$out" ||
        fail "exact id: $load did not load ab12cd34, got: $out"
    out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=codex "$load" ef56) || fail "one match: $load exited non-zero"
    rg -qF '# second topic' <<<"$out" || fail "one match: $load did not load ab12ef56, got: $out"
    out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=codex "$load") || fail "no id: $load exited non-zero"
    rg -qF '# second topic' <<<"$out" || fail "no id: $load did not load the newest, got: $out"
    set +e
    out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=codex "$load" zzzz 2>&1)
    rc=$?
    set -e
    [ "$rc" = 1 ] && rg -qF "no handoff found matching 'zzzz' in $codex_h" <<<"$out" || fail "no match: $load exited $rc, got: $out"
done
# one session saved twice: its exact id loads the newer of the two, though the id matches both
printf '# older save\n' > "$codex_h/2026-01-02T09-00_77aa88bb.md"
printf '# newer save\n' > "$codex_h/2026-01-02T12-00_77aa88bb.md"
touch -t 202601020900 "$codex_h/2026-01-02T09-00_77aa88bb.md"
touch -t 202601021200 "$codex_h/2026-01-02T12-00_77aa88bb.md"
out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=codex "$repo/handoff/bin/handoff-load" 77aa88bb) || fail "same id twice: exited non-zero"
rg -qF '# newer save' <<<"$out" || fail "same id twice: did not load the newer save, got: $out"
# a fragment that is also part of an exact id elsewhere: the exact id wins over a date-part match
printf '# dated\n' > "$codex_h/2026-01-03T20-26_cafe0001.md"
printf '# exact\n' > "$codex_h/2026-01-03T08-00_20260103.md"
touch -t 202601032026 "$codex_h/2026-01-03T20-26_cafe0001.md"
touch -t 202601030800 "$codex_h/2026-01-03T08-00_20260103.md"
out=$("${noh[@]}" JUNK_DRAWER_RUNTIME=codex "$repo/handoff/bin/handoff-load" 20260103) || fail "exact over date: exited non-zero"
rg -qF '# exact' <<<"$out" || fail "exact over date: did not load the exact id, got: $out"

# ---------------------------------------------------------------- the copies stay one file
for copy in tldr/bin/host-lib handon/bin/host-lib; do
    cmp -s "$skills/handoff/bin/host-lib" "$skills/$copy" || fail "skills/$copy differs from skills/handoff/bin/host-lib"
done
cmp -s "$skills/handoff/bin/handoff-load" "$skills/handon/bin/handoff-load" ||
    fail "skills/handon/bin/handoff-load differs from skills/handoff/bin/handoff-load"

echo "hosts tests passed"
