#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
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

cat > "$tmp/codex.jsonl" <<'JSONL'
{"type":"session_meta","payload":{"cwd":"/tmp/example"}}
{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1200,"output_tokens":30},"model_context_window":10000}}}
JSONL
[ "$("$root/plugins/ctx-tokens/bin/ctx-tokens" --codex "$tmp/codex.jsonl")" = 1200 ]
ctx_human=$("$root/plugins/ctx-tokens/bin/ctx-tokens" --codex -h "$tmp/codex.jsonl")
rg -q 'remaining 8k \(8800\)' <<<"$ctx_human"

cat > "$tmp/claude.jsonl" <<'JSONL'
{"message":{"usage":{"input_tokens":100,"cache_creation_input_tokens":200,"cache_read_input_tokens":300,"output_tokens":20}}}
JSONL
[ "$("$root/plugins/ctx-tokens/bin/ctx-tokens" --claude "$tmp/claude.jsonl")" = 600 ]

runtime="$tmp/runtime"
CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$root/plugins/ctx-limit/bin/ctx-limit" 1k >/dev/null
hook=$(printf '{"prompt":"continue","transcript_path":"%s"}' "$tmp/codex.jsonl" |
    CODEX_HOME="$runtime" PLUGIN_ROOT="$root/plugins/ctx-limit" "$root/plugins/ctx-limit/bin/ctx-limit-hook")
printf '%s\n' "$hook" | jq -e '.continue == false and (.stopReason | length > 0)' >/dev/null
escape=$(printf '{"prompt":"Use $ctx-limit to turn the guard off","transcript_path":"%s"}' "$tmp/codex.jsonl" |
    CODEX_HOME="$runtime" PLUGIN_ROOT="$root/plugins/ctx-limit" "$root/plugins/ctx-limit/bin/ctx-limit-hook")
[ -z "$escape" ]
mention=$(printf '{"prompt":"Explain why $ctx-limit blocked me","transcript_path":"%s"}' "$tmp/codex.jsonl" |
    CODEX_HOME="$runtime" PLUGIN_ROOT="$root/plugins/ctx-limit" "$root/plugins/ctx-limit/bin/ctx-limit-hook")
printf '%s\n' "$mention" | jq -e '.continue == false' >/dev/null
for lookalike in '/ctx-limiter off' '/clearance review' '$ctx-limiter off'; do
    blocked=$(printf '{"prompt":"%s","transcript_path":"%s"}' "$lookalike" "$tmp/codex.jsonl" |
        CODEX_HOME="$runtime" PLUGIN_ROOT="$root/plugins/ctx-limit" "$root/plugins/ctx-limit/bin/ctx-limit-hook")
    printf '%s\n' "$blocked" | jq -e '.continue == false' >/dev/null
done

claude_runtime="$tmp/claude-runtime"
CLAUDE_CONFIG_DIR="$claude_runtime" "$root/plugins/ctx-limit/bin/ctx-limit" 1 >/dev/null
set +e
claude_block=$(printf '{"prompt":"continue","transcript_path":"%s"}' "$tmp/claude.jsonl" |
    CLAUDE_CONFIG_DIR="$claude_runtime" "$root/plugins/ctx-limit/bin/ctx-limit-hook" 2>&1)
claude_status=$?
set -e
[ "$claude_status" -eq 2 ]
rg -q 'ctx-limit reached' <<<"$claude_block"

# A control command passes the guard over the limit; a lookalike of it does not.
for passing in '/junkd:handoff' '/junkd:handon abc' '/junkd:ahandoff off' '/handoff' '/skill:handon'; do
    passed=$(printf '{"prompt":"%s","transcript_path":"%s"}' "$passing" "$tmp/codex.jsonl" |
        CODEX_HOME="$runtime" PLUGIN_ROOT="$root/plugins/ctx-limit" "$root/plugins/ctx-limit/bin/ctx-limit-hook")
    [ -z "$passed" ] || { echo "ctx-limit blocked the control command $passing"; exit 1; }
done
for lookalike in '/junkd:handoffs' '/junkd:orch' '/handoff:handoff' '/ahandoff'; do
    blocked=$(printf '{"prompt":"%s","transcript_path":"%s"}' "$lookalike" "$tmp/codex.jsonl" |
        CODEX_HOME="$runtime" PLUGIN_ROOT="$root/plugins/ctx-limit" "$root/plugins/ctx-limit/bin/ctx-limit-hook")
    printf '%s\n' "$blocked" | jq -e '.continue == false' >/dev/null || { echo "ctx-limit let $lookalike through"; exit 1; }
done

junkd="$root/plugins/junkd"
CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$junkd/bin/tldr-flag" on >/dev/null
tldr_hook=$(CODEX_HOME="$runtime" PLUGIN_ROOT="$junkd" "$junkd/bin/tldr-hook")
rg -q 'TL;DR MODE ON' <<<"$tldr_hook"
CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$junkd/bin/tldr-flag" off >/dev/null

handoff_result=$(CODEX_THREAD_ID=codex-id CLAUDE_CODE_SESSION_ID=claude-id CLAUDE_CONFIG_DIR="$claude_runtime" \
    JUNK_DRAWER_RUNTIME=claude "$junkd/bin/handoff-path")
[ "$(printf '%s\n' "$handoff_result" | tail -1)" = claude-i ]

# One plugin: plugins/ holds junkd, ctx-limit, ctx-tokens, statusline and junk-drawer; no host's marketplace lists the
# plugins that moved into junkd (handoff, orch, tldr), and junkd depends on nothing.
[ "$(ls -1 "$root/plugins" | sort | tr '\n' ' ')" = "ctx-limit ctx-tokens junk-drawer junkd statusline " ] ||
    { echo "plugins/ holds $(ls -1 "$root/plugins" | tr '\n' ' '), expected ctx-limit ctx-tokens junk-drawer junkd statusline"; exit 1; }
for gone in handoff orch tldr; do
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
for skill in junkd tldr handoff handon ahandoff orch orch-init; do
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
for group in handoff orch tldr; do
    first=$(jq -r '.userConfig | keys_unsorted[]' "$junkd_manifest" | rg "^${group}_" | head -1)
    [ "$first" = "${group}_enabled" ] || { echo "junkd: the $group group's first row is $first, not ${group}_enabled"; exit 1; }
done
[ "$(jq -r '.userConfig | keys_unsorted[]' "$junkd_manifest" | sed 's/_.*//' | uniq | tr '\n' ' ')" = "core handoff orch tldr " ] ||
    { echo "junkd: the rows are not grouped core, handoff, orch, tldr in that order"; exit 1; }

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

# Eleven skills: one each for ctx-limit, ctx-tokens, junk-drawer and statusline, and junkd's seven (junkd, tldr,
# handoff, handon, ahandoff, orch, orch-init). skills/junkd also holds the real home of the plugin-root bin/ and
# scripts/ links, as the layout invariant above asks.
[ "$(ls -1 "$installed" | wc -l | tr -d ' ')" = 11 ]

for skill_md in "$installed"/*/SKILL.md; do
    skill_dir=$(dirname "$skill_md")
    # No SKILL.md may reach outside its own directory. Checked with an explicit if,
    # not `! rg -q`: set -e ignores a failure whose status is inverted with `!`.
    if rg -q '\.\./' "$skill_md"; then
        echo "escapes skill dir with ../ : $skill_md"; exit 1
    fi
    # `handon` ships no helpers and references no skill-local path at all -- it only delegates
    # to the `handoff` skill -- so the extraction below would correctly find nothing and the
    # fail-on-zero-refs rule does not apply to it. Its own contract is checked further down.
    # junkd and ahandoff are the same kind: their text is only the fallback for a host or session where the hooks
    # module did not answer the command, and it runs nothing.
    case "$(basename "$skill_dir")" in handon | junkd | ahandoff) continue ;; esac
    # Every skill-local path it does reference must exist after the copy. No look-around
    # here -- ripgrep's default engine rejects it and would exit 2, silently checking
    # nothing. A `../../bin/x` would also match this pattern, but the ../ check above
    # already exited by then. rg exit 1 (no matches at all) is a failure too: every
    # SKILL.md in this marketplace references at least one skill-local path.
    refs=$(rg -o -e '\./(bin/[a-z-]+|commands/[a-z-]+\.md|roles/|[a-z-]+\.sh)' "$skill_md" | sort -u) \
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

# `handon` gives skills-only installs the resume half of junkd's handoff. It must stay a
# pure delegator: SKILL.md plus its Codex metadata, no helpers and no symlinks of its own.
[ -f "$installed/handon/SKILL.md" ] || { echo "handon: no SKILL.md"; exit 1; }
[ -f "$installed/handon/agents/openai.yaml" ] || { echo "handon: no agents/openai.yaml"; exit 1; }
handon_files=$(find "$installed/handon" -mindepth 1 ! -type d | wc -l | tr -d ' ')
[ "$handon_files" = 2 ] || { echo "handon ships $handon_files files, expected 2"; exit 1; }
[ -z "$(find "$root/plugins/junkd/skills/handon" -type l)" ] ||
    { echo "handon must not contain symlinks"; exit 1; }
rg -qF '`handoff` skill' "$installed/handon/SKILL.md" ||
    { echo "handon/SKILL.md does not delegate to the handoff skill"; exit 1; }

# The catalog degrades to listing sibling skills instead of claiming the marketplace is empty.
standalone_catalog=$(cd "$installed/junk-drawer" && HOME=$home ./bin/junk-drawer)
rg -q 'standalone skills' <<<"$standalone_catalog"
rg -q '\$orch' <<<"$standalone_catalog"

echo "smoke tests passed"
