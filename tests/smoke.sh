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
                if ! rg -q -e '\./commands/' "$plugin"skills/*/SKILL.md; then continue; fi
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

CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$root/plugins/molt/bin/molt-auto" on >/dev/null
CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$root/plugins/molt/bin/molt-auto" limit 1 >/dev/null
molt_hook=$(printf '{"transcript_path":"%s","stop_hook_active":false}' "$tmp/codex.jsonl" |
    CODEX_HOME="$runtime" PLUGIN_ROOT="$root/plugins/molt" "$root/plugins/molt/bin/molt-stop")
printf '%s\n' "$molt_hook" | jq -e '.continue == true and (.systemMessage | contains("Molt recommended"))' >/dev/null

CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$root/plugins/tldr/bin/tldr-flag" on >/dev/null
tldr_hook=$(CODEX_HOME="$runtime" PLUGIN_ROOT="$root/plugins/tldr" "$root/plugins/tldr/bin/tldr-hook")
rg -q 'TL;DR MODE ON' <<<"$tldr_hook"
CODEX_HOME="$runtime" JUNK_DRAWER_RUNTIME=codex "$root/plugins/tldr/bin/tldr-flag" off >/dev/null

handoff_result=$(CODEX_THREAD_ID=codex-id CLAUDE_CODE_SESSION_ID=claude-id CLAUDE_CONFIG_DIR="$claude_runtime" \
    JUNK_DRAWER_RUNTIME=claude "$root/plugins/handoff/bin/handoff-path")
[ "$(printf '%s\n' "$handoff_result" | tail -1)" = claude-i ]

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

[ "$(ls -1 "$installed" | wc -l | tr -d ' ')" = 10 ]

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
[ -x "$installed/molt/bin/molt-path" ]
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
