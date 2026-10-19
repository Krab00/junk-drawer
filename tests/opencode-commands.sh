#!/usr/bin/env bash
# bin/opencode-commands.sh over temp dirs: one wrapper per skill, statusline skipped, a hand-written file kept, and a
# description that ends on a word boundary (the first sentence when it fits in 100 characters, else whole words
# plus "..."), never cut inside a word.
# Run: bash tests/opencode-commands.sh. Every check is an explicit `if`/`[ ]` so `set -e` catches it.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/T15-occmd-$$.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
fail() { echo "opencode-commands tests: $*" >&2; exit 1; }

skill() { # <name> <description>
    mkdir -p "$tmp/skills/$1"
    printf -- '---\nname: %s\ndescription: %s\n---\n\n# %s\n' "$1" "$2" "$1" > "$tmp/skills/$1/SKILL.md"
}
desc_of() { sed -n 's/^description: "\(.*\)"$/\1/p' "$tmp/out/$1.md"; }

# one long first sentence, no period within 100 chars: whole words, then "..."
long="Orchestrate implementation and independent verification of one task or a backlog using specialized subagents, isolated Git worktrees. Use when asked."
skill longone "$long"
# a short first sentence: that sentence alone
skill sentence "Save a durable Markdown handoff for the current task. Use when work should continue in a fresh session or task, before switching context."
# shorter than the limit, no sentence end: as it is
skill short "Resume a saved handoff by short id"
# a word that would straddle the cut: the 100-char cut falls inside "verification"
skill straddle "Drain a backlog with implementation agents and then run a long and very thorough independent verification pass on all of it"
# exactly 100 chars, no period: as it is
hundred=$(printf 'word%.0s ' $(seq 1 20) | cut -c1-99)x
skill hundred "$hundred"
skill statusline "Configure the status line"
mkdir -p "$tmp/out"
printf 'hand-written\n' > "$tmp/out/short.md"

out=$(sh "$root/bin/opencode-commands.sh" "$tmp/skills" "$tmp/out") || fail "the script exited non-zero"
[ ! -e "$tmp/out/statusline.md" ] || fail "statusline got a wrapper"
[ "$(cat "$tmp/out/short.md")" = hand-written ] || fail "a hand-written file was overwritten"
rg -qF "skip $tmp/out/short.md" <<<"$out" || fail "the skip of the hand-written file was not reported"
rm "$tmp/out/short.md"
sh "$root/bin/opencode-commands.sh" "$tmp/skills" "$tmp/out" >/dev/null || fail "the second run exited non-zero"

d=$(desc_of longone)
[ "$d" = "Orchestrate implementation and independent verification of one task or a backlog using..." ] ||
    fail "long description: got '$d'"
d=$(desc_of sentence)
[ "$d" = "Save a durable Markdown handoff for the current task." ] || fail "first sentence: got '$d'"
d=$(desc_of short)
[ "$d" = "Resume a saved handoff by short id" ] || fail "short description: got '$d'"
d=$(desc_of straddle)
[ "$d" = "Drain a backlog with implementation agents and then run a long and very thorough independent..." ] ||
    fail "straddling word: got '$d'"
d=$(desc_of hundred)
[ "$d" = "$hundred" ] || fail "a 100-char description was changed: got '$d'"
# every wrapper: at most 100 chars, and the text before "..." ends where a word of the original ends
for f in "$tmp"/out/*.md; do
    name=$(basename "$f" .md)
    d=$(desc_of "$name")
    [ "${#d}" -le 100 ] || fail "$name: description is ${#d} chars"
    orig=$(sed -n 's/^description: //p' "$tmp/skills/$name/SKILL.md")
    stem=${d%...}
    case "$orig" in "$stem"*) ;; *) fail "$name: '$d' is not a prefix of the description" ;; esac
    rest=${orig#"$stem"}
    [ -z "$rest" ] || [ "${rest:0:1}" = " " ] || [ "${stem: -1}" = . ] || fail "$name: cut inside a word: '$d'"
done
# the real skills: every generated description ends on a word boundary too
sh "$root/bin/opencode-commands.sh" "$root/plugins/junkd/skills" "$tmp/real" >/dev/null || fail "real skills: exited non-zero"
for f in "$tmp"/real/*.md; do
    d=$(sed -n 's/^description: "\(.*\)"$/\1/p' "$f")
    [ "${#d}" -le 100 ] || fail "$(basename "$f"): description is ${#d} chars"
    case "$d" in *... | *.) ;; *) [ "${#d}" -lt 100 ] || fail "$(basename "$f"): '$d' neither ends a sentence nor carries ..." ;; esac
done

echo "opencode-commands tests passed"
