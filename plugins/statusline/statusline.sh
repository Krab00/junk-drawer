#!/usr/bin/env bash
# Claude Code status line — colored segments separated by a dim │
#   ctx | branch | ⑂worktree | model | effort
# ctx shows only if the host provides .context_window; the rest render when available. Needs jq.

input=$(cat)

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
    settings_file="$HOME/.claude/settings.json"
    if [ -f "$settings_file" ]; then
        effort=$(jq -r '.effortLevel // empty' "$settings_file" 2>/dev/null)
    fi
fi
effort_segment=""
[ -n "$effort" ] && effort_segment="effort:${effort}"

# ── Assemble ──────────────────────────────────────────────────────────────────
parts=()
[ -n "$ctx_segment" ]      && parts+=("${C_CTX}${ctx_segment}${RST}")
[ -n "$git_segment" ]      && parts+=("${C_GIT}${git_segment}${RST}")
[ -n "$worktree_segment" ] && parts+=("${C_WT}${worktree_segment}${RST}")
[ -n "$model"       ]      && parts+=("${C_MODEL}${model}${RST}")
[ -n "$effort_segment" ]   && parts+=("${C_EFFORT}${effort_segment}${RST}")

sep="${C_SEP} │ ${RST}"
out=""
for part in "${parts[@]}"; do
    [ -z "$out" ] && out="$part" || out="${out}${sep}${part}"
done

printf '%s\n' "$out"
