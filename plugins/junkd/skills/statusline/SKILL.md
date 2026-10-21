---
name: statusline
description: Explain status-line and footer options across Claude Code, Codex, Kimi Code, and OpenCode. Use when the user asks for a status line, context remaining indicator, model or reasoning display, Git branch, current directory, or footer customization.
argument-hint: "[on | off | status]"
---

# Configure the status line

Argument: "$ARGUMENTS"

Each host renders its footer differently — pick the section for the user's host. junkd's own status line
(`bin/statusline.sh`) is Claude Code only; on every other host, never install or run it.

## OpenCode

OpenCode has no status-line command and no footer this plugin can configure. Say so in one line and do nothing else.

## Kimi Code

Kimi Code renders a fixed built-in footer; there is no user-configurable status-line item list in
`tui.toml` (that file covers theme, editor, notifications, and auto-update only). Do not promise
Codex-style `status_line` items here.

- Appearance is customizable through themes: `/theme` for the picker, or a custom theme JSON under
  `~/.kimi-code/themes/` (see the built-in `/custom-theme` skill). Footer colors follow the
  `text` / `textDim` / `textMuted` tokens.
- `tui.toml` changes apply with `/reload-tui`.
- Do not install or invoke `bin/statusline.sh` for Kimi Code; that script is for Claude Code only.

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

Do not install or invoke `bin/statusline.sh` for Codex. Keep that script for Claude Code.

## Claude Code

The junkd hooks module wires it: `/junkd:statusline on|off|status` (no argument toggles the statusline pane, where
each segment has a switch and a preview), or the `statusline_*` settings in the `/junkd` pane and `/config`. The
module answers the command before this text is reached. If you read this, the module did not answer: run the setup
script from this skill directory with the argument and report its one-line output:

```bash
./bin/statusline-setup on|off|status
```

`on` needs `jq`. It copies `bin/statusline.sh` to `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/statusline.sh`, backs
up `settings.json` to `settings.json.bak`, and points `statusLine` at that absolute path, because
`${CLAUDE_PLUGIN_ROOT}` does not resolve inside a user `settings.json`. A `statusLine` of the user's own is refused
(`on --force` replaces it; ask first). `off` removes the key only while it is junkd's. The old
`junk-drawer-statusline.sh` path is moved to the new one by `on`.

Segments, separated by a dim `│`: `ctx` (context free/used), `branch`, `worktree` (only in a linked worktree),
`model`, `effort`, `limits` (5h/week rate limits). Each is the `statusline_<segment>` setting (on by default).
