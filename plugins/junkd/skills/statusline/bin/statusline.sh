#!/usr/bin/env bash
# Claude Code status line — colored segments separated by a dim │
#   ctx | branch | ⑂worktree | model | effort | 5h/wk rate limits
# ctx shows only if the host provides .context_window; the rest render when available. Needs jq.
# Which segments are drawn: the junkd settings statusline_ctx, _branch, _worktree, _model, _effort and _limits, read
# from the user settings.json (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json, the first pluginConfigs entry whose
# key starts with `junkd@`, its options). true, "true" or "on" is on, any other value off; a missing key, a file that
# does not parse, or no jq draws the segment.

input=$(cat)
settings_file="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"

# ── Segment switches ──────────────────────────────────────────────────────────
show_ctx=on show_branch=on show_worktree=on show_model=on show_effort=on show_limits=on
if command -v jq >/dev/null 2>&1 && [ -f "$settings_file" ]; then
    switches=$(jq -r '[.pluginConfigs? // {} | to_entries[] | select(.key | startswith("junkd@"))][0].value.options? // {}
        | [.statusline_ctx, .statusline_branch, .statusline_worktree, .statusline_model, .statusline_effort, .statusline_limits]
        | map(if . == null or . == true or . == "true" or . == "on" then "on" else "off" end) | join(" ")' \
        "$settings_file" 2>/dev/null) || switches=""
    [ -z "$switches" ] || read -r show_ctx show_branch show_worktree show_model show_effort show_limits <<<"$switches"
fi

# ── Colors ────────────────────────────────────────────────────────────────────
C_CTX=$'\033[36m'      # cyan
C_GIT=$'\033[32m'      # green
C_WT=$'\033[35m'       # magenta
C_MODEL=$'\033[1;34m'  # bold blue
C_EFFORT=$'\033[33m'   # yellow
C_SEP=$'\033[2m'       # dim
RST=$'\033[0m'

# ── Context window ────────────────────────────────────────────────────────────
cw_size=$(echo "$input"  | jq -r '.context_window.context_window_size  // 0')
total_in=$(echo "$input" | jq -r '.context_window.total_input_tokens   // 0')
total_out=$(echo "$input"| jq -r '.context_window.total_output_tokens  // 0')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage      // empty')
rem_pct=$(echo "$input"  | jq -r '.context_window.remaining_percentage // empty')

used_tok=$(( total_in + total_out ))

# Friendly token formatter (k / M)
fmt_tok() {
    local n=$1
    if   [ "$n" -ge 1000000 ]; then printf "%.1fM" "$(echo "scale=1; $n/1000000" | bc)"
    elif [ "$n" -ge 1000 ];    then printf "%dk"   "$(( n / 1000 ))"
    else                            printf "%d"    "$n"
    fi
}

ctx_segment=""
if [ "$used_tok" -gt 0 ] && [ "$cw_size" -gt 0 ]; then
    rem_tok=$(( cw_size - used_tok ))
    rem_fmt=$(fmt_tok "$rem_tok")
    used_fmt=$(fmt_tok "$used_tok")
    if [ -n "$used_pct" ]; then
        pct_int=$(printf "%.0f" "$used_pct")
        ctx_segment="ctx ${rem_fmt} free / ${used_fmt} used (${pct_int}%)"
    else
        ctx_segment="ctx ${rem_fmt} free / ${used_fmt} used"
    fi
elif [ -n "$rem_pct" ]; then
    # No token counts yet but percentage is available
    rem_int=$(printf "%.0f" "$rem_pct")
    ctx_segment="ctx ${rem_int}% free"
fi

# ── Git branch ────────────────────────────────────────────────────────────────
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')

git_segment=""
worktree_segment=""
if [ -n "$cwd" ]; then
    branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
        git_segment="$branch"
    elif [ -n "$branch" ]; then
        # detached HEAD — show short hash
        sha=$(git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
        git_segment="detached@${sha}"
    fi
    # If git command failed (not a repo), git_segment stays empty — segment is omitted

    # Worktree: only shown when in a *linked* worktree (git-dir differs from common-dir).
    # ponytail: skip in the main worktree — it'd just repeat the repo folder name.
    git_dir=$(git -C "$cwd" rev-parse --git-dir 2>/dev/null)
    common_dir=$(git -C "$cwd" rev-parse --git-common-dir 2>/dev/null)
    if [ -n "$git_dir" ] && [ "$git_dir" != "$common_dir" ]; then
        worktree_segment="⑂$(basename "$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)")"
    fi
fi

# ── Model ─────────────────────────────────────────────────────────────────────
model=$(echo "$input" | jq -r '.model.display_name // empty')

# ── Effort level ──────────────────────────────────────────────────────────────
# Try to read from input JSON first, fall back to settings.json.
effort=$(echo "$input" | jq -r '.effort_level // .effortLevel // .model.effort_level // empty')
if [ -z "$effort" ]; then
    if [ -f "$settings_file" ]; then
        effort=$(jq -r '.effortLevel // empty' "$settings_file" 2>/dev/null)
    fi
fi
effort_segment=""
[ -n "$effort" ] && effort_segment="effort:${effort}"

# ── Rate limits (Anthropic 5h + weekly windows) ───────────────────────────────
rl5=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
rl7=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

# Truecolor (bypasses terminal palette remap): green <=50, orange 51-80, red >80
pct_color() {
    local p; p=$(printf '%.0f' "$1")
    if   [ "$p" -gt 80 ]; then printf '\033[1;38;2;239;68;68m'
    elif [ "$p" -gt 50 ]; then printf '\033[38;2;249;115;22m'
    else                       printf '\033[38;2;34;197;94m'
    fi
}

limits_segment=""
if [ -n "$rl5" ] || [ -n "$rl7" ]; then
    [ -n "$rl5" ] && limits_segment="${C_SEP}5h:${RST}$(pct_color "$rl5")$(printf '%.0f' "$rl5")%${RST}"
    if [ -n "$rl7" ]; then
        [ -n "$limits_segment" ] && limits_segment="${limits_segment} "
        limits_segment="${limits_segment}${C_SEP}week:${RST}$(pct_color "$rl7")$(printf '%.0f' "$rl7")%${RST}"
    fi
fi

# ── Assemble ──────────────────────────────────────────────────────────────────
parts=()
[ "$show_ctx" = on ]      && [ -n "$ctx_segment" ]      && parts+=("${C_CTX}${ctx_segment}${RST}")
[ "$show_branch" = on ]   && [ -n "$git_segment" ]      && parts+=("${C_GIT}${git_segment}${RST}")
[ "$show_worktree" = on ] && [ -n "$worktree_segment" ] && parts+=("${C_WT}${worktree_segment}${RST}")
[ "$show_model" = on ]    && [ -n "$model"       ]      && parts+=("${C_MODEL}${model}${RST}")
[ "$show_effort" = on ]   && [ -n "$effort_segment" ]   && parts+=("${C_EFFORT}${effort_segment}${RST}")
[ "$show_limits" = on ]   && [ -n "$limits_segment" ]   && parts+=("${limits_segment}")

sep="${C_SEP} │ ${RST}"
out=""
for part in "${parts[@]}"; do
    [ -z "$out" ] && out="$part" || out="${out}${sep}${part}"
done

printf '%s\n' "$out"
