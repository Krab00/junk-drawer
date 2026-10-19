#!/usr/bin/env bash
# orch-claude-md.sh on|off: the `orch_claude_md` switch on the global CLAUDE.md
# (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md).
#   on:  the "## Orchestrator mode" H2 section (with its H3 children, up to the next H1 or H2) becomes a pointer block,
#        <!-- junkd:orch start --> ... <!-- junkd:orch end -->, since junkd prints the rule sheet itself at session start.
#        A file with neither the section nor the block is left alone; a block already there is written afresh.
#   off: the pointer block goes, with the one blank line after it, and nothing else. The original section is not
#        put back: the backup holds it. No block: nothing to do.
# Never creates CLAUDE.md. Idempotent: an unchanged file is left alone (no backup); a changed one is backed up first,
# beside the real file (<file>.bak-<date>-<time>-XXXX). Writes through a symlink. Headings and markers inside a ``` / ~~~
# fence do not count (a fence closes on its own character, a run at least as long; ```x``` is inline code, no fence).
# A start marker with no end marker, or (on) a fence left open inside the section, is refused: exit 1, nothing
# written. CRLF lines match, and a CRLF file gets a CRLF block. Exit 2: no mode or an unknown one.
# Run by scripts/setup.sh at session start and by the hooks module when the setting flips; tests/claude-md.sh.
set -euo pipefail
mode="${1:-}"
case "$mode" in on | off) ;; *) echo "usage: orch-claude-md.sh on|off" >&2; exit 2 ;; esac
md="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md"
[[ -e "$md" ]] || { echo "skipped $md: not found"; exit 0; }
real="$(readlink -f "$md")"
# Built in $TMPDIR, so an unchanged file in a read-only folder is no error.
new="$(mktemp)"
trap 'rm -f "$new"' EXIT
# LC_ALL=C: every pattern is ASCII, and a UTF-8 awk aborts on an invalid byte.
if ! JUNKD_BLOCK=$'<!-- junkd:orch start -->\n## Orchestrator mode\nThe junkd plugin prints the orchestrator rules at session start; full text and settings: `/junkd:orch`.\n<!-- junkd:orch end -->' \
  MODE="$mode" LC_ALL=C awk '
    function block() {
      if (!done) { b = ENVIRON["JUNKD_BLOCK"]; if (crlf) { gsub(/\n/, "\r\n", b); b = b "\r" } print b }
      done = 1
    }
    BEGIN { on = ENVIRON["MODE"] == "on"; opener = "<!-- junkd:orch start -->"; closer = "<!-- junkd:orch end -->" }
    NR == 1 { crlf = /\r$/ }
    {
      f = fence; l = $0; sub(/\r$/, "", l)
      if (match(l, /^[ \t]*(```+|~~~+)/)) {
        run = substr(l, RSTART, RLENGTH); sub(/^[ \t]*/, "", run)
        # a ``` info string holds no backtick (CommonMark)
        if (!fence) { if (run !~ /^`/ || !index(substr(l, RSTART + RLENGTH), "`")) { fence = 1; fc = substr(run, 1, 1); fn = length(run) } }
        else if (substr(run, 1, 1) == fc && length(run) >= fn && l ~ /^[ \t]*(`+|~+)[ \t]*$/) fence = 0
      }
    }
    skip { if (!f && l == closer) { skip = 0; trail = !on } next }
    # off: the one blank line the block leaves behind
    trail { trail = 0; if (l == "") next }
    !f && l == opener { if (on) block(); skip = 1; next }
    !on { print; next }
    cut && !f && (l ~ /^## / || l ~ /^# /) { cut = 0; print (crlf ? "\r" : "") }
    cut { next }
    !f && l ~ /^## Orchestrator mode/ { block(); cut = 1; next }
    { print }
    END { if (skip || (cut && fence)) exit 3 }
  ' "$real" >"$new"; then
  echo "refused $md: an unclosed '<!-- junkd:orch start -->' block or code fence; fix it by hand, nothing written" >&2
  exit 1
fi
if cmp -s "$new" "$real"; then
  echo "up to date $md"
  exit 0
fi
tmp="$(mktemp "$real.XXXXXX")"
cp -p "$real" "$tmp" # the file's mode, without a BSD- or GNU-only stat
cat "$new" >"$tmp"
bak="$(mktemp "$real.bak-$(date +%Y%m%d-%H%M%S)-XXXX")"
cp -p "$real" "$bak"
mv "$tmp" "$real"
if [[ $mode == on ]]; then
  echo "updated $md: orchestrator section -> junkd:orch pointer block (backup: $bak)"
else
  echo "updated $md: junkd:orch pointer block removed (backup: $bak)"
fi
