#!/usr/bin/env bash
# junkd's orch tests: the SessionStart rule-sheet hook, the SubagentStop agent records, the agent roster, and the bin scripts
# (orch-state list/set/new/reset-stale, orch-worktree add/slot/remove). Run: bash tests/orch.sh
# (tests/smoke.sh runs it too). Every check is an explicit `if`/`[ ]` so `set -e` catches it.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
plugin="$root/plugins/junkd"
hook="$plugin/scripts/orch-context.sh"
sheet="$plugin/skills/orch/ORCHESTRATOR.md"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# The hook reads the orch_enabled and orch_inject_rules flag files under the config dir: point it at a fresh one so
# a real ~/.claude/junkd/orch-off or orch-rules-off never decides a test.
export CLAUDE_CONFIG_DIR="$tmp/cfg"

fail() { echo "orch tests: $*" >&2; exit 1; }

# ---------------------------------------------------------------- rule sheet + hook (AC2, AC3)
[ -f "$sheet" ] || fail "no ORCHESTRATOR.md"
lines=$(wc -l < "$sheet" | tr -d ' ')
[ "$lines" -lt 80 ] || fail "ORCHESTRATOR.md has $lines lines, must be under 80"
rg -q 'Fable' "$sheet" || fail "ORCHESTRATOR.md does not mention Fable"
rg -q 'Opus' "$sheet" || fail "ORCHESTRATOR.md does not mention Opus"

# hooks.json: a SessionStart command hook that runs scripts/orch-context.sh
jq -e '.hooks.SessionStart[0].hooks[] | select(.type == "command" and (.command | contains("/scripts/orch-context.sh")))' \
    "$plugin/hooks/hooks.json" >/dev/null || fail "hooks.json has no SessionStart hook for scripts/orch-context.sh"
[ -L "$plugin/scripts" ] || fail "plugins/junkd/scripts must be a symlink into skills/"
[ -x "$plugin/skills/orch/scripts/orch-context.sh" ] || fail "orch-context.sh is not executable"
# the link chain the hook is reached through: scripts -> skills/junkd/scripts, whose orch-context.sh is a file link to
# ../../orch/scripts/orch-context.sh; the sheet is beside the real file only, so a dirname-only lookup finds nothing
[ -L "$plugin/skills/junkd/scripts/orch-context.sh" ] || fail "skills/junkd/scripts/orch-context.sh must be a link into skills/orch/scripts"
[ ! -e "$plugin/skills/junkd/ORCHESTRATOR.md" ] || fail "a sheet beside skills/junkd/scripts would hide a broken link lookup"
for via in "$plugin/scripts/orch-context.sh" "$plugin/skills/junkd/scripts/orch-context.sh" "$plugin/skills/orch/scripts/orch-context.sh"; do
    out=$(printf '{}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$via") || fail "hook via $via exited non-zero"
    [ "$out" = "$(cat "$sheet")" ] || fail "hook via $via: expected the sheet"
done
# an absolute link to it from anywhere else (a host that links the hook in) finds the sheet too
ln -s "$hook" "$tmp/linked-hook.sh"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$tmp/linked-hook.sh") || fail "hook via an absolute link exited non-zero"
[ "$out" = "$(cat "$sheet")" ] || fail "hook via an absolute link: expected the sheet"

# main session (no agent marker): the sheet, byte for byte (compared through files so a
# trailing-newline difference shows), exit 0
printf '{"session_id":"s1","hook_event_name":"SessionStart"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook" > "$tmp/main.out"
cmp -s "$tmp/main.out" "$sheet" || fail "main session: hook output differs from ORCHESTRATOR.md"
# no stdin at all (a tty-less hook with closed input) still prints the sheet
env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook" < /dev/null > "$tmp/nostdin.out"
cmp -s "$tmp/nostdin.out" "$sheet" || fail "main session without stdin: hook output differs"

# subagent by env marker: nothing, exit 0
sub=$(printf '{"session_id":"s1"}' | CLAUDE_AGENT_ID=agent-1 ORCH_INJECT_RULES= "$hook")
[ -z "$sub" ] || fail "CLAUDE_AGENT_ID set: hook printed $(wc -c <<<"$sub") bytes, expected nothing"
# subagent by hook-input marker (agent_id key, any spacing): nothing
for payload in '{"session_id":"s1","agent_id":"a1"}' '{"agent_id" : "a1"}' '{ "agent_id":"" }'; do
    sub=$(printf '%s' "$payload" | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook")
    [ -z "$sub" ] || fail "payload $payload: hook printed output, expected nothing"
done
# a key that merely contains the text (agent_identity) is NOT the marker
out=$(printf '{"agent_identity":"a1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook")
[ "$out" = "$(cat "$sheet")" ] || fail "agent_identity key wrongly treated as the subagent marker"

# ORCH_INJECT_RULES=0: nothing; any other value injects
off=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES=0 "$hook")
[ -z "$off" ] || fail "ORCH_INJECT_RULES=0: hook printed output, expected nothing"
for v in 1 00 off false; do
    on=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES=$v "$hook")
    [ "$on" = "$(cat "$sheet")" ] || fail "ORCH_INJECT_RULES=$v: expected the sheet (only 0 turns it off)"
done
# exit status is 0 in every case (a non-zero SessionStart hook would block the session)
printf '{}' | CLAUDE_AGENT_ID=a "$hook" >/dev/null || fail "subagent path exited non-zero"
printf '{}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES=0 "$hook" >/dev/null || fail "ORCH_INJECT_RULES=0 exited non-zero"

# the flag files the hooks module writes for orch_inject_rules off (orch-rules-off) and orch_enabled off (orch-off):
# nothing while one exists, the sheet once it is gone
mkdir -p "$CLAUDE_CONFIG_DIR/junkd" && : > "$CLAUDE_CONFIG_DIR/junkd/orch-rules-off"
flagged=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook") || fail "rules-off flag: hook exited non-zero"
[ -z "$flagged" ] || fail "rules-off flag present: hook printed output, expected nothing"
rm "$CLAUDE_CONFIG_DIR/junkd/orch-rules-off"
unflagged=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook")
[ "$unflagged" = "$(cat "$sheet")" ] || fail "rules-off flag removed: expected the sheet"
# a directory of that name (what a Write under junkd/orch-rules-off/ would leave) is no flag: the sheet still comes
mkdir -p "$CLAUDE_CONFIG_DIR/junkd/orch-rules-off/x"
dirflag=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook") || fail "rules-off dir: hook exited non-zero"
[ "$dirflag" = "$(cat "$sheet")" ] || fail "rules-off as a directory read as the flag: expected the sheet"
rm -r "$CLAUDE_CONFIG_DIR/junkd/orch-rules-off"
# with no CLAUDE_CONFIG_DIR the flag is read under $HOME/.claude
mkdir -p "$tmp/home/.claude/junkd" && : > "$tmp/home/.claude/junkd/orch-rules-off"
homeflag=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR HOME="$tmp/home" ORCH_INJECT_RULES= "$hook")
[ -z "$homeflag" ] || fail "rules-off flag under HOME/.claude: hook printed output, expected nothing"
rm "$tmp/home/.claude/junkd/orch-rules-off"
# the same for orch-off, the orch_enabled flag
: > "$CLAUDE_CONFIG_DIR/junkd/orch-off"
flagged=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook") || fail "orch-off flag: hook exited non-zero"
[ -z "$flagged" ] || fail "orch-off flag present: hook printed output, expected nothing"
rm "$CLAUDE_CONFIG_DIR/junkd/orch-off"
mkdir -p "$CLAUDE_CONFIG_DIR/junkd/orch-off/x"
dirflag=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook") || fail "orch-off dir: hook exited non-zero"
[ "$dirflag" = "$(cat "$sheet")" ] || fail "orch-off as a directory read as the flag: expected the sheet"
rm -r "$CLAUDE_CONFIG_DIR/junkd/orch-off"
: > "$tmp/home/.claude/junkd/orch-off"
homeflag=$(printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR HOME="$tmp/home" ORCH_INJECT_RULES= "$hook")
[ -z "$homeflag" ] || fail "orch-off flag under HOME/.claude: hook printed output, expected nothing"
# the old flag (orch/rules-off) is read no more
mkdir -p "$CLAUDE_CONFIG_DIR/orch" && : > "$CLAUDE_CONFIG_DIR/orch/rules-off"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook") || fail "old flag: hook exited non-zero"
[ "$out" = "$(cat "$sheet")" ] || fail "the old orch/rules-off flag still decides"
rm "$CLAUDE_CONFIG_DIR/orch/rules-off"

# the setting itself in settings.json (the hooks module writes the flag only at its own session start, after this
# hook): true injects even past a stale flag, any other value skips; only without a value does the flag decide
hsettings="$CLAUDE_CONFIG_DIR/settings.json"
flag="$CLAUDE_CONFIG_DIR/junkd/orch-rules-off"
offflag="$CLAUDE_CONFIG_DIR/junkd/orch-off"
hook_main() { printf '{"session_id":"s1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook"; }
# expect <sheet|none> <what>: the hook's output, exit 0
expect() {
    local out
    out=$(hook_main) || fail "$2: hook exited non-zero"
    if [ "$1" = sheet ]; then [ "$out" = "$(cat "$sheet")" ] || fail "$2: expected the sheet"
    else [ -z "$out" ] || fail "$2: expected nothing, got $(wc -c <<<"$out") bytes"; fi
}
for key in 'junkd@junk-drawer' 'junkd@other'; do
    for v in false null 0 '"true"'; do
        rm -f "$flag"
        printf '{"theme":"dark","pluginConfigs":{"%s":{"options":{"orch_inject_rules":%s}}}}' "$key" "$v" > "$hsettings"
        expect none "setting $key orch_inject_rules=$v, no flag"
    done
    printf '{"pluginConfigs":{"%s":{"options":{"orch_inject_rules":true}}}}' "$key" > "$hsettings"
    : > "$flag"
    expect sheet "setting $key orch_inject_rules=true past a stale flag"
done
rm -f "$flag"
# orch_enabled the same way: true goes on past a stale orch-off flag, any other value stops the sheet, whatever
# orch_inject_rules says
for key in 'junkd@junk-drawer' 'junkd@other'; do
    for v in false null 0 '"true"'; do
        for inject in '' ',"orch_inject_rules":true'; do
            rm -f "$offflag"
            printf '{"theme":"dark","pluginConfigs":{"%s":{"options":{"orch_enabled":%s%s}}}}' "$key" "$v" "$inject" > "$hsettings"
            expect none "setting $key orch_enabled=$v$inject, no flag"
        done
    done
    printf '{"pluginConfigs":{"%s":{"options":{"orch_enabled":true}}}}' "$key" > "$hsettings"
    : > "$offflag"
    expect sheet "setting $key orch_enabled=true past a stale orch-off flag"
    # orch_enabled on does not override orch_inject_rules off, nor its flag
    printf '{"pluginConfigs":{"%s":{"options":{"orch_enabled":true,"orch_inject_rules":false}}}}' "$key" > "$hsettings"
    expect none "setting $key orch_enabled=true, orch_inject_rules=false"
    printf '{"pluginConfigs":{"%s":{"options":{"orch_enabled":true}}}}' "$key" > "$hsettings"
    : > "$flag"
    expect none "setting $key orch_enabled=true, the orch-rules-off flag"
    rm -f "$flag"
    # each setting decides on its own: orch_inject_rules=true past a stale orch-off flag still needs orch_enabled
    printf '{"pluginConfigs":{"%s":{"options":{"orch_inject_rules":true}}}}' "$key" > "$hsettings"
    expect none "setting $key orch_inject_rules=true, orch_enabled unset, the orch-off flag"
done
rm -f "$offflag"
# the first junkd@ entry decides
printf '{"pluginConfigs":{"junkd@a":{"options":{"orch_inject_rules":true}},"junkd@b":{"options":{"orch_inject_rules":false}}}}' > "$hsettings"
: > "$flag"
expect sheet "first junkd@ entry true, flag present"
rm -f "$flag"
printf '{"pluginConfigs":{"junkd@a":{"options":{"orch_enabled":false}},"junkd@b":{"options":{"orch_enabled":true}}}}' > "$hsettings"
expect none "first junkd@ entry orch_enabled false"
# never into a subagent, whatever the setting says
printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_inject_rules":true}}}}' > "$hsettings"
sub=$(printf '{"agent_id":"a1"}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$hook") || fail "subagent with setting true: exit non-zero"
[ -z "$sub" ] || fail "subagent with setting true: hook printed output"
# ORCH_INJECT_RULES=0 still wins over a true setting
off=$(printf '{}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES=0 "$hook") || fail "ORCH_INJECT_RULES=0 with setting true: exit non-zero"
[ -z "$off" ] || fail "ORCH_INJECT_RULES=0 with setting true: hook printed output"
# no value: another plugin's entry, a name that only starts or ends with junkd, the old orch plugin's entry and keys
# (migrated by hand, never read), a key without its orch_ prefix, no options, no key, no pluginConfigs, a file that
# does not parse or holds two values, no file: each flag decides, both ways
for content in '{"pluginConfigs":{"tldr@junk-drawer":{"options":{"orch_inject_rules":true,"orch_enabled":true}}}}' \
    '{"pluginConfigs":{"junkdx@x":{"options":{"orch_inject_rules":true,"orch_enabled":true}}}}' \
    '{"pluginConfigs":{"xjunkd@x":{"options":{"orch_inject_rules":true,"orch_enabled":true}}}}' \
    '{"pluginConfigs":{"orch@junk-drawer":{"options":{"inject_rules":true,"enabled":true}}}}' \
    '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"inject_rules":true,"enabled":true}}}}' '{"pluginConfigs":{"junkd@junk-drawer":{}}}' \
    '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_rounds":5}}}}' '{"theme":"dark"}' '{"pluginConfigs":' \
    '{"pluginConfigs":{"junkd@a":{"options":{"orch_inject_rules":true,"orch_enabled":true}}}} {}' 'NOFILE'; do
    if [ "$content" = NOFILE ]; then rm -f "$hsettings"; else printf '%s' "$content" > "$hsettings"; fi
    for f in "$flag" "$offflag"; do
        : > "$f"
        expect none "settings $content with the flag $f"
        rm -f "$f"
    done
    expect sheet "settings $content without the flags"
done
# no jq on PATH (nothing added to it): the flag decides, a setting it cannot read does not
mkdir -p "$tmp/nojq-hook"
for t in bash cat dirname readlink; do ln -sf "$(command -v "$t")" "$tmp/nojq-hook/$t"; done
printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_inject_rules":true,"orch_enabled":true}}}}' > "$hsettings"
: > "$flag"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID PATH="$tmp/nojq-hook" ORCH_INJECT_RULES= "$hook") || fail "no jq: exit non-zero"
[ -z "$out" ] || fail "no jq, flag present: expected nothing (the setting can't be read)"
rm -f "$flag"
: > "$offflag"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID PATH="$tmp/nojq-hook" ORCH_INJECT_RULES= "$hook") || fail "no jq: exit non-zero"
[ -z "$out" ] || fail "no jq, orch-off flag present: expected nothing (the setting can't be read)"
rm -f "$offflag"
printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_inject_rules":false,"orch_enabled":false}}}}' > "$hsettings"
out=$(printf '{}' | env -u CLAUDE_AGENT_ID PATH="$tmp/nojq-hook" ORCH_INJECT_RULES= "$hook") || fail "no jq: exit non-zero"
[ "$out" = "$(cat "$sheet")" ] || fail "no jq, no flag: expected the sheet"
rm -f "$hsettings"
# with no CLAUDE_CONFIG_DIR the setting is read from $HOME/.claude/settings.json; with neither, exit 0 and the sheet
mkdir -p "$tmp/hhome/.claude"
for k in orch_inject_rules orch_enabled; do
    printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"%s":false}}}}' "$k" > "$tmp/hhome/.claude/settings.json"
    out=$(printf '{}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR HOME="$tmp/hhome" ORCH_INJECT_RULES= "$hook") || fail "HOME settings: exit non-zero"
    [ -z "$out" ] || fail "HOME settings $k false: expected nothing"
done
out=$(printf '{}' | env -u CLAUDE_AGENT_ID -u CLAUDE_CONFIG_DIR -u HOME ORCH_INJECT_RULES= "$hook") || fail "no HOME: exit non-zero"
[ "$out" = "$(cat "$sheet")" ] || fail "no HOME: expected the sheet"

# a missing sheet: empty output, still exit 0 (a failing SessionStart hook would block the session)
mkdir -p "$tmp/nosheet/scripts"
cp "$plugin/skills/orch/scripts/orch-context.sh" "$tmp/nosheet/scripts/"
missing=$(printf '{}' | env -u CLAUDE_AGENT_ID ORCH_INJECT_RULES= "$tmp/nosheet/scripts/orch-context.sh") || fail "missing sheet: hook exited non-zero"
[ -z "$missing" ] || fail "missing sheet: hook printed output"

# ---------------------------------------------------------------- agent records: the SubagentStop hook (T12 AC1)
stop="$plugin/scripts/orch-agent-stop.sh"
jq -e '.hooks.SubagentStop[0].hooks[] | select(.type == "command" and (.command | contains("/scripts/orch-agent-stop.sh")))' \
    "$plugin/hooks/hooks.json" >/dev/null || fail "hooks.json has no SubagentStop hook for scripts/orch-agent-stop.sh"
[ -x "$plugin/skills/orch/scripts/orch-agent-stop.sh" ] || fail "orch-agent-stop.sh is not executable"
[ -L "$plugin/skills/junkd/scripts/orch-agent-stop.sh" ] || fail "skills/junkd/scripts/orch-agent-stop.sh must be a link into skills/orch/scripts"
rcfg="$tmp/rcfg"
export CLAUDE_CONFIG_DIR="$rcfg"
agents="$rcfg/junkd/orch/_agents"
tr_dir="$tmp/transcripts"
mkdir -p "$tr_dir"
usage() { printf '{"type":"assistant","message":{"role":"assistant","usage":%s}}\n' "$1"; }
# the last usage record counts (input + cache-write + cache-read; output is no context), its last iteration when
# it has any; a line that does not parse, a usage that is no object and a line that only mentions "usage" are skipped
{
    usage '{"input_tokens":1,"cache_creation_input_tokens":2,"cache_read_input_tokens":3,"output_tokens":900}'
    printf '{"type":"user","message":{"content":"the usage of x"}}\n'
    usage '{"input_tokens":10,"cache_creation_input_tokens":200,"cache_read_input_tokens":3000,"output_tokens":5}'
    printf 'not json at all, "usage"\n'
    printf '{"type":"assistant","message":{"usage":"none"}}\n'
} > "$tr_dir/plain.jsonl"
{
    usage '{"input_tokens":7}'
    printf '{"broken": "usage"\n'
    usage '{"input_tokens":1,"cache_read_input_tokens":2,"iterations":[{"input_tokens":5000},{"input_tokens":40,"cache_creation_input_tokens":500,"cache_read_input_tokens":6000,"output_tokens":7}]}'
} > "$tr_dir/iter.jsonl"
usage '{"input_tokens":30,"cache_read_input_tokens":12,"iterations":[]}' > "$tr_dir/emptyiter.jsonl"
usage '{"input_tokens":"500","cache_creation_input_tokens":null,"cache_read_input_tokens":8}' > "$tr_dir/oddtypes.jsonl"
printf '{"type":"user"}\n' > "$tr_dir/nousage.jsonl"
# stop_event <session_id JSON> <agent_id JSON> <transcript> [agent_type]: the hook input, the ids as given (JSON values)
stop_event() {
    printf '{"session_id":%s,"transcript_path":"/x/main.jsonl","cwd":"/repo","hook_event_name":"SubagentStop","stop_hook_active":false,"agent_id":%s,"agent_transcript_path":"%s","agent_type":"%s","last_assistant_message":"done"}' \
        "$1" "$2" "$3" "${4:-junkd:implementer}"
}
# stop <session_id> <agent_id> <transcript> [agent_type]: runs the hook, which must exit 0 and print nothing
stop() {
    local out
    out=$(stop_event "\"$1\"" "\"$2\"" "$3" "${4:-}" | "$stop") || fail "stop $1/$2: exited non-zero"
    [ -z "$out" ] || fail "stop $1/$2: printed $out"
}
records() { [ -d "$agents" ] && find "$agents" -type f | sort || true; }
# want <file> <record>: the file holds exactly that record
want() { [ -f "$1" ] || fail "no record $1"; [ "$(cat "$1")" = "$2" ] || fail "record $1: $(cat "$1"), expected $2"; }
rm -rf "$rcfg"
stop s1 a1 "$tr_dir/plain.jsonl"
want "$agents/s1/a1.json" '{"type":"junkd:implementer","tokens":3210}'
[ "$(records)" = "$agents/s1/a1.json" ] || fail "an unnamed agent wrote more than its id's record: $(records)"
stop s1 a2 "$tr_dir/iter.jsonl" junkd:verify-coordinator
want "$agents/s1/a2.json" '{"type":"junkd:verify-coordinator","tokens":6540}'
stop s1 a3 "$tr_dir/emptyiter.jsonl"
want "$agents/s1/a3.json" '{"type":"junkd:implementer","tokens":42}'
stop s1 a4 "$tr_dir/oddtypes.jsonl"
want "$agents/s1/a4.json" '{"type":"junkd:implementer","tokens":8}'
# no usage record, or no transcript at all: the type is still recorded, the tokens unknown
stop s1 a5 "$tr_dir/nousage.jsonl"
want "$agents/s1/a5.json" '{"type":"junkd:implementer","tokens":null}'
stop s1 a6 "$tr_dir/missing.jsonl"
want "$agents/s1/a6.json" '{"type":"junkd:implementer","tokens":null}'
# a later stop of the same agent replaces its record
stop s1 a1 "$tr_dir/iter.jsonl"
want "$agents/s1/a1.json" '{"type":"junkd:implementer","tokens":6540}'
# each session in its own folder
stop s-2_B a1 "$tr_dir/emptyiter.jsonl"
want "$agents/s-2_B/a1.json" '{"type":"junkd:implementer","tokens":42}'
want "$agents/s1/a1.json" '{"type":"junkd:implementer","tokens":6540}'

# a named agent (the .meta.json beside its transcript) gets a second, identical record under its name; a name that
# is no plain id, an empty or non-string one, or no meta file adds nothing
cp "$tr_dir/plain.jsonl" "$tr_dir/named.jsonl"
printf '{"agentType":"junkd:implementer","name":"impl-T12_b"}' > "$tr_dir/named.meta.json"
rm -rf "$rcfg"
stop s1 n1 "$tr_dir/named.jsonl"
want "$agents/s1/n1.json" '{"type":"junkd:implementer","tokens":3210}'
want "$agents/s1/impl-T12_b.json" '{"type":"junkd:implementer","tokens":3210}'
for meta in '{"name":"impl\n"}' '{"name":"../escape"}' '{"name":"a/b"}' '{"name":"a b"}' '{"name":"a.b"}' '{"name":""}' '{"name":5}' '{"name":["x"]}' '{}' 'not json' NOFILE; do
    rm -rf "$rcfg"
    if [ "$meta" = NOFILE ]; then rm -f "$tr_dir/named.meta.json"; else printf '%s' "$meta" > "$tr_dir/named.meta.json"; fi
    stop s1 n1 "$tr_dir/named.jsonl"
    [ "$(records)" = "$agents/s1/n1.json" ] || fail "meta $meta: expected only the id's record, got $(records)"
done
[ ! -e "$tmp/escape.json" ] && [ ! -e "$agents/escape.json" ] || fail "a ../ name was written outside the session folder"

# ids that are no plain id ([A-Za-z0-9_-]+): nothing is written, exit 0
for pair in '"../x" "a1"' '"a/b" "a1"' '"" "a1"' 'null "a1"' '5 "a1"' '"s1" "../x"' '"s1" "a.b"' '"s1" "a b"' '"s1" ""' \
    '"s1" null' '"s1" 7' '"s1" ["a1"]' '"s1\nx" "a1"' '"s1" "a1\n"'; do
    rm -rf "$rcfg"
    out=$(stop_event ${pair% *} ${pair#* } "$tr_dir/plain.jsonl" | "$stop") || fail "ids $pair: exited non-zero"
    [ -z "$out" ] || fail "ids $pair: printed output"
    [ -z "$(records)" ] || fail "ids $pair: wrote $(records)"
done
# no session_id or agent_id key, an input that does not parse, no input
for input in '{"agent_id":"a1","agent_transcript_path":"x"}' '{"session_id":"s1"}' 'not json' ''; do
    rm -rf "$rcfg"
    printf '%s' "$input" | "$stop" || fail "input $input: exited non-zero"
    [ -z "$(records)" ] || fail "input $input: wrote $(records)"
done

# the gate, from settings.json (the first junkd@ entry): orch_enabled anything but true, or orch_guard off (any case,
# padded), writes nothing; no file, no junkd@ entry, no key, a file that does not parse = on
rsettings="$rcfg/settings.json"
# gated <settings or NOFILE> <none|record>
gated() {
    rm -rf "$rcfg"; mkdir -p "$rcfg"
    [ "$1" = NOFILE ] || printf '%s' "$1" > "$rsettings"
    stop s1 g1 "$tr_dir/plain.jsonl"
    if [ "$2" = none ]; then [ -z "$(records)" ] || fail "settings $1: expected no record, got $(records)"
    else want "$agents/s1/g1.json" '{"type":"junkd:implementer","tokens":3210}'; fi
}
for key in 'junkd@junk-drawer' 'junkd@other'; do
    for v in false null 0 '"true"' '"on"' '{}'; do
        gated "{\"pluginConfigs\":{\"$key\":{\"options\":{\"orch_enabled\":$v}}}}" none
    done
    for g in '"off"' '"OFF"' '" Off "' '"off\n"'; do
        gated "{\"pluginConfigs\":{\"$key\":{\"options\":{\"orch_enabled\":true,\"orch_guard\":$g}}}}" none
        gated "{\"pluginConfigs\":{\"$key\":{\"options\":{\"orch_guard\":$g}}}}" none
    done
    gated "{\"pluginConfigs\":{\"$key\":{\"options\":{\"orch_enabled\":true}}}}" record
    for g in '"fable"' '"always"' '"of"' '"offx"' '"o ff"' 'null' 'false'; do
        gated "{\"pluginConfigs\":{\"$key\":{\"options\":{\"orch_enabled\":true,\"orch_guard\":$g}}}}" record
    done
done
# the first junkd@ entry decides, both ways
gated '{"pluginConfigs":{"junkd@a":{"options":{"orch_enabled":false}},"junkd@b":{"options":{"orch_enabled":true}}}}' none
gated '{"pluginConfigs":{"junkd@a":{"options":{"orch_enabled":true}},"junkd@b":{"options":{"orch_enabled":false}}}}' record
gated '{"pluginConfigs":{"junkd@a":{"options":{"orch_guard":"off"}},"junkd@b":{"options":{"orch_guard":"fable"}}}}' none
gated '{"pluginConfigs":{"junkd@a":{"options":{"orch_guard":"fable"}},"junkd@b":{"options":{"orch_guard":"off"}}}}' record
# no value of junkd's: on
for content in '{"pluginConfigs":{"tldr@junk-drawer":{"options":{"orch_enabled":false,"orch_guard":"off"}}}}' \
    '{"pluginConfigs":{"junkdx@x":{"options":{"orch_enabled":false}}}}' '{"pluginConfigs":{"xjunkd@x":{"options":{"orch_guard":"off"}}}}' \
    '{"pluginConfigs":{"orch@junk-drawer":{"options":{"enabled":false,"guard":"off"}}}}' \
    '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"enabled":false,"guard":"off"}}}}' '{"pluginConfigs":{"junkd@junk-drawer":{}}}' \
    '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_rounds":5}}}}' '{"pluginConfigs":null}' '{"theme":"dark"}' '{"pluginConfigs":' 'NOFILE'; do
    gated "$content" record
done
# the module's flag files are not this hook's gate: only settings.json is
mkdir -p "$rcfg/junkd" && : > "$rcfg/junkd/orch-off"
stop s1 f1 "$tr_dir/plain.jsonl"
want "$agents/s1/f1.json" '{"type":"junkd:implementer","tokens":3210}'
# with no CLAUDE_CONFIG_DIR, the records and the settings are under $HOME/.claude
rm -rf "$tmp/rhome"
stop_event '"s1"' '"h1"' "$tr_dir/plain.jsonl" | env -u CLAUDE_CONFIG_DIR HOME="$tmp/rhome" "$stop" || fail "HOME: exited non-zero"
want "$tmp/rhome/.claude/junkd/orch/_agents/s1/h1.json" '{"type":"junkd:implementer","tokens":3210}'
rm -rf "$tmp/rhome"; mkdir -p "$tmp/rhome/.claude"
printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_guard":"off"}}}}' > "$tmp/rhome/.claude/settings.json"
stop_event '"s1"' '"h1"' "$tr_dir/plain.jsonl" | env -u CLAUDE_CONFIG_DIR HOME="$tmp/rhome" "$stop" || fail "HOME guard off: exited non-zero"
[ ! -e "$tmp/rhome/.claude/junkd" ] || fail "HOME settings guard off: a record was written"
# through every path the hook is reached by: the plugin root's link, skills/junkd's link, the real file
for via in "$plugin/scripts/orch-agent-stop.sh" "$plugin/skills/junkd/scripts/orch-agent-stop.sh" "$plugin/skills/orch/scripts/orch-agent-stop.sh"; do
    rm -rf "$rcfg"
    stop_event '"s1"' '"v1"' "$tr_dir/plain.jsonl" | "$via" || fail "via $via: exited non-zero"
    want "$agents/s1/v1.json" '{"type":"junkd:implementer","tokens":3210}'
done
# a folder it cannot write (the config dir is a file): nothing, exit 0
rm -rf "$rcfg"; : > "$rcfg"
stop s1 w1 "$tr_dir/plain.jsonl"
rm -f "$rcfg"
# no jq on PATH (the script adds nothing to it): nothing is written, exit 0
mkdir -p "$tmp/nojq-stop"
for t in bash cat grep tail mkdir; do ln -sf "$(command -v "$t")" "$tmp/nojq-stop/$t"; done
rm -rf "$rcfg"
stop_event '"s1"' '"j1"' "$tr_dir/plain.jsonl" | PATH="$tmp/nojq-stop" "$stop" || fail "no jq: exited non-zero"
[ -z "$(records)" ] || fail "no jq: wrote $(records)"
export CLAUDE_CONFIG_DIR="$tmp/cfg"

# ---------------------------------------------------------------- agents (AC1)
for agent in implementer verify-coordinator ui-reviewer orch-ops lead-implementer test-planner test-reviewer; do
    f="$plugin/agents/$agent.md"
    [ -f "$f" ] || fail "missing agent $agent"
    model=$(awk 'NR==1 && !/^---/ {exit} /^---/ {n++; if (n==2) exit; next} /^model:/ {sub(/^model:[ \t]*/, ""); print}' "$f")
    case "$model" in
        opus|sonnet|haiku) ;;
        *) fail "agent $agent: model '$model' is not opus|sonnet|haiku" ;;
    esac
    name=$(awk '/^---/ {n++; if (n==2) exit; next} /^name:/ {sub(/^name:[ \t]*/, ""); print}' "$f")
    [ "$name" = "$agent" ] || fail "agent $agent: frontmatter name is '$name'"
done
for pair in implementer:opus lead-implementer:opus verify-coordinator:opus ui-reviewer:sonnet test-planner:sonnet test-reviewer:sonnet orch-ops:haiku; do
    model=$(awk '/^---/ {n++; if (n==2) exit; next} /^model:/ {sub(/^model:[ \t]*/, ""); print}' "$plugin/agents/${pair%%:*}.md")
    [ "$model" = "${pair##*:}" ] || fail "agent ${pair%%:*}: model '$model', expected ${pair##*:}"
done

# ---------------------------------------------------------------- bin scripts (AC4, AC5)
for s in orch-state orch-sync orch-worktree; do bash -n "$plugin/bin/$s" || fail "bash -n $s"; done
bin="$plugin/bin"

mkdir -p "$tmp/project/.orch/tasks"
project=$(cd -P "$tmp/project" && pwd)   # git reports physical paths (/private/var on macOS)
git -C "$project" init -q
git -C "$project" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
cat > "$project/.orch/config.md" <<'CONFIG'
---
backend: adhoc
tasks_dir: ".orch/tasks"
default_base: main
branch_prefix: task/
capabilities:
  web: { run: "npm run dev", port_base: 5180, health: "/" }
---
CONFIG
printf '## T-0\nlesson one\n' > "$project/.orch/tasks/_lessons.md"
printf -- '---\nid: _draft\nstatus: todo\n---\n' > "$project/.orch/tasks/_draft.md"
printf 'no frontmatter here\n' > "$project/.orch/tasks/BROKEN.md"
cd "$project"

# new: skeleton with status todo; a duplicate is refused; a `_` id is refused
"$bin/orch-state" new T-1 "First task" >/dev/null
[ -f .orch/tasks/T-1.md ] || fail "new did not create T-1.md (quoted tasks_dir not honoured?)"
[ ! -e '.orch/tasks"' ] && [ ! -e '"' ] || fail "quoted tasks_dir taken literally"
rg -q '^status: todo$' .orch/tasks/T-1.md || fail "new: status is not todo"
rg -q '^title: First task$' .orch/tasks/T-1.md || fail "new: title not written"
if "$bin/orch-state" new T-1 2>/dev/null; then fail "new: duplicate id accepted"; fi
if "$bin/orch-state" new _lessons 2>/dev/null; then fail "new: id starting with _ accepted"; fi
if "$bin/orch-state" new 'a..b' 2>/dev/null; then fail "new: id with .. accepted"; fi
"$bin/orch-state" new x_y >/dev/null   # an inner _ is fine

# set: valid statuses rewrite the frontmatter; a bad status / unknown id / broken file is refused
"$bin/orch-state" set T-1 in_progress >/dev/null
rg -q '^status: in_progress$' .orch/tasks/T-1.md || fail "set: status not in_progress"
[ "$(rg -c '^status:' .orch/tasks/T-1.md)" = 1 ] || fail "set: duplicated the status line"
if "$bin/orch-state" set T-1 running 2>/dev/null; then fail "set: bad status accepted"; fi
if "$bin/orch-state" set NOPE todo 2>/dev/null; then fail "set: unknown id accepted"; fi
if "$bin/orch-state" set BROKEN todo 2>/dev/null; then fail "set: file without frontmatter accepted"; fi
if "$bin/orch-state" set _draft todo 2>/dev/null; then fail "set: _ id accepted"; fi
# a frontmatter block without a status line gets one inserted before the closing ---
printf -- '---\nid: NS\ntitle: no status\n---\nbody\n' > .orch/tasks/NS.md
"$bin/orch-state" set NS blocked >/dev/null
[ "$(cat .orch/tasks/NS.md)" = "$(printf -- '---\nid: NS\ntitle: no status\nstatus: blocked\n---\nbody')" ] || fail "set: status line not inserted: $(cat .orch/tasks/NS.md)"
# a CRLF file is rewritten LF with the new status
printf -- '---\r\nid: CR\r\nstatus: todo\r\n---\r\nbody\r\n' > .orch/tasks/CR.md
"$bin/orch-state" set CR done >/dev/null
rg -q $'^status: done$' .orch/tasks/CR.md || fail "set on CRLF: status not rewritten"
if rg -q $'\r' .orch/tasks/CR.md; then fail "set on CRLF: CR bytes remain"; fi

# list: header + one row per task file; `_`-files hidden; a file without frontmatter is `invalid`
list=$("$bin/orch-state" list)
[ "$(printf '%s\n' "$list" | head -1 | awk '{print $1, $2, $3, $4}')" = "ID STATUS ! DEPS" ] || fail "list: no header: $(printf '%s\n' "$list" | head -1)"
rg -q '^T-1[[:space:]]+in_progress[[:space:]]+\[\]' <<<"$list" || fail "list: T-1 row wrong: $list"
rg -q '^x_y[[:space:]]+todo' <<<"$list" || fail "list: x_y (inner underscore) missing"
rg -q '^CR[[:space:]]+done' <<<"$list" || fail "list: CR row missing"
rg -q '^BROKEN[[:space:]]+invalid' <<<"$list" || fail "list: BROKEN not marked invalid"
if rg -q '_lessons' <<<"$list"; then fail "list shows _lessons"; fi
if rg -q '_draft' <<<"$list"; then fail "list shows _draft"; fi
rg -q '^NS[[:space:]]+blocked' <<<"$list" || fail "list: NS row missing"
[ "$(printf '%s\n' "$list" | wc -l | tr -d ' ')" = 6 ] || fail "list: expected header + 5 rows, got: $list"

# deps: a flow list and a block list both print as [a, b]
printf -- '---\nid: D1\nstatus: todo\ndeps: [T-1, CR]\n---\n' > .orch/tasks/D1.md
printf -- '---\nid: D2\nstatus: "blocked"   # quoted\ndeps:\n  - T-1\n  - CR\n---\n' > .orch/tasks/D2.md
list=$("$bin/orch-state" list)
rg -q '^D1[[:space:]]+todo[[:space:]]+\[T-1, CR\]$' <<<"$list" || fail "list: flow deps wrong"
rg -q '^D2[[:space:]]+blocked[[:space:]]+\[T-1, CR\]$' <<<"$list" || fail "list: block deps / quoted status wrong"

# critical: `!` between status and deps only for critical: true (True, TRUE, double or single quotes, an unclosed quote, trailing
# blanks, an unquoted value with a space or tab # comment, CRLF, the first of two critical lines); false, a missing key, other
# spellings, an indented key, a longer key, a space before the colon, a block list, a line after the frontmatter and an invalid
# file get none
printf -- '---\nid: K1\nstatus: todo\ncritical: true\ndeps: [T-1]\n---\n' > .orch/tasks/K1.md
printf -- '---\nid: K2\nstatus: todo\ncritical: True\n---\n' > .orch/tasks/K2.md
printf -- '---\nid: K3\nstatus: todo\ncritical: TRUE\n---\n' > .orch/tasks/K3.md
printf -- '---\nid: K4\nstatus: todo\ncritical: "true"   # quoted\n---\n' > .orch/tasks/K4.md
printf -- '---\nid: K5\nstatus: todo\ncritical: false\n---\n' > .orch/tasks/K5.md
printf -- '---\nid: K6\nstatus: todo\ncritical: yes\n---\n' > .orch/tasks/K6.md
printf -- '---\nid: K7\nstatus: todo\ncritical: truely\n---\n' > .orch/tasks/K7.md
printf -- '---\r\nid: K8\r\nstatus: todo\r\ncritical: true\r\n---\r\n' > .orch/tasks/K8.md
printf -- '---\nid: KA\nstatus: todo\ncritical: true  # note\n---\n' > .orch/tasks/KA.md
printf -- '---\nid: KB\nstatus: todo\n  critical: true\n---\n' > .orch/tasks/KB.md
printf -- "---\nid: KC\nstatus: todo\ncritical: 'true'\n---\n" > .orch/tasks/KC.md
printf -- '---\nid: KD\nstatus: todo\ncritical:   true   \n---\n' > .orch/tasks/KD.md
printf -- '---\nid: KE\nstatus: todo\ncritical: "true\n---\n' > .orch/tasks/KE.md
printf -- '---\nid: KF\nstatus: todo\ncriticality: true\n---\n' > .orch/tasks/KF.md
printf -- '---\nid: KG\nstatus: todo\ncritical:\n  - true\n---\n' > .orch/tasks/KG.md
printf -- '---\nid: KH\nstatus: todo\ncritical: true\ncritical: false\n---\n' > .orch/tasks/KH.md
printf -- '---\nid: KI\nstatus: todo\ncritical : true\n---\n' > .orch/tasks/KI.md
printf -- '---\nid: KJ\nstatus: todo\ncritical: true\t# tab note\n---\n' > .orch/tasks/KJ.md
printf -- 'critical: true\n' > .orch/tasks/K9.md
printf -- '---\nid: K0\nstatus: todo\n---\ncritical: true\n' > .orch/tasks/K0.md
list=$("$bin/orch-state" list)
for k in K1 K2 K3 K4 K8 KA KC KD KE KH KJ; do rg -q "^$k[[:space:]]+todo[[:space:]]+![[:space:]]" <<<"$list" || fail "list: $k (critical) has no ! marker: $list"; done
rg -q '^K1[[:space:]]+todo[[:space:]]+![[:space:]]+\[T-1\]$' <<<"$list" || fail "list: K1 deps not after the marker: $list"
rg -q '^K9[[:space:]]+invalid[[:space:]]*$' <<<"$list" || fail "list: K9 (invalid) row wrong: $list"
[ "$(rg -c '!' <<<"$list")" = 12 ] || fail "list: expected the header + 11 critical rows with !, got: $list"
for k in K5 K6 K7 K9 K0 KB KF KG KI T-1 D1 D2 CR; do if rg -q "^$k[[:space:]].*!" <<<"$list"; then fail "list: $k is not critical but has !"; fi; done
rm -f .orch/tasks/K?.md

# reset-stale: in_progress -> todo; blocked only with --blocked; `_` files untouched
"$bin/orch-state" reset-stale >/dev/null
rg -q '^status: todo$' .orch/tasks/T-1.md || fail "reset-stale: T-1 not reset"
rg -q '^status: "blocked"' .orch/tasks/D2.md || fail "reset-stale touched a blocked task without --blocked"
"$bin/orch-state" reset-stale --blocked >/dev/null
rg -q '^status: todo$' .orch/tasks/D2.md || fail "reset-stale --blocked: D2 not reset"
[ "$("$bin/orch-state" reset-stale)" = "no stale tasks" ] || fail "reset-stale: expected 'no stale tasks'"
rg -q '^status: todo$' .orch/tasks/_draft.md || fail "reset-stale rewrote _draft.md"
[ "$(cat .orch/tasks/_lessons.md)" = "$(printf '## T-0\nlesson one')" ] || fail "_lessons.md changed"
if "$bin/orch-state" reset-stale --bogus 2>/dev/null; then fail "reset-stale: unknown flag accepted"; fi

# cfg / id
[ "$("$bin/orch-state" cfg default_base)" = main ] || fail "cfg default_base"
[ "$("$bin/orch-state" cfg backend)" = adhoc ] || fail "cfg backend"
[ "$("$bin/orch-state" id T-9)" = T-9 ] || fail "id T-9"
if "$bin/orch-state" id '' 2>/dev/null; then fail "id: empty accepted"; fi
if "$bin/orch-state" id '-x' 2>/dev/null; then fail "id: -x accepted"; fi

# orch-worktree: add (new branch / detached at an existing one), slot, remove; guards
out=$("$bin/orch-worktree" add T-1 task/T-1-first)
rg -q "^dir=$project/.worktrees/T-1$" <<<"$out" || fail "worktree add: dir line wrong: $out"
rg -q '^slot=0$' <<<"$out" || fail "worktree add: first slot is not 0"
rg -q '^web_port=5180$' <<<"$out" || fail "worktree add: web_port is not port_base+0"
if rg -q '^api_port=' <<<"$out"; then fail "worktree add: api_port printed with no api capability"; fi
[ -d .worktrees/T-1 ] || fail "worktree add: no directory"
git -C "$project" rev-parse --verify --quiet task/T-1-first >/dev/null || fail "worktree add: branch not created"
grep -qxF '.worktrees/' .git/info/exclude || fail "worktree add: .worktrees/ not excluded"
[ "$("$bin/orch-worktree" slot T-1)" = 0 ] || fail "slot: T-1 is not 0"
[ "$("$bin/orch-worktree" slot T-2)" = 1 ] || fail "slot: T-2 is not 1"
# the same add again is idempotent (same dir, same slot)
out2=$("$bin/orch-worktree" add T-1 task/T-1-first)
[ "$out2" = "$out" ] || fail "worktree add twice differs: $out2"
# an existing branch is attached detached, so the implementer's checkout may keep it
"$bin/orch-worktree" remove T-1 >/dev/null
out=$("$bin/orch-worktree" add T-1 task/T-1-first)
[ "$(git -C .worktrees/T-1 rev-parse --abbrev-ref HEAD)" = HEAD ] || fail "worktree add on an existing branch is not detached"
rg -q '^slot=0$' <<<"$out" || fail "worktree add after remove: slot 0 was freed and is the lowest free index; got: $out"
rg -q '^T-2 1$' .worktrees/.orch-slots || fail "re-adding T-1 disturbed T-2's slot"
if "$bin/orch-worktree" add T-3 main 2>/dev/null; then fail "worktree add accepted the default base as a task branch"; fi
# a bad branch name is refused by orch-worktree itself (its own message), before git sees it
err=$("$bin/orch-worktree" add T-3 '-x' 2>&1 && echo ACCEPTED || true)
rg -q "^orch: bad branch name '-x'$" <<<"$err" || fail "worktree add: bad branch name not refused by the guard: $err"
[ ! -d .worktrees/T-3 ] || fail "worktree add: bad branch name created a worktree"
# branch == base with an EXISTING base: without the guard git would happily attach detached at it
git -C "$project" branch feat
if "$bin/orch-worktree" add T-3 feat feat 2>/dev/null; then fail "worktree add accepted branch == base"; fi
[ ! -d .worktrees/T-3 ] || fail "worktree add: branch == base created a worktree"
if "$bin/orch-worktree" add _t b 2>/dev/null; then fail "worktree add accepted a _ id"; fi
# the dir exists but holds another commit than <branch>: refused with the remove hint, dir kept
git -C "$project" -c user.email=t@t -c user.name=t commit -q --allow-empty -m second
git -C "$project" branch other HEAD
err=$("$bin/orch-worktree" add T-1 other 2>&1 && echo ACCEPTED || true)
rg -q "^orch: $project/.worktrees/T-1 is not at other; run orch-worktree remove T-1 first$" <<<"$err" ||
    fail "worktree add: existing dir at another commit not refused: $err"
[ -d .worktrees/T-1 ] || fail "worktree add: the refused add removed the dir"
# add with an existing base: the new branch starts at the base's commit
out=$("$bin/orch-worktree" add T-4 task/T-4-from-feat feat)
rg -q "^dir=$project/.worktrees/T-4$" <<<"$out" || fail "worktree add with base: dir line wrong: $out"
[ "$(git -C "$project" rev-parse task/T-4-from-feat)" = "$(git -C "$project" rev-parse feat)" ] || fail "worktree add with base: branch not at the base commit"
[ "$(git -C .worktrees/T-4 rev-parse --abbrev-ref HEAD)" = task/T-4-from-feat ] || fail "worktree add with base: new branch not checked out"
"$bin/orch-worktree" remove T-4 >/dev/null
"$bin/orch-worktree" remove T-1 >/dev/null
[ ! -d .worktrees/T-1 ] || fail "worktree remove left the directory"
if rg -q '^T-1 ' .worktrees/.orch-slots; then fail "worktree remove left the slot"; fi
rg -q '^T-2 1$' .worktrees/.orch-slots || fail "worktree remove dropped another id's slot"
[ ! -e .worktrees/.orch-slots.lock ] || fail "registry lock left behind"
[ -z "$(git -C "$project" status --short | rg -v '^\?\? \.orch/')" ] || fail ".worktrees leaked into git status"

# a project that is itself a git worktree (the orch run dir): .orch/ lives in the worktree, and
# both scripts resolve the root to the worktree, not to the main checkout
git -C "$project" worktree add -q "$tmp/run" -b orch/run >/dev/null 2>&1
run=$(cd -P "$tmp/run" && pwd)
mkdir -p "$run/.orch/tasks"
cp "$project/.orch/config.md" "$run/.orch/config.md"
(
    cd "$run"
    "$bin/orch-state" new W-1 "In a worktree" >/dev/null
    [ -f "$run/.orch/tasks/W-1.md" ] || fail "worktree project: orch-state wrote outside the worktree"
    rg -q '^W-1[[:space:]]+todo' <<<"$("$bin/orch-state" list)" || fail "worktree project: list misses W-1"
    out=$("$bin/orch-worktree" add W-1 task/W-1-x) || fail "worktree project: orch-worktree add failed: $out"
    rg -q "^dir=$run/.worktrees/W-1$" <<<"$out" || fail "worktree project: dir not under the worktree: $out"
    [ -d "$run/.worktrees/W-1" ] || fail "worktree project: no worktree dir"
    [ ! -e "$project/.worktrees/W-1" ] || fail "worktree project: worktree landed in the main checkout"
    "$bin/orch-worktree" remove W-1 >/dev/null
    [ ! -d "$run/.worktrees/W-1" ] || fail "worktree project: remove left the dir"
)

# from inside a task worktree (<project>/.worktrees/<id>, which has no .orch/ of its own) the scripts work on the
# project: list its tasks, its slot registry, its config
"$bin/orch-worktree" add T-5 task/T-5-x >/dev/null
(
    cd "$project/.worktrees/T-5/"
    [ ! -e .orch ] || fail "task worktree setup: it has a .orch/ of its own"
    rg -q '^T-1[[:space:]]+todo' <<<"$("$bin/orch-state" list 2>&1)" || fail "task worktree: orch-state list misses the project's T-1"
    [ "$("$bin/orch-worktree" slot T-2 2>&1)" = 1 ] || fail "task worktree: orch-worktree does not use the project's slot registry"
    [ ! -e .worktrees ] || fail "task worktree: orch-worktree made a .worktrees/ inside the task worktree"
    rg -q 'no-op' <<<"$("$bin/orch-sync" pull 2>&1)" || fail "task worktree: orch-sync does not find the project's config"
    [ "$("$bin/orch-state" root)" = "$project" ] || fail "task worktree: root is $("$bin/orch-state" root), expected $project"
    mkdir -p sub && cd sub   # a subdir of the task worktree
    [ "$("$bin/orch-state" root)" = "$project" ] || fail "task worktree subdir: root is not the project"
)
"$bin/orch-worktree" remove T-5 >/dev/null
# the project itself a worktree inside the main checkout's .worktrees/ (<main>/.worktrees/orch), with its own .orch/:
# its task worktree resolves to it, the nearest checkout with a .orch/, never past it to the main checkout
git -C "$project" worktree add -q "$project/.worktrees/orchrun" -b orch/nested >/dev/null 2>&1
nested="$project/.worktrees/orchrun"
mkdir -p "$nested/.orch/tasks"
cp "$project/.orch/config.md" "$nested/.orch/config.md"
(
    cd "$nested"
    [ "$("$bin/orch-state" root)" = "$nested" ] || fail "nested project: its own .orch/ is not its root"
    "$bin/orch-state" new N-1 "Nested" >/dev/null
    [ -f "$nested/.orch/tasks/N-1.md" ] || fail "nested project: orch-state new wrote outside it"
    out=$("$bin/orch-worktree" add N-1 task/N-1-x) || fail "nested project: orch-worktree add failed: $out"
    rg -q "^dir=$nested/.worktrees/N-1$" <<<"$out" || fail "nested project: dir not under it: $out"
    cd "$nested/.worktrees/N-1"
    [ "$("$bin/orch-state" root)" = "$nested" ] || fail "nested task worktree: root is $("$bin/orch-state" root), expected $nested"
    list=$("$bin/orch-state" list)
    rg -q '^N-1[[:space:]]+todo' <<<"$list" || fail "nested task worktree: list misses N-1"
    if rg -q '^T-1[[:space:]]' <<<"$list"; then fail "nested task worktree: listed the main checkout's tasks"; fi
    cd "$nested"
    "$bin/orch-worktree" remove N-1 >/dev/null
)
# outside any repo orch-worktree refuses (nothing is created under the cwd)
mkdir -p "$tmp/nogit"
err=$(cd "$tmp/nogit" && "$bin/orch-worktree" slot X-1 2>&1 && echo ACCEPTED || true)
[ "$err" = "orch: not inside a git repo" ] || fail "orch-worktree outside a repo: $err"
[ ! -e "$tmp/nogit/.worktrees" ] || fail "orch-worktree outside a repo made .worktrees/"
# escapes: no .orch/ anywhere above -> the own root stays (and the config is missing); a .worktrees in a name is no
# /.worktrees/ segment
git init -q "$tmp/bare"
git -C "$tmp/bare" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$tmp/bare" worktree add -q "$tmp/bare/.worktrees/X-1" -b x1 >/dev/null 2>&1
bare=$(cd -P "$tmp/bare" && pwd)
[ "$(cd "$bare/.worktrees/X-1" && "$bin/orch-state" root)" = "$bare/.worktrees/X-1" ] || fail "no .orch above: root moved"
if (cd "$bare/.worktrees/X-1" && "$bin/orch-state" list >/dev/null 2>&1); then fail "no .orch above: list found a config"; fi
mkdir -p "$tmp/a.worktrees/p" && cp -R "$project/.orch" "$tmp/a.worktrees/.orch"
git init -q "$tmp/a.worktrees/p"
[ "$(cd "$tmp/a.worktrees/p" && "$bin/orch-state" root)" = "$(cd -P "$tmp/a.worktrees/p" && pwd)" ] || fail "a.worktrees/p: a name ending in .worktrees taken as the segment"
mkdir -p "$tmp/w/.worktreesX/p" && cp -R "$project/.orch" "$tmp/w/.orch"
git init -q "$tmp/w/.worktreesX/p"
[ "$(cd "$tmp/w/.worktreesX/p" && "$bin/orch-state" root)" = "$(cd -P "$tmp/w/.worktreesX/p" && pwd)" ] || fail ".worktreesX/p: a name starting with .worktrees taken as the segment"

# orch-state settings: the user settings /orch runs with, from settings.json pluginConfigs (no config needed)
settings_json="$CLAUDE_CONFIG_DIR/settings.json"
defaults=$'enabled=true\nrounds=3\nui_review=true\nimplementer_ctx_k=400\ninject_rules=true'
settings() { (cd "$tmp" && "$bin/orch-state" settings); }   # $tmp: no repo, no .orch/config.md
mkdir -p "$CLAUDE_CONFIG_DIR"
rm -f "$settings_json"
[ "$(settings)" = "$defaults" ] || fail "settings, no settings.json: expected the defaults, got: $(settings)"
# opts <json of junkd@junk-drawer's options> -> what settings prints
opts() { printf '{"theme":"dark","pluginConfigs":{"tldr@junk-drawer":{"options":{"orch_rounds":9}},"junkd@junk-drawer":{"options":%s}}}\n' "$1" > "$settings_json"; settings; }
[ "$(opts '{"orch_enabled":false,"orch_rounds":5,"orch_ui_review":false,"orch_implementer_ctx_k":600,"orch_inject_rules":false}')" = $'enabled=false\nrounds=5\nui_review=false\nimplementer_ctx_k=600\ninject_rules=false' ] ||
    fail "settings: values not read: $(settings)"
[ "$(opts '{"orch_enabled":true,"orch_ui_review":true,"orch_inject_rules":true}')" = "$defaults" ] || fail "settings: explicit true switches: $(settings)"
# the keys without their orch_ prefix (the old plugin's) are no setting of junkd's
[ "$(opts '{"enabled":false,"rounds":5,"ui_review":false,"implementer_ctx_k":600,"inject_rules":false}')" = "$defaults" ] ||
    fail "settings: unprefixed keys read: $(settings)"
# the exact bounds, one assertion each: in range kept, one past clamped
for pair in rounds:0:1 rounds:1:1 rounds:10:10 rounds:11:10 rounds:-4:1 implementer_ctx_k:49:50 implementer_ctx_k:50:50 \
    implementer_ctx_k:1000:1000 implementer_ctx_k:1001:1000; do
    IFS=: read -r key in want <<<"$pair"
    got=$(opts "{\"orch_$key\":$in}" | rg "^$key=")
    [ "$got" = "$key=$want" ] || fail "settings: $key $in: expected $want, got $got"
done
# not a whole number: rounded like the hooks module; a numeric string counts; anything else is the default
for pair in '2.5:3' '2.4:2' '"4":4' '" 6 ":6' '"abc":3' '"":3' '" ":3' '"\t6\n":6' '"\u00a07":7' 'true:3' 'null:3' '[5]:3' '{}:3' '"nan":3' '"Infinity":3' '"1e999":3' '1e999:3'; do
    in=${pair%:*} want=${pair##*:}
    got=$(opts "{\"orch_rounds\":$in}" | rg '^rounds=')
    [ "$got" = "rounds=$want" ] || fail "settings: rounds $in: expected $want, got $got"
done
got=$(opts '{"orch_implementer_ctx_k":"250"}' | rg '^implementer_ctx_k=')
[ "$got" = implementer_ctx_k=250 ] || fail "settings: implementer_ctx_k \"250\": got $got"
# a switch: missing = true, only a JSON true is true
for in in false null 0 1 '"true"' '"on"'; do
    got=$(opts "{\"orch_enabled\":$in,\"orch_ui_review\":$in,\"orch_inject_rules\":$in}" | rg '^(enabled|ui_review|inject_rules)=' | tr '\n' ' ')
    [ "$got" = "enabled=false ui_review=false inject_rules=false " ] || fail "settings: switch $in: got $got"
done
# no junkd@ entry (another plugin, the old orch plugin, a name that only starts or ends with junkd), no options,
# options not an object, the file not one JSON object: the defaults
for content in '{"pluginConfigs":{"tldr@junk-drawer":{"options":{"orch_rounds":9}}}}' '{"pluginConfigs":{"junkdx@x":{"options":{"orch_rounds":9}}}}' \
    '{"pluginConfigs":{"xjunkd@x":{"options":{"orch_rounds":9}}}}' '{"pluginConfigs":{"orch@junk-drawer":{"options":{"rounds":9,"orch_rounds":9}}}}' \
    '{"pluginConfigs":{"junkd@junk-drawer":{}}}' \
    '{"pluginConfigs":{"junkd@junk-drawer":{"options":[9]}}}' '{"pluginConfigs":[]}' '{}' '' '{"pluginConfigs":' '[]' '"x"' \
    '{"pluginConfigs":{"junkd@a":{"options":{"orch_rounds":9}}}} {}' 'not json'; do
    printf '%s' "$content" > "$settings_json"
    [ "$(settings)" = "$defaults" ] || fail "settings, file $content: expected the defaults, got: $(settings)"
done
# the first junkd@ entry decides (any marketplace)
printf '{"pluginConfigs":{"junkd@other":{"options":{"orch_rounds":7}},"junkd@junk-drawer":{"options":{"orch_rounds":2}}}}' > "$settings_json"
[ "$(settings | rg '^rounds=')" = rounds=7 ] || fail "settings: the first junkd@ entry does not decide"
# no jq on PATH: the defaults, exit 0
mkdir -p "$tmp/nojq"
ln -sf "$(command -v bash)" "$tmp/nojq/bash"
out=$(cd "$tmp" && PATH="$tmp/nojq" "$bin/orch-state" settings) || fail "settings without jq exited non-zero"
[ "$out" = "$defaults" ] || fail "settings without jq: expected the defaults, got: $out"
# with no CLAUDE_CONFIG_DIR the file is $HOME/.claude/settings.json
mkdir -p "$tmp/shome/.claude"
printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_rounds":4}}}}' > "$tmp/shome/.claude/settings.json"
[ "$(cd "$tmp" && env -u CLAUDE_CONFIG_DIR HOME="$tmp/shome" "$bin/orch-state" settings | rg '^rounds=')" = rounds=4 ] ||
    fail "settings: \$HOME/.claude/settings.json not read without CLAUDE_CONFIG_DIR"
# inside a project, and inside a project that is itself a worktree: the same user settings
printf '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"orch_rounds":6}}}}' > "$settings_json"
[ "$(cd "$project" && "$bin/orch-state" settings | rg '^rounds=')" = rounds=6 ] || fail "settings in the project"
[ "$(cd "$run" && "$bin/orch-state" settings | rg '^rounds=')" = rounds=6 ] || fail "settings in a worktree project"
# the same scripts by every path they are reached through: the plugin root's bin/ (links into skills/junkd/bin, whose
# entries link to ../../orch/bin), skills/junkd/bin, orch-init's bin (a link to ../orch/bin) and the real files; each
# finds its sibling orch-state beside the path it was called by
for via in "$plugin/bin" "$plugin/skills/junkd/bin" "$plugin/skills/orch-init/bin" "$plugin/skills/orch/bin"; do
    [ "$(cd "$project" && "$via/orch-state" settings | rg '^rounds=')" = rounds=6 ] || fail "orch-state settings via $via"
    rg -q 'no-op' <<<"$(cd "$project" && "$via/orch-sync" pull)" || fail "orch-sync pull via $via"
    [ "$(cd "$project" && "$via/orch-worktree" slot T-2)" = 1 ] || fail "orch-worktree slot via $via"
done
for s in orch-state orch-sync orch-worktree; do
    [ -L "$plugin/skills/junkd/bin/$s" ] || fail "skills/junkd/bin/$s is no link"
    [ "$(cd -P "$(dirname "$plugin/skills/junkd/bin/$(readlink "$plugin/skills/junkd/bin/$s")")" && pwd)" = "$(cd -P "$plugin/skills/orch/bin" && pwd)" ] ||
        fail "skills/junkd/bin/$s does not lead to skills/orch/bin"
done
rm -f "$settings_json"

# orch-sync on the adhoc backend is a no-op in both directions
# orch-sync takes plain task ids only (they name task files and reach gh): an option, a path or a reserved id is
# refused before any backend runs, in the project and in a project that is itself a worktree
for dir in "$project" "$run"; do
    for cmd in push pull; do
        for bad in '../../x' '--web' '-R' 'a/b' 'a..b' '_lessons' '' 'GH-1;x'; do
            err=$(cd "$dir" && "$bin/orch-sync" "$cmd" GH-1 "$bad" 2>&1 && echo ACCEPTED || true)
            [ "$err" = "orch: bad task id '$bad' (letters, digits, . _ -; not starting with _)" ] ||
                fail "orch-sync $cmd '$bad' in $dir: not refused: $err"
        done
        # the first id is checked too
        err=$(cd "$dir" && "$bin/orch-sync" "$cmd" ../../x 2>&1 && echo ACCEPTED || true)
        [ "$err" = "orch: bad task id '../../x' (letters, digits, . _ -; not starting with _)" ] || fail "orch-sync $cmd ../../x (first id) in $dir: $err"
        rg -q 'no-op' <<<"$(cd "$dir" && "$bin/orch-sync" "$cmd" GH-1 T-1.x)" || fail "orch-sync $cmd with good ids in $dir: not a no-op"
    done
done
rg -q 'no-op' <<<"$("$bin/orch-sync" pull)" || fail "orch-sync pull (adhoc) is not a no-op"
# the command word is no id: --help still prints the usage
rg -q '^  orch-sync pull \[id\.\.\.\]' <<<"$("$bin/orch-sync" --help)" || fail "orch-sync --help: no usage"
rg -q 'no-op' <<<"$("$bin/orch-sync" push)" || fail "orch-sync push (adhoc) is not a no-op"

# tasks_dir steers where the scripts write, so it must be a folder under the project's .orch/: relative, no `..`
# segment, its real path (symlinks resolved, from the nearest existing folder) below .orch/, never .orch/ itself
fence="$tmp/fence"; mkdir -p "$fence/.orch/tasks" "$tmp/outside"
fence=$(cd -P "$fence" && pwd)
git -C "$fence" init -q
ln -s "$tmp/outside" "$fence/.orch/link"
ln -s "$tmp/outside" "$fence/linked"
fence_cfg() { printf -- '---\nbackend: adhoc\ntasks_dir: %s\n---\n' "$1" > "$fence/.orch/config.md"; }
for bad in '../outside' '/tmp/x' '/.orch/tasks' '.orch/a/../../src' '.orch/nope/../../../outside' '.orch/../../outside' '.orch/tasks/../../../outside' '.orch/link' '.orch/link/new/deep' 'linked' '.git' '.git/tasks' '"../outside"' 'tasks' '.' '.orch' '.orch/' './.orch' '.orchard/tasks' 'x.orch/tasks'; do
    fence_cfg "$bad"
    for cmd in "orch-state list" "orch-state tasks-dir" "orch-state new T-9" "orch-state reset-stale" "orch-sync pull"; do
        if out=$(cd "$fence" && $bin/$cmd 2>&1); then fail "tasks_dir $bad: $cmd ran: $out"; fi
        rg -q '^orch: tasks_dir ' <<<"$out" || fail "tasks_dir $bad: $cmd stopped for another reason: $out"
    done
    [ -z "$(ls -A "$tmp/outside")" ] || fail "tasks_dir $bad: something was written outside the project"
    [ ! -e "$fence/src" ] && [ ! -e "$fence/.orch/a" ] || fail "tasks_dir $bad: something was written outside .orch/ (src/ or .orch/a/)"
    rc=0; (cd "$fence" && "$bin/orch-state" new X1 >/dev/null 2>&1) || rc=$?
    [ $rc = 2 ] || fail "tasks_dir $bad: orch-state new exited $rc, expected 2"
done
# under .orch/: the usual dir, a quoted one, one not created yet, a ./ spelling
for good in '.orch/tasks' '".orch/tasks"' '.orch/new/deep' './.orch/tasks'; do
    fence_cfg "$good"
    out=$(cd "$fence" && "$bin/orch-state" tasks-dir) || fail "tasks_dir $good refused: $out"
    want=${good//\"/}; [ "$out" = "$fence/$want" ] || fail "tasks_dir $good: printed $out"
    (cd "$fence" && "$bin/orch-state" list >/dev/null && "$bin/orch-sync" pull >/dev/null) || fail "tasks_dir $good: list or orch-sync refused"
done
rm -f "$fence/.orch/config.md"

echo "orch tests passed"
