---
name: statusline
description: Configure the native Codex CLI footer and explain available status-line items. Use when the user asks for a Codex status line, context remaining indicator, model or reasoning display, Git branch, current directory, or footer customization.
---

# Configure the Codex status line

Codex uses a declarative native footer rather than Claude Code's arbitrary status-line command.

1. Inspect `${CODEX_HOME:-$HOME/.codex}/config.toml` and preserve unrelated settings.
2. Propose this default ordered list unless the user requested different items:

   ```toml
   [tui]
   status_line = ["model-with-reasoning", "context-remaining", "git-branch", "current-dir"]
   ```

3. Before modifying a user-level config, state the exact change and obtain any required filesystem approval. Create a backup if editing through a script.
4. Explain that the change applies to Codex CLI; the desktop app does not render this CLI footer. Ask the user to restart the CLI session if the footer does not refresh.

Do not install or invoke `statusline.sh` for Codex. Keep that script for Claude Code compatibility.
