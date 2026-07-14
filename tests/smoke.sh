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
echo "smoke tests passed"
