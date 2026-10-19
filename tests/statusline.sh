#!/usr/bin/env bash
# statusline shell-side tests over temp dirs, never a real home:
# - bin/statusline.sh, the renderer: with every segment on, the line is byte-identical to tests/statusline/golden.txt,
#   which the renderer before the move into junkd (plugins/statusline/skills/statusline/statusline.sh) printed for
#   tests/statusline/input.json (__CWD__ is a linked worktree `wt-golden` on branch feature/golden). Each
#   statusline_<segment> setting off takes out exactly that segment and its separator.
# - bin/statusline-setup on|off|status over an isolated CLAUDE_CONFIG_DIR.
# Run: bash tests/statusline.sh. Every check is an explicit `if`/`[ ]` so `set -e` catches it.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/junkd"
render="$plugin/bin/statusline.sh"
setup="$plugin/bin/statusline-setup"
real_render="$plugin/skills/statusline/bin/statusline.sh"
golden="$root/tests/statusline/golden.txt"
# The physical path, once (a TMPDIR ending in `/` gives mktemp a `//`).
tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/T16-statusline-$$.XXXXXX")" && pwd -P)
trap 'rm -rf "$tmp"' EXIT

fail() { echo "statusline tests: $*" >&2; exit 1; }

home="$tmp/home"
cfg="$tmp/cfg"
mkdir -p "$home" "$cfg"
base=(env -u CLAUDE_CONFIG_DIR -u CLAUDECODE -u CLAUDE_PLUGIN_ROOT HOME="$home")

# ---------------------------------------------------------------- the links reach the real scripts
for x in statusline.sh statusline-setup; do
    [ -L "$plugin/skills/junkd/bin/$x" ] && [ -x "$plugin/skills/statusline/bin/$x" ] && [ ! -L "$plugin/skills/statusline/bin/$x" ] ||
        fail "skills/junkd/bin/$x is no link to a real skills/statusline/bin/$x"
    [ "$(readlink -f "$plugin/bin/$x")" = "$(readlink -f "$plugin/skills/statusline/bin/$x")" ] || fail "bin/$x does not reach skills/statusline/bin/$x"
done

# ---------------------------------------------------------------- the fixture: a linked worktree on feature/golden
git -C "$tmp" init -q -b main repo
git -C "$tmp/repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git -C "$tmp/repo" worktree add -q -b feature/golden "$tmp/wt-golden"
input=$(sed "s#__CWD__#$tmp/wt-golden#" "$root/tests/statusline/input.json")

# renders [settings.json content]: the line for the fixture, settings.json under CLAUDE_CONFIG_DIR (none when empty).
draw() {
    rm -f "$cfg/settings.json"
    [ -z "${1:-}" ] || printf '%s\n' "$1" > "$cfg/settings.json"
    printf '%s' "$input" | "${base[@]}" CLAUDE_CONFIG_DIR="$cfg" "$render"
}
same_as_golden() { # <what> <settings.json content>
    draw "${2:-}" > "$tmp/line"
    cmp -s "$tmp/line" "$golden" || fail "$1: the line differs from the golden: $(cat -v "$tmp/line")"
}
junkd_opts() { printf '{"theme":"dark","pluginConfigs":{"junkd@junk-drawer":{"options":%s}}}' "$1"; }

# ---------------------------------------------------------------- AC3: all on is the pre-move line
same_as_golden "no settings.json"
same_as_golden "all six on" "$(junkd_opts '{"statusline_ctx":true,"statusline_branch":true,"statusline_worktree":true,"statusline_model":true,"statusline_effort":true,"statusline_limits":true}')"
same_as_golden "missing pluginConfigs" '{"theme":"dark"}'
same_as_golden "an empty settings.json" ''
same_as_golden "pluginConfigs without junkd" '{"pluginConfigs":{"other@x":{"options":{"statusline_ctx":false}}}}'
same_as_golden "a junkd entry with no statusline keys" "$(junkd_opts '{"tldr_enabled":false}')"
same_as_golden "a junkd entry with no options" '{"pluginConfigs":{"junkd@junk-drawer":{}}}'
same_as_golden "on spellings" "$(junkd_opts '{"statusline_ctx":"on","statusline_branch":"true","statusline_worktree":null}')"
same_as_golden "a settings.json that does not parse" '{"pluginConfigs": {'
same_as_golden "a settings.json that is no object" '[1,2]'
# The line on its own: what the person sees today.
[ "$(sed 's/\x1b\[[0-9;]*m//g' "$golden")" = "ctx 139k free / 61k used (30%) │ feature/golden │ ⑂wt-golden │ Opus │ effort:high │ 5h:42% week:88%" ] ||
    fail "the golden is not the fixture's six segments"

# ---------------------------------------------------------------- each segment off: exactly it and its separator
sep=$'\033[2m │ \033[0m'
line=$(cat "$golden")
parts=()
rest=$line
while [[ "$rest" == *"$sep"* ]]; do
    parts+=("${rest%%"$sep"*}")
    rest=${rest#*"$sep"}
done
parts+=("$rest")
[ "${#parts[@]}" = 6 ] || fail "the golden has ${#parts[@]} segments, not 6"
segs=(ctx branch worktree model effort limits)
without() { # <index>: the golden with that segment and its separator taken out
    local out="" i
    for i in 0 1 2 3 4 5; do
        [ "$i" = "$1" ] && continue
        if [ -z "$out" ]; then out=${parts[$i]}; else out="$out$sep${parts[$i]}"; fi
    done
    printf '%s\n' "$out"
}
for i in 0 1 2 3 4 5; do
    for off in false '"off"' '"false"' 0 '"no"'; do
        draw "$(junkd_opts "{\"statusline_${segs[$i]}\":$off}")" > "$tmp/line"
        [ "$(cat "$tmp/line")" = "$(without "$i")" ] ||
            fail "statusline_${segs[$i]}=$off: got $(cat -v "$tmp/line"), want $(without "$i" | cat -v)"
    done
done
# All off: an empty line, as the old renderer printed with nothing to show.
draw "$(junkd_opts '{"statusline_ctx":false,"statusline_branch":false,"statusline_worktree":false,"statusline_model":false,"statusline_effort":false,"statusline_limits":false}')" > "$tmp/line"
[ "$(cat "$tmp/line")" = "" ] && [ "$(wc -c < "$tmp/line" | tr -d ' ')" = 1 ] || fail "all off: got $(cat -v "$tmp/line")"
# Two off at the ends.
draw "$(junkd_opts '{"statusline_ctx":false,"statusline_limits":false}')" > "$tmp/line"
[ "$(cat "$tmp/line")" = "${parts[1]}$sep${parts[2]}$sep${parts[3]}$sep${parts[4]}" ] || fail "ctx and limits off: $(cat -v "$tmp/line")"
# The first junkd@ entry decides; another plugin's entry never does.
draw '{"pluginConfigs":{"other@x":{"options":{"statusline_model":false}},"junkd@junk-drawer":{"options":{"statusline_branch":false}},"junkd@fork":{"options":{"statusline_ctx":false}}}}' > "$tmp/line"
[ "$(cat "$tmp/line")" = "$(without 1)" ] || fail "the first junkd@ entry does not decide alone: $(cat -v "$tmp/line")"

# CLAUDE_CONFIG_DIR is honoured: the HOME settings.json is not read while it is set, and is read when it is not.
mkdir -p "$home/.claude"
junkd_opts '{"statusline_model":false}' > "$home/.claude/settings.json"
draw "" > "$tmp/line"
cmp -s "$tmp/line" "$golden" || fail "the HOME settings.json was read with CLAUDE_CONFIG_DIR set"
printf '%s' "$input" | "${base[@]}" "$render" > "$tmp/line"
[ "$(cat "$tmp/line")" = "$(without 3)" ] || fail "with no CLAUDE_CONFIG_DIR, \$HOME/.claude/settings.json is not read"
rm -rf "$home/.claude"
# The effort fallback reads the same settings.json when the input names no effort.
printf '%s' "$input" | jq -c 'del(.effort_level)' > "$tmp/noeffort.json"
printf '{"effortLevel":"max"}\n' > "$cfg/settings.json"
"${base[@]}" CLAUDE_CONFIG_DIR="$cfg" "$render" < "$tmp/noeffort.json" | sed 's/\x1b\[[0-9;]*m//g' > "$tmp/line"
rg -qF '│ effort:max │' "$tmp/line" || fail "the effort fallback does not read \$CLAUDE_CONFIG_DIR/settings.json: $(cat "$tmp/line")"

# No jq at all: the line the old renderer printed without jq (it parses its input with jq too), a lone newline, and
# no error from the switches. A jq that fails only on settings.json: every segment drawn.
mkdir -p "$tmp/nojq" "$tmp/badjq"
for t in bash git bc basename cat printf sed dirname env; do
    p=$(command -v "$t") && ln -sf "$p" "$tmp/nojq/$t" && ln -sf "$p" "$tmp/badjq/$t"
done
printf '%s' "$input" | env -i PATH="$tmp/nojq" HOME="$home" CLAUDE_CONFIG_DIR="$cfg" bash "$real_render" > "$tmp/line" 2>"$tmp/err"
[ "$(od -An -c "$tmp/line" | tr -d ' ')" = '\n' ] || fail "no jq: got $(cat -v "$tmp/line")"
cat > "$tmp/badjq/jq" <<EOF
#!$(command -v bash)
for a in "\$@"; do case "\$a" in *settings.json) exit 1 ;; esac; done
exec $(command -v jq) "\$@"
EOF
chmod +x "$tmp/badjq/jq"
junkd_opts '{"statusline_ctx":false}' > "$cfg/settings.json"
printf '%s' "$input" | env -i PATH="$tmp/badjq" HOME="$home" CLAUDE_CONFIG_DIR="$cfg" bash "$real_render" > "$tmp/line"
cmp -s "$tmp/line" "$golden" || fail "a jq that fails on settings.json: not every segment drawn: $(cat -v "$tmp/line")"
rm -f "$cfg/settings.json"

# ---------------------------------------------------------------- statusline-setup on an isolated config dir
dest="$cfg/junkd/statusline.sh"
legacy="$cfg/junk-drawer-statusline.sh"
settings="$cfg/settings.json"
st() { # <args...>: sets out, err, rc
    set +e
    out=$("${base[@]}" CLAUDE_CONFIG_DIR="$cfg" "$setup" "$@" 2>"$tmp/err")
    rc=$?
    set -e
    err=$(cat "$tmp/err")
}
reset() { rm -rf "$cfg"; mkdir -p "$cfg"; }
cmd_is() { [ "$(jq -r '.statusLine.command' "$settings")" = "$1" ] && [ "$(jq -r '.statusLine.type' "$settings")" = command ]; }
no_temps() { # <dir>: no temp file of a write is left beside settings.json
    [ -z "$(find "$1" -maxdepth 1 -name 'settings.json.*' ! -name 'settings.json.bak')" ] || fail "a temp file was left in $1: $(ls -A "$1")"
}

# Fresh: no settings.json, no copy.
reset
st status
[ "$rc" = 0 ] && [ "$out" = off ] || fail "status fresh: rc $rc $out"
st on
[ "$rc" = 0 ] && cmd_is "$dest" || fail "on fresh: rc $rc $out $err"
[ -x "$dest" ] && cmp -s "$dest" "$real_render" || fail "on: the copy is not bin/statusline.sh, executable"
[ "$(stat -f %Lp "$dest" 2>/dev/null || stat -c %a "$dest")" = 755 ] || fail "on: the copy is not mode 0755"
[ ! -e "$settings.bak" ] || fail "on fresh: a backup of no file"
st status
[ "$out" = on ] || fail "status after on: $out"
# The copy renders the same line.
printf '%s' "$input" | "${base[@]}" CLAUDE_CONFIG_DIR="$tmp/none" "$dest" | cmp -s - "$golden" || fail "the installed copy does not render the golden"
# Again: nothing to change, nothing written, no backup.
before=$(cat "$settings")
st on
[ "$rc" = 0 ] && [ "$(cat "$settings")" = "$before" ] && [ ! -e "$settings.bak" ] || fail "on twice rewrote settings.json"
# An outdated copy is refreshed by on.
printf 'old\n' > "$dest"
st on
cmp -s "$dest" "$real_render" || fail "on does not refresh an outdated copy"
no_temps "$cfg"

# Other keys kept, a backup of the file as it was.
reset
printf '{\n  "theme": "dark",\n  "enabledPlugins": {"a@b": true}\n}\n' > "$settings"
cp "$settings" "$tmp/orig"
st on
[ "$rc" = 0 ] && cmd_is "$dest" && [ "$(jq -r .theme "$settings")" = dark ] && [ "$(jq -c .enabledPlugins "$settings")" = '{"a@b":true}' ] ||
    fail "on with other keys: rc $rc $(cat "$settings")"
cmp -s "$settings.bak" "$tmp/orig" || fail "on: the backup is not the file as it was"
[ "$(jq -r 'keys_unsorted | join(",")' "$settings")" = theme,enabledPlugins,statusLine ] || fail "on: the key order changed"
# off: the key and the copy go, the rest stays, the backup is the file before the off.
cp "$settings" "$tmp/before-off"
st off
[ "$rc" = 0 ] && [ "$out" = "statusline: off" ] || fail "off: rc $rc $out $err"
jq -e 'has("statusLine") | not' "$settings" >/dev/null && [ "$(jq -r .theme "$settings")" = dark ] || fail "off did not remove only the key: $(cat "$settings")"
[ ! -e "$dest" ] || fail "off left the copy"
cmp -s "$settings.bak" "$tmp/before-off" || fail "off: the backup is not the file before the off"
st status
[ "$out" = off ] || fail "status after off: $out"
# off with no statusLine: nothing written.
rm -f "$settings.bak"
cp "$settings" "$tmp/before-off"
st off
[ "$rc" = 0 ] && cmp -s "$settings" "$tmp/before-off" && [ ! -e "$settings.bak" ] || fail "off with no key wrote settings.json"
# An empty settings.json is {}.
: > "$settings"
st on
[ "$rc" = 0 ] && cmd_is "$dest" || fail "on over an empty settings.json: rc $rc $err"

# A statusLine of the person's own: on refuses (exit 1, one line), off and status leave it, --force replaces it.
reset
printf '{"statusLine":{"type":"command","command":"/my/own/line.sh"},"x":1}\n' > "$settings"
cp "$settings" "$tmp/orig"
st on
[ "$rc" = 1 ] && [ "$(wc -l <<<"$out" | tr -d ' ')" = 1 ] && rg -qF '/my/own/line.sh' <<<"$out" && rg -qF 'of your own' <<<"$out" ||
    fail "on over a foreign statusLine: rc $rc out $out"
cmp -s "$settings" "$tmp/orig" && [ ! -e "$settings.bak" ] && [ ! -e "$dest" ] || fail "on over a foreign statusLine touched something"
st status
[ "$rc" = 0 ] && [ "$out" = "off (/my/own/line.sh)" ] || fail "status with a foreign statusLine: $out"
mkdir -p "$cfg/junkd" && cp "$real_render" "$dest"
st off
[ "$rc" = 0 ] && rg -qF 'of your own' <<<"$out" && cmp -s "$settings" "$tmp/orig" && [ ! -e "$settings.bak" ] ||
    fail "off over a foreign statusLine: rc $rc $out"
[ -e "$dest" ] || fail "off over a foreign statusLine removed a file"
st on --force
[ "$rc" = 0 ] && cmd_is "$dest" && [ "$(jq -r .x "$settings")" = 1 ] && cmp -s "$settings.bak" "$tmp/orig" || fail "on --force: rc $rc $(cat "$settings")"
# A statusLine with no command of its own is foreign too.
printf '{"statusLine":{"type":"static","text":"hi"}}\n' > "$settings"
st on
[ "$rc" = 1 ] || fail "on over a statusLine with no command: rc $rc"
st status
rg -q '^off \(\{' <<<"$out" || fail "status with a statusLine with no command: $out"
# A command that only contains our path is not ours.
printf '{"statusLine":{"type":"command","command":"bash %s | tr a b"}}\n' "$dest" > "$settings"
st off
[ "$rc" = 0 ] && jq -e '.statusLine.command | startswith("bash ")' "$settings" >/dev/null || fail "off removed a command that wraps ours"
st on
[ "$rc" = 1 ] || fail "on replaced a command that wraps ours"
# A sibling path of ours is not ours.
printf '{"statusLine":{"type":"command","command":"%s.old"}}\n' "$dest" > "$settings"
st on
[ "$rc" = 1 ] || fail "on replaced a sibling path of ours"

# The legacy path: ours, moved to the new one by on; off removes it too.
reset
printf '#!/bin/sh\necho legacy\n' > "$legacy" && chmod +x "$legacy"
printf '{"statusLine":{"type":"command","command":"%s"},"theme":"dark"}\n' "$legacy" > "$settings"
st status
[ "$out" = on ] || fail "status with the legacy path: $out"
st on
[ "$rc" = 0 ] && cmd_is "$dest" && [ ! -e "$legacy" ] && [ -x "$dest" ] || fail "on did not migrate the legacy path: rc $rc $(cat "$settings")"
reset
printf '#!/bin/sh\n' > "$legacy"
printf '{"statusLine":{"type":"command","command":"%s"}}\n' "$legacy" > "$settings"
st off
[ "$rc" = 0 ] && jq -e 'has("statusLine") | not' "$settings" >/dev/null && [ ! -e "$legacy" ] || fail "off with the legacy path: rc $rc $(cat "$settings")"

# settings.json as a symlink: written through it (temp + mv beside the real file), the link stays a link.
reset
mkdir -p "$tmp/dotfiles"
printf '{"theme":"light"}\n' > "$tmp/dotfiles/settings.json"
ln -s "$tmp/dotfiles/settings.json" "$settings"
st on
[ "$rc" = 0 ] && [ -L "$settings" ] && cmd_is "$dest" && [ "$(jq -r .theme "$tmp/dotfiles/settings.json")" = light ] ||
    fail "on through a symlink: rc $rc, link $(ls -l "$settings")"
[ "$(jq -r .statusLine.command "$tmp/dotfiles/settings.json")" = "$dest" ] || fail "on through a symlink did not write the real file"
no_temps "$cfg"
no_temps "$tmp/dotfiles"
st off
[ "$rc" = 0 ] && [ -L "$settings" ] && jq -e 'has("statusLine") | not' "$tmp/dotfiles/settings.json" >/dev/null || fail "off through a symlink"
rm -rf "$tmp/dotfiles"

# A settings.json that does not parse, or is no object, is never written: on, off and status exit 1.
for bad in '{"theme": "dark",' '[1,2]' '"text"' 'not json'; do
    reset
    printf '%s\n' "$bad" > "$settings"
    cp "$settings" "$tmp/orig"
    for mode in on off status; do
        st "$mode"
        [ "$rc" = 1 ] && rg -qF 'does not parse' <<<"$err" || fail "$mode over '$bad': rc $rc $err"
        cmp -s "$settings" "$tmp/orig" && [ ! -e "$settings.bak" ] || fail "$mode over '$bad' wrote settings.json"
    done
    [ ! -e "$dest" ] || fail "on over '$bad' installed the copy"
done

# A settings.json that cannot be written: exit 1, the file as it was.
reset
printf '{"theme":"dark"}\n' > "$settings"
chmod 444 "$settings"
cp "$settings" "$tmp/orig"
st on
[ "$rc" = 1 ] && cmp -s "$settings" "$tmp/orig" || fail "on over a read-only settings.json: rc $rc $(cat "$settings")"
chmod 644 "$settings"
no_temps "$cfg"

# No jq: exit 1, nothing written.
reset
set +e
out=$(env -i PATH="$tmp/nojq" HOME="$home" CLAUDE_CONFIG_DIR="$cfg" bash "$plugin/skills/statusline/bin/statusline-setup" on 2>&1)
rc=$?
set -e
[ "$rc" = 1 ] && rg -qF 'needs jq' <<<"$out" && [ -z "$(ls -A "$cfg")" ] || fail "no jq: rc $rc $out"
# An unknown mode.
st bogus
[ "$rc" = 1 ] && rg -qF 'usage:' <<<"$err" || fail "an unknown mode: rc $rc"
# No CLAUDE_CONFIG_DIR: $HOME/.claude.
set +e
"${base[@]}" "$setup" on >/dev/null 2>&1
set -e
[ "$(jq -r .statusLine.command "$home/.claude/settings.json")" = "$home/.claude/junkd/statusline.sh" ] || fail "no CLAUDE_CONFIG_DIR: not \$HOME/.claude"
rm -rf "$home/.claude"

[ -z "$(ls -A "$home")" ] || fail "something was left under HOME: $(ls -A "$home")"
echo "statusline tests passed"
