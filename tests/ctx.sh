#!/usr/bin/env bash
# ctx-limit and ctx-tokens shell-side tests over temp dirs, never a real home: bin/ctx-limit (the CLI) and
# bin/ctx-limit-hook (UserPromptSubmit) on every host, with fake transcripts; bin/ctx-tokens on the Claude Code,
# Codex and Kimi Code formats and its host detection through host-lib. The scripts run as the hooks and skills reach
# them: plugins/junkd/bin/<x> -> skills/junkd/bin/<x> -> skills/<skill>/bin/<x>, or the skill's own bin/.
# Run: bash tests/ctx.sh. Every check is an explicit `if`/`[ ]` so `set -e` catches it.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/junkd"
limit="$plugin/bin/ctx-limit"
hookbin="$plugin/bin/ctx-limit-hook"
skillhook="$plugin/skills/ctx-limit/bin/ctx-limit-hook"
tokens="$plugin/bin/ctx-tokens"
# The physical path, once: a TMPDIR ending in `/` (stock macOS) gives mktemp a `//`, and the paths derived from it
# (the Claude Code project folder name) would differ from the $PWD a `cd` normalises.
tmp=$(cd "$(mktemp -d "${TMPDIR:-/tmp}/T16-ctx-$$.XXXXXX")" && pwd -P)
trap 'rm -rf "$tmp"' EXIT

fail() { echo "ctx tests: $*" >&2; exit 1; }

home="$tmp/home"
ccfg="$tmp/claude"           # CLAUDE_CONFIG_DIR
xhome="$tmp/codex"           # CODEX_HOME
khome="$tmp/kimi"            # KIMI_CODE_HOME
xdg="$tmp/xdg"               # XDG_DATA_HOME
cdir="$ccfg/junkd"
xdir="$xhome/junk-drawer/junkd"
kdir="$khome/junk-drawer/junkd"
odir="$xdg/opencode/junk-drawer/junkd"
mkdir -p "$home"

# No host signal at all (see skills/handoff/bin/host-lib); each host adds what it sets. HOME is the temp home, so a
# helper that fell back to $HOME would land in it (checked at the end: it stays empty).
noh=(env -u CLAUDECODE -u CLAUDE_PLUGIN_ROOT -u CLAUDE_CONFIG_DIR -u CODEX_THREAD_ID -u CODEX_HOME -u PLUGIN_ROOT
    -u KIMI_PLUGIN_ROOT -u KIMI_CODE_HOME -u KIMI_SESSION_ID -u OPENCODE -u OPENCODE_PID -u JUNK_DRAWER_RUNTIME
    -u XDG_DATA_HOME HOME="$home")
# The variables each host exports to a skill's Bash call and to its hooks.
on_claude=(CLAUDECODE=1 CLAUDE_CONFIG_DIR="$ccfg")
on_codex=(CODEX_HOME="$xhome" CODEX_THREAD_ID=thread-1)
codex_root="$xhome/plugins/cache/junk-drawer/junkd/0.5.0"
on_codex_hook=(CODEX_HOME="$xhome" PLUGIN_ROOT="$codex_root" CLAUDE_PLUGIN_ROOT="$codex_root")
on_kimi=(KIMI_CODE_HOME="$khome" KIMI_PLUGIN_ROOT="$tmp/kimi-plugin")
on_opencode=(XDG_DATA_HOME="$xdg" OPENCODE=1)

# ---------------------------------------------------------------- fixtures: 150000 context tokens on every host
CTX=150000
cat > "$tmp/claude.jsonl" <<'JSONL'
{"type":"user","message":{"content":"hi"}}
{"type":"assistant","message":{"usage":{"input_tokens":10,"cache_creation_input_tokens":20,"cache_read_input_tokens":30,"output_tokens":5}}}
{"type":"assistant","message":{"usage":{"input_tokens":50000,"cache_creation_input_tokens":50000,"cache_read_input_tokens":50000,"output_tokens":20}}}
JSONL
cat > "$tmp/codex.jsonl" <<JSONL
{"type":"session_meta","payload":{"cwd":"$tmp/proj","thread_source":"user"}}
{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":1200,"output_tokens":3},"model_context_window":258000}}}
{"type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":150000,"output_tokens":30},"model_context_window":258000}}}
JSONL
cat > "$tmp/kimi.jsonl" <<'JSONL'
{"type":"metadata","protocol_version":"1"}
{"type":"context.append_loop_event","event":{"type":"step.end","usage":{"inputOther":1,"inputCacheRead":2,"inputCacheCreation":3,"output":4}}}
{"type":"context.append_loop_event","event":{"type":"step.end","usage":{"inputOther":50000,"inputCacheRead":90000,"inputCacheCreation":10000,"output":7}}}
JSONL
printf '{"type":"assistant"}\n' > "$tmp/nousage.jsonl"

# A hook's stdin: the prompt and the transcript.
input() { jq -cn --arg p "$1" --arg t "$2" '{prompt: $p, transcript_path: $t, session_id: "s1"}'; }
# hook_<host> <prompt> [transcript]: run the hook as that host runs it; sets out (stdout), err (stderr), rc.
run_hook() { # <stdin> <cmd...>
    local in=$1
    shift
    set +e
    out=$(printf '%s' "$in" | "$@" 2>"$tmp/err")
    rc=$?
    set -e
    err=$(cat "$tmp/err")
}
hook_claude() { run_hook "$(input "$1" "${2:-$tmp/claude.jsonl}")" "${noh[@]}" "${on_claude[@]}" CLAUDE_PLUGIN_ROOT="$plugin" "$hookbin"; }
hook_codex() { run_hook "$(input "$1" "${2:-$tmp/codex.jsonl}")" "${noh[@]}" "${on_codex_hook[@]}" bash "$skillhook"; }
hook_kimi() { run_hook "$(input "$1" "${2:-$tmp/kimi.jsonl}")" "${noh[@]}" "${on_kimi[@]}" bash "$skillhook"; }
# The CLI as each host's skill runs it.
cli() { # <host> <args...>; sets out, err, rc
    local host=$1
    shift
    local -a vars
    case "$host" in
        claude) vars=("${on_claude[@]}") ;;
        codex) vars=("${on_codex[@]}") ;;
        kimi) vars=("${on_kimi[@]}") ;;
        opencode) vars=("${on_opencode[@]}") ;;
        none) vars=() ;;
    esac
    set +e
    out=$("${noh[@]}" ${vars[@]+"${vars[@]}"} "$limit" "$@" 2>"$tmp/err")
    rc=$?
    set -e
    err=$(cat "$tmp/err")
}
dir_of() { case "$1" in claude) echo "$cdir" ;; codex) echo "$xdir" ;; kimi) echo "$kdir" ;; opencode) echo "$odir" ;; esac; }
reset() { rm -rf "$ccfg" "$xhome" "$khome" "$xdg"; }
blocked() { # <host> <what>: the hook refused the prompt as that host refuses one
    case "$1" in
        codex)
            [ "$rc" = 0 ] && jq -e '.continue == false and (.stopReason | test("ctx-limit reached")) and (.systemMessage | length > 0)' <<<"$out" >/dev/null ||
                fail "$2: codex did not answer continue:false (rc $rc, out $out, err $err)"
            ;;
        *)
            [ "$rc" = 2 ] && rg -qF "ctx-limit reached: $CTX >= " <<<"$err" && [ -z "$out" ] ||
                fail "$2: $1 did not exit 2 with the reason on stderr (rc $rc, out $out, err $err)"
            ;;
    esac
}
passed() { # <what>: the hook let the prompt through without a word
    [ "$rc" = 0 ] && [ -z "$out" ] && [ -z "$err" ] || fail "$1: expected a silent pass (rc $rc, out $out, err $err)"
}

# ---------------------------------------------------------------- the links reach the real scripts
for x in ctx-limit ctx-limit-hook; do
    [ -L "$plugin/skills/junkd/bin/$x" ] && [ -x "$plugin/skills/ctx-limit/bin/$x" ] && [ ! -L "$plugin/skills/ctx-limit/bin/$x" ] ||
        fail "skills/junkd/bin/$x is no link to a real skills/ctx-limit/bin/$x"
    [ "$(readlink -f "$plugin/bin/$x")" = "$(readlink -f "$plugin/skills/ctx-limit/bin/$x")" ] || fail "bin/$x does not reach skills/ctx-limit/bin/$x"
done
[ "$(readlink -f "$tokens")" = "$(readlink -f "$plugin/skills/ctx-tokens/bin/ctx-tokens")" ] || fail "bin/ctx-tokens does not reach skills/ctx-tokens"

# ---------------------------------------------------------------- the CLI on every host: its own junkd folder only
for host in claude codex kimi opencode; do
    reset
    d=$(dir_of "$host")
    cli "$host" status
    [ "$rc" = 0 ] && [ "$out" = "ctx-limit: OFF — action: block" ] || [ "$host" = opencode ] || fail "$host status: rc $rc, $out $err"
    cli "$host"
    rg -q '^ctx-limit: OFF' <<<"$out" || fail "$host: no argument is not status: $out"
    cli "$host" off
    [ "$rc" = 0 ] || fail "$host off: rc $rc"
    [ ! -e "$d" ] || fail "$host: status and off created $d"

    cli "$host" 250k
    [ "$rc" = 0 ] && [ "$(cat "$d/ctx-limit-threshold")" = 250000 ] || fail "$host 250k: rc $rc, file $(cat "$d/ctx-limit-threshold" 2>&1)"
    rg -qF 'ctx-limit ON @ 250000 tokens' <<<"$out" || fail "$host 250k: $out"
    cli "$host" 1m
    [ "$(cat "$d/ctx-limit-threshold")" = 1000000 ] || fail "$host 1m"
    cli "$host" 2K
    [ "$(cat "$d/ctx-limit-threshold")" = 2000 ] || fail "$host 2K (upper-case suffix)"
    cli "$host" 300000
    [ "$(cat "$d/ctx-limit-threshold")" = 300000 ] || fail "$host 300000"
    for junk in junk 12x k 1.5k -5 '' 3kk; do
        cli "$host" "$junk"
        if [ "$junk" = '' ]; then
            [ "$rc" = 0 ] || fail "$host: an empty argument is status"
            continue
        fi
        [ "$rc" = 1 ] && rg -q '^usage: ctx-limit' <<<"$err" || fail "$host '$junk': rc $rc, err $err"
        [ "$(cat "$d/ctx-limit-threshold")" = 300000 ] || fail "$host '$junk' changed the threshold"
    done
    cli "$host" status
    rg -qF 'ON @ 300000 tokens' <<<"$out" || fail "$host status when on: $out"
    cli "$host" on
    [ "$(cat "$d/ctx-limit-threshold")" = 300000 ] || fail "$host on changed a threshold already set"
    cli "$host" off
    [ ! -e "$d/ctx-limit-threshold" ] && [ "$out" = "ctx-limit OFF." ] || fail "$host off left the threshold"
    cli "$host" on
    want=200000
    [ "$host" = claude ] && want=300000
    [ "$(cat "$d/ctx-limit-threshold")" = $want ] || fail "$host on: default is not $want"
    cli "$host" reset
    [ ! -e "$d/ctx-limit-threshold" ] || fail "$host reset left the threshold"

    cli "$host" action warn
    [ "$(cat "$d/ctx-limit-action")" = warn ] || fail "$host action warn"
    cli "$host" action bogus
    [ "$rc" = 1 ] && [ "$(cat "$d/ctx-limit-action")" = warn ] || fail "$host action bogus: rc $rc"
    cli "$host" action
    [ "$rc" = 1 ] || fail "$host action with no mode: rc $rc"
    cli "$host" cmd
    [ "$rc" = 1 ] || fail "$host cmd with no command: rc $rc"
    cli "$host" cmd say hi there
    [ "$(cat "$d/ctx-limit-cmd")" = "say hi there" ] && [ "$(cat "$d/ctx-limit-action")" = cmd ] || fail "$host cmd"
    cli "$host" status
    rg -qF 'action: cmd' <<<"$out" && rg -qF '  cmd: say hi there' <<<"$out" || fail "$host status with cmd: $out"

    # never another host's folder
    for other in claude codex kimi opencode; do
        [ "$other" = "$host" ] && continue
        [ ! -e "$(dir_of "$other")" ] || fail "$host wrote into $other's folder $(dir_of "$other")"
    done
done
reset
cli opencode status
rg -qF 'OpenCode runs no hook' <<<"$out" || fail "opencode status does not say the limit is not enforced: $out"

# Claude Code without CLAUDE_CONFIG_DIR: $HOME/.claude/junkd.
"${noh[@]}" CLAUDECODE=1 "$limit" 5k >/dev/null
[ "$(cat "$home/.claude/junkd/ctx-limit-threshold")" = 5000 ] || fail "claude with no CLAUDE_CONFIG_DIR: not under \$HOME/.claude/junkd"
rm -rf "$home/.claude"

# An unknown host: exit 2 with host-lib's reason, nothing written anywhere.
cli none 250k
[ "$rc" = 2 ] && rg -qF 'cannot tell which host' <<<"$err" || fail "unknown host: rc $rc, err $err"
[ -z "$(ls -A "$home")" ] && [ ! -e "$ccfg" ] && [ ! -e "$xhome" ] || fail "unknown host wrote something"
cli none status
[ "$rc" = 2 ] || fail "unknown host status: rc $rc"
set +e
"${noh[@]}" JUNK_DRAWER_RUNTIME=bogus "$limit" status >/dev/null 2>&1
rc=$?
set -e
[ "$rc" = 2 ] || fail "JUNK_DRAWER_RUNTIME=bogus: rc $rc"
"${noh[@]}" JUNK_DRAWER_RUNTIME=codex CODEX_HOME="$xhome" "$limit" 7k >/dev/null
[ "$(cat "$xdir/ctx-limit-threshold")" = 7000 ] || fail "JUNK_DRAWER_RUNTIME=codex does not pick Codex"
reset

# ---------------------------------------------------------------- the hook: off, block, the boundary
for host in claude codex kimi; do
    reset
    hook_$host "continue"
    passed "$host off (no threshold file)"
    cli "$host" 100k
    hook_$host "continue"
    blocked "$host" "$host past the limit"
    cli "$host" 150000 # ctx == threshold: blocked (>=)
    hook_$host "continue"
    blocked "$host" "$host at the limit"
    cli "$host" 150001
    hook_$host "continue"
    passed "$host one under the limit"
    cli "$host" 100k
    # an empty, junk or missing threshold, a transcript without usage or none: fail open
    printf 'abc\n' > "$(dir_of "$host")/ctx-limit-threshold"
    hook_$host "continue"
    passed "$host junk threshold"
    : > "$(dir_of "$host")/ctx-limit-threshold"
    hook_$host "continue"
    passed "$host empty threshold"
    cli "$host" 100k
    hook_$host "continue" "$tmp/nousage.jsonl"
    passed "$host transcript with no usage"
    hook_$host "continue" "$tmp/missing.jsonl"
    passed "$host missing transcript"
    # Codex's message points at the handoff skill, Claude Code's at /junkd:handoff
    cli "$host" action warn
    hook_$host "continue"
    [ "$rc" = 0 ] && rg -qF "ctx-limit: context is $CTX tokens (limit 100000)" <<<"$out" || fail "$host warn: rc $rc, out $out"
    if [ "$host" = claude ]; then
        rg -qF '/junkd:handoff then /clear' <<<"$out" || fail "claude warn does not name /junkd:handoff: $out"
    else
        rg -qF 'invoke the handoff skill' <<<"$out" || fail "$host warn does not name the handoff skill: $out"
    fi
    cli "$host" cmd 'printf "%s %s" "$CTX_TOKENS" "$CTX_LIMIT" > "'"$tmp/cmd-$host"'"'
    hook_$host "continue"
    passed "$host cmd"
    [ "$(cat "$tmp/cmd-$host")" = "$CTX 100000" ] || fail "$host cmd: the command did not run with CTX_TOKENS and CTX_LIMIT ($(cat "$tmp/cmd-$host" 2>&1))"
    cli "$host" action block
done

# Kimi Code passes session_id and no transcript_path: the hook finds the live wire.jsonl itself.
reset
cli kimi 100k
mkdir -p "$khome/sessions/proj1/s1/agents/main"
cp "$tmp/kimi.jsonl" "$khome/sessions/proj1/s1/agents/main/wire.jsonl"
run_hook '{"prompt":"continue","session_id":"s1"}' "${noh[@]}" "${on_kimi[@]}" bash "$skillhook"
blocked kimi "kimi through session_id"
run_hook '{"prompt":"continue","session_id":"s2"}' "${noh[@]}" "${on_kimi[@]}" bash "$skillhook"
passed "kimi with a session id of no wire file"

# Each host reads only its own folder: a Claude Code limit does not block Codex or Kimi Code, and back.
reset
cli claude 100k
hook_codex "continue"
passed "codex with only a Claude Code limit"
hook_kimi "continue"
passed "kimi with only a Claude Code limit"
reset
cli codex 100k
hook_claude "continue"
passed "claude with only a Codex limit"
reset

# An unknown host: the hook exits 0 whatever the files say (here every host's limit is set).
for host in claude codex kimi; do cli "$host" 100k; done
mkdir -p "$home/.claude/junkd" && printf '100000\n' > "$home/.claude/junkd/ctx-limit-threshold"
run_hook "$(input continue "$tmp/claude.jsonl")" "${noh[@]}" bash "$skillhook"
passed "unknown host"
run_hook "$(input continue "$tmp/claude.jsonl")" "${noh[@]}" JUNK_DRAWER_RUNTIME=bogus bash "$skillhook"
passed "JUNK_DRAWER_RUNTIME=bogus"
rm -rf "$home/.claude"

# ---------------------------------------------------------------- escape hatches and their lookalikes
reset
for host in claude codex; do cli "$host" 100k; done
for p in '/junkd:ctx-limit off' '/junkd:ctx-limit' '/junkd:handoff' '/junkd:handon abc' '/junkd:ahandoff off' '/clear' '/compact' '/compact keep the tests' \
    '$ctx-limit off' '$handoff' '/skill:ctx-limit off' '/skill:handoff' '/skill:handon abc' '/ctx-limit off' '/handoff' \
    '/handon abc' '   /junkd:ctx-limit off' 'Use $ctx-limit to turn the guard off' 'Use $handoff now' $'/clear\tnow'; do
    hook_claude "$p"
    passed "claude escape '$p'"
    hook_codex "$p"
    passed "codex escape '$p'"
done
for p in '/ctx-limiter off' '/junkd:ctx-limiter' '$handoffs' '$ctx-limiter off' '/junkd:handoffs' '/junkd:orch' '/clearance review' '/compaction' \
    '/handoff:handoff' '/ahandoff' '/skill:ctx-limiter' '/handonx' 'Explain why $ctx-limit blocked me' 'please /clear' \
    'Use $handoffs' '/junkd:ctx-limit-off'; do
    hook_claude "$p"
    blocked claude "claude lookalike '$p'"
    hook_codex "$p"
    blocked codex "codex lookalike '$p'"
done

# ---------------------------------------------------------------- ctx-tokens
tok() { # <env/args...>: sets out, err, rc
    set +e
    out=$("${noh[@]}" "$@" 2>"$tmp/err")
    rc=$?
    set -e
    err=$(cat "$tmp/err")
}
# an explicit file: the flag picks the format, without one the content tells
tok "$tokens" --claude "$tmp/claude.jsonl"
[ "$out" = $CTX ] || fail "ctx-tokens --claude: $out"
tok "$tokens" "$tmp/claude.jsonl"
[ "$out" = $CTX ] || fail "ctx-tokens <claude file>: $out $err"
tok "$tokens" -h "$tmp/claude.jsonl"
[ "$out" = "ctx 150k ($CTX) | out 20" ] || fail "ctx-tokens -h claude: $out"
tok "$tokens" --human "$tmp/claude.jsonl"
[ "$out" = "ctx 150k ($CTX) | out 20" ] || fail "ctx-tokens --human claude: $out"
tok "$tokens" --codex "$tmp/codex.jsonl"
[ "$out" = $CTX ] || fail "ctx-tokens --codex: $out"
tok "$tokens" "$tmp/codex.jsonl"
[ "$out" = $CTX ] || fail "ctx-tokens <codex file>: $out"
tok "$tokens" --codex -h "$tmp/codex.jsonl"
[ "$out" = "ctx 150k ($CTX) | remaining 108k (108000) | window 258000 | out 30" ] || fail "ctx-tokens -h codex: $out"
tok "$tokens" --kimi "$tmp/kimi.jsonl"
[ "$out" = $CTX ] || fail "ctx-tokens --kimi: $out"
tok "$tokens" "$tmp/kimi.jsonl"
[ "$out" = $CTX ] || fail "ctx-tokens <kimi file>: $out"
tok "$tokens" -h --kimi "$tmp/kimi.jsonl"
[ "$out" = "ctx 150k ($CTX) | out 7" ] || fail "ctx-tokens -h kimi: $out"
# an explicit file wins over the detected host
tok CLAUDECODE=1 CLAUDE_CONFIG_DIR="$ccfg" "$tokens" "$tmp/codex.jsonl"
[ "$out" = $CTX ] || fail "ctx-tokens <codex file> on Claude Code: $out"
tok "$tokens" "$tmp/nousage.jsonl"
[ "$rc" = 1 ] && rg -qF 'no supported usage record' <<<"$err" || fail "ctx-tokens with no usage: rc $rc $err"
tok "$tokens" "$tmp/missing.jsonl"
[ "$rc" = 1 ] && [ "$err" = "no transcript" ] || fail "ctx-tokens with a missing file: rc $rc $err"

# no file: the transcript of the host host-lib detects, for --cwd
proj="$tmp/proj"
mkdir -p "$proj"
reset
tok "${on_claude[@]}" "$tokens" --cwd "$proj"
[ "$rc" = 1 ] && [ "$err" = "no transcript" ] || fail "ctx-tokens on Claude Code with no transcript: rc $rc $err"
# Codex transcripts exist, but the detected host is Claude Code: no guess into Codex
mkdir -p "$xhome/sessions/2026/10/19"
cp "$tmp/codex.jsonl" "$xhome/sessions/2026/10/19/rollout-1.jsonl"
tok "${on_claude[@]}" CODEX_HOME="$xhome" "$tokens" --cwd "$proj"
[ "$rc" = 1 ] || fail "ctx-tokens on Claude Code read another host's transcript: $out"
# the flag overrides the detected host
tok "${on_claude[@]}" CODEX_HOME="$xhome" "$tokens" --codex --cwd "$proj"
[ "$out" = $CTX ] || fail "ctx-tokens --codex on Claude Code: rc $rc $out $err"
mkdir -p "$ccfg/projects/$(printf '%s' "$proj" | sed 's/[^A-Za-z0-9]/-/g')"
cp "$tmp/claude.jsonl" "$ccfg/projects/$(printf '%s' "$proj" | sed 's/[^A-Za-z0-9]/-/g')/sess.jsonl"
tok "${on_claude[@]}" "$tokens" --cwd "$proj"
[ "$out" = $CTX ] || fail "ctx-tokens on Claude Code: rc $rc $out $err"
tok "${on_claude[@]}" "$tokens" --cwd "$proj" -h
[ "$out" = "ctx 150k ($CTX) | out 20" ] || fail "ctx-tokens -h on Claude Code: $out"
(cd "$proj" && "${noh[@]}" "${on_claude[@]}" "$tokens" > "$tmp/pwd.out")
[ "$(cat "$tmp/pwd.out")" = $CTX ] || fail "ctx-tokens with no --cwd does not read the working directory's session"
# Claude Code maps every non-alphanumeric character of the cwd to "-", not only "/": a dotted cwd has its own folder
dot="$tmp/repo.d/.claude/worktrees/a_b"
mkdir -p "$dot" "$ccfg/projects/${dot//[^A-Za-z0-9]/-}"
cp "$tmp/claude.jsonl" "$ccfg/projects/${dot//[^A-Za-z0-9]/-}/sess.jsonl"
tok "${on_claude[@]}" "$tokens" --cwd "$dot"
[ "$out" = $CTX ] || fail "ctx-tokens on Claude Code with a dotted cwd: rc $rc $out $err"
tok "${on_codex[@]}" "$tokens" --cwd "$proj"
[ "$out" = $CTX ] || fail "ctx-tokens on Codex: rc $rc $out $err"
tok "${on_codex[@]}" "$tokens" --cwd "$tmp/elsewhere"
[ "$rc" = 1 ] || fail "ctx-tokens on Codex found a transcript of another cwd: $out"
mkdir -p "$khome/sessions/p/session_1/agents/main"
jq -cn --arg d "$proj" '{workDir: $d}' > "$khome/sessions/p/session_1/state.json"
cp "$tmp/kimi.jsonl" "$khome/sessions/p/session_1/agents/main/wire.jsonl"
tok "${on_kimi[@]}" "$tokens" --cwd "$proj"
[ "$out" = $CTX ] || fail "ctx-tokens on Kimi Code: rc $rc $out $err"
tok "${on_kimi[@]}" "$tokens" --cwd "$tmp/elsewhere"
[ "$rc" = 1 ] || fail "ctx-tokens on Kimi Code found a transcript of another cwd: $out"
# no host signal: the old guess, the Claude Code folder under $HOME first, then Codex, then Kimi Code
tok CODEX_HOME="$xhome" "$tokens" --cwd "$proj" -h
rg -qF 'remaining 108k' <<<"$out" || fail "ctx-tokens with no host signal does not fall back to Codex: rc $rc $out $err"
reset
rm -rf "$home/.claude" "$home/.codex" "$home/.kimi-code"

# Nothing ever landed in the temp home but what a test put there and took away.
[ -z "$(ls -A "$home")" ] || fail "something was written under HOME: $(ls -A "$home")"

echo "ctx tests passed"
