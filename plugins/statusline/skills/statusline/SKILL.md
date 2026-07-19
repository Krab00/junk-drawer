---
name: statusline
description: Explain status-line and footer options across Claude Code, Codex, and Kimi Code. Use when the user asks for a status line, context remaining indicator, model or reasoning display, Git branch, current directory, or footer customization.
---

# Configure the status line

Each host renders its footer differently — pick the section for the user's host.

## Kimi Code

Kimi Code renders a fixed built-in footer; there is no user-configurable status-line item list in
`tui.toml` (that file covers theme, editor, notifications, and auto-update only). Do not promise
Codex-style `status_line` items here.

- Appearance is customizable through themes: `/theme` for the picker, or a custom theme JSON under
  `~/.kimi-code/themes/` (see the built-in `/custom-theme` skill). Footer colors follow the
  `text` / `textDim` / `textMuted` tokens.
- `tui.toml` changes apply with `/reload-tui`.
- Do not install or invoke `statusline.sh` for Kimi Code; that script is for Claude Code only.

## Codex

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

## Claude Code

Use the bundled `setup-statusline.sh` / `statusline.sh` as before (git branch + worktree + colored
context/effort segments). That flow is unchanged by this multi-host skill.
