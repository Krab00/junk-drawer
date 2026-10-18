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
    for entry in "$plugin"bin "$plugin"agents "$plugin"commands "$plugin"*.sh; do
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

CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$root/plugins/tldr/bin/tldr-flag" on >/dev/null
tldr_hook=$(CODEX_HOME="$runtime" PLUGIN_ROOT="$root/plugins/tldr" "$root/plugins/tldr/bin/tldr-hook")
rg -q 'TL;DR MODE ON' <<<"$tldr_hook"
CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$root/plugins/tldr/bin/tldr-flag" off >/dev/null

handoff_result=$(CODEX_THREAD_ID=codex-id CLAUDE_CODE_SESSION_ID=claude-id CLAUDE_CONFIG_DIR="$claude_runtime" \
    JUNK_DRAWER_RUNTIME=claude "$root/plugins/handoff/bin/handoff-path")
[ "$(printf '%s\n' "$handoff_result" | tail -1)" = claude-i ]

# $.orch.schema() is a mirror of the orch manifest's userConfig (a hooks module cannot import JSON): every
# field's key, type, title and default must appear together on one SCHEMA line of orch-lib.ts, the choice row's
# options too, and the mirror must hold no field the manifest lacks. A string default is spelled 'x' there.
orch_manifest="$root/plugins/orch/.claude-plugin/plugin.json"
orch_lib="$root/plugins/orch/hooks/orch-lib.ts"
for key in $(jq -r '.userConfig | keys[]' "$orch_manifest"); do
    type=$(jq -r ".userConfig[\"$key\"].type" "$orch_manifest")
    title=$(jq -r ".userConfig[\"$key\"].title" "$orch_manifest")
    default=$(jq -c ".userConfig[\"$key\"].default" "$orch_manifest" | tr '"' "'")
    rg -F "key: '$key'" "$orch_lib" | rg -F "type: '$type'" | rg -F "title: '$title'" | rg -qF "default: $default," ||
        { echo "orch SCHEMA entry for $key does not match the manifest"; exit 1; }
    options=$(jq -c ".userConfig[\"$key\"].options // empty" "$orch_manifest" | tr '"' "'" | sed "s/,/, /g")
    [ -z "$options" ] || rg -F "key: '$key'" "$orch_lib" | rg -qF "options: $options" ||
        { echo "orch SCHEMA options for $key do not match the manifest"; exit 1; }
done
schema_keys=$(rg -o "^  \{ key: '[A-Za-z_]+'" "$orch_lib" | rg -o "'[A-Za-z_]+'" | tr -d "'" | sort)
[ "$schema_keys" = "$(jq -r '.userConfig | keys[]' "$orch_manifest" | sort)" ] ||
    { echo "orch SCHEMA keys differ from the manifest's userConfig"; exit 1; }
# The flag file is the shell-side truth of inject_rules off: the hooks module and scripts/orch-context.sh must
# both spell it ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/orch/rules-off.
rg -qF "/orch/rules-off" "$root/plugins/orch/hooks/index.tsx" && rg -qF "CLAUDE_CONFIG_DIR" "$root/plugins/orch/hooks/index.tsx" &&
    rg -qF '/orch/rules-off' "$root/plugins/orch/skills/orch/scripts/orch-context.sh" ||
    { echo "orch: the inject_rules flag file is not spelled alike in the hooks module and orch-context.sh"; exit 1; }

# $.handoff.schema() is a mirror of the handoff manifest's userConfig (a hooks module cannot import JSON):
# every field's key, type, title and default must appear together on one SCHEMA line of lib.ts, and the
# mirror must hold no field the manifest lacks.
handoff_manifest="$root/plugins/handoff/.claude-plugin/plugin.json"
handoff_lib="$root/plugins/handoff/hooks/lib.ts"
for key in $(jq -r '.userConfig | keys[]' "$handoff_manifest"); do
    type=$(jq -r ".userConfig[\"$key\"].type" "$handoff_manifest")
    title=$(jq -r ".userConfig[\"$key\"].title" "$handoff_manifest")
    default=$(jq -c ".userConfig[\"$key\"].default" "$handoff_manifest")
    rg -F "key: '$key'" "$handoff_lib" | rg -F "type: '$type'" | rg -F "title: '$title'" | rg -qF "default: $default," ||
        { echo "handoff SCHEMA entry for $key does not match the manifest"; exit 1; }
done
schema_keys=$(rg -o "^  \{ key: '[A-Za-z]+'" "$handoff_lib" | rg -o "'[A-Za-z]+'" | tr -d "'" | sort)
[ "$schema_keys" = "$(jq -r '.userConfig | keys[]' "$handoff_manifest" | sort)" ] ||
    { echo "handoff SCHEMA keys differ from the manifest's userConfig"; exit 1; }

# The same for $.tldr.schema() and the tldr manifest (hooks/index.tsx).
tldr_manifest="$root/plugins/tldr/.claude-plugin/plugin.json"
tldr_mod="$root/plugins/tldr/hooks/index.tsx"
for key in $(jq -r '.userConfig | keys[]' "$tldr_manifest"); do
    type=$(jq -r ".userConfig[\"$key\"].type" "$tldr_manifest")
    title=$(jq -r ".userConfig[\"$key\"].title" "$tldr_manifest")
    default=$(jq -c ".userConfig[\"$key\"].default" "$tldr_manifest")
    rg -F "key: '$key'" "$tldr_mod" | rg -F "type: '$type'" | rg -F "title: '$title'" | rg -qF "default: $default," ||
        { echo "tldr SCHEMA entry for $key does not match the manifest"; exit 1; }
done
schema_keys=$(rg -o "^  \{ key: '[A-Za-z]+'" "$tldr_mod" | rg -o "'[A-Za-z]+'" | tr -d "'" | sort)
[ "$schema_keys" = "$(jq -r '.userConfig | keys[]' "$tldr_manifest" | sort)" ] ||
    { echo "tldr SCHEMA keys differ from the manifest's userConfig"; exit 1; }

# The flag file is the shell-side truth of terse mode: on Claude Code, tldr-flag (what /tldr on runs),
# tldr-hook and the mod ($.tldr.get/set, checked by its plugin test) must all spell it
# ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tldr-on.
tldr_cfg="$tmp/tldr-cfg"
CLAUDE_CONFIG_DIR="$tldr_cfg" "$root/plugins/tldr/bin/tldr-flag" on >/dev/null
[ -f "$tldr_cfg/tldr-on" ] || { echo "tldr-flag on did not create \$CLAUDE_CONFIG_DIR/tldr-on"; exit 1; }
CLAUDE_CONFIG_DIR="$tldr_cfg" "$root/plugins/tldr/bin/tldr-hook" | rg -q 'TL;DR MODE ON'
CLAUDE_CONFIG_DIR="$tldr_cfg" "$root/plugins/tldr/bin/tldr-flag" off >/dev/null
[ ! -e "$tldr_cfg/tldr-on" ] || { echo "tldr-flag off left the flag file"; exit 1; }
[ -z "$(CLAUDE_CONFIG_DIR="$tldr_cfg" "$root/plugins/tldr/bin/tldr-hook")" ]
rg -qF "/tldr-on" "$tldr_mod" && rg -qF "CLAUDE_CONFIG_DIR" "$tldr_mod" ||
    { echo "tldr hooks module does not spell the flag file as tldr-flag does"; exit 1; }

# junkd reads three nouns, one per manifest dependency, and nothing else: every `<p>@junk-drawer` under
# `dependencies` has its `$.<p>.schema(` call in the hooks module, every `$.<p>.schema(` there names a dependency
# (schema() is what every noun read starts with) and the pane's own `NOUNS` list is that same set. The
# marketplace lists junkd, so `/plugin install junkd@junk-drawer` works; the two files the pane reads are
# spelled as Claude Code lays them.
junkd_manifest="$root/plugins/junkd/.claude-plugin/plugin.json"
junkd_mod="$root/plugins/junkd/hooks/index.tsx"
junkd_deps=$(jq -r '.dependencies[]' "$junkd_manifest" | sed 's/@junk-drawer$//' | sort)
[ -n "$junkd_deps" ] || { echo "junkd: no dependencies in the manifest"; exit 1; }
for dep in $junkd_deps; do
    jq -e --arg d "$dep@junk-drawer" '.dependencies | index($d) != null' "$junkd_manifest" >/dev/null ||
        { echo "junkd: dependency $dep is not spelled $dep@junk-drawer"; exit 1; }
    rg -qF "\$.$dep.schema(" "$junkd_mod" || { echo "junkd: dependency $dep has no \$.$dep.schema() call in index.tsx"; exit 1; }
done
junkd_nouns=$(rg -o '\$\.[a-z]+\.schema\(' "$junkd_mod" | rg -o '\$\.[a-z]+' | tr -d '$.' | sort -u)
[ "$junkd_nouns" = "$junkd_deps" ] || { echo "junkd: the nouns index.tsx calls ($(echo $junkd_nouns)) differ from the manifest's dependencies ($(echo $junkd_deps))"; exit 1; }
junkd_list=$(rg -o "^const NOUNS = \[[^]]*\]" "$junkd_mod" | rg -o "'[a-z]+'" | tr -d "'" | sort)
[ "$junkd_list" = "$junkd_deps" ] || { echo "junkd: NOUNS in index.tsx differs from the manifest's dependencies"; exit 1; }
jq -e '.plugins[] | select(.name == "junkd" and .source == "./plugins/junkd")' "$root/.claude-plugin/marketplace.json" >/dev/null ||
    { echo "marketplace.json does not list junkd at ./plugins/junkd"; exit 1; }
rg -qF 'CLAUDE_CONFIG_DIR' "$junkd_mod" && rg -qF '/settings.json`' "$junkd_mod" &&
    rg -qF '/plugins/marketplaces/${MARKETPLACE}`' "$junkd_mod" && rg -qF '/.claude-plugin/marketplace.json`' "$junkd_mod" ||
    { echo "junkd: settings.json or marketplace.json is not spelled as Claude Code lays it"; exit 1; }
# The flag file is the shell-side truth of output_style off: the hooks module and scripts/setup.sh must both spell it
# ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/output-style-off. The style is named junkd:STE in both the file and the script.
rg -qF "/junkd/output-style-off" "$junkd_mod" && rg -qF '/junkd/output-style-off' "$root/plugins/junkd/skills/junkd/scripts/setup.sh" ||
    { echo "junkd: the output_style flag file is not spelled alike in the hooks module and setup.sh"; exit 1; }
rg -q '^name: STE$' "$root/plugins/junkd/output-styles/STE.md" && rg -qF '"junkd:STE"' "$root/plugins/junkd/skills/junkd/scripts/setup.sh" ||
    { echo "junkd: output-styles/STE.md is not named STE, or setup.sh does not set junkd:STE"; exit 1; }

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
    "$root/plugins/orch/bin/orch-state" new TEST-1 "Smoke test" >/dev/null
    "$root/plugins/orch/bin/orch-state" set TEST-1 in_progress >/dev/null
    state_list=$("$root/plugins/orch/bin/orch-state" list)
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

# Nine skills, plus junkd's skills/junkd: no SKILL.md (junkd is a mod, not a skill), only the real home of the
# plugin-root helper symlinks, as the layout invariant above asks.
[ "$(ls -1 "$installed" | wc -l | tr -d ' ')" = 10 ]
[ ! -e "$installed/junkd/SKILL.md" ] || { echo "junkd grew a SKILL.md: count it as a skill above"; exit 1; }

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
    case "$(basename "$skill_dir")" in handon) continue ;; esac
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

# `handon` gives skills-only installs the resume half of the handoff plugin. It must stay a
# pure delegator: SKILL.md plus its Codex metadata, no helpers and no symlinks of its own.
[ -f "$installed/handon/SKILL.md" ] || { echo "handon: no SKILL.md"; exit 1; }
[ -f "$installed/handon/agents/openai.yaml" ] || { echo "handon: no agents/openai.yaml"; exit 1; }
handon_files=$(find "$installed/handon" -mindepth 1 ! -type d | wc -l | tr -d ' ')
[ "$handon_files" = 2 ] || { echo "handon ships $handon_files files, expected 2"; exit 1; }
[ -z "$(find "$root/plugins/handoff/skills/handon" -type l)" ] ||
    { echo "handon must not contain symlinks"; exit 1; }
rg -qF '`handoff` skill' "$installed/handon/SKILL.md" ||
    { echo "handon/SKILL.md does not delegate to the handoff skill"; exit 1; }

# The catalog degrades to listing sibling skills instead of claiming the marketplace is empty.
standalone_catalog=$(cd "$installed/junk-drawer" && HOME=$home ./bin/junk-drawer)
rg -q 'standalone skills' <<<"$standalone_catalog"
rg -q '\$orch' <<<"$standalone_catalog"

echo "smoke tests passed"
