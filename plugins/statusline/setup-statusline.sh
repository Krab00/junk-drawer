#!/usr/bin/env bash
# Wire this plugin's status line into your Claude Code settings.json.
# Run from anywhere, any number of times (idempotent):
#   bash ~/.claude/plugins/marketplaces/junk-drawer/plugins/statusline/setup-statusline.sh
# A plugin can't auto-register a statusLine, so this does the one manual step for you.
set -euo pipefail

command -v jq >/dev/null || { echo "need jq (the status line needs it too)"; exit 1; }

DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/statusline.sh"
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"

[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak"   # settings is precious — always back up before touching

tmp="$(mktemp)"
jq --arg cmd "$SCRIPT" '.statusLine = {type: "command", command: $cmd}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"

# check: the edit landed and the command renders something
jq -e '.statusLine.command' "$SETTINGS" >/dev/null || { echo "FAILED to write statusLine"; exit 1; }
echo "statusLine → $SCRIPT"
echo "backup     → $SETTINGS.bak"
echo "preview    → $(printf '{"model":{"display_name":"preview"},"cwd":"%s"}' "$PWD" | bash "$SCRIPT")"
