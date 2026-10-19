#!/usr/bin/env bash
# The orch_claude_md switch: scripts/orch-claude-md.sh on|off over a temp CLAUDE_CONFIG_DIR (never the real
# ~/.claude/CLAUDE.md), and its run from scripts/setup.sh at session start per the setting. Run: bash tests/claude-md.sh
# (tests/smoke.sh runs it too). Every check is an explicit `if`/`[ ]` so `set -e` catches it.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/junkd"
script="$plugin/scripts/orch-claude-md.sh"
setup="$plugin/scripts/setup.sh"
tmp=$(cd -P "$(mktemp -d)" && pwd) # the real path: the backup is named after the real file
trap 'rm -rf "$tmp"' EXIT
export CLAUDE_CONFIG_DIR="$tmp/cfg"
md="$CLAUDE_CONFIG_DIR/CLAUDE.md"

fail() { echo "claude-md tests: $*" >&2; exit 1; }
reset() { rm -rf "$CLAUDE_CONFIG_DIR"; mkdir -p "$CLAUDE_CONFIG_DIR"; }
backups() { find "$CLAUDE_CONFIG_DIR" -name 'CLAUDE.md.bak-*' | wc -l | tr -d ' '; }
# Nothing but CLAUDE.md and its backups (and what a case put there itself) is left in the config dir: no temp file.
no_litter() { [ -z "$(ls -A "$CLAUDE_CONFIG_DIR" | grep -Ev '^(CLAUDE\.md(\.bak-[0-9]{8}-[0-9]{6}-.{4})?|settings\.json|junkd|real|link-target)$')" ] ||
    fail "$1: a stray file is left: $(ls -A "$CLAUDE_CONFIG_DIR")"; }
# run <mode>: the script's output (stdout and stderr); its exit code in $rc.
run() { rc=0; out=$("$script" "$@" 2>&1) || rc=$?; }
# expect <file> <printf format>: the file holds exactly these bytes.
expect() { cmp -s "$1" <(printf "$2") || { echo "--- got:"; od -c "$1" | head -40; fail "$3"; }; }

BLOCK='<!-- junkd:orch start -->\n## Orchestrator mode\nThe junkd plugin prints the orchestrator rules at session start; full text and settings: `/junkd:orch`.\n<!-- junkd:orch end -->\n'
BLOCK_CRLF='<!-- junkd:orch start -->\r\n## Orchestrator mode\r\nThe junkd plugin prints the orchestrator rules at session start; full text and settings: `/junkd:orch`.\r\n<!-- junkd:orch end -->\r\n'

# ---------------------------------------------------------------- layout
[ -x "$plugin/skills/orch/scripts/orch-claude-md.sh" ] || fail "skills/orch/scripts/orch-claude-md.sh is not executable"
[ -L "$plugin/skills/junkd/scripts/orch-claude-md.sh" ] || fail "skills/junkd/scripts/orch-claude-md.sh is not the symlink to the orch skill's copy"
[ "$(readlink "$plugin/skills/junkd/scripts/orch-claude-md.sh")" = ../../orch/scripts/orch-claude-md.sh ] || fail "the symlink does not lead to ../../orch/scripts/orch-claude-md.sh"
# the seam: the hooks module runs the script at the plugin-root path, which resolves to the same file setup.sh runs
rg -qF '`${$.plugin.root}/scripts/orch-claude-md.sh`' "$plugin/hooks/orch.tsx" || fail "hooks/orch.tsx does not run \${\$.plugin.root}/scripts/orch-claude-md.sh"
[ -x "$plugin/scripts/orch-claude-md.sh" ] && [ "$plugin/scripts/orch-claude-md.sh" -ef "$plugin/skills/orch/scripts/orch-claude-md.sh" ] ||
    fail "scripts/orch-claude-md.sh at the plugin root is not the orch skill's script"
rg -qF '"$root/skills/orch/scripts/orch-claude-md.sh"' "$plugin/skills/junkd/scripts/setup.sh" || fail "setup.sh does not run skills/orch/scripts/orch-claude-md.sh"
jq -e '.userConfig.orch_claude_md | .type == "boolean" and .default == false' "$plugin/.claude-plugin/plugin.json" >/dev/null ||
    fail "plugin.json: userConfig.orch_claude_md is not a boolean defaulting to false"
rg -qF "{ key: 'orch_claude_md', group: 'orch', field: 'claude_md', type: 'boolean', title: 'CLAUDE.md pointer block', default: false, main: true }" "$plugin/hooks/settings.ts" ||
    fail "settings.ts: orch_claude_md is not a main row of the orch group defaulting to false"

# ---------------------------------------------------------------- the mode
reset
printf '## Orchestrator mode\nx\n' > "$md"
for bad in "" maybe ON; do
    run $bad
    [ "$rc" = 2 ] || fail "mode '$bad': expected exit 2, got $rc"
    [[ "$out" == usage:* ]] || fail "mode '$bad': no usage line: $out"
done
expect "$md" '## Orchestrator mode\nx\n' "a bad mode wrote the file"
[ "$(backups)" = 0 ] || fail "a bad mode made a backup"

# ================================================================ on (AC1)
# section -> block; the cut section's trailing blank line is given back before the next heading
reset
printf '# Me\n\nintro\n\n## Orchestrator mode\nrules\n\n## Other\nx\n' > "$md"
cp "$md" "$tmp/orig"
run on
[ "$rc" = 0 ] || fail "on: exit $rc: $out"
[[ "$out" == "updated $md: orchestrator section -> junkd:orch pointer block (backup: $md.bak-"* ]] || fail "on: the line is: $out"
expect "$md" "# Me\n\nintro\n\n${BLOCK}\n## Other\nx\n" "on: the section did not become the block"
[ "$(backups)" = 1 ] || fail "on: expected one backup, got $(backups)"
cmp -s "$(find "$CLAUDE_CONFIG_DIR" -name 'CLAUDE.md.bak-*')" "$tmp/orig" || fail "on: the backup is not the original"
no_litter on
# idempotent: byte-identical, no second backup
cp "$md" "$tmp/after"
run on
[ "$rc" = 0 ] && [ "$out" = "up to date $md" ] || fail "on again: $rc $out"
cmp -s "$md" "$tmp/after" || fail "on again: the file changed"
[ "$(backups)" = 1 ] || fail "on again: a backup was made"
no_litter "on again"

# H3 children are cut with it, up to the next H2; an H1 ends it too; a section at the end of the file is cut whole
reset
printf '## A\na\n## Orchestrator mode\nr\n### Sub one\ns1\n### Sub two\ns2\n## B\nb\n' > "$md"
run on
expect "$md" "## A\na\n${BLOCK}\n## B\nb\n" "on: the H3 children were not cut up to the next H2"
reset
printf '## Orchestrator mode\nr\n### Sub\ns\n# Top\nt\n' > "$md"
run on
expect "$md" "${BLOCK}\n# Top\nt\n" "on: an H1 did not end the section"
reset
printf 'pre\n## Orchestrator mode\nr\n### Sub\ns\n' > "$md"
run on
[ "$rc" = 0 ] || fail "on: section at the end of the file: exit $rc: $out"
expect "$md" "pre\n${BLOCK}" "on: a section at the end of the file was not cut whole"
# a heading that only starts like one (`##x`, `###`) does not end the section
reset
printf '## Orchestrator mode\nr\n##x\n#### deep\n## Next\n' > "$md"
run on
expect "$md" "${BLOCK}\n## Next\n" "on: ##x or #### ended the section"

# no section and no block: untouched, no backup
reset
printf '# Me\n\n## Orchestrator\n## orchestrator mode\n  ## Orchestrator mode\n' > "$md"
cp "$md" "$tmp/orig"
run on
[ "$rc" = 0 ] && [ "$out" = "up to date $md" ] || fail "on, nothing to do: $rc $out"
cmp -s "$md" "$tmp/orig" || fail "on, nothing to do: the file changed"
[ "$(backups)" = 0 ] || fail "on, nothing to do: a backup was made"

# block already present: untouched, no backup; and a stale block is written afresh (only that)
reset
printf "# Me\n\n${BLOCK}\n## Other\n" > "$md"
cp "$md" "$tmp/orig"
run on
cmp -s "$md" "$tmp/orig" || fail "on, block present: the file changed"
[ "$(backups)" = 0 ] || fail "on, block present: a backup was made"
reset
printf '# Me\n<!-- junkd:orch start -->\nold text\n<!-- junkd:orch end -->\ntail\n' > "$md"
run on
expect "$md" "# Me\n${BLOCK}tail\n" "on: a stale block was not written afresh"
# a block and a section left beside it: one block, the section cut
reset
printf "${BLOCK}\n## Orchestrator mode\nr\n## Z\n" > "$md"
run on
expect "$md" "${BLOCK}\n\n## Z\n" "on: block plus section did not end with one block"

# headings and markers inside fences do not count
reset
printf '# Me\n```md\n## Orchestrator mode\n<!-- junkd:orch start -->\n```\n~~~\n## Orchestrator mode\n~~~\n' > "$md"
cp "$md" "$tmp/orig"
run on
[ "$rc" = 0 ] || fail "on, fenced: exit $rc: $out"
cmp -s "$md" "$tmp/orig" || fail "on: a heading or a marker inside a fence counted"
[ "$(backups)" = 0 ] || fail "on, fenced: a backup was made"
# inside the section, a fenced `## ` does not end it, and a fence closes only on its own character and a long enough run
reset
printf '## Orchestrator mode\n````\n```\n## Not a heading\n~~~\n````\n~~~\n## Still in\n~~~\n## Next\n' > "$md"
run on
[ "$rc" = 0 ] || fail "on, fenced section: exit $rc: $out"
expect "$md" "${BLOCK}\n## Next\n" "on: a fenced heading ended the section, or a short or foreign run closed the fence"
# a longer run of the other character (~~~~ in a ``` fence) does not close it
reset
printf '## Orchestrator mode\n```\n~~~~\n## In\n```\n## Next\n' > "$md"
run on
expect "$md" "${BLOCK}\n## Next\n" "on: ~~~~ closed a \`\`\` fence"
# a fence line with an info string (```bash) opens a fence but never closes one
reset
printf '## Orchestrator mode\n```\n```bash\n## In\n```\n## Next\n' > "$md"
run on
expect "$md" "${BLOCK}\n## Next\n" "on: \`\`\`bash closed a fence"
# ```x``` on one line is inline code, no fence: the heading after it counts
reset
printf '```x```\n## Orchestrator mode\nr\n' > "$md"
run on
expect "$md" "\`\`\`x\`\`\`\n${BLOCK}" "on: inline \`\`\`x\`\`\` opened a fence"
# an indented fence counts as a fence
reset
printf '  ```\n## Orchestrator mode\n  ```\n' > "$md"
cp "$md" "$tmp/orig"
run on
cmp -s "$md" "$tmp/orig" || fail "on: an indented fence did not count"

# an unclosed start marker: exit 1, nothing written, no backup, no temp file
reset
printf '# Me\n<!-- junkd:orch start -->\n## Orchestrator mode\nr\n' > "$md"
cp "$md" "$tmp/orig"
run on
[ "$rc" = 1 ] || fail "on, unclosed block: expected exit 1, got $rc"
[[ "$out" == "refused $md: "* ]] || fail "on, unclosed block: the line is: $out"
cmp -s "$md" "$tmp/orig" || fail "on, unclosed block: the file was written"
[ "$(backups)" = 0 ] || fail "on, unclosed block: a backup was made"
no_litter "on, unclosed block"
# an end marker inside a fence in the block does not close it
reset
printf '<!-- junkd:orch start -->\n```\n<!-- junkd:orch end -->\n```\nx\n' > "$md"
cp "$md" "$tmp/orig"
run on
[ "$rc" = 1 ] || fail "on: a fenced end marker closed the block (exit $rc)"
cmp -s "$md" "$tmp/orig" || fail "on, fenced end marker: the file was written"
# a fence left open inside the section: exit 1, nothing written
reset
printf '## Orchestrator mode\n```\n## X\n' > "$md"
cp "$md" "$tmp/orig"
run on
[ "$rc" = 1 ] || fail "on, open fence in the section: expected exit 1, got $rc"
cmp -s "$md" "$tmp/orig" || fail "on, open fence in the section: the file was written"
[ "$(backups)" = 0 ] || fail "on, open fence in the section: a backup was made"
# a fence left open outside any section is the file's own business
reset
printf '## Orchestrator mode\nr\n## Z\n```\nopen\n' > "$md"
run on
[ "$rc" = 0 ] || fail "on, open fence after the section: exit $rc"
expect "$md" "${BLOCK}\n## Z\n\`\`\`\nopen\n" "on, open fence after the section"

# CRLF: the section matches, the block and the blank line come in CRLF
reset
printf '# Me\r\n\r\n## Orchestrator mode\r\nr\r\n### Sub\r\ns\r\n\r\n## Other\r\nx\r\n' > "$md"
run on
[ "$rc" = 0 ] || fail "on, CRLF: exit $rc: $out"
expect "$md" "# Me\r\n\r\n${BLOCK_CRLF}\r\n## Other\r\nx\r\n" "on, CRLF: not a CRLF block"
run on
[ "$out" = "up to date $md" ] || fail "on, CRLF again: $out"
# an LF file gets no CR anywhere
reset
printf '## Orchestrator mode\nr\n## Z\n' > "$md"
run on
if grep -q $'\r' "$md"; then fail "on, LF file: a CR was written"; fi

# a symlinked CLAUDE.md is written through: the link stays a link, the target changes, the backup sits beside it
reset
mkdir -p "$CLAUDE_CONFIG_DIR/real"
printf '## Orchestrator mode\nr\n' > "$CLAUDE_CONFIG_DIR/real/CLAUDE.md"
ln -s real/CLAUDE.md "$md"
run on
[ "$rc" = 0 ] || fail "on, symlink: exit $rc: $out"
[ -L "$md" ] || fail "on, symlink: the link was replaced by a file"
expect "$CLAUDE_CONFIG_DIR/real/CLAUDE.md" "${BLOCK}" "on, symlink: the target was not written"
[ "$(find "$CLAUDE_CONFIG_DIR/real" -name 'CLAUDE.md.bak-*' | wc -l | tr -d ' ')" = 1 ] || fail "on, symlink: no backup beside the target"
# the file's mode is kept (640: neither mktemp's 600 nor the usual umask's 644)
reset
printf '## Orchestrator mode\nr\n' > "$md"
chmod 640 "$md"
run on
[ "$(ls -l "$md" | cut -c1-10)" = "-rw-r-----" ] || fail "on: the file's mode was not kept: $(ls -l "$md")"

# missing CLAUDE.md: skipped, exit 0, never created (a dangling link is missing too)
reset
run on
[ "$rc" = 0 ] && [ "$out" = "skipped $md: not found" ] || fail "on, missing: $rc $out"
[ ! -e "$md" ] || fail "on, missing: CLAUDE.md was created"
ln -s nowhere/CLAUDE.md "$md"
run on
[ "$rc" = 0 ] && [ "$out" = "skipped $md: not found" ] || fail "on, dangling link: $rc $out"
[ ! -e "$CLAUDE_CONFIG_DIR/nowhere" ] || fail "on, dangling link: its target was created"
# no CLAUDE_CONFIG_DIR: $HOME/.claude
reset
mkdir -p "$tmp/home/.claude"
printf '## Orchestrator mode\nr\n' > "$tmp/home/.claude/CLAUDE.md"
rc=0; out=$(env -u CLAUDE_CONFIG_DIR HOME="$tmp/home" "$script" on 2>&1) || rc=$?
[ "$rc" = 0 ] || fail "on, HOME: exit $rc: $out"
expect "$tmp/home/.claude/CLAUDE.md" "${BLOCK}" "on: without CLAUDE_CONFIG_DIR, \$HOME/.claude/CLAUDE.md was not the file"

# ================================================================ off (AC2)
# the block goes with its one trailing blank line; everything else byte-identical
reset
printf "# Me\n\nintro\n\n${BLOCK}\n## Other\nx\n\n\n## Orchestrator mode\nkept\n" > "$md"
cp "$md" "$tmp/orig"
run off
[ "$rc" = 0 ] || fail "off: exit $rc: $out"
[[ "$out" == "updated $md: junkd:orch pointer block removed (backup: $md.bak-"* ]] || fail "off: the line is: $out"
expect "$md" "# Me\n\nintro\n\n## Other\nx\n\n\n## Orchestrator mode\nkept\n" "off: not just the block and its blank line removed"
[ "$(backups)" = 1 ] || fail "off: expected one backup, got $(backups)"
cmp -s "$(find "$CLAUDE_CONFIG_DIR" -name 'CLAUDE.md.bak-*')" "$tmp/orig" || fail "off: the backup is not the file before"
no_litter off
# idempotent
cp "$md" "$tmp/after"
run off
[ "$rc" = 0 ] && [ "$out" = "up to date $md" ] || fail "off again: $rc $out"
cmp -s "$md" "$tmp/after" || fail "off again: the file changed"
[ "$(backups)" = 1 ] || fail "off again: a backup was made"
# only one blank line goes; a non-blank line right after the block stays; a block at the end of the file goes whole
reset
printf "a\n${BLOCK}\n\nb\n" > "$md"
run off
expect "$md" "a\n\nb\n" "off: more or less than one blank line went"
reset
printf "a\n${BLOCK}b\n" > "$md"
run off
expect "$md" "a\nb\n" "off: the line right after the block went"
reset
printf "a\n${BLOCK}" > "$md"
run off
expect "$md" "a\n" "off: a block at the end of the file"
# on then off: the section is gone for good (the backup holds it), the rest is as before
reset
printf '# Me\n\n## Orchestrator mode\nr\n\n## Other\n' > "$md"
run on
run off
expect "$md" "# Me\n\n## Other\n" "on then off"
[ "$(backups)" = 2 ] || fail "on then off: expected two backups"
# no block: untouched, no backup (an orchestrator section is not ours to remove)
reset
printf '# Me\n## Orchestrator mode\nr\n' > "$md"
cp "$md" "$tmp/orig"
run off
[ "$rc" = 0 ] && [ "$out" = "up to date $md" ] || fail "off, no block: $rc $out"
cmp -s "$md" "$tmp/orig" || fail "off, no block: the file changed"
[ "$(backups)" = 0 ] || fail "off, no block: a backup was made"
# markers inside a fence do not count
reset
printf '```\n<!-- junkd:orch start -->\nx\n<!-- junkd:orch end -->\n```\n' > "$md"
cp "$md" "$tmp/orig"
run off
cmp -s "$md" "$tmp/orig" || fail "off: a fenced block was removed"
# an end marker inside a fence in the block does not close it: refused
reset
printf '<!-- junkd:orch start -->\n~~~\n<!-- junkd:orch end -->\n~~~\n<!-- junkd:orch end -->\nafter\n' > "$md"
run off
[ "$rc" = 0 ] || fail "off, fenced end marker then the real one: exit $rc"
expect "$md" "after\n" "off: the fenced end marker closed the block"
# an unclosed start marker: exit 1, nothing written, no backup
reset
printf 'a\n<!-- junkd:orch start -->\nb\n' > "$md"
cp "$md" "$tmp/orig"
run off
[ "$rc" = 1 ] || fail "off, unclosed block: expected exit 1, got $rc"
[[ "$out" == "refused $md: "* ]] || fail "off, unclosed block: the line is: $out"
cmp -s "$md" "$tmp/orig" || fail "off, unclosed block: the file was written"
[ "$(backups)" = 0 ] || fail "off, unclosed block: a backup was made"
no_litter "off, unclosed block"
# CRLF: the block and its CRLF blank line go
reset
printf "a\r\n${BLOCK_CRLF}\r\nb\r\n" > "$md"
run off
expect "$md" "a\r\nb\r\n" "off, CRLF"
# symlink: written through
reset
mkdir -p "$CLAUDE_CONFIG_DIR/real"
printf "${BLOCK}\nz\n" > "$CLAUDE_CONFIG_DIR/real/CLAUDE.md"
ln -s real/CLAUDE.md "$md"
run off
[ -L "$md" ] || fail "off, symlink: the link was replaced"
expect "$CLAUDE_CONFIG_DIR/real/CLAUDE.md" "z\n" "off, symlink: the target was not written"
# missing: skipped, never created
reset
run off
[ "$rc" = 0 ] && [ "$out" = "skipped $md: not found" ] || fail "off, missing: $rc $out"
[ ! -e "$md" ] || fail "off, missing: CLAUDE.md was created"

# ================================================================ setup.sh at session start (AC3)
settings="$CLAUDE_CONFIG_DIR/settings.json"
main() { printf '%s' "${1:-{\"session_id\":\"s1\",\"hook_event_name\":\"SessionStart\"\}}" | env -u CLAUDE_AGENT_ID "$setup" 2>&1; }
# opts <json of junkd@'s options>: settings.json with the outputStyle already set (the style step stays quiet)
opts() { printf '{"outputStyle":"x","pluginConfigs":{"other@m":{"options":{"orch_claude_md":%s}},"junkd@m":{"options":%s},"junkd@n":{"options":{"orch_claude_md":%s,"orch_enabled":true}}}}\n' "$2" "$1" "$2" > "$settings"; }
section='# Me\n\n## Orchestrator mode\nr\n\n## Other\n'
with_block="# Me\n\n${BLOCK}\n## Other\n"

# on: the section becomes the block, one junkd: line
reset; printf "$section" > "$md"; opts '{"orch_claude_md":true}' false
out=$(main) || fail "setup, on: exit non-zero"
[[ "$out" == "junkd: updated $md: orchestrator section -> junkd:orch pointer block"* ]] || fail "setup, on: the line is: $out"
expect "$md" "$with_block" "setup, on: no block"
out=$(main)
[ -z "$out" ] || fail "setup, on again: not silent: $out"
# off (false), and unset (the default, off): the block goes
for o in '{"orch_claude_md":false}' '{}' '{"orch_claude_md":"true"}'; do
    reset; printf "$with_block" > "$md"; opts "$o" true
    out=$(main) || fail "setup, $o: exit non-zero"
    [[ "$out" == "junkd: updated $md: junkd:orch pointer block removed"* ]] || fail "setup, $o: the line is: $out"
    expect "$md" '# Me\n\n## Other\n' "setup, $o: the block stayed"
done
# no junkd@ entry, no pluginConfigs: the default, off
reset; printf "$with_block" > "$md"; printf '{"outputStyle":"x"}\n' > "$settings"
main >/dev/null
expect "$md" '# Me\n\n## Other\n' "setup, no pluginConfigs: the block stayed"
# orch disabled (the setting, or the orch-off flag where the setting names nothing): not run either way
for o in '{"orch_claude_md":true,"orch_enabled":false}' '{"orch_claude_md":false,"orch_enabled":false}'; do
    reset; printf "$section" > "$md"; opts "$o" true
    out=$(main)
    [ -z "$out" ] || fail "setup, orch disabled $o: not silent: $out"
    expect "$md" "$section" "setup, orch disabled $o: the file changed"
    printf "$with_block" > "$md"
    main >/dev/null
    expect "$md" "$with_block" "setup, orch disabled $o: the block went"
done
reset; printf "$section" > "$md"; opts '{"orch_claude_md":true}' true
mkdir -p "$CLAUDE_CONFIG_DIR/junkd"; : > "$CLAUDE_CONFIG_DIR/junkd/orch-off"
main >/dev/null
expect "$md" "$section" "setup, orch-off flag: the script ran"
# the setting wins over the flag
opts '{"orch_claude_md":true,"orch_enabled":true}' false
main >/dev/null
expect "$md" "$with_block" "setup, orch_enabled true and a stale orch-off flag: the script did not run"
# a directory under the flag's name is no flag
reset; printf "$section" > "$md"; opts '{"orch_claude_md":true}' false
mkdir -p "$CLAUDE_CONFIG_DIR/junkd/orch-off"
main >/dev/null
expect "$md" "$with_block" "setup, a directory named orch-off: counted as the flag"
# a settings.json that does not parse, is no object, or is missing: the step is skipped
for s in 'not json' '[1]' ''; do
    reset; printf "$with_block" > "$md"; printf '%s' "$s" > "$settings"
    main >/dev/null
    expect "$md" "$with_block" "setup, settings.json '$s': the step ran"
done
reset; printf "$with_block" > "$md"
main >/dev/null
expect "$md" "$with_block" "setup, no settings.json: the step ran"
# refused: the script's reason as one junkd: line, exit 0, nothing written
reset; printf '<!-- junkd:orch start -->\nx\n' > "$md"; opts '{"orch_claude_md":true}' false
out=$(main) || fail "setup, refused: exit non-zero"
[[ "$out" == "junkd: refused $md: "* ]] || fail "setup, refused: the line is: $out"
expect "$md" '<!-- junkd:orch start -->\nx\n' "setup, refused: the file was written"
# missing CLAUDE.md: silent, never created
reset; opts '{"orch_claude_md":true}' false
out=$(main)
[ -z "$out" ] || fail "setup, no CLAUDE.md: not silent: $out"
[ ! -e "$md" ] || fail "setup, no CLAUDE.md: created"
# the version stamp of the style step does not hold this step back: it runs every session start
reset; printf "$section" > "$md"; opts '{"orch_claude_md":true}' false
ver=$(jq -r .version "$plugin/.claude-plugin/plugin.json")
mkdir -p "$CLAUDE_CONFIG_DIR/junkd"; : > "$CLAUDE_CONFIG_DIR/junkd/setup-$ver.stamp"
main >/dev/null
expect "$md" "$with_block" "setup, stamped: the step did not run"
# never in a subagent
reset; printf "$section" > "$md"; opts '{"orch_claude_md":true}' false
out=$(printf '{"agent_id":"a1"}' | env -u CLAUDE_AGENT_ID "$setup" 2>&1)
expect "$md" "$section" "setup, subagent input: the step ran"
out=$(printf '{}' | CLAUDE_AGENT_ID=a1 "$setup" 2>&1)
expect "$md" "$section" "setup, CLAUDE_AGENT_ID: the step ran"

echo "claude-md tests passed"
