#!/usr/bin/env bash
# /junkd:task-draft's helpers (skills/task-draft/bin) and its roles: task-draft-state (settings, egm, models,
# questions, decisions) over a temp HOME, CLAUDE_CONFIG_DIR and fixture git repo; task-probe (the prompt, the
# inline-file rules, --list, --judge-input, --ac-hash, the timeout, the env scrub, the safe writes) with stub CLIs on
# a PATH that holds no real harness; the four harness adapters' argv mapping; task-from-spec over a fixture repo that
# orch-state accepts. No model is called and nothing is installed.
# Each case prints `case: <name>` and fails with a line on the first mismatch.
# Run: bash tests/task-draft.sh (tests/smoke.sh runs it too).
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd -P)
plugin="$root/plugins/junkd"
skill="$plugin/skills/task-draft"
state="$skill/bin/task-draft-state"
probe="$skill/bin/task-probe"
fromspec="$skill/bin/task-from-spec"
orch_state="$plugin/skills/orch/bin/orch-state"
command -v jq >/dev/null || { echo "task-draft tests: jq is needed"; exit 1; }

tmp=$(cd "$(mktemp -d)" && pwd -P) # the physical path: a TMPDIR ending in `/` gives mktemp a `//`
trap 'chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
export HOME="$tmp/home" CLAUDE_CONFIG_DIR="$tmp/home/.claude"
unset JUNK_DRAWER_RUNTIME CODEX_THREAD_ID KIMI_PLUGIN_ROOT OPENCODE OPENCODE_PID EGM_ROOT JUNKD_EGM_MODELS ORCH_STATE CODEX_HOME OPENCODE_CONFIG_CONTENT
mkdir -p "$CLAUDE_CONFIG_DIR"

fail() { echo "task-draft tests: $*" >&2; exit 1; }
case_() { echo "case: $*"; }
# run <cmd...>: rc, out (stdout) and err (stderr) of one command that may fail.
run() {
    rc=0
    out=$("$@" 2>"$tmp/err") || rc=$?
    err=$(cat "$tmp/err")
}
# Helpers that run the same on GNU and BSD (macOS), in place of the GNU-only flags of env, sed and stat.
# at <dir> <cmd...>: one command in <dir>, in a subshell.
at() ( cd -- "$1" || exit; shift; "$@" )
# sed_i <script> <file>: sed's output written back over the file (its mode and inode stay).
sed_i() { sed "$1" "$2" > "$tmp/sed.out" && cat "$tmp/sed.out" > "$2"; }
# first_a <line> <file>: the first `A:` line with no answer becomes <line>.
first_a() { awk -v t="$1" '!d && $0 == "A:" { $0 = t; d = 1 } 1' "$2" > "$tmp/sed.out" && cat "$tmp/sed.out" > "$2"; }
# fsize <file>: the size in bytes. fmode <file>: the permission bits in octal (GNU stat, else BSD stat).
fsize() { local n; n=$(wc -c < "$1") && echo $((n)); }
fmode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }

# ---------------------------------------------------------------- syntax
case_ "syntax"
for f in task-draft-state harness-omp harness-opencode harness-codex harness-kimi; do
    bash -n "$skill/bin/$f" || fail "bash -n $f"
    [ "$(head -1 "$skill/bin/$f")" = '#!/usr/bin/env bash' ] || fail "$f is not a bash script"
    grep -qx 'set -euo pipefail' "$skill/bin/$f" || fail "$f lacks set -euo pipefail"
done
for py in "$probe" "$fromspec"; do
    [ "$(head -1 "$py")" = '#!/usr/bin/env python3' ] || fail "$py is not a python3 script"
    python3 -I -c 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$py" || fail "ast.parse $py"
done

# ---------------------------------------------------------------- bin links
case_ "bin links"
for n in task-draft-state task-probe task-from-spec harness-omp harness-opencode harness-codex harness-kimi; do
    real="$skill/bin/$n"
    [ -f "$real" ] && [ ! -L "$real" ] && [ -x "$real" ] || fail "skills/task-draft/bin/$n is not a real executable"
    [ -L "$plugin/skills/junkd/bin/$n" ] && [ "$(readlink "$plugin/skills/junkd/bin/$n")" = "../../task-draft/bin/$n" ] ||
        fail "skills/junkd/bin/$n is not a link to ../../task-draft/bin/$n"
    [ "$plugin/bin/$n" -ef "$real" ] || fail "bin/$n does not reach skills/task-draft/bin/$n"
done
for n in harness-omp harness-opencode harness-codex harness-kimi; do
    # the mode git records (100755); on disk only the executable bits, since a checkout's mode follows the umask
    [ "$(git -C "$root" ls-files -s -- "plugins/junkd/skills/task-draft/bin/$n" | cut -d' ' -f1)" = 100755 ] || fail "$n is not tracked as mode 100755"
    [ $(( 8#$(fmode "$skill/bin/$n") & 8#111 )) = $(( 8#111 )) ] || fail "$n is not executable by user, group and other"
    grep -q '^# Test status: ' "$skill/bin/$n" && grep -q '"No tools": ' "$skill/bin/$n" || fail "$n's header lacks its test or no-tools status"
done

# ---------------------------------------------------------------- roles copies
case_ "roles copies"
for r in task-egm task-elephant task-judge task-goldfish; do
    canon="$plugin/skills/orch/roles/$r.md"
    [ -f "$canon" ] && [ ! -L "$canon" ] || fail "skills/orch/roles/$r.md is not a real file"
    [ -f "$skill/roles/$r.md" ] && [ ! -L "$skill/roles/$r.md" ] || fail "skills/task-draft/roles/$r.md is not a real file"
    cmp -s "$canon" "$skill/roles/$r.md" || fail "skills/task-draft/roles/$r.md differs from skills/orch/roles/$r.md"
    [ "$(sed -n 1p "$canon")" = '---' ] && grep -qx "name: $r" "$canon" || fail "$r.md has no frontmatter name"
done
fmline() { awk -v k="$2" 'NR == 1 { next } /^---$/ { exit } index($0, k ": ") == 1 { print; exit }' "$plugin/skills/orch/roles/$1.md"; }
[ "$(fmline task-egm model)" = 'model: opus' ] && [ "$(fmline task-egm tools)" = 'tools: Read, Grep, Glob, Write, Edit, Bash, Agent' ] || fail "task-egm frontmatter"
[ "$(fmline task-egm description)" = 'description: "Drafts and reviews one task'"'"'s EGM spec by reading EGM'"'"'s skill files from disk; returns every EGM question to the main loop as QUESTION: blocks and waits (with egm_answers: auto it answers them itself and lists them), then spec or failed:."' ] || fail "task-egm description"
[ "$(fmline task-elephant model)" = 'model: opus' ] && [ "$(fmline task-elephant tools)" = 'tools: Read, Write, Edit, Bash, Agent' ] || fail "task-elephant frontmatter"
[ "$(fmline task-elephant description)" = 'description: "Owns one task'"'"'s comprehension sub-loop: probes the registry ladder, has each answer judged, clarifies the spec, returns QUESTION: blocks for a human when needed (with egm_answers: auto it answers them itself and lists them), returns one line per task."' ] || fail "task-elephant description"
[ "$(fmline task-judge model)" = 'model: sonnet' ] && [ "$(fmline task-judge tools)" = 'tools: []' ] || fail "task-judge frontmatter"
[ "$(fmline task-judge description)" = "description: Scores one goldfish answer against the spec's ACs, files and out-of-scope list." ] || fail "task-judge description"
[ "$(fmline task-goldfish tools)" = 'tools: []' ] && [ -z "$(fmline task-goldfish model)" ] || fail "task-goldfish frontmatter (tools: [], no model)"
[ "$(fmline task-goldfish description)" = 'description: Answers the probe questionnaire with no tools and no history.' ] || fail "task-goldfish description"
for r in task-judge task-goldfish; do
    grep -qxF 'You have no tools; never call one.' "$plugin/skills/orch/roles/$r.md" || fail "$r lacks the no-tools sentence"
done
grep -qF 'You have no tools and no history. Answer the' "$plugin/skills/orch/roles/task-goldfish.md" || fail "task-goldfish body"
grep -qF 'The reply is the first line `understood N/M`, then one line per mismatch:' "$plugin/skills/orch/roles/task-judge.md" || fail "task-judge body"
for r in task-egm task-elephant; do
    md="$plugin/skills/orch/roles/$r.md"
    grep -qF 'Unless your prompt has `egm_answers: auto`, never answer a question yourself and never take a default: answer it from the decisions register when a recorded decision covers it (the spec'"'"'s `## Decisions` first, then `task-draft-state decisions --match`), logging `answered from <decision id>` in `.orch/taskdraft/<id>/egm/gate_log.md`; otherwise return it as a `QUESTION:` block and wait.' "$md" ||
        fail "$r lacks the never-answer sentence"
    grep -qF 'With `egm_answers: auto`, ask nothing: after the register, answer every question yourself (the first option, or your own text for `(free text)`), log `answered auto: <question> => <answer>` in the same gate log' "$md" ||
        fail "$r lacks the auto sentence"
    grep -qF 'Return every uncovered question of one gate in one reply, your proposed answer as the first option; never write `.orch/decisions.md`.' "$md" ||
        fail "$r lacks the batch sentence"
    grep -qF 'QUESTION: <the question, one line>' "$md" || fail "$r lacks the Questions format block"
done
grep -qF 'EGM artifact directory: .orch/taskdraft/<id>/egm/' "$plugin/skills/orch/roles/task-egm.md" || fail "task-egm body"
grep -qF 'split <id> -> <id>a <id>b [ordered]' "$plugin/skills/orch/roles/task-elephant.md" || fail "task-elephant lacks the Split section"

# ---------------------------------------------------------------- the skill's text
case_ "skill text"
skill_md="$skill/SKILL.md"
grep -qxF 'allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/bin/task-draft-state:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/task-probe:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/task-from-spec:*), Agent, Read, Write, AskUserQuestion, SendMessage' "$skill_md" ||
    fail "SKILL.md allowed-tools line"
grep -qxF 'argument-hint: "<task-id> [input] [--unattended]"' "$skill_md" || fail "SKILL.md argument-hint"
for host in 'Claude Code' 'Codex' 'Kimi Code' 'OpenCode'; do grep -qF "$host" "$skill_md" || fail "SKILL.md does not name $host"; done
if grep -qF '../' "$skill_md"; then fail "SKILL.md contains ../"; fi
if grep -qE 'taskdraft_|--worker-model|rung' "$skill_md"; then fail "SKILL.md keeps the removed wording"; fi
grep -qF 'Unless `egm_answers` is `auto`, never answer a question for the user and never take a default. Only the decisions register answers a question without the user: the spec'"'"'s `## Decisions`, then `.orch/decisions.md`.' "$skill_md" ||
    fail "SKILL.md lacks the never-answer sentence"
for md in "$skill_md" "$plugin/skills/orch/roles/task-egm.md" "$plugin/skills/orch/roles/task-elephant.md"; do
    for s in 'QUESTION:' 'WAITING <N>' 'never take a default' '.orch/decisions.md' 'task-draft-state decisions' 'answered from' 'answered auto: <question> => <answer>' 'ANSWER: <the answer it applied>' '(auto-answered <N>)' 'egm_answers: auto' '<out>/auto-answers.md'; do
        grep -qF -- "$s" "$md" || fail "${md#"$root"/} lacks '$s'"
    done
done
grep -qF 'task-draft is off: turn on egm_enabled in the /junkd pane (Settings, egm) or /config' "$skill_md" || fail "SKILL.md step 1 message"
for s in 'egm_answers: <mode>' 'task-draft <id>: auto-answered <N>' '1. <question> => <answer>' 'files: .orch/taskdraft/<id>/auto-answers.md, .orch/taskdraft/<id>/egm/gate_log.md, .orch/decisions.md' \
    'answered auto: Send these <n> files to non-local harnesses? => skip non-local' '`answers=<manual|auto>`'; do
    grep -qF -- "$s" "$skill_md" || fail "SKILL.md lacks the auto text '$s'"
done
# the --file commands the orch guard lets through (hooks/orch.test.tsx runs these spellings against the guard)
for md in "$skill_md" "$plugin/skills/orch/roles/task-egm.md" "$plugin/skills/orch/roles/task-elephant.md"; do
    for s in '`task-draft-state decisions add <id> --source chat --file <out>/answers.md`' \
        '`task-draft-state decisions add <id> --source auto --file <out>/answers.md`' \
        '`task-draft-state questions <id> put --role <role> --spec <spec path or none> --file <out>/blocks.md`'; do
        grep -qF -- "$s" "$md" || fail "${md#"$root"/} lacks $s"
    done
    if grep -qE 'pipe (the|them)' "$md"; then fail "${md#"$root"/} still tells the main loop to pipe into a helper"; fi
done
grep -qF 'short_description: "An orch task through EGM'"'"'s draft and review, an optional comprehension check, and into the task file"' "$skill/agents/openai.yaml" ||
    fail "openai.yaml short_description"

# ---------------------------------------------------------------- task-draft-state settings
settings_json() { printf '%s' "$1" > "$CLAUDE_CONFIG_DIR/settings.json"; }
case_ "settings defaults"
[ "$("$state" settings)" = $'enabled=false\nmodels=false\nanswers=manual\nhost=claude' ] || fail "settings with no settings.json: $("$state" settings)"
settings_json 'not json'
[ "$("$state" settings)" = $'enabled=false\nmodels=false\nanswers=manual\nhost=claude' ] || fail "settings with a broken settings.json"
settings_json '{"a":1}{"b":2}'
[ "$("$state" settings)" = $'enabled=false\nmodels=false\nanswers=manual\nhost=claude' ] || fail "settings with two JSON values"
case_ "settings models needs enabled"
settings_json '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"egm_enabled":false,"egm_models":true}}}}'
[ "$("$state" settings)" = $'enabled=false\nmodels=false\nanswers=manual\nhost=claude' ] || fail "egm_models without egm_enabled: $("$state" settings)"
for v in 'true' '"true"' '"on"'; do
    settings_json '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"egm_enabled":'"$v"',"egm_models":'"$v"'}}}}'
    [ "$("$state" settings)" = $'enabled=true\nmodels=true\nanswers=manual\nhost=claude' ] || fail "the spelling $v is not true: $("$state" settings)"
done
for v in 'false' '"yes"' '1' '"TRUE"' 'null'; do
    settings_json '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"egm_enabled":'"$v"'}}}}'
    [ "$("$state" settings | head -1)" = 'enabled=false' ] || fail "the value $v counts as true"
done
settings_json '{"pluginConfigs":{"other@x":{"options":{"egm_enabled":true}},"junkd@a":{"options":{"egm_enabled":true}},"junkd@b":{"options":{"egm_enabled":false}}}}'
[ "$("$state" settings | head -1)" = 'enabled=true' ] || fail "settings does not read the first junkd@ key"
settings_json '{"pluginConfigs":{"junkd@a":{"options":{"egm_enabled":true}}}}'
[ "$(JUNKD_EGM_MODELS=1 "$state" settings)" = $'enabled=true\nmodels=false\nanswers=manual\nhost=claude' ] || fail "JUNKD_EGM_MODELS changed models on claude"
case_ "settings answers"
for v in '"auto"' '"AUTO"' '" Auto "'; do
    settings_json '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"egm_enabled":true,"egm_answers":'"$v"'}}}}'
    [ "$("$state" settings)" = $'enabled=true\nmodels=false\nanswers=auto\nhost=claude' ] || fail "egm_answers $v is not auto: $("$state" settings)"
done
for v in '"bogus"' '"manual"' 'true' 'null' '""'; do
    settings_json '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"egm_enabled":true,"egm_answers":'"$v"'}}}}'
    [ "$("$state" settings | sed -n 3p)" = 'answers=manual' ] || fail "egm_answers $v is not manual: $("$state" settings)"
done
settings_json '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"egm_enabled":true}}}}'
[ "$("$state" settings | sed -n 3p)" = 'answers=manual' ] || fail "egm_answers absent is not manual"
settings_json '{"pluginConfigs":{"junkd@junk-drawer":{"options":{"egm_answers":"auto"}}}}'
[ "$("$state" settings)" = $'enabled=false\nmodels=false\nanswers=auto\nhost=claude' ] || fail "egm_answers is not read while egm_enabled is off"
[ "$(JUNKD_EGM_ANSWERS=manual "$state" settings | sed -n 3p)" = 'answers=auto' ] || fail "JUNKD_EGM_ANSWERS changed answers on claude"
case_ "settings other host"
[ "$(JUNK_DRAWER_RUNTIME=codex JUNKD_EGM_MODELS=1 "$state" settings)" = $'enabled=false\nmodels=true\nanswers=manual\nhost=codex' ] || fail "settings on codex with JUNKD_EGM_MODELS=1"
[ "$(JUNK_DRAWER_RUNTIME=codex "$state" settings)" = $'enabled=false\nmodels=false\nanswers=manual\nhost=codex' ] || fail "settings on codex without JUNKD_EGM_MODELS"
[ "$(JUNK_DRAWER_RUNTIME=codex JUNKD_EGM_ANSWERS=auto "$state" settings)" = $'enabled=false\nmodels=false\nanswers=auto\nhost=codex' ] || fail "settings on codex with JUNKD_EGM_ANSWERS=auto"
[ "$(JUNKD_EGM_ANSWERS=AUTO "$state" settings --host opencode | sed -n 3p)" = 'answers=auto' ] || fail "JUNKD_EGM_ANSWERS=AUTO is not auto"
[ "$(JUNKD_EGM_ANSWERS=yes "$state" settings --host kimi | sed -n 3p)" = 'answers=manual' ] || fail "JUNKD_EGM_ANSWERS=yes counted as auto"
[ "$(JUNKD_EGM_MODELS=true "$state" settings --host kimi)" = $'enabled=false\nmodels=false\nanswers=manual\nhost=kimi' ] || fail "JUNKD_EGM_MODELS=true counted as 1"
[ "$(CODEX_THREAD_ID=x "$state" settings | tail -1)" = 'host=codex' ] || fail "CODEX_THREAD_ID is not codex"
[ "$(KIMI_PLUGIN_ROOT=x "$state" settings | tail -1)" = 'host=kimi' ] || fail "KIMI_PLUGIN_ROOT is not kimi"
[ "$(OPENCODE=1 "$state" settings | tail -1)" = 'host=opencode' ] || fail "OPENCODE is not opencode"
[ "$(OPENCODE_PID=9 "$state" settings | tail -1)" = 'host=opencode' ] || fail "OPENCODE_PID is not opencode"
[ "$(JUNK_DRAWER_RUNTIME=kimi CODEX_THREAD_ID=x "$state" settings | tail -1)" = 'host=kimi' ] || fail "JUNK_DRAWER_RUNTIME does not win over CODEX_THREAD_ID"
[ "$(CODEX_THREAD_ID=x KIMI_PLUGIN_ROOT=x "$state" settings | tail -1)" = 'host=codex' ] || fail "CODEX_THREAD_ID does not win over KIMI_PLUGIN_ROOT"
[ "$(JUNK_DRAWER_RUNTIME=codex "$state" settings --host claude | tail -1)" = 'host=claude' ] || fail "--host does not win over JUNK_DRAWER_RUNTIME"
case_ "unknown host"
run "$state" settings --host nope
[ "$rc" = 2 ] && [ -z "$out" ] && [ "$err" = "task-draft-state: unknown host 'nope' (claude, codex, kimi or opencode)" ] || fail "settings --host nope: $rc $out $err"
run env JUNK_DRAWER_RUNTIME=vim "$state" egm
[ "$rc" = 2 ] && [ "$err" = "task-draft-state: unknown host 'vim' (claude, codex, kimi or opencode)" ] || fail "egm with JUNK_DRAWER_RUNTIME=vim: $rc $err"
run "$state" settings --bogus
[ "$rc" = 2 ] || fail "settings --bogus exited $rc"
run "$state" nonsense
[ "$rc" = 2 ] || fail "an unknown command exited $rc"
rm -f "$CLAUDE_CONFIG_DIR/settings.json"

# ---------------------------------------------------------------- task-draft-state egm
fake_egm() { mkdir -p "$1/skills/egm-draft" && printf '# egm-draft\n' > "$1/skills/egm-draft/SKILL.md"; }
fake_egm "$tmp/egm-user"; fake_egm "$tmp/egm-proj"; fake_egm "$tmp/egm-first"; fake_egm "$tmp/egm-env"
ln -s "$tmp/egm-user" "$tmp/egm-user-link"
mkdir -p "$CLAUDE_CONFIG_DIR/plugins" "$tmp/egm-empty"
installed="$CLAUDE_CONFIG_DIR/plugins/installed_plugins.json"
case_ "egm installed user scope"
printf '{"version":2,"plugins":{"egm@egm":[{"scope":"project","installPath":"%s"},{"scope":"user","installPath":"%s","version":"0.1.1"}]}}' "$tmp/egm-proj" "$tmp/egm-user-link" > "$installed"
run "$state" egm
[ "$rc" = 0 ] && [ "$out" = $'egm: installed\nroot='"$tmp/egm-user" ] || fail "egm with a user record: $rc $out"
case_ "egm installed first record"
printf '{"plugins":{"egm@egm":[{"scope":"project","installPath":"%s"},{"scope":"local","installPath":"%s"}]}}' "$tmp/egm-first" "$tmp/egm-proj" > "$installed"
run "$state" egm
[ "$rc" = 0 ] && [ "$out" = $'egm: installed\nroot='"$tmp/egm-first" ] || fail "egm with no user record: $rc $out"
# a record whose folder lacks skills/egm-draft/SKILL.md does not count: EGM_ROOT, else the hint
printf '{"plugins":{"egm@egm":[{"scope":"user","installPath":"%s"}]}}' "$tmp/egm-empty" > "$installed"
run env EGM_ROOT="$tmp/egm-env" "$state" egm
[ "$rc" = 0 ] && [ "$out" = $'egm: installed\nroot='"$tmp/egm-env" ] || fail "egm with an empty record and EGM_ROOT: $rc $out"
run "$state" egm
[ "$rc" = 1 ] || fail "egm with an empty record and no EGM_ROOT exited $rc"
printf '{"plugins":{"egm@other":[{"scope":"user","installPath":"%s"}]}}' "$tmp/egm-user" > "$installed"
run "$state" egm
[ "$rc" = 1 ] || fail "egm@other counted as egm@egm"
case_ "egm EGM_ROOT"
rm -f "$installed"
run env EGM_ROOT="$tmp/egm-env" "$state" egm
[ "$rc" = 0 ] && [ "$out" = $'egm: installed\nroot='"$tmp/egm-env" ] || fail "egm from EGM_ROOT: $rc $out"
run env EGM_ROOT="$tmp/egm-empty" "$state" egm
[ "$rc" = 1 ] || fail "EGM_ROOT without skills/egm-draft/SKILL.md counted"
printf 'broken' > "$installed"
run env EGM_ROOT="$tmp/egm-env" "$state" egm
[ "$rc" = 0 ] && [ "$out" = $'egm: installed\nroot='"$tmp/egm-env" ] || fail "a broken installed_plugins.json stopped EGM_ROOT: $rc $out"
rm -f "$installed"
case_ "egm missing per host"
expect_hint() {
    run "$state" egm --host "$1"
    [ "$rc" = 1 ] && [ "$out" = "$2" ] && [ $(( $(printf '%s\n' "$out" | wc -l) )) = 1 ] || fail "egm hint on $1: $rc $out"
}
expect_hint claude 'egm is not installed: claude plugin marketplace add google/elephant-goldfish-model && claude plugin install egm@egm'
expect_hint codex 'egm is not installed: codex plugin marketplace add google/elephant-goldfish-model && codex plugin add egm@egm, then set EGM_ROOT to the folder that holds skills/egm-draft/SKILL.md'
expect_hint kimi 'junkd: egm has no Kimi package; set EGM_ROOT to an EGM checkout (git clone https://github.com/google/elephant-goldfish-model)'
expect_hint opencode 'junkd: egm has no OpenCode package; set EGM_ROOT to an EGM checkout (git clone https://github.com/google/elephant-goldfish-model)'
run env OPENCODE_PID=3 "$state" egm
[ "$out" = 'junkd: egm has no OpenCode package; set EGM_ROOT to an EGM checkout (git clone https://github.com/google/elephant-goldfish-model)' ] || fail "egm hint from the env host"

# ---------------------------------------------------------------- task-draft-state models
models="$CLAUDE_CONFIG_DIR/junkd/models.json"
mkdir -p "$CLAUDE_CONFIG_DIR/junkd"
case_ "models absent"
run "$state" models
[ "$rc" = 0 ] && [ -z "$out" ] || fail "models with no file: $rc $out"
printf '[]' > "$models"
run "$state" models
[ "$rc" = 0 ] && [ -z "$out" ] || fail "models with an empty array: $rc $out"
case_ "models ladder"
cat > "$models" <<'JSON'
[
  {"class": "F", "id": "frontier", "harness": "omp"},
  {"class": "B", "id": "zeta", "harness": "omp", "effort": "high"},
  {"class": "B", "id": "alpha", "harness": "codex"},
  {"class": "C", "id": "opus", "harness": "claude"},
  {"class": "A", "id": "haiku", "harness": "claude"},
  {"class": "B", "id": "Zeta", "harness": "omp"}
]
JSON
run "$state" models
[ "$rc" = 0 ] || fail "models ladder exited $rc: $err"
[ "$out" = '{"class":"A","id":"haiku","harness":"claude"}
{"class":"B","id":"Zeta","harness":"omp"}
{"class":"C","id":"opus","harness":"claude"}
{"class":"F","id":"frontier","harness":"omp"}' ] || fail "models ladder (A B C F, the first B by code point): $out"
printf '[{"class":"B","id":"b2","harness":"omp"},{"class":"B","id":"b1","harness":"omp"}]' > "$models"
[ "$("$state" models)" = '{"class":"B","id":"b1","harness":"omp"}' ] || fail "models with two B entries: $("$state" models)"
case_ "models broken"
printf '{"class":"A","id":"x","harness":"omp"}' > "$models"
run "$state" models
[ "$rc" = 1 ] && [ -z "$out" ] && [ "$err" = 'task-draft-state: models.json: not an array' ] || fail "models with an object: $rc $err"
printf '[{"class":"A","id":"x","harness":"omp"},{"class":"B","harness":"omp"}]' > "$models"
run "$state" models
[ "$rc" = 1 ] && [ -z "$out" ] && [ "$err" = 'task-draft-state: models.json: entry 2: id is not a non-empty string' ] || fail "models with no id: $rc $out $err"
printf '[{"class":"A","id":"x","harness":"  "}]' > "$models"
run "$state" models
[ "$rc" = 1 ] && [ "$err" = 'task-draft-state: models.json: entry 1: harness is not a non-empty string' ] || fail "models with a blank harness: $rc $err"
printf '[{"class":7,"id":"x","harness":"omp"}]' > "$models"
run "$state" models
[ "$rc" = 1 ] && [ "$err" = 'task-draft-state: models.json: entry 1: class is not a non-empty string' ] || fail "models with a number class: $rc $err"
printf '["x"]' > "$models"
run "$state" models
[ "$rc" = 1 ] && [ "$err" = 'task-draft-state: models.json: entry 1: not an object' ] || fail "models with a string entry: $rc $err"
printf '[{' > "$models"
run "$state" models
[ "$rc" = 1 ] && [[ "$err" == 'task-draft-state: models.json: does not parse ('* ]] || fail "models with broken JSON: $rc $err"
rm -f "$models"

# ---------------------------------------------------------------- a fixture repo with a spec
repo="$tmp/repo"
mkdir -p "$repo/docs/designs" "$repo/src" "$repo/tools" "$repo/.orch/tasks" "$tmp/outside"
git -C "$repo" init -q
# the user-repo lines of this repo's .gitignore; this repo's own .orch/ and docs/designs/ ignores are not a user's, so
# nothing in the fixture ignores .orch/ until task-draft-state writes .orch/taskdraft/.gitignore
grep -vxF -e '.orch/' -e 'docs/designs/' "$root/.gitignore" > "$repo/.gitignore"
printf 'src/ignored.py\n' >> "$repo/.gitignore"
printf -- '---\nbackend: adhoc\ntasks_dir: ".orch/tasks"\ndefault_base: main\nbranch_prefix: task/\n---\n' > "$repo/.orch/config.md"
printf 'def greet(name):\n    return "hi " + name\n' > "$repo/src/greet.py"
printf '#!/bin/sh\necho RUN-MARKER\n' > "$repo/tools/run"
printf 'BLOB-MARKER\n' > "$repo/tools/blob"
printf 'UNTRACKED-MARKER\n' > "$repo/src/untracked.py"
printf 'IGNORED-MARKER\n' > "$repo/src/ignored.py"
printf 'BIN-MARKER\n' > "$repo/src/data.bin"
printf 'TOKEN-MARKER\n' > "$repo/src/api_token.txt"
printf 'MYTOKENS-MARKER\n' > "$repo/my-tokens.txt"
# a #! first line, so only DENY (not the extension rule) keeps the key file out
printf '#!KEY-MARKER\n' > "$repo/id_ed25519"
# .env with a #! line and .env.md with an allowlisted extension: only DENY's .env branch keeps them out
mkdir -p "$repo/config"
printf '#!ENV-MARKER\n' > "$repo/.env"
printf 'ENVMD-MARKER\n' > "$repo/config/.env.md"
printf 'SIBLING-MARKER\n' > "$repo/docs/designs/sibling.md"
printf 'OUTSIDE-MARKER\n' > "$tmp/outside/notes.md"
ln -s "$tmp/outside/notes.md" "$repo/src/link.md"
head -c 300000 /dev/zero | tr '\0' 'x' > "$repo/src/big.txt"
spec="$repo/docs/designs/greet.md"
cat > "$spec" <<'SPEC'
# Design: Greeting with a title

## Overview
greet() takes an optional title and puts it before the name.

Second paragraph of the overview.

## Detailed design
Change `src/greet.py` (function greet), see [the greeter](src/greet.py), and the runner `tools/run`.
Notes in `sibling.md`. The blob `tools/blob` is data. Not added yet: `src/untracked.py`. Generated: `src/ignored.py`.
Binary: `src/data.bin`. Keys: `src/api_token.txt`, `my-tokens.txt`, `id_ed25519`, `.env` and `config/.env.md`. Outside: `@OUTSIDE@`
and `~/.config/example-tool/token`. A link out: `src/link.md`. This spec: `docs/designs/greet.md`.
Leave `src/big.txt` alone. History: [x](https://example.com/x.md). The folder `src/`.

## Test matrix
| Case | Input | Expect |
|---|---|---|
| title | greet("Ann", "Dr") | "hi Dr Ann" |

## Non-Goals
Localisation stays out.

## Acceptance criteria
- [ ] AC1: greet("Ann") still returns "hi Ann". (modality: test)
- [ ] AC2: greet("Ann", "Dr") returns "hi Dr Ann", (modality: test)
  with one space between the parts.
- AC3: tests/test_greet.py covers both cases. (modality: test)
SPEC
sed_i "s|@OUTSIDE@|$tmp/outside/notes.md|" "$spec"
git -C "$repo" add .gitignore .orch/config.md src/greet.py tools/run tools/blob src/data.bin src/api_token.txt my-tokens.txt id_ed25519 .env config/.env.md \
    docs/designs/sibling.md docs/designs/greet.md src/link.md src/big.txt
git -C "$repo" add -f src/ignored.py
git -C "$repo" -c user.email=t@t -c user.name=t commit -q -m init
git -C "$repo" ls-files --error-unmatch src/ignored.py >/dev/null || fail "fixture: src/ignored.py is not tracked"
git -C "$repo" check-ignore --no-index -q src/ignored.py || fail "fixture: src/ignored.py is not ignored"
case_ "taskdraft ignore file"
# the run's first call (answers, no questions.md) writes .orch/taskdraft/.gitignore: git then ignores the folder's
# files and nothing else of .orch/
run at "$repo" "$state" questions T0 answers
[ "$rc" = 1 ] && [ "$(cat "$repo/.orch/taskdraft/.gitignore")" = '*' ] || fail "answers did not write .orch/taskdraft/.gitignore: $rc $err"
git -C "$repo" check-ignore -q .orch/taskdraft/T0/questions.md || fail "the fixture repo does not ignore .orch/taskdraft/T0/questions.md"
rc=0; git -C "$repo" check-ignore -q .orch/decisions.md || rc=$?
[ "$rc" = 1 ] || fail "git check-ignore .orch/decisions.md exited $rc in the fixture repo"
# an existing ignore file is left as it is
printf '*\n# kept\n' > "$repo/.orch/taskdraft/.gitignore"
run at "$repo" "$state" questions T0 answers
[ "$rc" = 1 ] && [ "$(cat "$repo/.orch/taskdraft/.gitignore")" = $'*\n# kept' ] || fail "answers changed an existing .orch/taskdraft/.gitignore"
printf '*\n' > "$repo/.orch/taskdraft/.gitignore"

# stubs: one script under every harness name, on a PATH that holds no real harness
stub="$tmp/stub"
minbin="$tmp/minbin"
mkdir -p "$stub" "$minbin"
for t in bash env date git stat sleep cat cp python3 basename pwd mkdir rm head tr wc; do
    p=$(command -v "$t" 2>/dev/null) && [ -n "$p" ] && [ "${p#/}" != "$p" ] && ln -sf "$p" "$minbin/$t"
done
cat > "$stub/fake-cli" <<'STUB'
#!/usr/bin/env bash
name=$(basename "$0")
printf '%s\n' "$@" > "$STUB_LOG/$name.argv"
prev=""
# the agent file, and a copy of the folder it sits in (a kimi agent names its system prompt relative to itself)
for a in "$@"; do
  if [ "$prev" = --agent-file ]; then
    cp "$a" "$STUB_LOG/$name.agent"
    mkdir -p "$STUB_LOG/$name.agentdir" && cp -R "${a%/*}/." "$STUB_LOG/$name.agentdir/"
  fi
  prev="$a"
done
cat > "$STUB_LOG/$name.stdin"
env > "$STUB_LOG/$name.env"
pwd > "$STUB_LOG/$name.cwd"
case "${STUB_MODE:-}" in
  sleep) sleep 5 ;;
  fail) echo "partial"; exit 3 ;;
  empty) exit 0 ;;
  # the screen kimi printed when it opened its interactive UI instead of print mode, exit 0
  tui) printf '\033[?1049h\033[2J\342\225\255\342\224\200 Kimi \342\224\200\342\225\256\n\342\224\202 > \342\224\202\n\342\225\260\342\224\200\342\224\200\342\225\257\n Esc exit  Enter select\033[?1049l\n'; exit 0 ;;
esac
echo "### (a) What I change"
echo "- AC1 from $name"
STUB
chmod +x "$stub/fake-cli"
for n in omp opencode codex kimi; do ln -s fake-cli "$stub/$n"; done
safe_path="$stub:$minbin"
nocli_path="$minbin"
for n in omp opencode codex kimi; do
    [ -z "$(PATH="$nocli_path" command -v "$n" 2>/dev/null)" ] || fail "fixture: the bare PATH still has $n"
    [ "$(PATH="$safe_path" command -v "$n")" = "$stub/$n" ] || fail "fixture: the stub $n does not come first"
done
export STUB_LOG="$tmp/log"
mkdir -p "$STUB_LOG"
clear_log() { rm -rf "${STUB_LOG:?}"/*; }
out_dir="$repo/.orch/taskdraft/T7"
haiku='{"class":"A","id":"haiku","harness":"claude"}'
ompB='{"class":"B","id":"openrouter/x/y-1.5","harness":"omp","effort":"default","thinking":{"level":"high","pass":"suffix"}}'
ompstem="$out_dir/probe-r1-B-openrouter-x-y-1-5"
# probe [ENV=V ...] -- <args>: task-probe from the repo root on the stub PATH
probe() {
    local envs=()
    while [ "$1" != -- ]; do envs+=("$1"); shift; done
    shift
    (cd "$repo" && env PATH="$safe_path" ${envs[@]+"${envs[@]}"} python3 -I "$probe" "$@")
}

# ---------------------------------------------------------------- task-probe
case_ "probe prompt"
run probe -- "$spec" --entry "$haiku" --round 1 --out "$out_dir"
[ "$rc" = 10 ] || fail "probe with harness claude exited $rc: $err"
p="$out_dir/probe-r1-A-haiku.prompt.md"
[ "$(head -1 "$p")" = 'You have no tools and no history. Read the spec and the files below, then answer the five questions.' ] || fail "the prompt header"
grep -qF 'greet() takes an optional title and puts it before the name.' "$p" || fail "the prompt lacks the spec"
grep -qF 'def greet(name):' "$p" || fail "the prompt lacks the inlined src/greet.py"
grep -qxF 'src/greet.py:' "$p" || fail "the inlined file is not headed by its repo-relative path"
for q in '(a) What do I change?' '(b) Where (files, functions)?' '(c) Which tests prove it?' '(d) What is out of scope?' '(e) What is unclear or contradictory?'; do
    grep -qF -- "$q" "$p" || fail "the prompt lacks the questionnaire item $q"
done
[ "$(tail -2 "$p")" = '(a) What do I change?  (b) Where (files, functions)?  (c) Which tests prove it?
(d) What is out of scope?  (e) What is unclear or contradictory?' ] || fail "the questionnaire is not verbatim at the end"
case_ "probe inline rules"
grep -qF 'RUN-MARKER' "$p" || fail "a tracked extensionless #! script was not inlined"
grep -qF 'SIBLING-MARKER' "$p" || fail "a file named relative to the spec's folder was not inlined"
for m in BLOB-MARKER UNTRACKED-MARKER IGNORED-MARKER BIN-MARKER TOKEN-MARKER MYTOKENS-MARKER KEY-MARKER ENV-MARKER ENVMD-MARKER OUTSIDE-MARKER; do
    if grep -qF "$m" "$p"; then fail "the prompt inlines the file of $m"; fi
done
if grep -qF 'xxxxxxxxxx' "$p"; then fail "the 300 KB file was inlined"; fi
if grep -q 'example-tool/token:' "$p"; then fail "the token path was inlined"; fi
if grep -qxF 'docs/designs/greet.md:' "$p"; then fail "the spec inlined itself"; fi
[ "$(grep -cE '^(src/greet\.py|tools/run|docs/designs/sibling\.md):$' "$p")" = 3 ] || fail "the prompt does not inline exactly three files"
[ "$(grep -c '^src/greet.py:$' "$p")" = 1 ] || fail "a file named twice is inlined twice"
case_ "probe list"
run probe -- "$spec" --list --out "$out_dir"
[ "$rc" = 0 ] || fail "--list exited $rc: $err"
[ "$(cat "$out_dir/inline-files.txt")" = $'src/greet.py\ntools/run\ndocs/designs/sibling.md' ] || fail "inline-files.txt: $(cat "$out_dir/inline-files.txt")"
total=$(( $(wc -c < "$repo/src/greet.py") + $(wc -c < "$repo/tools/run") + $(wc -c < "$repo/docs/designs/sibling.md") ))
[ "$out" = "src/greet.py
tools/run
docs/designs/sibling.md
(omitted: size cap) src/big.txt
total $total" ] || fail "--list printed: $out"
case_ "probe files-from"
printf 'src/greet.py\n' > "$tmp/one.txt"
run probe -- "$spec" --entry "$haiku" --round 2 --out "$out_dir" --files-from "$tmp/one.txt"
[ "$rc" = 10 ] || fail "--files-from exited $rc"
p2="$out_dir/probe-r2-A-haiku.prompt.md"
grep -qF 'def greet(name):' "$p2" || fail "--files-from dropped the listed file"
if grep -qF 'RUN-MARKER' "$p2" || grep -qF 'SIBLING-MARKER' "$p2"; then fail "--files-from inlined an unlisted file"; fi
run probe -- "$spec" --list --out "$out_dir" --files-from "$tmp/one.txt"
[ "$(cat "$out_dir/inline-files.txt")" = 'src/greet.py' ] || fail "--list --files-from: $(cat "$out_dir/inline-files.txt")"
printf 'src/untracked.py\n' > "$tmp/untracked.txt"
run probe -- "$spec" --list --out "$out_dir" --files-from "$tmp/untracked.txt"
[ "$out" = 'total 0' ] || fail "--files-from let an untracked file in: $out"
run probe -- "$spec" --list --out "$out_dir" --files-from "$tmp/no-such-list.txt"
[ "$rc" = 2 ] || fail "a missing --files-from exited $rc"
case_ "probe check-ignore error fails closed"
# a git whose check-ignore exits 128 (an error, not "not ignored"): nothing is inlined
gitstub="$tmp/gitstub"
mkdir -p "$gitstub"
printf '#!/usr/bin/env bash\nfor a in "$@"; do [ "$a" = check-ignore ] && exit 128; done\nexec %q "$@"\n' "$(command -v git)" > "$gitstub/git"
chmod +x "$gitstub/git"
run at "$repo" env PATH="$gitstub:$safe_path" python3 -I "$probe" "$spec" --list --out "$out_dir"
[ "$rc" = 0 ] && [ "$out" = 'total 0' ] && [ ! -s "$out_dir/inline-files.txt" ] || fail "a check-ignore error let files in: $rc $out"
run probe -- "$spec" --list --out "$out_dir"
[ "$(head -1 "$out_dir/inline-files.txt")" = src/greet.py ] || fail "inline-files.txt not restored after the check-ignore case"
case_ "probe size cap"
run probe -- "$spec" --list --out "$out_dir"
grep -qxF '(omitted: size cap) src/big.txt' <<<"$out" || fail "the 300 KB file is not listed as omitted"
if grep -qF 'big.txt' "$out_dir/inline-files.txt"; then fail "inline-files.txt holds the omitted file"; fi
grep -qxF '(omitted: size cap) src/big.txt' "$p" || fail "the prompt does not list the omitted file"
g=$(fsize "$repo/src/greet.py")
run probe -- "$spec" --list --out "$out_dir" --files-from "$tmp/one.txt" --cap-bytes "$g"
[ "$out" = "src/greet.py
total $g" ] || fail "a cap of exactly the file's size dropped it: $out"
run probe -- "$spec" --list --out "$out_dir" --files-from "$tmp/one.txt" --cap-bytes "$((g - 1))"
[ "$out" = "(omitted: size cap) src/greet.py
total 0" ] || fail "a cap one byte under the file's size kept it: $out"
run probe -- "$spec" --list --out "$out_dir" --cap-bytes 0
[ "$(grep -c '^(omitted: size cap) ' <<<"$out")" = 4 ] && [ "$(tail -1 <<<"$out")" = 'total 0' ] || fail "--cap-bytes 0: $out"
# greet.py fits; tools/run (26 bytes) no longer fits in what is left; sibling.md (15 bytes) still does
[ "$(wc -c < "$repo/tools/run")" -gt "$(wc -c < "$repo/docs/designs/sibling.md")" ] || fail "fixture: tools/run is not larger than sibling.md"
gs=$(( $(wc -c < "$repo/src/greet.py") + $(wc -c < "$repo/docs/designs/sibling.md") ))
run probe -- "$spec" --list --out "$out_dir" --cap-bytes "$gs"
[ "$out" = "src/greet.py
docs/designs/sibling.md
(omitted: size cap) tools/run
(omitted: size cap) src/big.txt
total $gs" ] || fail "the cap is not a running total, or a smaller file after an omitted one was dropped: $out"
run probe -- "$spec" --list --out "$out_dir" --cap-bytes abc
[ "$rc" = 2 ] || fail "--cap-bytes abc exited $rc"
case_ "probe claude exits 10"
run probe -- "$spec" --entry "$haiku" --round 1 --out "$out_dir"
[ "$rc" = 10 ] && [ "$out" = "$out_dir/probe-r1-A-haiku.prompt.md" ] && [ -f "$out" ] || fail "probe claude: $rc $out"
for m in sonnet opus fable; do
    run probe -- "$spec" --entry '{"class":"C","id":"'"$m"'","harness":"claude"}' --round 3 --out "$out_dir"
    [ "$rc" = 10 ] && [ -f "$out_dir/probe-r3-C-$m.prompt.md" ] || fail "probe claude $m exited $rc"
done
[ ! -e "$out_dir/probe-r1-A-haiku.md" ] && [ ! -e "$out_dir/probe-r1-A-haiku.meta.json" ] || fail "probe claude wrote an answer or meta"
case_ "probe claude bad id"
run probe -- "$spec" --entry '{"class":"A","id":"gpt","harness":"claude"}' --round 1 --out "$out_dir"
[ "$rc" = 2 ] && [ "$err" = 'task-probe: harness claude takes haiku, sonnet, opus or fable, not gpt' ] || fail "probe claude gpt: $rc $err"
[ ! -e "$out_dir/probe-r1-A-gpt.prompt.md" ] || fail "a bad claude id wrote a prompt"
case_ "probe bad entry"
bad_entry() {
    run probe -- "$spec" --entry "$1" --round 1 --out "$out_dir"
    [ "$rc" = 2 ] && [ "$err" = "task-probe: $2" ] || fail "entry $1: $rc $err"
}
bad_entry '{"class":' 'JSON: Expecting value: line 1 column 10 (char 9)'
bad_entry '[1]' 'JSON: oczekiwany jeden obiekt {…}'
bad_entry '{"id":"x","harness":"omp"}' 'JSON: brak pola class'
bad_entry '{"class":"A","harness":"omp"}' 'JSON: brak pola id'
bad_entry '{"class":"A","id":"  ","harness":"omp"}' 'JSON: brak pola id'
bad_entry '{"class":"A","id":"x"}' 'JSON: brak pola harness'
bad_entry '{"class":"D","id":"x","harness":"omp"}' 'JSON: class D to rezerwa, użyj A, B, C albo F'
bad_entry '{"class":"E","id":"x","harness":"omp"}' 'JSON: class E to rezerwa, użyj A, B, C albo F'
bad_entry '{"class":"Z","id":"x","harness":"omp"}' 'JSON: class musi być A, B, C albo F, jest "Z"'
bad_entry '{"class":"A","id":5,"harness":"omp"}' 'JSON: id musi być tekstem'
bad_entry '{"class":"A","id":"x","harness":"vim"}' 'JSON: harness spoza listy: claude, omp, opencode, codex, kimi'
bad_entry '{"class":"A","id":"x","harness":"omp","effort":"huge"}' 'JSON: effort spoza listy: default, none, low, medium, high, xhigh, max'
bad_entry '{"class":"A","id":"x","harness":"omp","thinking":{"level":"max"}}' 'JSON: thinking.level spoza listy: -, off, on, low, medium, high'
bad_entry '{"class":"A","id":"x","harness":"omp","thinking":"max"}' 'JSON: thinking.level spoza listy: -, off, on, low, medium, high'
bad_entry '{"class":"A","id":"x","harness":"omp","thinking":{"level":"on","pass":"x"}}' 'JSON: thinking.pass musi być suffix albo param'
run probe -- "$spec" --entry "$haiku" --round 0 --out "$out_dir"
[ "$rc" = 2 ] || fail "--round 0 exited $rc"
run probe -- "$spec" --entry "$haiku" --out "$out_dir"
[ "$rc" = 2 ] || fail "no --round exited $rc"
run probe -- "$spec" --round 1 --out "$out_dir"
[ "$rc" = 2 ] || fail "no --entry exited $rc"
run probe -- "$spec" --entry "$haiku" --round 1
[ "$rc" = 2 ] || fail "no --out exited $rc"
run probe -- "$tmp/none.md" --entry "$haiku" --round 1 --out "$out_dir"
[ "$rc" = 2 ] || fail "a missing spec exited $rc"
run probe -- "$spec" --list --ac-hash
[ "$rc" = 2 ] || fail "--list with --ac-hash exited $rc"
run probe -- "$spec" --entry "$ompB" --round 1 --out "$out_dir" --timeout 0
[ "$rc" = 2 ] || fail "--timeout 0 exited $rc"
# a bare string thinking level is accepted with pass suffix
clear_log
run probe -- "$spec" --entry '{"class":"B","id":"m","harness":"omp","thinking":"high"}' --round 1 --out "$out_dir"
[ "$rc" = 0 ] && grep -qx -- '--model=m:high' "$STUB_LOG/omp.argv" || fail "a bare thinking string: $rc $err"

case_ "probe omp answer"
clear_log
run probe -- "$spec" --entry "$ompB" --round 1 --out "$out_dir"
[ "$rc" = 0 ] && [ "$out" = "$ompstem.md" ] || fail "probe omp: $rc $out $err"
[ "$(cat "$ompstem.md")" = $'### (a) What I change\n- AC1 from omp' ] || fail "the answer is not the CLI's stdout without the JSON line: $(cat "$ompstem.md")"
jq -e '.entry.id == "openrouter/x/y-1.5" and .round == 1 and .exit == 0 and (.wall_s | type) == "number"
       and .tokens_in == null and .tokens_out == null and .cost == null and (has("meta_error") | not)
       and .files == ["src/greet.py", "tools/run", "docs/designs/sibling.md"]
       and (.argv | index("--prompt-file")) != null and (.argv[0] | endswith("/harness-omp"))' "$ompstem.meta.json" >/dev/null ||
    fail "meta.json: $(cat "$ompstem.meta.json")"
[ -f "$ompstem.judge.md" ] || fail "no judge input after a probe"
case "$(cat "$STUB_LOG/omp.cwd")" in "${TMPDIR:-/tmp}"/junkd-probe-* | */junkd-probe-*) ;; *) fail "omp ran in $(cat "$STUB_LOG/omp.cwd"), not a junkd-probe- temp dir" ;; esac
[ ! -e "$(cat "$STUB_LOG/omp.cwd")" ] || fail "the temp dir was not removed"
case_ "probe judge input"
j="$ompstem.judge.md"
lines=$(grep -nE '^## (Acceptance criteria|Files|Out of scope|Answer)$' "$j" | cut -d: -f2- | tr '\n' '|')
[ "$lines" = '## Acceptance criteria|## Files|## Out of scope|## Answer|' ] || fail "the judge input sections: $lines"
grep -qF -- '- [ ] AC1: greet("Ann") still returns "hi Ann". (modality: test)' "$j" || fail "the judge input lacks the AC list verbatim"
[ "$(awk '/^## Files$/ { f = 1; next } f && NF { print; exit }' "$j")" = '- `src/greet.py`' ] || fail "the inlined files do not come first under ## Files"
grep -qxF -- '- `src/big.txt`' "$j" || fail "## Files lacks a named file that was not inlined"
if grep -qF 'outside/notes.md' "$j"; then fail "## Files names a file outside the root"; fi
[ "$(awk '/^## Out of scope$/ { getline; print; exit }' "$j")" = 'Localisation stays out.' ] || fail "## Out of scope is not the Non-Goals text"
[ "$(awk '/^## Answer$/ { f = 1; next } f' "$j")" = $'### (a) What I change\n- AC1 from omp' ] || fail "## Answer is not the answer verbatim"
printf 'the goldfish said this\n' > "$tmp/answer.md"
run probe -- "$spec" --judge-input "$tmp/answer.md" --entry "$haiku" --round 4 --out "$out_dir"
[ "$rc" = 0 ] && [ "$out" = "$out_dir/probe-r4-A-haiku.judge.md" ] || fail "--judge-input: $rc $out $err"
[ "$(awk '/^## Answer$/ { f = 1; next } f' "$out")" = 'the goldfish said this' ] || fail "--judge-input answer"
run probe -- "$spec" --judge-input "$tmp/no-answer.md" --entry "$haiku" --round 4 --out "$out_dir"
[ "$rc" = 2 ] || fail "--judge-input of a missing file exited $rc"
sed '/^## Non-Goals$/,/^Localisation/d' "$spec" > "$repo/docs/designs/nogoals.md"
run probe -- "$repo/docs/designs/nogoals.md" --judge-input "$tmp/answer.md" --entry "$haiku" --round 5 --out "$out_dir"
[ "$(awk '/^## Out of scope$/ { getline; print; exit }' "$out")" = '(none)' ] || fail "no Non-Goals section is not (none)"
case_ "probe timeout"
clear_log
start=$(date +%s)
run probe STUB_MODE=sleep -- "$spec" --entry "$ompB" --round 2 --out "$out_dir" --timeout 1
[ "$rc" = 20 ] && [ "$err" = 'task-probe: timeout' ] || fail "probe timeout: $rc $err"
[ $(( $(date +%s) - start )) -lt 5 ] || fail "the timeout did not kill the adapter's group"
s2="$out_dir/probe-r2-B-openrouter-x-y-1-5"
[ -f "$s2.prompt.md" ] && [ -f "$s2.meta.json" ] && [ ! -e "$s2.md" ] && [ ! -e "$s2.judge.md" ] || fail "the files after a timeout"
jq -e '.exit == 124' "$s2.meta.json" >/dev/null || fail "meta after a timeout: $(cat "$s2.meta.json")"
case_ "probe missing cli"
run at "$repo" env PATH="$nocli_path" python3 -I "$probe" "$spec" --entry "$ompB" --round 3 --out "$out_dir"
# the adapter's bash says `omp: command not found` on stderr; task-probe's own line comes last
[ "$rc" = 20 ] && [ "$(tail -1 <<<"$err")" = 'task-probe: adapter exit 127' ] || fail "probe with no omp: $rc $err"
s3="$out_dir/probe-r3-B-openrouter-x-y-1-5"
[ -f "$s3.prompt.md" ] && [ -f "$s3.meta.json" ] && [ ! -e "$s3.md" ] && [ ! -e "$s3.judge.md" ] || fail "the files after a missing CLI"
case_ "probe adapter fails"
run probe STUB_MODE=fail -- "$spec" --entry "$ompB" --round 4 --out "$out_dir"
[ "$rc" = 20 ] && [ "$err" = 'task-probe: adapter exit 3' ] || fail "probe with omp exiting 3: $rc $err"
[ ! -e "$out_dir/probe-r4-B-openrouter-x-y-1-5.md" ] || fail "a failed adapter wrote an answer"
jq -e '.exit == 3' "$out_dir/probe-r4-B-openrouter-x-y-1-5.meta.json" >/dev/null || fail "meta of a failed adapter"
case_ "probe empty answer"
run probe STUB_MODE=empty -- "$spec" --entry "$ompB" --round 5 --out "$out_dir"
[ "$rc" = 20 ] && [ "$err" = 'task-probe: empty answer' ] || fail "probe with an empty answer: $rc $err"
[ ! -e "$out_dir/probe-r5-B-openrouter-x-y-1-5.md" ] && [ ! -e "$out_dir/probe-r5-B-openrouter-x-y-1-5.judge.md" ] || fail "an empty answer was written"
case_ "probe malformed meta"
# a copy of task-probe next to a stub adapter that prints no JSON line (task-probe finds its adapters beside itself)
pbin="$tmp/probebin"
mkdir -p "$pbin"
cp "$probe" "$pbin/task-probe"
printf '#!/usr/bin/env bash\necho "plain answer"\necho "{not json"\n' > "$pbin/harness-omp"
chmod +x "$pbin/task-probe" "$pbin/harness-omp"
run at "$repo" env PATH="$safe_path" python3 -I "$pbin/task-probe" "$spec" --entry "$ompB" --round 6 --out "$out_dir"
s6="$out_dir/probe-r6-B-openrouter-x-y-1-5"
[ "$rc" = 0 ] || fail "probe with no JSON line exited $rc: $err"
jq -e '.meta_error == "no json line" and .wall_s == null and .tokens_in == null and .tokens_out == null and .cost == null' "$s6.meta.json" >/dev/null ||
    fail "meta with no JSON line: $(cat "$s6.meta.json")"
[ "$(cat "$s6.md")" = $'plain answer\n{not json' ] || fail "the answer is not the whole stdout: $(cat "$s6.md")"
printf '#!/usr/bin/env bash\necho "the answer"\necho "{\\"wall_s\\":7,\\"tokens_in\\":11,\\"tokens_out\\":12,\\"cost\\":0.5}"\n' > "$pbin/harness-omp"
run at "$repo" env PATH="$safe_path" python3 -I "$pbin/task-probe" "$spec" --entry "$ompB" --round 7 --out "$out_dir"
jq -e '.wall_s == 7 and .tokens_in == 11 and .tokens_out == 12 and .cost == 0.5 and (has("meta_error") | not)' "$out_dir/probe-r7-B-openrouter-x-y-1-5.meta.json" >/dev/null ||
    fail "meta from the JSON line: $(cat "$out_dir/probe-r7-B-openrouter-x-y-1-5.meta.json")"
[ "$(cat "$out_dir/probe-r7-B-openrouter-x-y-1-5.md")" = 'the answer' ] || fail "the JSON line stayed in the answer"
case_ "probe tui output"
# tui_probe <round> <printf format>: the copy of task-probe with a harness-omp that prints the fixture, then a JSON line
tui_probe() {
    printf "$2" > "$tmp/tui-fixture"
    printf '#!/usr/bin/env bash\ncat %q\necho "{\\"wall_s\\":1,\\"tokens_in\\":null,\\"tokens_out\\":null,\\"cost\\":null}"\n' "$tmp/tui-fixture" > "$pbin/harness-omp"
    run at "$repo" env PATH="$safe_path" python3 -I "$pbin/task-probe" "$spec" --entry "$ompB" --round "$1" --out "$out_dir"
    ts="$out_dir/probe-r$1-B-openrouter-x-y-1-5"
}
# rejected like an empty answer: exit 20, one stderr line, meta.json written, no answer and no judge input
tui_rejected() {
    [ "$rc" = 20 ] && [ "$err" = 'task-probe: tui output' ] && [ ! -e "$ts.md" ] && [ ! -e "$ts.judge.md" ] &&
        jq -e '.exit == 0 and .wall_s == 1 and (has("meta_error") | not)' "$ts.meta.json" >/dev/null
}
tui_passed() { [ "$rc" = 0 ] && [ "$out" = "$ts.md" ] && cmp -s "$ts.md" "$tmp/tui-fixture" && [ -f "$ts.judge.md" ]; }
tui_probe 21 'The answer has a colour code \033[0m in it.\n'
tui_rejected || fail "an answer with an ESC byte only: $rc $err"
tui_probe 22 '### (a) What I change\n- Esc exit closes the dialog\n'
tui_rejected || fail "an answer with Esc exit only: $rc $err"
tui_probe 23 '### (a) What I change\n- Enter select picks a row\n'
tui_rejected || fail "an answer with Enter select only: $rc $err"
# the box rule: a rounded corner (╭ ╮ ╰ ╯) on 2 or more lines; │ ─ ├ └ alone (a `tree` listing) never count
tui_probe 24 '\342\225\255 top\nprose in between\n\342\225\260 bottom\n'
tui_rejected || fail "rounded corners top-left and bottom-left on 2 lines: $rc $err"
tui_probe 25 '\342\225\256 top\n\342\225\257 bottom\n'
tui_rejected || fail "rounded corners top-right and bottom-right on 2 lines: $rc $err"
tui_probe 26 '\342\225\255\342\224\200\342\224\200\342\225\256 four corners \342\225\260\342\224\200\342\224\200\342\225\257 on one line\nprose\n'
tui_passed || fail "rounded corners on 1 line (4 corners) were rejected: $rc $err"
tui_probe 28 '### (b) Where\nsrc/\n\342\224\234\342\224\200\342\224\200 greet.py\n\342\224\202   \342\224\224\342\224\200\342\224\200 util.py\n\342\224\202   \342\224\234\342\224\200\342\224\200 a.py\n\342\224\224\342\224\200\342\224\200 tests/\n    \342\224\224\342\224\200\342\224\200 test_greet.py\n'
tui_passed || fail "a tree listing (├── └── │ on 5 lines) was rejected: $rc $err"
tui_probe 27 '### (a) What I change\n| file | change |\n|---|---|\n-- Escape the title, press Enter to select, then exit.\n'
tui_passed || fail "plain prose with an ASCII table was rejected: $rc $err"
case_ "probe kimi tui"
# the real harness-kimi on the stub kimi: the screen of its interactive UI is not an answer
clear_log
run probe STUB_MODE=tui -- "$spec" --entry '{"class":"F","id":"kimi-x1","harness":"kimi"}' --round 1 --out "$out_dir"
ks="$out_dir/probe-r1-F-kimi-x1"
[ "$rc" = 20 ] && [ "$err" = 'task-probe: tui output' ] && [ ! -e "$ks.md" ] && [ ! -e "$ks.judge.md" ] &&
    jq -e '.exit == 0' "$ks.meta.json" >/dev/null || fail "probe with kimi printing its UI: $rc $err"
# --agent-file names a file in the adapter's working directory, task-probe's temp dir, which is gone afterwards
kcwd=$(cat "$STUB_LOG/kimi.cwd")
[ "$(head -n 10 "$STUB_LOG/kimi.argv")" = $'--agent-file\n./kimi-goldfish.md\n--skills-dir\n./kimi-skills\n-m\nkimi-x1\n--output-format\ntext\n-p\nYou have no tools and no history. Read the spec and the files below, then answer the five questions.' ] &&
    [ -f "$STUB_LOG/kimi.agentdir/kimi-goldfish.md" ] || fail "kimi's argv through task-probe: $(head -n 12 "$STUB_LOG/kimi.argv")"
# the -p value is the whole prompt task-probe wrote, without its final newline (the stub's printf '%s\n' adds one back);
# task-probe also feeds the prompt on the adapter's stdin, and kimi must not get it there
[ -f "$ks.prompt.md" ] && cmp -s <(tail -n +10 "$STUB_LOG/kimi.argv") "$ks.prompt.md" || fail "the -p value through task-probe is not the prompt"
[ -f "$STUB_LOG/kimi.stdin" ] && [ ! -s "$STUB_LOG/kimi.stdin" ] || fail "kimi got the prompt on stdin through task-probe: $(wc -c < "$STUB_LOG/kimi.stdin")"
[ -n "$kcwd" ] && [ "${kcwd#"$repo"}" = "$kcwd" ] && [ ! -e "$kcwd" ] || fail "kimi ran in $kcwd, not in a removed temp dir"
clear_log
run probe -- "$spec" --entry '{"class":"F","id":"kimi-x1","harness":"kimi"}' --round 2 --out "$out_dir"
[ "$rc" = 0 ] && [ "$out" = "$out_dir/probe-r2-F-kimi-x1.md" ] && [ "$(cat "$out_dir/probe-r2-F-kimi-x1.md")" = $'### (a) What I change\n- AC1 from kimi' ] ||
    fail "probe with kimi printing prose: $rc $err"
case_ "probe env scrub"
clear_log
run probe CLAUDE_X=leak CLAUDECODE=1 ORCA_Y=leak AWS_SECRET_ACCESS_KEY=leak AWS_PROFILE=leak HF_TOKEN=leak GITHUB_TOKEN=leak GH_TOKEN=leak \
    GOOGLE_APPLICATION_CREDENTIALS=leak SSH_AUTH_SOCK=leak OPENROUTER_API_KEY=kept MY_GH_TOKEN=kept -- "$spec" --entry "$ompB" --round 8 --out "$out_dir"
[ "$rc" = 0 ] || fail "probe env scrub run exited $rc: $err"
if grep -E '^(CLAUDE|ORCA_|AWS_|HF_TOKEN=|GITHUB_TOKEN=|GH_TOKEN=|GOOGLE_APPLICATION_CREDENTIALS=|SSH_AUTH_SOCK=)' "$STUB_LOG/omp.env"; then fail "the env reached the CLI unscrubbed"; fi
grep -qx 'OPENROUTER_API_KEY=kept' "$STUB_LOG/omp.env" && grep -qx 'MY_GH_TOKEN=kept' "$STUB_LOG/omp.env" || fail "a provider key was scrubbed"
case_ "ac hash"
h1=$(cd "$repo" && python3 -I "$probe" "$spec" --ac-hash)
h2=$(cd "$repo" && python3 -I "$probe" "$spec" --ac-hash)
[[ "$h1" =~ ^[0-9a-f]{64}$ ]] && [ "$h1" = "$h2" ] || fail "--ac-hash is not a stable SHA-256: $h1 $h2"
cp "$spec" "$tmp/spec2.md"
sed_i 's/still returns "hi Ann"/returns "hi Ann"/' "$tmp/spec2.md"
[ "$(python3 -I "$probe" "$tmp/spec2.md" --ac-hash)" != "$h1" ] || fail "a changed AC gives the same hash"
cp "$spec" "$tmp/spec3.md"
sed_i 's/Localisation stays out./Localisation stays out for now./' "$tmp/spec3.md"
[ "$(python3 -I "$probe" "$tmp/spec3.md" --ac-hash)" = "$h1" ] || fail "a change outside the AC section changed the hash"
printf '# Nothing\n\nNo criteria here.\n' > "$tmp/noac.md"
run python3 -I "$probe" "$tmp/noac.md" --ac-hash
[ "$rc" = 3 ] && [ -z "$out" ] || fail "--ac-hash with no AC list exited $rc"
printf '# T\n\n## Acceptance criteria\n- greet works\n\n## After\nAC1: not in the section\n' > "$tmp/noitem.md"
run python3 -I "$probe" "$tmp/noitem.md" --ac-hash
[ "$rc" = 3 ] || fail "--ac-hash with no AC<n>: item exited $rc"
clear_log
cp "$tmp/noac.md" "$repo/docs/designs/noac.md"
run probe -- "$repo/docs/designs/noac.md" --entry "$ompB" --round 1 --out "$out_dir"
[ "$rc" = 3 ] && [ ! -e "$STUB_LOG/omp.argv" ] || fail "a probe on a spec with no ACs: $rc"
case_ "probe out outside repo"
run probe -- "$spec" --entry "$haiku" --round 1 --out "$tmp/elsewhere"
[ "$rc" = 2 ] && [ "$err" = "task-probe: $tmp/elsewhere resolves outside the repo" ] && [ ! -e "$tmp/elsewhere" ] || fail "--out outside the repo: $rc $err"
ln -s "$tmp/outside" "$repo/.orch/taskdraft/escape"
run probe -- "$spec" --list --out "$repo/.orch/taskdraft/escape"
[ "$rc" = 2 ] && [ ! -e "$tmp/outside/inline-files.txt" ] || fail "--out through a link outside the repo: $rc"
run probe -- "$spec" --list --out "$repo/.orch/taskdraft/escape/sub"
[ "$rc" = 2 ] && [ ! -e "$tmp/outside/sub" ] || fail "--out below a link outside the repo: $rc"
case_ "probe symlink target"
printf 'VICTIM\n' > "$repo/victim.txt"
rm -f "$out_dir/probe-r9-A-haiku.prompt.md"
ln -s "$repo/victim.txt" "$out_dir/probe-r9-A-haiku.prompt.md"
run probe -- "$spec" --entry "$haiku" --round 9 --out "$out_dir"
[ "$rc" = 2 ] && [ "$(cat "$repo/victim.txt")" = VICTIM ] && [ -L "$out_dir/probe-r9-A-haiku.prompt.md" ] || fail "a symlinked prompt target: $rc"
clear_log
ln -s "$repo/victim.txt" "$out_dir/probe-r9-B-openrouter-x-y-1-5.md"
run probe -- "$spec" --entry "$ompB" --round 9 --out "$out_dir"
[ "$rc" = 2 ] && [ ! -e "$STUB_LOG/omp.argv" ] && [ "$(cat "$repo/victim.txt")" = VICTIM ] || fail "a symlinked answer target: $rc (the CLI ran: $([ -e "$STUB_LOG/omp.argv" ] && echo yes || echo no))"
mkdir -p "$repo/.orch/taskdraft/T8"
ln -s "$repo/victim.txt" "$repo/.orch/taskdraft/T8/inline-files.txt"
run probe -- "$spec" --list --out "$repo/.orch/taskdraft/T8"
[ "$rc" = 2 ] && [ "$(cat "$repo/victim.txt")" = VICTIM ] || fail "a symlinked inline-files.txt: $rc"

# ---------------------------------------------------------------- harness adapters, called directly
adir="$tmp/adapter"
mkdir -p "$adir"
printf 'the prompt\n' > "$adir/prompt.md"
# adapter <name> <effort> <level> <pass> [STUB_MODE]: run it in $adir on the stub PATH
adapter() {
    clear_log
    run at "$adir" env PATH="$safe_path" STUB_MODE="${5:-}" "$skill/bin/harness-$1" --model the-model --effort "$2" --thinking "$3" --pass "$4" --prompt-file prompt.md
}
argv_has() { grep -qxF -- "$2" "$STUB_LOG/$1.argv"; }
argv_lacks() { ! grep -qF -- "$2" "$STUB_LOG/$1.argv"; }
json_last() { [[ "$(tail -1 <<<"$out")" =~ ^\{\"wall_s\":[0-9]+,\"tokens_in\":null,\"tokens_out\":null,\"cost\":null\}$ ]]; }
case_ "omp mapping"
adapter omp default on suffix
[ "$rc" = 0 ] && json_last || fail "omp adapter: $rc $out"
argv_has omp '--thinking=auto' && argv_has omp '--model=the-model' || fail "omp on: $(cat "$STUB_LOG/omp.argv")"
for f in -p --no-tools --no-session --no-title --no-extensions --no-skills --no-rules --no-lsp --no-context-files '--cwd' '@prompt.md'; do
    argv_has omp "$f" || fail "omp lacks $f"
done
adapter omp default high suffix
argv_has omp '--model=the-model:high' && argv_lacks omp '--thinking' || fail "omp high+suffix: $(cat "$STUB_LOG/omp.argv")"
adapter omp default high param
argv_has omp '--thinking=high' && argv_has omp '--model=the-model' || fail "omp high+param: $(cat "$STUB_LOG/omp.argv")"
adapter omp max - suffix
argv_has omp '--thinking=max' && argv_has omp '--model=the-model' || fail "omp effort max, level -: $(cat "$STUB_LOG/omp.argv")"
adapter omp max high param
argv_has omp '--thinking=high' && argv_lacks omp '--thinking=max' || fail "omp effort with a level: $(cat "$STUB_LOG/omp.argv")"
adapter omp default - suffix
argv_lacks omp '--thinking' || fail "omp default effort, level -: $(cat "$STUB_LOG/omp.argv")"
adapter omp none - suffix
argv_lacks omp '--thinking' || fail "omp effort none: $(cat "$STUB_LOG/omp.argv")"
adapter omp max off suffix
argv_has omp '--thinking=off' && argv_lacks omp '--thinking=max' || fail "omp off: $(cat "$STUB_LOG/omp.argv")"
adapter omp default on suffix fail
[ "$rc" = 3 ] && json_last || fail "omp adapter with the CLI failing: $rc $out"
case_ "opencode mapping"
adapter opencode default on suffix
[ "$rc" = 0 ] && json_last || fail "opencode adapter: $rc"
for f in run --pure '--dir' -m the-model -f prompt.md 'Answer as the attached file asks.'; do argv_has opencode "$f" || fail "opencode lacks $f"; done
[ "$(grep -A1 -x -- '--variant' "$STUB_LOG/opencode.argv" | tail -1)" = high ] || fail "opencode on: $(cat "$STUB_LOG/opencode.argv")"
[ "$(grep -A1 -x -- '-f' "$STUB_LOG/opencode.argv" | tail -1)" = prompt.md ] || fail "opencode -f"
adapter opencode default low param
[ "$(grep -A1 -x -- '--variant' "$STUB_LOG/opencode.argv" | tail -1)" = low ] || fail "opencode low"
adapter opencode high off suffix
[ "$(grep -A1 -x -- '--variant' "$STUB_LOG/opencode.argv" | tail -1)" = high ] || fail "opencode off with effort high"
adapter opencode xhigh medium suffix
[ "$(grep -c -x -- '--variant' "$STUB_LOG/opencode.argv")" = 1 ] && [ "$(grep -A1 -x -- '--variant' "$STUB_LOG/opencode.argv" | tail -1)" = medium ] || fail "opencode level wins over effort"
adapter opencode default off suffix
argv_lacks opencode '--variant' || fail "opencode off, default effort"
adapter opencode none - suffix
argv_lacks opencode '--variant' || fail "opencode effort none"
case_ "codex mapping"
adapter codex high on suffix
[ "$rc" = 0 ] && json_last || fail "codex adapter: $rc"
for f in exec --skip-git-repo-check --sandbox read-only -C -m the-model -c 'model_reasoning_effort="high"'; do argv_has codex "$f" || fail "codex lacks $f: $(cat "$STUB_LOG/codex.argv")"; done
[ "$(grep -A1 -x -- '--sandbox' "$STUB_LOG/codex.argv" | tail -1)" = read-only ] || fail "codex sandbox"
[ "$(tail -1 "$STUB_LOG/codex.argv")" = - ] || fail "codex does not read the prompt from stdin"
cmp -s "$STUB_LOG/codex.stdin" "$adir/prompt.md" || fail "codex did not get the prompt on stdin"
argv_lacks codex 'thinking' || fail "codex passed a thinking flag"
adapter codex default high param
argv_lacks codex 'model_reasoning_effort' || fail "codex default effort"
adapter codex none - suffix
argv_lacks codex 'model_reasoning_effort' || fail "codex effort none"
case_ "kimi mapping"
adapter kimi high on suffix < "$adir/prompt.md"
[ "$rc" = 0 ] && json_last || fail "kimi adapter: $rc"
# Kimi Code 2.4.1: -p is prompt mode (no TUI), its value is the prompt; no --yolo/--auto (rejected with -p), no kimi-cli
# flags (--quiet, --mcp-config-file); the prompt's final newline is dropped by the command substitution
[ "$(cat "$STUB_LOG/kimi.argv")" = $'--agent-file\n./kimi-goldfish.md\n--skills-dir\n./kimi-skills\n-m\nthe-model\n--output-format\ntext\n-p\nthe prompt' ] ||
    fail "kimi argv: $(cat "$STUB_LOG/kimi.argv")"
# the adapter's stdin held the prompt; kimi's stdin is /dev/null
[ -f "$STUB_LOG/kimi.stdin" ] && [ ! -s "$STUB_LOG/kimi.stdin" ] || fail "kimi got the adapter's stdin: $(cat "$STUB_LOG/kimi.stdin")"
grep -qxF '# Targets Kimi Code 2.4.1 (`kimi --version` 2.4.1, docs https://moonshotai.github.io/kimi-code/). kimi-cli, the legacy' "$skill/bin/harness-kimi" &&
    grep -qxF '# Python CLI (--quiet, YAML agent files, --mcp-config-file), is not supported: 2.4.1 rejects those flags.' "$skill/bin/harness-kimi" ||
    fail "harness-kimi's header does not name Kimi Code 2.4.1 and drop kimi-cli"
grep -qxF '# MCP: no flag or agent-file key turns MCP off. Servers in ~/.kimi-code/mcp.json and in plugins may still connect' "$skill/bin/harness-kimi" ||
    fail "harness-kimi's header does not say MCP servers may still connect"
grep -qxF "# kimi's stdin is /dev/null. The prompt is passed in argv, so it is visible to local users in the process list" "$skill/bin/harness-kimi" ||
    fail "harness-kimi's header does not state that the prompt is visible in the process list"
grep -qF "the prompt is passed in argv; visible to local users in the process list" "$root/plugins/junkd/README.md" &&
    grep -qF "| agent file allows no tools; MCP from the user's config is not isolated; advisory. " "$root/plugins/junkd/README.md" ||
    fail "the README kimi cells do not state the argv exposure and the advisory no-tools"
[ "$(cat "$STUB_LOG/kimi.cwd")" = "$adir" ] && [ -f "$STUB_LOG/kimi.agentdir/kimi-goldfish.md" ] && [ -d "$STUB_LOG/kimi.agentdir/kimi-skills" ] ||
    fail "kimi's agent file or skills dir is not in the adapter's directory"
[ -z "$(ls -A "$STUB_LOG/kimi.agentdir/kimi-skills")" ] || fail "kimi's skills dir is not empty: $(ls -A "$STUB_LOG/kimi.agentdir/kimi-skills")"
printf 'line one\n\nline three\n\n\n' > "$adir/prompt.md"
adapter kimi default - suffix
[ "$rc" = 0 ] && [ "$(tail -n +10 "$STUB_LOG/kimi.argv")" = $'line one\n\nline three' ] && [ $(( $(wc -l < "$STUB_LOG/kimi.argv") )) = 12 ] ||
    fail "a multi-line prompt in -p: $(cat "$STUB_LOG/kimi.argv")"
head -c 102400 /dev/zero | tr '\0' 'k' > "$adir/prompt.md"
adapter kimi default - suffix
[ "$rc" = 0 ] && [ "$(sed -n 10p "$STUB_LOG/kimi.argv")" = "$(cat "$adir/prompt.md")" ] && [ $(( $(wc -l < "$STUB_LOG/kimi.argv") )) = 10 ] ||
    fail "the 100 KB prompt is not kimi's -p value"
head -c 122880 /dev/zero | tr '\0' 'k' > "$adir/prompt.md"
adapter kimi default - suffix
# 120 KiB in one argv string stays under the kernel's 128 KiB cap (MAX_ARG_STRLEN): the stub got it byte for byte
[ "$rc" = 0 ] && [ "$(sed -n 9p "$STUB_LOG/kimi.argv")" = -p ] && [ $(( $(sed -n 10p "$STUB_LOG/kimi.argv" | wc -c) )) = 122881 ] &&
    [ "$(sed -n 10p "$STUB_LOG/kimi.argv")" = "$(cat "$adir/prompt.md")" ] || fail "a prompt of exactly 120 KiB did not reach kimi's -p"
head -c 122881 /dev/zero | tr '\0' 'k' > "$adir/prompt.md"
adapter kimi default - suffix
[ "$rc" = 2 ] && [ "$err" = 'harness-kimi: prompt over 120 KiB' ] && [ ! -e "$STUB_LOG/kimi.argv" ] && json_last || fail "a prompt one byte over 120 KiB: $rc $err"
head -c 153600 /dev/zero | tr '\0' 'k' > "$repo/src/kimi150.txt"
git -C "$repo" add src/kimi150.txt
printf '# Kimi\n\nSee `src/kimi150.txt`.\n\n## Acceptance criteria\n- AC1: it works. (modality: test)\n' > "$repo/docs/designs/kimi.md"
clear_log
run probe -- "$repo/docs/designs/kimi.md" --entry '{"class":"B","id":"k2","harness":"kimi"}' --round 1 --out "$out_dir" --cap-bytes 400000
[ "$rc" = 20 ] && grep -qx 'task-probe: adapter exit 2' <<<"$err" && [ ! -e "$STUB_LOG/kimi.argv" ] || fail "a 150 KB prompt through task-probe: $rc $err"
printf 'the prompt\n' > "$adir/prompt.md"
case_ "omp no tools"
adapter omp default - suffix
argv_has omp '--no-tools' && argv_has omp '--no-extensions' && argv_has omp '--no-skills' || fail "omp runs with tools"
case_ "opencode no tools"
adapter opencode default - suffix
cfg=$(sed -n 's/^OPENCODE_CONFIG_CONTENT=//p' "$STUB_LOG/opencode.env")
[ -n "$cfg" ] || fail "opencode ran with no OPENCODE_CONFIG_CONTENT"
jq -e '.permission["*"] == "deny" and ([.permission[]] | all(. == "deny"))
       and (["edit", "bash", "webfetch", "websearch", "external_directory", "skill", "task"] | all(. as $k | $cfg_p[$k] == "deny"))
       and .tools["*"] == false and ([.tools[]] | all(. == false))
       and (["bash", "edit", "write", "patch", "apply_patch", "multiedit", "read", "grep", "glob", "list", "lsp", "webfetch", "websearch",
             "codesearch", "skill", "batch", "question", "todowrite", "todoread", "task"] | all(. as $k | $cfg_t[$k] == false))' \
    --argjson cfg_p "$(jq -c .permission <<<"$cfg")" --argjson cfg_t "$(jq -c .tools <<<"$cfg")" <<<"$cfg" >/dev/null ||
    fail "opencode's config does not turn the tools off: $cfg"
run at "$adir" env PATH="$safe_path" OPENCODE_CONFIG_CONTENT='{"permission":{"bash":"allow"}}' "$skill/bin/harness-opencode" --model m --prompt-file prompt.md
[ "$(sed -n 's/^OPENCODE_CONFIG_CONTENT=//p' "$STUB_LOG/opencode.env" | jq -r .permission.bash)" = deny ] || fail "a caller's OPENCODE_CONFIG_CONTENT reached opencode"
case_ "codex no tools"
adapter codex default - suffix
for feat in shell_tool unified_exec apps browser_use computer_use image_generation; do
    [ "$(grep -B1 -x -- "$feat" "$STUB_LOG/codex.argv" | head -1)" = --disable ] || fail "codex does not --disable $feat: $(cat "$STUB_LOG/codex.argv")"
done
for kv in 'web_search="disabled"' 'tools.web_search=false' 'mcp_servers={}'; do
    [ "$(grep -B1 -xF -- "$kv" "$STUB_LOG/codex.argv" | head -1)" = -c ] || fail "codex lacks -c $kv: $(cat "$STUB_LOG/codex.argv")"
done
if grep -q '^CODEX_HOME=' "$STUB_LOG/codex.env"; then fail "the codex adapter set CODEX_HOME"; fi
grep -qxF '# "No tools": not proven; every listed tool surface is off (see "Tools" above).' "$skill/bin/harness-codex" || fail "harness-codex claims more than it turns off"
[ "$(grep -A1 -x -- '--sandbox' "$STUB_LOG/codex.argv" | tail -1)" = read-only ] || fail "codex is not read-only"
grep -qF 'The read-only sandbox alone does not stop reads or a network call' "$skill/bin/harness-codex" || fail "harness-codex claims more than its sandbox does"
case_ "kimi no tools"
adapter kimi default - suffix
[ -f "$STUB_LOG/kimi.agent" ] || fail "kimi got no agent file"
kd="$STUB_LOG/kimi.agentdir"
cmp -s "$STUB_LOG/kimi.agent" "$kd/kimi-goldfish.md" || fail "the copied folder holds another kimi-goldfish.md"
# the Kimi Code agent file (customization/agents): Markdown, YAML frontmatter, the body is the system prompt.
# name, description (required), `tools: []` ("disables all tools") and disallowedTools: every tool on the tools page
# (reference/tools) plus mcp__* (a bare * there "disables nothing"). Exact bytes always; python3 yaml too.
kimi_builtins='Read Write Edit Grep Glob ReadMediaFile Bash WebSearch FetchURL ExitPlanMode TodoList Agent AgentSwarm AskUserQuestion
NotifyUser Skill TaskList TaskOutput TaskStop WaitFor CronCreate CronList CronDelete'
[ $(( $(wc -w <<<"$kimi_builtins") )) = 23 ] || fail "fixture: the built-in tool list is not the 23 the tools page names"
kimi_md=$'---\nname: kimi-goldfish\ndescription: Answers five questions about a spec from the message alone, with no tools\ntools: []\ndisallowedTools:'
for t in $kimi_builtins 'mcp__*'; do kimi_md+=$'\n'"  - $t"; done
kimi_md+=$'\n---\n\nYou have no tools and no history. Answer the five questions about the spec in the message, under the headings (a) to (e). Do not ask questions back.'
[ "$(cat "$STUB_LOG/kimi.agent")" = "$kimi_md" ] && [ "$(head -n 1 "$STUB_LOG/kimi.agent")" = --- ] ||
    fail "kimi's agent file: $(cat "$STUB_LOG/kimi.agent")"
if grep -qF '${' "$STUB_LOG/kimi.agent"; then fail "kimi's agent file holds a template variable"; fi
grep -qxF '# agent file (frontmatter: name, description, `tools: []`, which the docs say "disables all tools", and a' "$skill/bin/harness-kimi" ||
    fail "harness-kimi's header does not describe the agent file"
grep -qxF "# \"No tools\": advisory: the agent file cuts the tools; the MCP servers of the user's config are not isolated (MCP below)." "$skill/bin/harness-kimi" ||
    fail "harness-kimi's header does not call its no-tools advisory"
if grep -qF 'enforced by an agent file' "$skill/bin/harness-kimi"; then fail "harness-kimi's header still calls its no-tools enforced"; fi
grep -qxF '# empty tool set is the guard. HOME and the kimi config dir are left alone: kimi keeps its own login there.' "$skill/bin/harness-kimi" ||
    fail "harness-kimi's header does not say it leaves HOME and the kimi config dir alone"
grep -qxF '# on 2026-11-09 (exit 0, transcript-style text, kimi accepted the agent file); MCP isolation is not confirmed live.' "$skill/bin/harness-kimi" ||
    fail "harness-kimi's header does not give the live run of the 2.4.1 argv and the unconfirmed MCP isolation"
grep -qxF "# Session: Kimi Code stores every run as a session in the user's Kimi home (stderr: \`To resume this session: kimi -r session_<id>\`), so the prompt text stays there; the adapter does not delete it: it never touches the user's home or credential files." "$skill/bin/harness-kimi" ||
    fail "harness-kimi's header does not say kimi keeps a session with the prompt that the adapter leaves alone"
# the README's Untested section, its wrapped lines joined with spaces
untested=$(awk '/^### Untested$/ { on = 1; next } on && /^#/ { exit } on' "$root/plugins/junkd/README.md" | tr '\n' ' ')
grep -qF "Kimi Code stores a session for every run in the user's Kimi home (stderr prints \`To resume this session: kimi -r session_<id>\`), so the prompt text stays there; the adapter does not delete it, because adapters never handle the user's home or credential files." <<<"$untested" ||
    fail "the README's Untested section does not say kimi keeps a session with the prompt that the adapter leaves alone"
grep -qF "The 2.4.1 argv (\`-p\` prompt mode, a Markdown agent file with \`tools: []\`) is confirmed live: on 2026-11-09, run through \`task-probe\`, it exited 0." <<<"$untested" &&
    grep -qF "MCP isolation is not confirmed: MCP servers from the user's config are still not isolated, so kimi's no-tools stays advisory." <<<"$untested" &&
    grep -qF "opencode and codex have had no live call." <<<"$untested" ||
    fail "the README's Untested section does not record the live kimi run, the unconfirmed MCP isolation and the untested opencode and codex"
if grep -qE '^[^#]*(HOME|KIMI_[A-Z_]*)=' "$skill/bin/harness-kimi"; then fail "harness-kimi redirects HOME or a kimi config variable"; fi
grep -qx 'HOME=.*' "$STUB_LOG/kimi.env" && [ "$(sed -n 's/^HOME=//p' "$STUB_LOG/kimi.env")" = "$HOME" ] || fail "kimi did not get the caller's HOME"
if python3 -I -c 'import yaml' 2>/dev/null; then
    echo "  kimi agent file: exact bytes and python3 yaml"
    python3 -I - "$kd/kimi-goldfish.md" $kimi_builtins <<'PY' || fail "kimi's agent file (python3 yaml): $(cat "$STUB_LOG/kimi.agent")"
import sys, yaml
text = open(sys.argv[1]).read()
assert text.startswith("---\n"), text
front, body = text[4:].split("\n---\n", 1)
doc = yaml.safe_load(front)
want = {"name": "kimi-goldfish", "description": "Answers five questions about a spec from the message alone, with no tools",
        "tools": [], "disallowedTools": sys.argv[2:] + ["mcp__*"]}
assert len(sys.argv[2:]) == 23, sys.argv
assert doc == want, doc
assert body.strip().startswith("You have no tools and no history."), body
assert "${" not in body, body
PY
else
    echo "  kimi agent file: exact bytes only (no python3 yaml)"
fi
kimi_files="kimi-goldfish.md kimi-skills"
none_left() { local g; for g in $kimi_files; do [ ! -e "$adir/$g" ] && [ ! -L "$adir/$g" ] || return 1; done; }
none_left || fail "the kimi agent file or skills dir was left behind: $(ls -A "$adir")"
adapter kimi default - suffix fail
[ "$rc" = 3 ] && none_left || fail "the kimi agent file or skills dir stays after kimi fails: $(ls -A "$adir")"
for f in $kimi_files; do
    printf 'mine\n' > "$adir/$f"
    adapter kimi default - suffix
    [ "$rc" = 2 ] && [ "$err" = "harness-kimi: ./$f exists; run the adapter in an empty directory" ] && [ ! -e "$STUB_LOG/kimi.argv" ] &&
        [ "$(cat "$adir/$f")" = mine ] && json_last || fail "kimi with an existing $f: $rc $err"
    for g in $kimi_files; do [ "$g" = "$f" ] || [ ! -e "$adir/$g" ] || fail "kimi wrote $g next to an existing $f"; done
    rm -f "$adir/$f"
    ln -s "$tmp/no-such-target" "$adir/$f"
    adapter kimi default - suffix
    [ "$rc" = 2 ] && [ "$err" = "harness-kimi: ./$f exists; run the adapter in an empty directory" ] && [ ! -e "$STUB_LOG/kimi.argv" ] &&
        [ -L "$adir/$f" ] && [ ! -e "$tmp/no-such-target" ] || fail "kimi with a dangling $f link: $rc $err"
    rm -f "$adir/$f"
done
# an existing kimi-skills directory, with a file in it: refused, and the directory is not touched
mkdir "$adir/kimi-skills" && printf 'mine\n' > "$adir/kimi-skills/SKILL.md"
adapter kimi default - suffix
[ "$rc" = 2 ] && [ "$err" = 'harness-kimi: ./kimi-skills exists; run the adapter in an empty directory' ] && [ ! -e "$STUB_LOG/kimi.argv" ] &&
    [ "$(cat "$adir/kimi-skills/SKILL.md")" = mine ] && [ ! -e "$adir/kimi-goldfish.md" ] || fail "kimi with an existing kimi-skills dir: $rc $err"
rm -rf "${adir:?}/kimi-skills"
case_ "adapter arguments"
run at "$adir" env PATH="$safe_path" "$skill/bin/harness-omp" --model m
[ "$rc" = 2 ] || fail "an adapter with no --prompt-file exited $rc"
run at "$adir" env PATH="$safe_path" "$skill/bin/harness-codex" --model m --prompt-file prompt.md --bogus x
[ "$rc" = 2 ] || fail "an adapter with an unknown flag exited $rc"
run at "$adir" env PATH="$safe_path" "$skill/bin/harness-kimi" --model
[ "$rc" = 2 ] || fail "an adapter with a flag missing its value exited $rc"

# ---------------------------------------------------------------- task-from-spec
task="$repo/.orch/tasks/T1.md"
fs() { (cd "$repo" && python3 -I "$fromspec" "$@"); }
case_ "from-spec fixture"
run fs "$spec" T1 --worker-class B
[ "$rc" = 0 ] && [ "$out" = "wrote $task" ] || fail "task-from-spec: $rc $out $err"
[ "$(awk 'NR == 1 { next } /^---$/ { exit } { print }' "$task")" = 'id: T1
title: Greeting with a title
status: todo
deps: []
source: adhoc
source_updated_at:
criteria_source: verbatim
spec: docs/designs/greet.md
worker_class: B' ] || fail "the frontmatter: $(head -12 "$task")"
[ "$(sed -n 1p "$task")" = '---' ] || fail "the task file does not start with ---"
listing=$(cd "$repo" && "$orch_state" list)
grep -qE '^T1 +todo ' <<<"$listing" || fail "orch-state list does not accept T1: $listing"
grep -qx '## Description' "$task" && grep -qxF 'greet() takes an optional title and puts it before the name.' "$task" || fail "the description is not the overview's first paragraph"
if grep -qF 'Second paragraph of the overview.' "$task"; then fail "the description holds more than the first paragraph"; fi
grep -qxF 'Spec: `docs/designs/greet.md` (EGM, via /junkd:task-draft).' "$task" || fail "the spec line"
grep -qxF -- '- [ ] AC1: greet("Ann") still returns "hi Ann". (modality: test)' "$task" || fail "AC1 not verbatim"
grep -qxF -- '- [ ] AC2: greet("Ann", "Dr") returns "hi Dr Ann", (modality: test) with one space between the parts.' "$task" || fail "AC2 (wrapped) not joined"
grep -qxF -- '- [ ] AC3: tests/test_greet.py covers both cases. (modality: test)' "$task" || fail "AC3 not normalised"
grep -qx '## Test matrix' "$task" && grep -qF '| title | greet("Ann", "Dr") | "hi Dr Ann" |' "$task" || fail "the test matrix"
if grep -qx '## Evidence: comprehension' "$task"; then fail "an evidence section without --probe"; fi
if grep -qF 'Localisation' "$task"; then fail "the Non-Goals leaked into the task file"; fi
printf '# Plain\n\n## Acceptance criteria\n- AC1: x. (modality: test)\n' > "$repo/docs/designs/plain.md"
run fs "$repo/docs/designs/plain.md" T2
[ "$rc" = 0 ] && [ "$(awk '/^## Description$/ { getline; print; exit }' "$repo/.orch/tasks/T2.md")" = Plain ] || fail "no overview: the description is not the title"
if grep -q '^worker_class:' "$repo/.orch/tasks/T2.md"; then fail "worker_class without --worker-class"; fi
case_ "from-spec matches orch-state new keys"
(cd "$repo" && "$orch_state" new NEWKEYS x >/dev/null)
keys=$(awk 'NR == 1 { next } /^---$/ { exit } { sub(/:.*/, ""); print }' "$repo/.orch/tasks/NEWKEYS.md")
[ -n "$keys" ] || fail "orch-state new wrote no keys"
for k in $keys; do grep -q "^$k:" "$task" || fail "task-from-spec does not write the key $k"; done
rm -f "$repo/.orch/tasks/NEWKEYS.md"
case_ "from-spec no overwrite"
cp "$task" "$tmp/first.md"
run fs "$spec" T1 --worker-class B
[ "$rc" = 1 ] && grep -qF 'pass --force' <<<"$err" && cmp -s "$task" "$tmp/first.md" || fail "a second run without --force: $rc $err"
case_ "from-spec force keeps"
run fs "$spec" T1 --worker-class B --force
[ "$rc" = 0 ] && cmp -s "$task" "$tmp/first.md" || fail "--force with the same inputs gave another file"
# a backslash-newline in the replacement is the newline both GNU and BSD sed take
sed_i 's/^status: todo$/status: in_progress/; s/^deps: \[\]$/deps: [T0, T00]/; s/^source: adhoc$/source: github#12/; s/^source_updated_at:$/source_updated_at: 2026-11-01T10:00:00Z\
critical: true/' "$task"
printf '\n## Verification — task/T1\n| AC | verdict |\n|---|---|\n| AC1 | PASS |\n' >> "$task"
run fs "$spec" T1 --worker-class C --force
[ "$rc" = 0 ] || fail "--force exited $rc: $err"
[ "$(awk 'NR == 1 { next } /^---$/ { exit } { print }' "$task")" = 'id: T1
title: Greeting with a title
status: in_progress
deps: [T0, T00]
source: github#12
source_updated_at: 2026-11-01T10:00:00Z
critical: true
criteria_source: verbatim
spec: docs/designs/greet.md
worker_class: C' ] || fail "--force did not keep the orch keys: $(head -13 "$task")"
grep -qF '| AC1 | PASS |' "$task" && [ "$(grep -c '^## Verification' "$task")" = 1 ] || fail "--force lost or doubled ## Verification"
listing=$(cd "$repo" && "$orch_state" list)
grep -qE '^T1 +in_progress +! +\[T0, T00\]$' <<<"$listing" || fail "orch-state does not read the kept keys: $listing"
case_ "from-spec probe and deps"
printf 'AGREED ANSWER\n(e) none\n' > "$tmp/agreed.md"
run fs "$spec" T3 --probe "$tmp/agreed.md" --understood 6/6 --worker-class B --deps T1a
[ "$rc" = 0 ] || fail "--probe --deps exited $rc: $err"
t3="$repo/.orch/tasks/T3.md"
grep -qx 'deps: \[T1a\]' "$t3" || fail "--deps T1a: $(grep '^deps:' "$t3")"
[ "$(awk '/^## Evidence: comprehension$/ { f = 1; next } f' "$t3")" = $'understood 6/6 on class B\nAGREED ANSWER\n(e) none' ] || fail "the evidence section: $(cat "$t3")"
run fs "$spec" T4 --deps T1a,T1b
grep -qx 'deps: \[T1a, T1b\]' "$repo/.orch/tasks/T4.md" || fail "--deps T1a,T1b: $(grep '^deps:' "$repo/.orch/tasks/T4.md")"
for badarg in '--deps T1a,,T1b' '--deps _x' '--worker-class D' '--worker-class b' '--understood 6' "--probe $tmp/no-answer.md"; do
    # shellcheck disable=SC2086
    run fs "$spec" T5 $badarg
    [ "$rc" = 2 ] && [ ! -e "$repo/.orch/tasks/T5.md" ] || fail "task-from-spec $badarg exited $rc"
done
for badid in _bad ../x 'a..b'; do
    run fs "$spec" "$badid"
    [ "$rc" = 2 ] || fail "the id $badid exited $rc"
done
case_ "from-spec no criteria"
run fs "$repo/docs/designs/noac.md" T6
[ "$rc" = 3 ] && [ ! -e "$repo/.orch/tasks/T6.md" ] || fail "a spec with no criteria: $rc"
case_ "from-spec deterministic"
cp -a "$repo" "$tmp/repoA"
cp -a "$repo" "$tmp/repoB"
rm -f "$tmp/repoA/.orch/tasks/T1.md" "$tmp/repoB/.orch/tasks/T1.md"
(cd "$tmp/repoA" && python3 -I "$fromspec" docs/designs/greet.md T1 --probe "$tmp/agreed.md" --understood 3/3 --worker-class A --deps T0 >/dev/null)
(cd "$tmp/repoB" && python3 -I "$fromspec" docs/designs/greet.md T1 --probe "$tmp/agreed.md" --understood 3/3 --worker-class A --deps T0 >/dev/null)
cmp -s "$tmp/repoA/.orch/tasks/T1.md" "$tmp/repoB/.orch/tasks/T1.md" || fail "two runs to two dirs differ"
case_ "from-spec outside repo"
r2="$tmp/r2"
mkdir -p "$r2/.orch" "$tmp/outside-tasks"
git -C "$r2" init -q
ln -s "$tmp/outside-tasks" "$r2/.orch/tasks"
run python3 -I "$fromspec" "$spec" T1 --root "$r2"
[ "$rc" = 2 ] && grep -qF 'resolves outside the repo' <<<"$err" && [ -z "$(ls -A "$tmp/outside-tasks")" ] || fail "a tasks dir linked outside the repo: $rc $err"
case_ "from-spec symlink target"
printf 'INSIDE-VICTIM\n' > "$repo/victim2.md"
rm -f "$repo/.orch/tasks/T7.md"
ln -s "$repo/victim2.md" "$repo/.orch/tasks/T7.md"
run fs "$spec" T7 --force
[ "$rc" = 2 ] && [ "$err" = "task-from-spec: $repo/.orch/tasks/T7.md is a symlink or cannot be read; left unchanged" ] &&
    [ "$(cat "$repo/victim2.md")" = INSIDE-VICTIM ] && [ -L "$repo/.orch/tasks/T7.md" ] || fail "a symlinked task file with --force: $rc $err"
run fs "$spec" T7
[ "$rc" = 1 ] && [ "$(cat "$repo/victim2.md")" = INSIDE-VICTIM ] || fail "a symlinked task file without --force: $rc"
ln -s "$tmp/outside/notes.md" "$repo/.orch/tasks/T8.md"
run fs "$spec" T8 --force
[ "$rc" = 2 ] && [ "$(cat "$tmp/outside/notes.md")" = OUTSIDE-MARKER ] || fail "a task file linked outside the repo: $rc"
rm -f "$repo/.orch/tasks/T7.md" "$repo/.orch/tasks/T8.md"

# ---------------------------------------------------------------- questions
qfile="$repo/.orch/taskdraft/T1/questions.md"
st() { (cd "$repo" && "$state" "$@"); }
two_blocks='QUESTION: Which review preset?
CONTEXT: egm-review gate: the reviewers to run
OPTIONS: standard | deep | quick

QUESTION: Name the new flag?
CONTEXT: egm-draft gate 2: the CLI flag name
OPTIONS: --title | --prefix
WAITING 2'
case_ "questions file written"
run st questions T1 put --role task-egm --spec none <<<"$two_blocks"
[ "$rc" = 0 ] && [ "$out" = '2 questions in .orch/taskdraft/T1/questions.md' ] || fail "questions put: $rc $out $err"
[ "$(cat "$qfile")" = '# task-draft T1: open questions
Role: task-egm
Spec: none

Write each answer after `A:` on the line under its question (one of the options, or your own text; `ok` takes the first option, the proposed answer). Then run `/junkd:task-draft T1` or the orch command again.

## Q1
Question: Which review preset?
Context: egm-review gate: the reviewers to run
Options: standard | deep | quick
A:

## Q2
Question: Name the new flag?
Context: egm-draft gate 2: the CLI flag name
Options: --title | --prefix
A:' ] || fail "questions.md: $(cat "$qfile")"
run st questions T1 answers
[ "$rc" = 4 ] && [ "$out" = 'role: task-egm
spec: none
Q1: Which review preset? | standard | deep | quick
Q2: Name the new flag? | --title | --prefix' ] || fail "answers with none answered: $rc $out"
cp "$qfile" "$tmp/q-before.md"
run st questions T1 put --role task-egm --spec none </dev/null
[ "$rc" = 2 ] && [ "$err" = 'task-draft-state: questions: no QUESTION: block on stdin' ] || fail "put with empty stdin: $rc $err"
cmp -s "$qfile" "$tmp/q-before.md" || fail "a refused put changed questions.md"
run st questions T1 put --role task-egm --spec none <<<$'QUESTION: q\nOPTIONS: a'
[ "$rc" = 2 ] && grep -qF 'questions: ' <<<"$err" || fail "a block with no CONTEXT: line: $rc $err"
run st questions T1 put --role task-egm --spec none <<<$'QUESTION: q\nCONTEXT: c'
[ "$rc" = 2 ] && [ "$err" = 'task-draft-state: questions: a block lacks one of its three lines' ] || fail "a block with no OPTIONS: line: $rc $err"
run st questions T1 put --role task-egm --spec none <<<$'QUESTION: q\nCONTEXT: c\nQUESTION: r\nCONTEXT: c\nOPTIONS: a'
[ "$rc" = 2 ] && [ "$err" = 'task-draft-state: questions: a block lacks its OPTIONS: line' ] || fail "a block cut short by the next one: $rc $err"
run st questions T1 put --role task-egm --spec none <<<$'CONTEXT: c\nOPTIONS: a'
[ "$rc" = 2 ] || fail "a block with no QUESTION: line: $rc"
run st questions T1 put --role task-egm --spec none <<<$'QUESTION: \nCONTEXT: c\nOPTIONS: a'
[ "$rc" = 2 ] || fail "an empty QUESTION: line: $rc"
run st questions T1 put --role judge --spec none <<<"$two_blocks"
[ "$rc" = 2 ] && [ "$err" = "task-draft-state: questions: --role must be task-egm, task-elephant or task-draft, not 'judge'" ] || fail "put --role judge: $rc $err"
run st questions T1 put --role task-egm <<<"$two_blocks"
[ "$rc" = 2 ] || fail "put with no --spec: $rc"
run st questions _T1 put --role task-egm --spec none <<<"$two_blocks"
[ "$rc" = 2 ] || fail "put with a bad id: $rc"
run st questions T1 frob
[ "$rc" = 2 ] || fail "an unknown questions subcommand: $rc"
cmp -s "$qfile" "$tmp/q-before.md" || fail "a refused put changed questions.md"
# prose around the blocks and CRLF line ends are skipped; the role is kept as given
run st questions T9 put --role task-draft --spec docs/designs/greet.md <<<$'Here are my questions.\r\nQUESTION: Send these 3 files to non-local harnesses?\r\nCONTEXT: src/greet.py tools/run docs/designs/sibling.md\r\nOPTIONS: send | skip non-local\r\nWAITING 1\r'
[ "$rc" = 0 ] && [ "$out" = '1 questions in .orch/taskdraft/T9/questions.md' ] || fail "put with prose and CRLF: $rc $out $err"
grep -qx 'Options: send | skip non-local' "$repo/.orch/taskdraft/T9/questions.md" && grep -qx 'Spec: docs/designs/greet.md' "$repo/.orch/taskdraft/T9/questions.md" ||
    fail "put kept a CR or lost the spec: $(cat -A "$repo/.orch/taskdraft/T9/questions.md")"
case_ "questions writer safety"
mkdir -p "$repo/.orch/taskdraft/T10"
ln -s "$repo/victim.txt" "$repo/.orch/taskdraft/T10/questions.md"
run st questions T10 put --role task-egm --spec none <<<"$two_blocks"
[ "$rc" = 2 ] && [ "$(cat "$repo/victim.txt")" = VICTIM ] && [ -L "$repo/.orch/taskdraft/T10/questions.md" ] || fail "put onto a symlink: $rc $err"
run st questions T10 done
[ "$rc" = 2 ] && [ -L "$repo/.orch/taskdraft/T10/questions.md" ] || fail "done on a symlinked questions.md: $rc"
ln -s "$tmp/outside" "$repo/.orch/taskdraft/T11"
run st questions T11 put --role task-egm --spec none <<<"$two_blocks"
[ "$rc" = 2 ] && grep -qF 'resolves outside the repo' <<<"$err" && [ ! -e "$tmp/outside/questions.md" ] || fail "put through a folder linked outside: $rc $err"
rm -f "$repo/.orch/taskdraft/T11"
# a questions.md that is a folder: the mv fails (never moves the file into it) and put exits 2
mkdir -p "$repo/.orch/taskdraft/T12/questions.md"
run st questions T12 put --role task-egm --spec none <<<"$two_blocks"
[ "$rc" = 2 ] && [ "$err" = 'task-draft-state: questions: cannot replace .orch/taskdraft/T12/questions.md' ] && [ -z "$(ls -A "$repo/.orch/taskdraft/T12/questions.md")" ] ||
    fail "put onto a folder: $rc $err"
if ls -A "$repo/.orch/taskdraft/T12" | grep -q '^\.questions\.'; then fail "a failed put left its temp file"; fi
rm -rf "$repo/.orch/taskdraft/T12"
# fsz <cmd...>: run one command in the fixture repo with no room to write a byte into a regular file (ulimit -f 0,
# SIGXFSZ ignored so a write fails with EFBIG). stdin comes from a pipe and stdout+stderr go to a pipe, since a here-string
# or a redirect to a file could not be written either. Sets rc and both (stdout and stderr together).
fsz() {
    rc=0
    both=$(cd "$repo" && trap '' XFSZ && ulimit -f 0 && "$@" 2>&1) || rc=$?
}
fsz_works=1
(trap '' XFSZ; ulimit -f 0; printf x > "$tmp/fsz-probe") 2>/dev/null && fsz_works=0
rm -f "$tmp/fsz-probe"
if [ "$fsz_works" = 0 ]; then
    echo "  (skipped: ulimit -f 0 does not stop a write here)"
else
    # the temp file of put cannot be written: put exits 2, nothing reaches questions.md, no temp file is left
    fsz "$state" questions T13 put --role task-egm --spec none < <(printf '%s\n' "$two_blocks")
    [ "$rc" = 2 ] && [ "$both" = 'task-draft-state: questions: cannot write .orch/taskdraft/T13/questions.md' ] ||
        fail "put with the temp file not writable: $rc $both"
    [ ! -e "$repo/.orch/taskdraft/T13/questions.md" ] && [ ! -L "$repo/.orch/taskdraft/T13/questions.md" ] ||
        fail "a put whose temp write failed left a questions.md ($(fsize "$repo/.orch/taskdraft/T13/questions.md") bytes)"
    if ls -A "$repo/.orch/taskdraft/T13" | grep -q '^\.questions\.'; then fail "a put whose temp write failed left its temp file"; fi
    # the same over an existing questions.md: it keeps its bytes
    fsz "$state" questions T1 put --role task-elephant --spec none < <(printf '%s\n' "$two_blocks")
    [ "$rc" = 2 ] && [ "$both" = 'task-draft-state: questions: cannot write .orch/taskdraft/T1/questions.md' ] ||
        fail "put over questions.md with the temp file not writable: $rc $both"
    cmp -s "$qfile" "$tmp/q-before.md" || fail "a put whose temp write failed changed questions.md ($(fsize "$qfile") bytes)"
    if ls -A "$repo/.orch/taskdraft/T1" | grep -q '^\.questions\.'; then fail "a put whose temp write failed left its temp file in T1"; fi
fi
rm -rf "$repo/.orch/taskdraft/T13"
# the task's folder cannot be made: put exits 2 with the mkdir message, not a later one
chmod 555 "$repo/.orch/taskdraft"
if [ -w "$repo/.orch/taskdraft" ]; then
    echo "  (skipped: a read-only folder is writable for this user)"
else
    run st questions T15 put --role task-egm --spec none <<<"$two_blocks"
    chmod 755 "$repo/.orch/taskdraft"
    [ "$rc" = 2 ] && [ -z "$out" ] && [ "$err" = 'task-draft-state: questions: cannot make .orch/taskdraft/T15' ] ||
        fail "put with .orch/taskdraft read-only: $rc $out $err"
    [ ! -e "$repo/.orch/taskdraft/T15" ] || fail "put made .orch/taskdraft/T15 although mkdir failed"
fi
chmod 755 "$repo/.orch/taskdraft"
# nothing is made outside the repo: .orch/taskdraft linked outside, the task's folder not there yet
r3="$tmp/r3"
mkdir -p "$r3/.orch" "$tmp/outside2"
git -C "$r3" init -q
ln -s "$tmp/outside2" "$r3/.orch/taskdraft"
run at "$r3" env "$state" questions T14 put --role task-egm --spec none <<<"$two_blocks"
[ "$rc" = 2 ] && [ -z "$(ls -A "$tmp/outside2")" ] || fail "put made a folder outside the repo before the fence: $rc $(ls -A "$tmp/outside2")"
case_ "answers consumed and file deleted"
first_a 'A:   deep  ' "$qfile"
sed_i 's/^A:$/A: --title/' "$qfile"
cp "$qfile" "$tmp/q-answered.md"
run st questions T1 answers
[ "$rc" = 0 ] && [ "$out" = 'role: task-egm
spec: none
A1: Which review preset? => deep
A2: Name the new flag? => --title' ] || fail "answers with both answered: $rc $out"
cmp -s "$qfile" "$tmp/q-answered.md" || fail "answers changed questions.md"
rm -f "$repo/.orch/decisions.md"
run st questions T1 done
[ "$rc" = 0 ] && [ "$out" = 'questions: removed .orch/taskdraft/T1/questions.md' ] && [ ! -e "$qfile" ] || fail "done: $rc $out"
run st questions T1 answers
[ "$rc" = 1 ] && [ -z "$out" ] || fail "answers after done: $rc $out"
run st questions T1 done
[ "$rc" = 0 ] && [ -z "$out" ] || fail "done with no file: $rc $out"
rm -f "$repo/.orch/decisions.md"
case_ "no task file while unanswered"
st questions T1 put --role task-egm --spec none <<<"$two_blocks" >/dev/null
rm -f "$task"
for force in '' --force; do
    # shellcheck disable=SC2086
    run fs "$spec" T1 $force
    [ "$rc" = 4 ] && [ "$err" = 'task-from-spec: questions are open in .orch/taskdraft/T1/questions.md' ] && [ ! -e "$task" ] || fail "task-from-spec $force with questions open: $rc $err"
done
run fs "$spec" T3 --force
cp "$t3" "$tmp/t3.md"
mkdir -p "$repo/.orch/taskdraft/T3"
# a dangling link counts too (a file or a link)
ln -s "$repo/no-such-questions.md" "$repo/.orch/taskdraft/T3/questions.md"
run fs "$spec" T3 --force
[ "$rc" = 4 ] && cmp -s "$t3" "$tmp/t3.md" || fail "a questions.md link does not count as open, or the task file changed: $rc"
rm -f "$repo/.orch/taskdraft/T3/questions.md"
st questions T1 done >/dev/null
run fs "$spec" T1
[ "$rc" = 0 ] && [ -f "$task" ] || fail "task-from-spec after questions done: $rc $err"

# ---------------------------------------------------------------- the decisions register
dfile="$repo/.orch/decisions.md"
cat > "$dfile" <<'MD'
# Decisions

## R1 (2026-11-08) Which review preset?
A: standard
source: chat

## R2 (2026-11-08) Where do settings live?
A: the egm group of the /junkd pane
source: spec D6
MD
case_ "decisions register answers a covered gate"
cp "$dfile" "$tmp/d-before.md"
run st decisions --match "review preset"
[ "$rc" = 0 ] && [ "$out" = '## R1 (2026-11-08) Which review preset?
A: standard
source: chat' ] || fail "decisions --match review preset: $rc $out"
cmp -s "$dfile" "$tmp/d-before.md" || fail "decisions --match changed the file"
run st decisions --match "REVIEW PRESET"
[ "$rc" = 0 ] && [ "$(head -1 <<<"$out")" = '## R1 (2026-11-08) Which review preset?' ] || fail "--match is not case-insensitive"
run st decisions --match "/junkd pane"
[ "$rc" = 0 ] && [ "$(head -1 <<<"$out")" = '## R2 (2026-11-08) Where do settings live?' ] && [ $(( $(wc -l <<<"$out") )) = 3 ] || fail "--match on an A: line: $out"
run st decisions --match "2026-11-08"
[ "$rc" = 0 ] && [ "$out" = '## R1 (2026-11-08) Which review preset?
A: standard
source: chat

## R2 (2026-11-08) Where do settings live?
A: the egm group of the /junkd pane
source: spec D6' ] || fail "two matched blocks are not separated by one blank line: $out"
run st decisions --match "spec D6"
[ "$rc" = 1 ] && [ -z "$out" ] || fail "a source: line matched: $rc $out"
run st decisions --match "Decisions"
[ "$rc" = 1 ] || fail "the # Decisions title counted as a block"
run st decisions --match "a.c"
[ "$rc" = 1 ] || fail "--match is not a fixed string"
run st decisions
[ "$rc" = 0 ] && [ "$out" = "$(cat "$dfile")" ] || fail "decisions with no --match does not print the file"
mv "$dfile" "$tmp/d-saved.md"
run st decisions
[ "$rc" = 0 ] && [ -z "$out" ] || fail "decisions with no file: $rc $out"
run st decisions --match "review preset"
[ "$rc" = 1 ] && [ -z "$out" ] || fail "decisions --match with no file: $rc"
mv "$tmp/d-saved.md" "$dfile"
rc=0; git -C "$repo" check-ignore -q .orch/decisions.md || rc=$?
[ "$rc" = 1 ] || fail "git check-ignore .orch/decisions.md exited $rc in the fixture repo"
run at "$tmp" env "$state" decisions
[ "$rc" = 2 ] || fail "decisions outside a git repo exited $rc"
case_ "uncovered questions batched"
run st decisions --match "dark mode scope"
[ "$rc" = 1 ] && [ -z "$out" ] || fail "decisions --match dark mode scope: $rc $out"
run st questions T1 put --role task-egm --spec none <<<'QUESTION: Which toggle?
CONTEXT: egm-draft gate 1
OPTIONS: x | y
QUESTION: Dark mode scope?
CONTEXT: egm-draft gate 1
OPTIONS: pages | app
QUESTION: Anything else?
CONTEXT: egm-draft gate 1
OPTIONS: (free text)
WAITING 3'
[ "$rc" = 0 ] && [ "$out" = '3 questions in .orch/taskdraft/T1/questions.md' ] || fail "three blocks: $rc $out"
[ "$(grep -c '^## Q[1-3]$' "$qfile")" = 3 ] || fail "questions.md lacks Q1 to Q3"
awk 'BEGIN { n = 0 } /^A:$/ { n++; if (n == 1) $0 = "A: ok"; else if (n == 2) $0 = "A: z"; else $0 = "A: ok" } { print }' "$qfile" > "$tmp/q3" && cat "$tmp/q3" > "$qfile"
run st questions T1 answers
[ "$rc" = 4 ] && [ "$out" = 'role: task-egm
spec: none
A1: Which toggle? => x
A2: Dark mode scope? => z
Q3: Anything else? | (free text)' ] || fail "answers with ok, z, ok on free text: $rc $out"
sed_i 's/^A: ok$/A: OK/' "$qfile"
run st questions T1 answers
grep -qx 'A1: Which toggle? => x' <<<"$out" || fail "OK in capitals is not the first option"
cp "$dfile" "$tmp/d-before.md"
run st decisions add T1 --source chat <<<'A1: Dark mode scope? => pages
noise line
A2: Which toggle? => y'
[ "$rc" = 0 ] && [ "$out" = 'decisions: 2 added to .orch/decisions.md' ] || fail "decisions add: $rc $out $err"
today=$(date +%F)
[ "$(cat "$dfile")" = "$(cat "$tmp/d-before.md")

## R3 ($today) Dark mode scope?
A: pages
source: chat

## R4 ($today) Which toggle?
A: y
source: chat" ] || fail "decisions add appended: $(cat "$dfile")"
run st decisions add T1 --source D7 <<<'A1: Where? => here => there'
[ "$rc" = 0 ] && [ "$(tail -3 "$dfile")" = "## R5 ($today) Where?
A: here => there
source: spec D7" ] || fail "decisions add --source D7: $(tail -3 "$dfile")"
printf '\n## R41 (2026-01-01) Old\nA: x\nsource: chat\n\n\n' >> "$dfile"
run st decisions add T1 --source questions <<<'A1: Next? => yes'
[ "$(tail -3 "$dfile")" = "## R42 ($today) Next?
A: yes
source: questions.md of task T1" ] || fail "R numbering does not follow the highest R: $(tail -4 "$dfile")"
[ "$(tail -6 "$dfile" | tr '\n' '|')" = "A: x|source: chat||## R42 ($today) Next?|A: yes|source: questions.md of task T1|" ] || fail "the trailing blank lines were not cut to one: $(tail -6 "$dfile" | cat -A)"
run st decisions add T1 --source auto <<<'A1: Auto? => picked'
[ "$(tail -3 "$dfile")" = "## R43 ($today) Auto?
A: picked
source: auto (task T1)" ] || fail "decisions add --source auto: $(tail -4 "$dfile")"
cp "$dfile" "$tmp/d-before.md"
for badsrc in web D Dx questions.md AUTO auto2 ''; do
    run st decisions add T1 --source "$badsrc" <<<'A1: q => a'
    [ "$rc" = 2 ] || fail "decisions add --source '$badsrc' exited $rc"
done
run st decisions add T1 <<<'A1: q => a'
[ "$rc" = 2 ] || fail "decisions add with no --source exited $rc"
run st decisions add _T1 --source chat <<<'A1: q => a'
[ "$rc" = 2 ] || fail "decisions add with a bad id exited $rc"
run st decisions add T1 --source chat <<<'no answers here
Q1: open | x'
[ "$rc" = 2 ] && [ "$err" = 'task-draft-state: decisions: no A<n>: <question> => <answer> line on stdin' ] || fail "decisions add with no A<n>: line: $rc $err"
cmp -s "$dfile" "$tmp/d-before.md" || fail "a refused add changed decisions.md"
if [ "$fsz_works" = 1 ]; then
    # the temp file of add cannot be written: add exits 2, decisions.md keeps its bytes, no temp file is left
    fsz "$state" decisions add T1 --source chat < <(printf 'A1: q => a\n')
    [ "$rc" = 2 ] && [ "$both" = 'task-draft-state: decisions: cannot write .orch/decisions.md' ] ||
        fail "decisions add with the temp file not writable: $rc $both"
    cmp -s "$dfile" "$tmp/d-before.md" || fail "a decisions add whose temp write failed changed decisions.md ($(fsize "$dfile") bytes)"
    if ls -A "$repo/.orch" | grep -q '^\.decisions\.'; then fail "a decisions add whose temp write failed left its temp file"; fi
    # the decisions copy of questions done: exit 2, decisions.md keeps its bytes, questions.md is kept
    st questions T16 put --role task-egm --spec none <<<"$two_blocks" >/dev/null
    sed_i 's/^A:$/A: ok/' "$repo/.orch/taskdraft/T16/questions.md"
    cp "$repo/.orch/taskdraft/T16/questions.md" "$tmp/q16.md"
    fsz "$state" questions T16 done </dev/null
    [ "$rc" = 2 ] && [ "$both" = 'task-draft-state: decisions: cannot write .orch/decisions.md' ] ||
        fail "done with the decisions temp file not writable: $rc $both"
    cmp -s "$dfile" "$tmp/d-before.md" || fail "a done whose decisions temp write failed changed decisions.md ($(fsize "$dfile") bytes)"
    cmp -s "$repo/.orch/taskdraft/T16/questions.md" "$tmp/q16.md" || fail "a done whose decisions copy failed removed or changed questions.md"
    if ls -A "$repo/.orch" | grep -q '^\.decisions\.'; then fail "a done whose decisions temp write failed left a temp file"; fi
    rm -rf "$repo/.orch/taskdraft/T16"
fi
mv "$dfile" "$tmp/d-saved.md"
ln -s "$repo/victim.txt" "$dfile"
run st decisions add T1 --source chat <<<'A1: q => a'
[ "$rc" = 2 ] && [ "$(cat "$repo/victim.txt")" = VICTIM ] && [ -L "$dfile" ] || fail "decisions add onto a symlink: $rc $err"
rm -f "$dfile"
mv "$tmp/d-saved.md" "$dfile"
case_ "answers copied to decisions.md before questions.md is deleted"
mv "$dfile" "$tmp/d-saved.md"
st questions T1 put --role task-egm --spec none <<<"$two_blocks" >/dev/null
first_a 'A: ok' "$qfile"
sed_i 's/^A:$/A: --prefix/' "$qfile"
run st questions T1 done
[ "$rc" = 0 ] && [ "$out" = 'questions: removed .orch/taskdraft/T1/questions.md' ] && [ ! -e "$qfile" ] || fail "done with role task-egm: $rc $out $err"
[ "$(cat "$dfile")" = "# Decisions

## R1 ($today) Which review preset?
A: standard
source: questions.md of task T1

## R2 ($today) Name the new flag?
A: --prefix
source: questions.md of task T1" ] || fail "done did not copy the answers: $(cat "$dfile")"
cp "$dfile" "$tmp/d-copy.md"
rm -f "$dfile"
ln -s "$repo/victim.txt" "$dfile"
st questions T1 put --role task-elephant --spec docs/designs/greet.md <<<"$two_blocks" >/dev/null
sed_i 's/^A:$/A: ok/' "$qfile"
run st questions T1 done
[ "$rc" = 2 ] && grep -qF 'task-draft-state: decisions: ' <<<"$err" && [ -f "$qfile" ] && [ "$(cat "$repo/victim.txt")" = VICTIM ] || fail "done with decisions.md a symlink: $rc $err"
rm -f "$dfile"
cp "$tmp/d-copy.md" "$dfile"
run st questions T1 done
[ "$rc" = 0 ] && [ ! -e "$qfile" ] && [ "$(grep -c '^## R' "$dfile")" = 4 ] && grep -qx 'A: standard' "$dfile" || fail "done with role task-elephant: $rc $(cat "$dfile")"
cp "$dfile" "$tmp/d-before.md"
st questions T1 put --role task-draft --spec docs/designs/greet.md <<<$'QUESTION: Send these 3 files to non-local harnesses?\nCONTEXT: the list\nOPTIONS: send | skip non-local' >/dev/null
sed_i 's/^A:$/A: send/' "$qfile"
run st questions T1 done
[ "$rc" = 0 ] && [ ! -e "$qfile" ] && cmp -s "$dfile" "$tmp/d-before.md" || fail "done with role task-draft changed decisions.md: $rc"
st questions T1 put --role task-egm --spec none <<<"$two_blocks" >/dev/null
run st questions T1 done
[ "$rc" = 0 ] && [ ! -e "$qfile" ] && cmp -s "$dfile" "$tmp/d-before.md" || fail "done with nothing answered: $rc $err"
rm -f "$dfile"
mv "$tmp/d-saved.md" "$dfile"
mv "$repo/.orch" "$repo/.orch-real"
ln -s "$tmp/outside" "$repo/.orch"
run st decisions add T1 --source chat <<<'A1: q => a'
[ "$rc" = 2 ] && [ ! -e "$tmp/outside/decisions.md" ] || fail "decisions add with .orch linked outside: $rc $err"
rm -f "$repo/.orch"
mv "$repo/.orch-real" "$repo/.orch"

case_ "done keeps questions.md when the decisions copy fails"
want=$(printf '%o' $(( 0666 & ~0$(umask) )))
st questions T1 put --role task-egm --spec none <<<"$two_blocks" >/dev/null
[ "$(fmode "$qfile")" = "$want" ] || fail "questions.md is mode $(fmode "$qfile"), not the umask's $want"
sed_i 's/^A:$/A: ok/' "$qfile"
cp "$qfile" "$tmp/q-kept.md"
cp "$dfile" "$tmp/d-before.md"
chmod 555 "$repo/.orch"
if [ -w "$repo/.orch" ]; then
    echo "  (skipped: a read-only folder is writable for this user)"
else
    run st questions T1 done
    chmod 755 "$repo/.orch"
    [ "$rc" = 2 ] && [ "$err" = 'task-draft-state: decisions: cannot write in .orch/' ] || fail "done with .orch/ read-only: $rc $out $err"
    [ -f "$qfile" ] && cmp -s "$qfile" "$tmp/q-kept.md" || fail "done deleted or changed questions.md after a failed copy"
    cmp -s "$dfile" "$tmp/d-before.md" || fail "a failed copy changed decisions.md"
    if ls -A "$repo/.orch" | grep -q '^\.decisions\.'; then fail "a failed copy left a temp file in .orch/"; fi
    chmod 555 "$repo/.orch"
    run st decisions add T1 --source chat <<<'A1: q => a'
    chmod 755 "$repo/.orch"
    [ "$rc" = 2 ] && cmp -s "$dfile" "$tmp/d-before.md" || fail "decisions add into a read-only .orch/: $rc $err"
fi
chmod 755 "$repo/.orch"
run st questions T1 done
[ "$rc" = 0 ] && [ ! -e "$qfile" ] && [ "$(fmode "$dfile")" = "$want" ] || fail "done after the folder is writable again: $rc, decisions.md mode $(fmode "$dfile")"
case_ "done exits 2 when questions.md cannot be removed"
st questions T1 put --role task-egm --spec none <<<"$two_blocks" >/dev/null
sed_i 's/^A:$/A: ok/' "$qfile"
before=$(grep -c '^## R' "$dfile")
top=$(sed -n 's/^## R\([0-9][0-9]*\) .*/\1/p' "$dfile" | sort -n | tail -1)
chmod 555 "$repo/.orch/taskdraft/T1"
if [ -w "$repo/.orch/taskdraft/T1" ]; then
    echo "  (skipped: a read-only folder is writable for this user)"
else
    run st questions T1 done
    chmod 755 "$repo/.orch/taskdraft/T1"
    [ "$rc" = 2 ] && [ -z "$out" ] && [ "$err" = 'task-draft-state: questions: cannot remove .orch/taskdraft/T1/questions.md' ] ||
        fail "done with questions.md not removable: $rc $out $err"
    [ -f "$qfile" ] || fail "questions.md is gone although rm failed"
    [ "$(grep -c '^## R' "$dfile")" = $((before + 2)) ] && [ "$(tail -3 "$dfile")" = "## R$((top + 2)) ($today) Name the new flag?
A: --title
source: questions.md of task T1" ] || fail "decisions.md does not hold the copied answers before the failed rm: $(tail -8 "$dfile")"
fi
chmod 755 "$repo/.orch/taskdraft/T1"
rm -f "$qfile"

# ---------------------------------------------------------------- safe writes: failure injection
# Every writer of task-draft-state goes through one _safe_write. Each of its steps, and each read that produces the
# content, is made to fail in turn for every writer: put (new file), put (over a file), decisions add, and the
# decisions copy of questions done. Each must exit 2 with that step's own line, leave every target as it was (or
# absent), keep questions.md on done, and leave no temp file.
inj="$tmp/inj"
mkdir -p "$inj"
# One stub per tool, first on PATH: each runs the real tool unless INJ names it. INJ=<tool> exits 1. INJ=cat-empty:
# a bare `cat` swallows stdin and writes nothing. INJ=awk-on: awk exits 1 when an argument holds INJ_AWK, so each awk
# read fails on its own; INJ=awk-mute: that awk exits 0 and prints nothing. INJ=mkdir-plant: the real mkdir, then PLANT becomes a link to PLANT_TO (as if planted after
# the fence). INJ=mkdir-move: the real mkdir, then the folder PLANT moves to PLANT_TO and PLANT links there.
# INJ=mktemp-link / mktemp-dir: the real mktemp, then its file is swapped for a link to PLANT_TO, or a folder, and
# mktemp exits 0 with that path.
for t in awk cat chmod date mkdir mktemp mv; do
    {
        printf '#!/usr/bin/env bash\nreal=%q\nt=%q\n' "$(command -v "$t")" "$t"
        cat <<'STUB'
case "${INJ:-}" in
    "$t") exit 1 ;;
    cat-empty) if [ "$t" = cat ] && [ $# -eq 0 ]; then "$real" >/dev/null; exit 0; fi ;;
    awk-on) if [ "$t" = awk ]; then for a in "$@"; do case "$a" in *"$INJ_AWK"*) exit 1 ;; esac; done; fi ;;
    awk-mute) if [ "$t" = awk ]; then for a in "$@"; do case "$a" in *"$INJ_AWK"*) exit 0 ;; esac; done; fi ;;
    mkdir-plant) if [ "$t" = mkdir ]; then "$real" "$@" || exit; rm -f -- "$PLANT"; ln -s -- "$PLANT_TO" "$PLANT"; exit 0; fi ;;
    mkdir-move) if [ "$t" = mkdir ]; then "$real" "$@" || exit; mv -- "$PLANT" "$PLANT_TO"; ln -s -- "$PLANT_TO" "$PLANT"; exit 0; fi ;;
    mktemp-link) if [ "$t" = mktemp ]; then p=$("$real" "$@") || exit; rm -f -- "$p"; ln -s -- "$PLANT_TO" "$p"; printf '%s\n' "$p"; exit 0; fi ;;
    mktemp-dir) if [ "$t" = mktemp ]; then p=$("$real" "$@") || exit; rm -f -- "$p"; mkdir -- "$p"; printf '%s\n' "$p"; exit 0; fi ;;
esac
exec "$real" "$@"
STUB
    } > "$inj/$t"
    chmod +x "$inj/$t"
done
tpfile="$repo/.orch/taskdraft/TP/questions.md"
tdfile="$repo/.orch/taskdraft/TD/questions.md"
# ij <writer> [VAR=value...]: run one writer in the fixture repo with the stubs first on PATH.
# P1 put (new questions.md), P2 put (over T1's), A decisions add, D questions done (role task-egm, both answered).
ij() {
    local w="$1"
    shift
    case "$w" in
        P1) run at "$repo" env PATH="$inj:$PATH" "$@" "$state" questions TP put --role task-egm --spec none <<<"$two_blocks" ;;
        P2) run at "$repo" env PATH="$inj:$PATH" "$@" "$state" questions T1 put --role task-elephant --spec none <<<"$two_blocks" ;;
        A) run at "$repo" env PATH="$inj:$PATH" "$@" "$state" decisions add T1 --source chat <<<'A1: q => a' ;;
        D) run at "$repo" env PATH="$inj:$PATH" "$@" "$state" questions TD done </dev/null ;;
    esac
}
# prep <writer>: the files the writer starts from, saved for kept.
prep() {
    case "$1" in
        P1) rm -rf "$repo/.orch/taskdraft/TP"; snap "$tpfile" ;;
        P2) snap "$qfile" ;;
        A) snap "$dfile" ;;
        D) st questions TD put --role task-egm --spec none <<<"$two_blocks" >/dev/null
           sed_i 's/^A:$/A: ok/' "$tdfile"
           snap "$tdfile" "$dfile" ;;
    esac
}
snap() {
    local i=0 f
    snapped=("$@")
    rm -rf "$tmp/snap" && mkdir "$tmp/snap"
    for f; do i=$((i + 1)); if [ -e "$f" ]; then cp -- "$f" "$tmp/snap/$i"; fi; done
}
# kept <label>: every snapped file is still a regular file with the same bytes (or still absent); no temp file.
kept() {
    local i=0 f
    for f in ${snapped[@]+"${snapped[@]}"}; do
        i=$((i + 1))
        if [ -e "$tmp/snap/$i" ]; then
            [ -f "$f" ] && [ ! -L "$f" ] && cmp -s "$f" "$tmp/snap/$i" || fail "$1: ${f#"$repo"/} was changed or removed"
        else
            [ ! -e "$f" ] && [ ! -L "$f" ] || fail "$1: ${f#"$repo"/} was made"
        fi
    done
    [ -z "$(find "$repo/.orch" \( -name '.questions.*' -o -name '.decisions.*' \) -print)" ] ||
        fail "$1: a temp file was left: $(find "$repo/.orch" \( -name '.questions.*' -o -name '.decisions.*' \) -print)"
}
# restore: put the snapped files back (a planted link replaced one of them).
restore() {
    local i=0 f
    for f in ${snapped[@]+"${snapped[@]}"}; do
        i=$((i + 1))
        rm -f -- "$f"
        if [ -e "$tmp/snap/$i" ]; then cp -- "$tmp/snap/$i" "$f"; fi
    done
}
# rel_of / what_of <writer>: the target the writer writes, and the word its lines start with.
rel_of() { case "$1" in P1) echo .orch/taskdraft/TP/questions.md ;; P2) echo .orch/taskdraft/T1/questions.md ;; *) echo .orch/decisions.md ;; esac; }
what_of() { case "$1" in P*) echo questions ;; *) echo decisions ;; esac; }
done_tidy() { rm -rf "$repo/.orch/taskdraft/TD" "$repo/.orch/taskdraft/TP"; }

case_ "safe write: the stubs alone change nothing"
st questions T1 put --role task-egm --spec none <<<"$two_blocks" >/dev/null
ij P1 INJ=none
[ "$rc" = 0 ] && [ "$out" = '2 questions in .orch/taskdraft/TP/questions.md' ] && [ -z "$err" ] || fail "put through the stubs: $rc $out $err"
done_tidy

case_ "safe write: each step fails closed for each writer"
for w in P1 P2 A D; do
    rel=$(rel_of "$w")
    what=$(what_of "$w")
    reldir=${rel%/*}
    for step in mkdir mktemp cat cat-empty chmod mv; do
        case "$step" in
            mkdir) want="$what: cannot make $reldir" ;;
            mktemp) want="$what: cannot write in $reldir/" ;;
            cat) want="$what: cannot write $rel" ;;
            cat-empty) want="$what: nothing was written for $rel; left unchanged" ;;
            chmod) want="$what: cannot set the mode of $rel" ;;
            mv) want="$what: cannot replace $rel" ;;
        esac
        prep "$w"
        ij "$w" INJ="$step"
        [ "$rc" = 2 ] && [ -z "$out" ] && [ "$err" = "task-draft-state: $want" ] || fail "$w with $step failing: $rc $out $err"
        kept "$w with $step failing"
        done_tidy
    done
done

case_ "safe write: a failed read never reaches the write"
# writer | the awk call that fails (a piece of its program) | the line
while IFS='|' read -r w pat want; do
    prep "$w"
    ij "$w" INJ=awk-on INJ_AWK="$pat"
    [ "$rc" = 2 ] && [ -z "$out" ] && [ "$err" = "task-draft-state: $want" ] || fail "$w with the awk read '$pat' failing: $rc $out $err"
    kept "$w with the awk read '$pat' failing"
    done_tidy
done <<'ROWS'
P1|/^QUESTION:/|questions: cannot read the blocks on stdin
P2|/^QUESTION:/|questions: cannot read the blocks on stdin
A|start + k|decisions: cannot read the A<n>: lines on stdin
A|match($0, /^## R|decisions: cannot read .orch/decisions.md
A|line[NR] = $0|decisions: cannot read .orch/decisions.md
D|/^Role:/|questions: cannot read .orch/taskdraft/TD/questions.md
D|start + k|decisions: cannot read the A<n>: lines on stdin
D|match($0, /^## R|decisions: cannot read .orch/decisions.md
D|line[NR] = $0|decisions: cannot read .orch/decisions.md
ROWS
# a read that exits 0 but prints no count is refused too
while IFS='|' read -r w pat want; do
    prep "$w"
    ij "$w" INJ=awk-mute INJ_AWK="$pat"
    [ "$rc" = 2 ] && [ -z "$out" ] && [ "$err" = "task-draft-state: $want" ] || fail "$w with the awk read '$pat' printing nothing: $rc $out $err"
    kept "$w with the awk read '$pat' printing nothing"
    done_tidy
done <<'ROWS'
P1|/^QUESTION:/|questions: the blocks on stdin gave no count
P2|/^QUESTION:/|questions: the blocks on stdin gave no count
A|start + k|decisions: the A<n>: lines on stdin gave no count
A|match($0, /^## R|decisions: .orch/decisions.md gave no R number
D|start + k|decisions: the A<n>: lines on stdin gave no count
D|match($0, /^## R|decisions: .orch/decisions.md gave no R number
ROWS
for w in A D; do
    prep "$w"
    ij "$w" INJ=date
    [ "$rc" = 2 ] && [ "$err" = "task-draft-state: decisions: cannot read today's date" ] || fail "$w with date failing: $rc $err"
    kept "$w with date failing"
    done_tidy
done

case_ "safe write: a temp path that is not a regular file is refused and left in place"
cp "$repo/victim.txt" "$tmp/victim-before"
for kind in link dir; do
    for w in P1 P2 A D; do
        rel=$(rel_of "$w")
        reldir=${rel%/*}
        case "$rel" in */questions.md) pre=.questions. ;; *) pre=.decisions. ;; esac
        prep "$w"
        ij "$w" INJ="mktemp-$kind" PLANT_TO="$repo/victim.txt"
        [ "$rc" = 2 ] && [ -z "$out" ] && [ "$err" = "task-draft-state: $(what_of "$w"): cannot write in $reldir/" ] ||
            fail "$w with mktemp giving a $kind: $rc $out $err"
        cmp -s "$repo/victim.txt" "$tmp/victim-before" || fail "$w with mktemp giving a $kind wrote through it"
        # the planted path is not one mktemp made, so it is never removed: exactly one is there, still a link or a folder
        planted=$(find "$repo/$reldir" -maxdepth 1 -name "$pre*" -print)
        [ -n "$planted" ] && [ $(( $(printf '%s\n' "$planted" | wc -l) )) = 1 ] || fail "$w with mktemp giving a $kind: planted path gone or doubled: '$planted'"
        if [ "$kind" = link ]; then
            [ -L "$planted" ] && [ "$(readlink "$planted")" = "$repo/victim.txt" ] || fail "$w removed or changed the planted temp link"
        else
            [ -d "$planted" ] && [ ! -L "$planted" ] && [ -z "$(ls -A "$planted")" ] || fail "$w removed or filled the planted temp folder"
        fi
        rm -rf -- "$planted"
        kept "$w with mktemp giving a $kind"
        done_tidy
    done
done

case_ "answers exits 2 when questions.md cannot be read"
# a failed _qparse must not read as "all answered" (exit 0, nothing printed)
prep D
run at "$repo" env PATH="$inj:$PATH" INJ=awk-on INJ_AWK='/^Role:/' "$state" questions TD answers
[ "$rc" = 2 ] && [ -z "$out" ] && [ "$err" = 'task-draft-state: questions: cannot read .orch/taskdraft/TD/questions.md' ] ||
    fail "answers with the questions.md read failing: $rc $out $err"
kept "answers with the questions.md read failing"
chmod 000 "$tdfile"
if [ -r "$tdfile" ]; then
    echo "  (skipped: a mode 000 file is readable for this user)"
else
    run st questions TD answers
    # awk's own error line comes first here (the script leaves awk's stderr open); the script's line is the last
    [ "$rc" = 2 ] && [ -z "$out" ] && [ "$(tail -1 <<<"$err")" = 'task-draft-state: questions: cannot read .orch/taskdraft/TD/questions.md' ] ||
        fail "answers with questions.md mode 000: $rc $out $err"
fi
chmod 644 "$tdfile"
kept "answers with questions.md mode 000"
done_tidy

case_ "safe write: a link planted on the target during mkdir is refused"
cp "$repo/victim.txt" "$tmp/victim-before"
for w in P1 P2 A D; do
    rel=$(rel_of "$w")
    prep "$w"
    ij "$w" INJ=mkdir-plant PLANT="$repo/$rel" PLANT_TO="$repo/victim.txt"
    [ "$rc" = 2 ] && [ -z "$out" ] && [ "$err" = "task-draft-state: $(what_of "$w"): $rel is a symlink; left unchanged" ] ||
        fail "$w with $rel planted as a link during mkdir: $rc $out $err"
    [ -L "$repo/$rel" ] && [ "$(readlink "$repo/$rel")" = "$repo/victim.txt" ] || fail "$w replaced the planted link $rel"
    cmp -s "$repo/victim.txt" "$tmp/victim-before" || fail "$w wrote through the planted link $rel"
    if [ "$w" = D ]; then cmp -s "$tdfile" "$tmp/snap/1" || fail "done removed questions.md after a refused copy"; fi
    restore
    kept "$w after the planted link"
    done_tidy
done

case_ "safe write: a link planted on a folder during mkdir is refused"
# put: the task's folder becomes a link to a folder inside the repo, so the fence passes and only the link check stops it
prep P1
ij P1 INJ=mkdir-move PLANT="$repo/.orch/taskdraft/TP" PLANT_TO="$repo/.orch/taskdraft/TP-real"
[ "$rc" = 2 ] && [ "$err" = 'task-draft-state: questions: .orch/taskdraft/TP is a symlink; left unchanged' ] || fail "put with its folder planted as a link: $rc $err"
[ -z "$(ls -A "$repo/.orch/taskdraft/TP-real")" ] || fail "put wrote through its planted folder link: $(ls -A "$repo/.orch/taskdraft/TP-real")"
rm -f "$repo/.orch/taskdraft/TP"
rm -rf "$repo/.orch/taskdraft/TP-real"
kept "put after the planted folder link"
# add and done: .orch itself becomes a link to .orch-real
for w in A D; do
    prep "$w"
    ij "$w" INJ=mkdir-move PLANT="$repo/.orch" PLANT_TO="$repo/.orch-real"
    rm -f "$repo/.orch"
    mv "$repo/.orch-real" "$repo/.orch"
    [ "$rc" = 2 ] && [ "$err" = 'task-draft-state: decisions: .orch is a symlink; left unchanged' ] || fail "$w with .orch planted as a link: $rc $err"
    kept "$w after .orch was planted as a link"
    done_tidy
done
# a folder that is a link already (to a folder inside the repo) is refused before mkdir: nothing is made through it
r4="$tmp/r4"
mkdir -p "$r4/.orch/td-real"
git -C "$r4" init -q
ln -s "$r4/.orch/td-real" "$r4/.orch/taskdraft"
run at "$r4" env "$state" questions TL put --role task-egm --spec none <<<"$two_blocks"
[ "$rc" = 2 ] && [ "$err" = 'task-draft-state: questions: .orch/taskdraft is a symlink; left unchanged' ] && [ -z "$(ls -A "$r4/.orch/td-real")" ] ||
    fail "put through a folder link inside the repo: $rc $err $(ls -A "$r4/.orch/td-real")"

case_ "safe write: a folder in place of decisions.md"
mv "$dfile" "$tmp/d-saved.md"
mkdir "$dfile"
run st decisions add T1 --source chat <<<'A1: q => a'
[ "$rc" = 2 ] && [ "$err" = 'task-draft-state: decisions: cannot replace .orch/decisions.md' ] && [ -d "$dfile" ] && [ -z "$(ls -A "$dfile")" ] ||
    fail "decisions add onto a folder: $rc $err"
rmdir "$dfile"
mv "$tmp/d-saved.md" "$dfile"
snapped=()
kept "decisions add onto a folder"
rm -f "$qfile"

case_ "--file input of put and decisions add"
# the orch guard lets the main loop run a helper with plain arguments only (no pipe, no <), so both writers also read
# their input from a file
printf '%s\n' "$two_blocks" > "$tmp/blocks.md"
st questions TF put --role task-egm --spec none <<<"$two_blocks" >/dev/null
cp "$repo/.orch/taskdraft/TF/questions.md" "$tmp/q-stdin.md"
run st questions TF put --role task-egm --spec none --file "$tmp/blocks.md" </dev/null
[ "$rc" = 0 ] && [ "$out" = '2 questions in .orch/taskdraft/TF/questions.md' ] && cmp -s "$repo/.orch/taskdraft/TF/questions.md" "$tmp/q-stdin.md" ||
    fail "put --file: $rc $out $err"
rm -rf "$repo/.orch/taskdraft/TF"
before=$(grep -c '^## R' "$dfile")
printf 'A1: File question? => file answer\n' > "$tmp/answers.md"
run st decisions add T1 --source chat --file "$tmp/answers.md" </dev/null
[ "$rc" = 0 ] && [ "$out" = 'decisions: 1 added to .orch/decisions.md' ] && [ "$(grep -c '^## R' "$dfile")" = $((before + 1)) ] &&
    [ "$(tail -2 "$dfile")" = 'A: file answer
source: chat' ] || fail "decisions add --file: $rc $out $err"
cp "$dfile" "$tmp/d-before.md"
for f in "$tmp/none.md" "$tmp"; do
    run st decisions add T1 --source chat --file "$f" </dev/null
    [ "$rc" = 2 ] && [ "$err" = "task-draft-state: decisions: --file $f is not a file that can be read" ] || fail "decisions add --file $f: $rc $err"
    run st questions TF put --role task-egm --spec none --file "$f" </dev/null
    [ "$rc" = 2 ] && [ "$err" = "task-draft-state: questions: --file $f is not a file that can be read" ] && [ ! -e "$repo/.orch/taskdraft/TF" ] ||
        fail "put --file $f: $rc $err"
done
cmp -s "$dfile" "$tmp/d-before.md" || fail "a failed --file changed decisions.md"
run st decisions add T1 --source chat --file
[ "$rc" = 2 ] && [ "$err" = 'task-draft-state: decisions: --file takes a path' ] || fail "decisions add --file with no path: $rc $err"

echo "task-draft tests passed"
