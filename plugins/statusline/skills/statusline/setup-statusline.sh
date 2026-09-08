#!/usr/bin/env bash
# Wire this status line into Claude Code. Preferred: run `/statusline:init` inside Claude Code.
# Or from a terminal: bash <this-file>. Idempotent.
#
# Copies the status line script to a stable spot in your config dir and points settings.json there,
# so it survives plugin updates/uninstall (the plugin's own path is versioned cache and would rot).
set -euo pipefail

command -v jq >/dev/null || { echo "need jq (the status line needs it too)"; exit 1; }

DIR="$(cd "$(dirname "$0")" && pwd)"
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
DEST="$CFG/junk-drawer-statusline.sh"          # namespaced name → won't clobber a user's own statusline.sh
SETTINGS="$CFG/settings.json"

install -m 0755 "$DIR/statusline.sh" "$DEST"   # copy + chmod into a stable location

[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak"                  # settings is precious — always back up before touching

tmp="$(mktemp)"
jq --arg cmd "$DEST" '.statusLine = {type: "command", command: $cmd}' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"

jq -e '.statusLine.command' "$SETTINGS" >/dev/null || { echo "FAILED to write statusLine"; exit 1; }
echo "statusLine → $DEST"
echo "backup     → $SETTINGS.bak"
echo "preview    → $(printf '{"model":{"display_name":"preview"},"cwd":"%s"}' "$PWD" | bash "$DEST")"
