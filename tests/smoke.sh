#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(cd "$(mktemp -d)" && pwd -P) # the physical path: a TMPDIR ending in `/` gives mktemp a `//`
trap 'rm -rf "$tmp"' EXIT

for file in $(rg --files "$root/plugins" | rg '/(bin/|[^/]+\.sh$)'); do
    bash -n "$file"
done
for file in $(rg --files -uu "$root/.agents" "$root/plugins" | rg '\.json$'); do
    jq empty "$file"
done

# Every plugin a host's marketplace lists has that host's manifest, or its installer fails on the entry: Kimi
# reads `.kimi-plugin/plugin.json` or `kimi.plugin.json`, Codex `.codex-plugin/plugin.json`.
for src in $(jq -r '.plugins[].source' "$root/kimi-marketplace.json"); do
    [ -f "$root/$src/.kimi-plugin/plugin.json" ] || [ -f "$root/$src/kimi.plugin.json" ] ||
        { echo "kimi-marketplace.json lists $src, which has no .kimi-plugin/plugin.json or kimi.plugin.json"; exit 1; }
done
for src in $(jq -r '.plugins[].source.path' "$root/.agents/plugins/marketplace.json"); do
    [ -f "$root/$src/.codex-plugin/plugin.json" ] ||
        { echo ".agents/plugins/marketplace.json lists $src, which has no .codex-plugin/plugin.json"; exit 1; }
done

# A dangling link would make hooks and slash commands fail at runtime, and it hides from every
# check below that resolves a path (`test -e` on a broken link is false).
dangling=$(find "$root/plugins" -type l ! -exec test -e {} \; -print)
[ -z "$dangling" ] || { echo "dangling symlink(s):"; printf '%s\n' "$dangling"; exit 1; }

# Targets stay relative so a clone works from any path, in a plugin cache as well as a checkout.
while IFS= read -r link; do
    case "$(readlink "$link")" in
        /*) echo "absolute symlink target: $link -> $(readlink "$link")"; exit 1 ;;
    esac
done < <(find "$root/plugins" -type l)

# Structural invariant: every helper that a manifest, hook, or slash command can reach through
# the plugin root lives physically inside a skill directory, and the plugin root only holds a
# relative symlink to it. Equivalently: no regular file referenced from outside a skill dir
# lives outside a skill dir.
#
# Why this direction and not the reverse: `npx skills update` reinstalls a skill only when the
# git tree SHA of that skill's folder changed. A tree entry for a symlink hashes the target
# *string*, not the target's content, so with the old layout (skills/<s>/bin -> ../../bin) an
# edit to plugins/<p>/bin/<script> left every skill folder's tree SHA identical and installed
# skills silently went stale. Keeping the real files inside the skill dir puts each edit back
# inside the subtree that gets hashed.
for plugin in "$root"/plugins/*/; do
    plugin_phys=$(cd -P "$plugin" && pwd)
    for entry in "$plugin"bin "$plugin"agents "$plugin"commands "$plugin"scripts "$plugin"*.sh; do
        [ -e "$entry" ] || continue
        # A plugin-root commands/ that no skill reads is Claude-only slash-command surface, not
        # a helper a SKILL.md runs, so it may stay a real directory. orch is the exception: its
        # skills read ./commands/*.md as their canonical specification, so it must move too.
        case "$entry" in
            */commands)
                if ! rg -q -e '\./commands/' "$plugin"skills/*/SKILL.md 2>/dev/null; then continue; fi
                ;;
        esac
        [ -L "$entry" ] || { echo "plugin-root helper is not a symlink into skills/: $entry"; exit 1; }
        # macOS has no GNU realpath; python3 resolves the whole path physically.
        phys=$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$entry")
        case "$phys" in
            "$plugin_phys"/skills/*) ;;
            *) echo "plugin-root helper resolves outside skills/: $entry -> $phys"; exit 1 ;;
        esac
    done
done

# The same for a shell script at any depth: a real *.sh outside skills/ (say plugins/<p>/hooks/x.sh) is a helper
# the skill hash never sees. hooks/*.tsx, the mods' modules, are no helpers and stay where they are.
stray=$(find "$root"/plugins -type f -name '*.sh' ! -path '*/skills/*')
[ -z "$stray" ] || { echo "real *.sh outside skills/ (move it under skills/<name>/, link it from the plugin root):"; printf '%s\n' "$stray"; exit 1; }

# ctx-limit, ctx-tokens and the status line are skills of junkd: their own tests run them over temp homes on every
# host (tests/ctx.sh) and hold the renderer to the pre-move golden (tests/statusline.sh).
bash "$root/tests/ctx.sh" >/dev/null 2>&1 || { echo "tests/ctx.sh failed; run it alone for the reason"; exit 1; }
bash "$root/tests/statusline.sh" >/dev/null 2>&1 || { echo "tests/statusline.sh failed; run it alone for the reason"; exit 1; }
# Again with a TMPDIR that ends in `/`, as stock macOS sets it: no path a test derives may carry a `//`.
mkdir -p "$tmp/slash"
for t in ctx statusline; do
    TMPDIR="$tmp/slash/" bash "$root/tests/$t.sh" >/dev/null 2>&1 ||
        { echo "tests/$t.sh failed with TMPDIR ending in /; run it alone with TMPDIR=\$TMPDIR/ for the reason"; exit 1; }
done
runtime="$tmp/runtime"
claude_runtime="$tmp/claude-runtime"

junkd="$root/plugins/junkd"
CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$junkd/bin/tldr-flag" on >/dev/null
# As a Codex hook runs it: PLUGIN_ROOT and CLAUDE_PLUGIN_ROOT name the installed plugin under $CODEX_HOME, and no
# Claude Code signal of the shell that runs these tests leaks in.
codex_plugin="$runtime/plugins/cache/junk-drawer/junkd/0.5.0"
tldr_hook=$(env -u CLAUDECODE -u CLAUDE_CONFIG_DIR -u JUNK_DRAWER_RUNTIME CODEX_HOME="$runtime" PLUGIN_ROOT="$codex_plugin" \
    CLAUDE_PLUGIN_ROOT="$codex_plugin" "$junkd/skills/tldr/bin/tldr-hook")
rg -q 'TL;DR MODE ON' <<<"$tldr_hook"
CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$junkd/bin/tldr-flag" off >/dev/null

handoff_result=$(CODEX_THREAD_ID=codex-id CLAUDE_CODE_SESSION_ID=claude-id CLAUDE_CONFIG_DIR="$claude_runtime" \
    JUNK_DRAWER_RUNTIME=claude "$junkd/bin/handoff-path")
[ "$(printf '%s\n' "$handoff_result" | tail -1)" = claude-i ]

# Two plugins: plugins/ holds junkd and junk-drawer (the cheatsheet); every host's marketplace lists those two and
# nothing else, no plugin that moved into junkd (handoff, orch, tldr, ctx-limit, ctx-tokens, statusline) among them,
# and junkd depends on nothing.
[ "$(ls -1 "$root/plugins" | sort | tr '\n' ' ')" = "junk-drawer junkd " ] ||
    { echo "plugins/ holds $(ls -1 "$root/plugins" | tr '\n' ' '), expected junk-drawer junkd"; exit 1; }
for gone in ctx-limit ctx-tokens statusline; do
    [ ! -e "$root/plugins/$gone" ] || { echo "plugins/$gone is back"; exit 1; }
done
[ "$(jq -r '[.plugins[].name] | sort | join(" ")' "$root/.claude-plugin/marketplace.json")" = "junk-drawer junkd" ] &&
    [ "$(jq -r '[.plugins[].id] | sort | join(" ")' "$root/kimi-marketplace.json")" = "junk-drawer junkd" ] &&
    [ "$(jq -r '[.plugins[].name] | sort | join(" ")' "$root/.agents/plugins/marketplace.json")" = "junk-drawer junkd" ] ||
    { echo "a marketplace lists more or less than junk-drawer and junkd"; exit 1; }
for gone in handoff orch tldr ctx-limit ctx-tokens statusline; do
    jq -e --arg n "$gone" '[.plugins[] | select(.name == $n)] | length == 0' "$root/.claude-plugin/marketplace.json" >/dev/null &&
        jq -e --arg n "$gone" '[.plugins[] | select(.id == $n)] | length == 0' "$root/kimi-marketplace.json" >/dev/null &&
        jq -e --arg n "$gone" '[.plugins[] | select(.name == $n)] | length == 0' "$root/.agents/plugins/marketplace.json" >/dev/null ||
        { echo "a marketplace still lists $gone"; exit 1; }
done
junkd_manifest="$junkd/.claude-plugin/plugin.json"
jq -e 'has("dependencies") | not' "$junkd_manifest" >/dev/null || { echo "junkd: the manifest has dependencies"; exit 1; }
jq -e '.plugins[] | select(.name == "junkd" and .source == "./plugins/junkd")' "$root/.claude-plugin/marketplace.json" >/dev/null ||
    { echo "marketplace.json does not list junkd at ./plugins/junkd"; exit 1; }
for f in .kimi-plugin/plugin.json .codex-plugin/plugin.json; do
    [ "$(jq -r .version "$junkd/$f")" = "$(jq -r .version "$junkd_manifest")" ] || { echo "junkd: $f version differs from the Claude manifest's"; exit 1; }
done

# Every command is a skill of junkd's (/junkd:<name>); no plugin-root commands/ (it would add /junkd:init and a
# second /junkd:orch from skills/orch/commands).
for skill in junkd tldr handoff handon ahandoff orch orch-init ctx-limit ctx-tokens statusline tools explain; do
    [ "$(awk -F': *' '$1 == "name" { print $2; exit }' "$junkd/skills/$skill/SKILL.md")" = "$skill" ] ||
        { echo "junkd: skills/$skill/SKILL.md is missing or not named $skill"; exit 1; }
done
[ ! -e "$junkd/commands" ] || { echo "junkd: a plugin-root commands/ is back"; exit 1; }

# $.junkd.schema() is a mirror of the manifest's userConfig (a hooks module cannot import JSON): every row's key,
# type, title and default appear together on one SCHEMA line of settings.ts, a choice row's options too, the group
# and field are the key split at its first `_`, and the mirror holds the manifest's rows in the manifest's order.
# In every group but core, `enabled` is the group's first row.
settings_ts="$junkd/hooks/settings.ts"
for key in $(jq -r '.userConfig | keys_unsorted[]' "$junkd_manifest"); do
    type=$(jq -r ".userConfig[\"$key\"].type" "$junkd_manifest")
    title=$(jq -r ".userConfig[\"$key\"].title" "$junkd_manifest")
    default=$(jq -c ".userConfig[\"$key\"].default" "$junkd_manifest" | tr '"' "'")
    group=${key%%_*}
    field=${key#*_}
    rg -F "key: '$key'," "$settings_ts" | rg -F "group: '$group'," | rg -F "field: '$field'," | rg -F "type: '$type'," |
        rg -F "title: '$title'," | rg -qF "default: $default," ||
        { echo "settings.ts SCHEMA entry for $key does not match the manifest"; exit 1; }
    options=$(jq -c ".userConfig[\"$key\"].options // empty" "$junkd_manifest" | tr '"' "'" | sed "s/,/, /g")
    [ -z "$options" ] || rg -F "key: '$key'," "$settings_ts" | rg -qF "options: $options" ||
        { echo "settings.ts SCHEMA options for $key do not match the manifest"; exit 1; }
done
schema_keys=$(rg -o "^  \{ key: '[A-Za-z_]+'" "$settings_ts" | rg -o "'[A-Za-z_]+'" | tr -d "'")
[ "$schema_keys" = "$(jq -r '.userConfig | keys_unsorted[]' "$junkd_manifest")" ] ||
    { echo "settings.ts SCHEMA keys differ from the manifest's userConfig (or their order does)"; exit 1; }
for group in handoff orch tldr ctx statusline tools; do
    first=$(jq -r '.userConfig | keys_unsorted[]' "$junkd_manifest" | rg "^${group}_" | head -1)
    [ "$first" = "${group}_enabled" ] || { echo "junkd: the $group group's first row is $first, not ${group}_enabled"; exit 1; }
done
[ "$(jq -r '.userConfig | keys_unsorted[]' "$junkd_manifest" | sed 's/_.*//' | uniq | tr '\n' ' ')" = "core handoff orch tldr ctx statusline tools " ] ||
    { echo "junkd: the rows are not grouped core, handoff, orch, tldr, ctx, statusline, tools in that order"; exit 1; }
# The manifest keeps type, title, description, default and a choice's options only: a min or max there is enforced
# by the engine at load (a hand-edited value out of range stops the module), so the bounds live in code.
jq -e '[.userConfig[] | keys[] | select(. != "type" and . != "title" and . != "description" and . != "default" and . != "options")] == []' "$junkd_manifest" >/dev/null ||
    { echo "junkd: a userConfig row has a key beyond type, title, description, default and options"; exit 1; }
# tools_refresh is clamped in code (10-600): the manifest row keeps type and default only, since the engine refuses
# the whole module when a stored value is out of a manifest range.
jq -e '.userConfig.tools_refresh | keys == ["default", "description", "title", "type"]' "$junkd_manifest" >/dev/null ||
    { echo "junkd: the tools_refresh row carries more than type, title, description and default"; exit 1; }

# The flag files are the shell-side truth of a row a shell hook reads before the module runs: the module and the
# script spell each alike under ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/.
flag_pair() { # <flag name> <module file> <script>
    rg -qF "'$1'" "$junkd/hooks/$2" || rg -qF "/junkd/$1\`" "$junkd/hooks/$2" ||
        { echo "junkd: hooks/$2 does not spell the flag $1"; exit 1; }
    rg -qF "\$cfg/junkd/$1" "$3" || { echo "junkd: $3 does not spell \$cfg/junkd/$1"; exit 1; }
}
flag_pair output-style-off core.ts "$junkd/skills/junkd/scripts/setup.sh"
flag_pair orch-off orch.tsx "$junkd/skills/orch/scripts/orch-context.sh"
flag_pair orch-rules-off orch.tsx "$junkd/skills/orch/scripts/orch-context.sh"
flag_pair tldr-on tldr.tsx "$junkd/skills/tldr/bin/tldr-hook"
flag_pair tldr-off tldr.tsx "$junkd/skills/tldr/bin/tldr-hook"
# ctx-limit's files: the module writes <config dir>/junkd/ctx-limit-<name>, the CLI and the hook read $cfg/ctx-limit-<name>
# with cfg the Claude Code config dir's junkd/ folder.
rg -qF '`${await configDir($)}/junkd/ctx-limit-${name}`' "$junkd/hooks/ctx.ts" || { echo "junkd: hooks/ctx.ts does not spell <config dir>/junkd/ctx-limit-<name>"; exit 1; }
for name in threshold action cmd; do
    rg -qF "'$name'" "$junkd/hooks/ctx.ts" || { echo "junkd: hooks/ctx.ts does not name the ctx-limit-$name file"; exit 1; }
    for script in ctx-limit ctx-limit-hook; do
        rg -qF "\$cfg/ctx-limit-$name" "$junkd/skills/ctx-limit/bin/$script" || { echo "junkd: bin/$script does not spell \$cfg/ctx-limit-$name"; exit 1; }
    done
done
for script in ctx-limit ctx-limit-hook; do
    rg -qF 'if [ "$JD_HOST" = claude ]; then cfg="$JD_CFG/junkd"' "$junkd/skills/ctx-limit/bin/$script" ||
        { echo "junkd: bin/$script does not keep its Claude Code files in \$JD_CFG/junkd"; exit 1; }
done
# The status line: the module compares and setup writes <config dir>/junkd/statusline.sh, and the renderer reads every
# segment row of settings.ts from settings.json by its key.
rg -qF '`${await configDir($)}/junkd/statusline.sh`' "$junkd/hooks/statusline.tsx" &&
    rg -qF 'DEST="$CFG/junkd/statusline.sh"' "$junkd/skills/statusline/bin/statusline-setup" ||
    { echo "junkd: hooks/statusline.tsx and bin/statusline-setup do not spell the same <config dir>/junkd/statusline.sh"; exit 1; }
for key in $(jq -r '.userConfig | keys_unsorted[] | select(startswith("statusline_") and . != "statusline_enabled")' "$junkd_manifest"); do
    rg -qF ".$key," "$junkd/skills/statusline/bin/statusline.sh" || rg -qF ".$key]" "$junkd/skills/statusline/bin/statusline.sh" ||
        { echo "junkd: bin/statusline.sh does not read the $key row"; exit 1; }
done
# The SubagentStop records: the script writes them where the module reads them, and the guard's deny list holds them.
rg -qF '$cfg/junkd/orch/_agents/$sid"' "$junkd/skills/orch/scripts/orch-agent-stop.sh" ||
    { echo "junkd: orch-agent-stop.sh does not write under \$cfg/junkd/orch/_agents/<session>"; exit 1; }
rg -qF '${await configDir($)}/junkd/orch/_agents/${sid}/${key}.json' "$junkd/hooks/orch.tsx" ||
    { echo "junkd: hooks/orch.tsx does not read <config dir>/junkd/orch/_agents/<session>/<key>.json"; exit 1; }
rg -qF '\/junkd\/orch\/_agents(\/|$)' "$junkd/hooks/orch-lib.ts" ||
    { echo "junkd: hooks/orch-lib.ts NEVER_WRITE does not hold junkd/orch/_agents/"; exit 1; }
rg -qF 'CLAUDE_CONFIG_DIR' "$junkd/hooks/core.ts" && rg -qF 'CLAUDE_CONFIG_DIR' "$junkd/hooks/orch.tsx" && rg -qF 'CLAUDE_CONFIG_DIR' "$junkd/hooks/tldr.tsx" ||
    { echo "junkd: a module file that writes a flag does not follow CLAUDE_CONFIG_DIR"; exit 1; }
tldr_cfg="$tmp/tldr-cfg"
CLAUDE_CONFIG_DIR="$tldr_cfg" "$junkd/bin/tldr-flag" on >/dev/null
[ -f "$tldr_cfg/junkd/tldr-on" ] || { echo "tldr-flag on did not create \$CLAUDE_CONFIG_DIR/junkd/tldr-on"; exit 1; }
CLAUDE_CONFIG_DIR="$tldr_cfg" "$junkd/bin/tldr-hook" | rg -q 'TL;DR MODE ON'
CLAUDE_CONFIG_DIR="$tldr_cfg" "$junkd/bin/tldr-flag" off >/dev/null
[ ! -e "$tldr_cfg/junkd/tldr-on" ] || { echo "tldr-flag off left the flag file"; exit 1; }
[ -z "$(CLAUDE_CONFIG_DIR="$tldr_cfg" "$junkd/bin/tldr-hook")" ]

# The pane reads the two files Claude Code lays out: the user settings.json and the marketplace's manifest.
panel="$junkd/hooks/panel.tsx"
rg -qF 'CLAUDE_CONFIG_DIR' "$panel" && rg -qF '/settings.json`' "$panel" &&
    rg -qF '/plugins/marketplaces/${MARKETPLACE}`' "$panel" && rg -qF '/.claude-plugin/marketplace.json`' "$panel" ||
    { echo "junkd: settings.json or marketplace.json is not spelled as Claude Code lays it"; exit 1; }
rg -q '^name: STE$' "$junkd/output-styles/STE.md" && rg -qF '"junkd:STE"' "$junkd/skills/junkd/scripts/setup.sh" ||
    { echo "junkd: output-styles/STE.md is not named STE, or setup.sh does not set junkd:STE"; exit 1; }

# Host detection and handoff ids: every helper lands in the detected host's data root, no signal exits 2.
bash "$root/tests/hosts.sh" >/dev/null 2>&1 || { echo "tests/hosts.sh failed; run it alone for the reason"; exit 1; }
# The OpenCode command wrappers: one per skill, descriptions cut on a word boundary.
bash "$root/tests/opencode-commands.sh" >/dev/null 2>&1 || { echo "tests/opencode-commands.sh failed; run it alone for the reason"; exit 1; }

# host-lib has one real copy per skill that ships its helpers (an installer that drops symlinks keeps each skill
# whole), and handon ships a real copy of handoff-load: the copies stay byte-identical to handoff's.
for copy in tldr/bin/host-lib handon/bin/host-lib ctx-limit/bin/host-lib ctx-tokens/bin/host-lib handon/bin/handoff-load; do
    [ -f "$junkd/skills/$copy" ] && [ ! -L "$junkd/skills/$copy" ] || { echo "junkd: skills/$copy is not a real file"; exit 1; }
    cmp -s "$junkd/skills/handoff/bin/${copy##*/}" "$junkd/skills/$copy" ||
        { echo "junkd: skills/$copy differs from skills/handoff/bin/${copy##*/}"; exit 1; }
done
[ -x "$junkd/skills/handon/bin/handoff-load" ] || { echo "junkd: skills/handon/bin/handoff-load is not executable"; exit 1; }
# The helpers of ctx-limit, ctx-tokens and statusline: real executables in their skill, reached from the plugin root
# through bin -> skills/junkd/bin -> ../../<skill>/bin (the hooks and /junkd's module call them there).
for pair in ctx-limit:ctx-limit ctx-limit:ctx-limit-hook ctx-tokens:ctx-tokens statusline:statusline.sh statusline:statusline-setup; do
    skill=${pair%%:*} name=${pair#*:}
    real="$junkd/skills/$skill/bin/$name"
    [ -f "$real" ] && [ ! -L "$real" ] && [ -x "$real" ] || { echo "junkd: skills/$skill/bin/$name is not a real executable"; exit 1; }
    [ -L "$junkd/skills/junkd/bin/$name" ] && [ "$(readlink "$junkd/skills/junkd/bin/$name")" = "../../$skill/bin/$name" ] ||
        { echo "junkd: skills/junkd/bin/$name is not a link to ../../$skill/bin/$name"; exit 1; }
    [ "$(cd -P "$junkd/bin" && pwd)/$name" -ef "$real" ] || { echo "junkd: bin/$name does not reach skills/$skill/bin/$name"; exit 1; }
done

# Codex refuses a hooks file with any top-level key but description and hooks, and hooks/hooks.json carries Claude
# Code's modules: Codex reads its own file, named by its manifest, whose command reaches a real script (Codex drops
# the plugin-root symlinks). Kimi's manifest names no agents (it would load agents/ as agent definitions) and its
# hook command resolves inside the plugin.
codex_hooks=$(jq -r '.hooks // empty' "$junkd/.codex-plugin/plugin.json")
[ "$codex_hooks" = ./.codex-plugin/hooks.json ] && [ -f "$junkd/$codex_hooks" ] ||
    { echo "junkd: .codex-plugin/plugin.json does not name ./.codex-plugin/hooks.json"; exit 1; }
jq -e 'keys - ["description", "hooks"] == []' "$junkd/$codex_hooks" >/dev/null ||
    { echo "junkd: $codex_hooks has a top-level key Codex refuses"; exit 1; }
for cmd in $(jq -r '.hooks[][].hooks[].command' "$junkd/$codex_hooks" | rg -o '\$PLUGIN_ROOT/[^"]+'); do
    script="$junkd/${cmd#\$PLUGIN_ROOT/}"
    [ -f "$script" ] && [ ! -L "$script" ] || { echo "junkd: Codex hook command $cmd is not a real file in the plugin"; exit 1; }
done
jq -e '.agents == []' "$junkd/.kimi-plugin/plugin.json" >/dev/null || { echo "junkd: .kimi-plugin/plugin.json has no \"agents\": []"; exit 1; }
for cmd in $(jq -r '.hooks[].command' "$junkd/.kimi-plugin/plugin.json" | rg -o '\./[^ ]+'); do
    [ -f "$junkd/$cmd" ] && [ ! -L "$junkd/$cmd" ] || { echo "junkd: Kimi hook command $cmd is not a real file in the plugin"; exit 1; }
done

# The shell-side tests of tldr-flag and tldr-hook.
bash "$root/tests/tldr.sh" >/dev/null 2>&1 || { echo "tests/tldr.sh failed; run it alone for the reason"; exit 1; }

# The junkd plugin's own tests: the STE style and the SessionStart setup step over a temp config dir.
bash "$root/tests/junkd.sh" >/dev/null 2>&1 || { echo "tests/junkd.sh failed; run it alone for the reason"; exit 1; }

project="$tmp/project"
mkdir -p "$project/.orch" "$project/.orch/tasks"
git -C "$project" init -q
cat > "$project/.orch/config.md" <<'CONFIG'
---
backend: adhoc
tasks_dir: .orch/tasks
default_base: main
branch_prefix: task/
capabilities:
---
CONFIG
(
    cd "$project"
    "$root/plugins/junkd/bin/orch-state" new TEST-1 "Smoke test" >/dev/null
    "$root/plugins/junkd/bin/orch-state" set TEST-1 in_progress >/dev/null
    state_list=$("$root/plugins/junkd/bin/orch-state" list)
    rg -q 'TEST-1[[:space:]]+in_progress' <<<"$state_list"
)

# The orch plugin's own tests: the SessionStart rule-sheet hook, the agent roster, the bin scripts.
bash "$root/tests/orch.sh" >/dev/null 2>&1 || { echo "tests/orch.sh failed; run it alone for the reason"; exit 1; }

catalog=$(JUNK_DRAWER_RUNTIME=codex "$root/plugins/junk-drawer/bin/junk-drawer")
rg -q '\$orch' <<<"$catalog"

# The real script sits in the skill dir and the plugin root reaches it through
# `bin -> skills/junk-drawer/bin`, so both entry points must produce the same marketplace
# listing. The script resolves its own physical location to decide whether it is in a
# marketplace and how far up the plugins root is; getting that wrong silently degrades this
# to the sibling-skill fallback list.
via_skill=$(cd "$root/plugins/junk-drawer/skills/junk-drawer" && JUNK_DRAWER_RUNTIME=codex ./bin/junk-drawer)
[ "$via_skill" = "$catalog" ]

# Standalone-skill install contract (`npx skills add <repo>`).
#
# That installer copies ONLY plugins/<p>/skills/<s>/ into <project>/.claude/skills/<s>/,
# dereferencing symlinks into real files and preserving exec bits. So every path a
# SKILL.md tells the agent to run or read must resolve *inside its own skill dir* --
# a `../../` escape works in the plugin layout but breaks once installed.
# `cp -RL` reproduces those copy semantics without needing the network.
installed="$tmp/installed"
mkdir -p "$installed"
for skill in "$root"/plugins/*/skills/*/; do
    cp -RL "$skill" "$installed/$(basename "$skill")"
done

# Thirteen skills: junk-drawer's one and junkd's twelve (junkd, tldr, handoff, handon, ahandoff, orch, orch-init,
# ctx-limit, ctx-tokens, statusline, tools, explain). skills/junkd also holds the real home of the plugin-root bin/ and scripts/
# links, as the layout invariant above asks.
[ "$(ls -1 "$installed" | wc -l | tr -d ' ')" = 13 ]

for skill_md in "$installed"/*/SKILL.md; do
    skill_dir=$(dirname "$skill_md")
    # No SKILL.md may reach outside its own directory. Checked with an explicit if,
    # not `! rg -q`: set -e ignores a failure whose status is inverted with `!`.
    if rg -q '\.\./' "$skill_md"; then
        echo "escapes skill dir with ../ : $skill_md"; exit 1
    fi
    # junkd, ahandoff and tools reference no skill-local path at all: their text is only the fallback for a host or
    # session where the hooks module did not answer the command, and it runs nothing. explain is the same case for a
    # different reason: it runs no helper (its text only tells the model how to answer), so it has no ./bin to resolve.
    case "$(basename "$skill_dir")" in junkd | ahandoff | tools | explain) continue ;; esac
    # Every skill-local path it does reference must exist after the copy. No look-around
    # here -- ripgrep's default engine rejects it and would exit 2, silently checking
    # nothing. A `../../bin/x` would also match this pattern, but the ../ check above
    # already exited by then. rg exit 1 (no matches at all) is a failure too: every
    # SKILL.md in this marketplace references at least one skill-local path.
    refs=$(rg -o -e '\./(bin/[a-z-]+(\.sh)?|commands/[a-z-]+\.md|roles/|[a-z-]+\.sh)' "$skill_md" | sort -u) \
        || { echo "no skill-local refs extracted from $skill_md"; exit 1; }
    for ref in $refs; do
        [ -e "$skill_dir/$ref" ] || { echo "unresolved $ref in $skill_md"; exit 1; }
    done
done

# Helpers must actually execute from the installed layout, not merely exist.
[ -x "$installed/handoff/bin/handoff-path" ]
home="$tmp/home"
mkdir -p "$home/.claude"
(cd "$installed/tldr" && [ "$(HOME=$home CLAUDE_CONFIG_DIR=$home/.claude ./bin/tldr-flag status)" = "TL;DR mode: OFF" ])
(cd "$installed/orch" && [ "$(wc -l < ./commands/orch.md)" -gt 100 ] && [ -e ./roles/implementer.md ])

# orch owns the real bin/ and commands/ (both orch.md and init.md); orch-init reaches them
# through a sibling symlink, which the install dereferences into independent real copies.
cmp -s "$installed/orch-init/bin/orch-state" "$installed/orch/bin/orch-state" ||
    { echo "orch-init/bin/orch-state differs from orch/bin/orch-state"; exit 1; }
[ -e "$installed/orch/commands/init.md" ] ||
    { echo "orch skill is missing commands/init.md"; exit 1; }

# `handon` gives skills-only installs the resume half of junkd's handoff, self-contained: SKILL.md, its Codex
# metadata, and real copies of handoff-load and host-lib (Codex drops symlinks, Kimi rewrites them to absolute
# checkout paths), so no symlinks of its own. Its SKILL.md puts the non-Claude line (./bin/handoff-load) first.
[ -f "$installed/handon/SKILL.md" ] || { echo "handon: no SKILL.md"; exit 1; }
[ -f "$installed/handon/agents/openai.yaml" ] || { echo "handon: no agents/openai.yaml"; exit 1; }
handon_files=$(cd "$installed/handon" && find . -mindepth 1 ! -type d | LC_ALL=C sort | tr '\n' ' ')
[ "$handon_files" = "./SKILL.md ./agents/openai.yaml ./bin/handoff-load ./bin/host-lib " ] ||
    { echo "handon ships $handon_files, expected SKILL.md, agents/openai.yaml, bin/handoff-load, bin/host-lib"; exit 1; }
[ -z "$(find "$root/plugins/junkd/skills/handon" -type l)" ] ||
    { echo "handon must not contain symlinks"; exit 1; }
cmp -s "$installed/handon/bin/handoff-load" "$installed/handoff/bin/handoff-load" ||
    { echo "handon/bin/handoff-load differs from handoff/bin/handoff-load"; exit 1; }

# Every host map names all four hosts; handoff tells the resume command of each; tldr says OpenCode has no hook.
for skill in handoff tldr orch orch-init ctx-limit ctx-tokens statusline tools explain; do
    for host in 'Claude Code' 'Codex' 'Kimi Code' 'OpenCode'; do
        rg -qF "$host" "$root/plugins/junkd/skills/$skill/SKILL.md" || { echo "junkd: skills/$skill/SKILL.md does not name $host"; exit 1; }
    done
done
for resume in '`/junkd:handon <id>`' '`$handon <id>`' '`/skill:handon <id>`' '`/handon <id>`'; do
    rg -qF -- "$resume" "$root/plugins/junkd/skills/handoff/SKILL.md" || { echo "junkd: handoff/SKILL.md does not list $resume"; exit 1; }
done
rg -qF 'OpenCode has no hook' "$root/plugins/junkd/skills/tldr/SKILL.md" || { echo "junkd: tldr/SKILL.md does not say OpenCode has no hook"; exit 1; }

# The Kimi model followed whichever host line came first: handon, junkd, ahandoff, ctx-limit, ctx-tokens and tools put
# the non-Claude line before the Claude Code one (explain too, in its slider-page route).
for skill in handon junkd ahandoff ctx-limit ctx-tokens tools explain; do
    md="$root/plugins/junkd/skills/$skill/SKILL.md"
    other=$(rg -n -m1 '^- Codex, Kimi Code, OpenCode or any other host' "$md" | cut -d: -f1)
    claude_line=$(rg -n -m1 '^- Claude Code' "$md" | cut -d: -f1)
    [ -n "$other" ] && [ -n "$claude_line" ] && [ "$other" -lt "$claude_line" ] ||
        { echo "junkd: skills/$skill/SKILL.md does not put the non-Claude line before the Claude Code one"; exit 1; }
done

# explain routes by topic type: its SKILL.md names the three routes, keeps the page free of network loads, and never
# writes into the repo.
explain_md="$root/plugins/junkd/skills/explain/SKILL.md"
for route in 'Route 1: slider' 'Route 2: mermaid' 'Route 3: STE'; do
    rg -q "^## $route" "$explain_md" || { echo "junkd: skills/explain/SKILL.md has no '## $route' section"; exit 1; }
done
rg -qF 'no `<script type="module">`, no `import`' "$explain_md" || { echo "junkd: skills/explain/SKILL.md lost the no-module-script rule for the page"; exit 1; }
rg -q '^Run this test once' "$explain_md" && rg -qF 'ask one question and wait' "$explain_md" ||
    { echo "junkd: skills/explain/SKILL.md lost the detection rule or the one-question tie-break"; exit 1; }
[ -f "$root/plugins/junkd/skills/explain/agents/openai.yaml" ] || { echo "junkd: skills/explain/agents/openai.yaml is missing"; exit 1; }
rg -qF 'No `http://` or `https://` load, no `fetch`' "$explain_md" || { echo "junkd: skills/explain/SKILL.md lost the no-network rule for the page"; exit 1; }
rg -qF 'The skill never writes into the repo.' "$explain_md" || { echo "junkd: skills/explain/SKILL.md lost the never-write-into-the-repo rule"; exit 1; }
rg -qF -e '- Claude Code: when the Artifact tool exists' "$explain_md" || { echo "junkd: skills/explain/SKILL.md lost the Claude Code Artifact line"; exit 1; }

# The catalog degrades to listing sibling skills instead of claiming the marketplace is empty.
standalone_catalog=$(cd "$installed/junk-drawer" && HOME=$home ./bin/junk-drawer)
rg -q 'standalone skills' <<<"$standalone_catalog"
rg -q '\$orch' <<<"$standalone_catalog"

# The orch_claude_md switch: scripts/orch-claude-md.sh on|off and its session-start run, over a temp config dir.
bash "$root/tests/claude-md.sh" >/dev/null 2>&1 || { echo "tests/claude-md.sh failed; run it alone for the reason"; exit 1; }

# The prompt-cache check: scripts/cache-check.sh over fixture transcripts in a temp project folder.
bash "$root/tests/cache-check.sh" >/dev/null 2>&1 || { echo "tests/cache-check.sh failed; run it alone for the reason"; exit 1; }

# Ported behaviour is written in junk-drawer's own words: the name of the code it was ported from appears in no file
# of the repo (tracked or new; .git, the local plans and the orchestrator's store aside). The name is spelled here by
# its character codes so this check does not hold it either.
origin=$(printf '\156\165\162\163\141')
if git -C "$root" grep -i -I -l --untracked -e "$origin" -- . ':!PLAN-*.md' ':!.orch' ':!.worktrees' >/dev/null; then
    echo "the origin's name appears in: $(git -C "$root" grep -i -I -l --untracked -e "$origin" -- . ':!PLAN-*.md' ':!.orch' ':!.worktrees' | tr '\n' ' ')"; exit 1
fi

echo "smoke tests passed"
