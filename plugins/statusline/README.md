# statusline

A colored Claude Code status line. Segments, separated by a dim `│`:

`ctx` (cyan) · `branch` (green) · `⑂worktree` (magenta, only in a linked worktree) · `model` (bold blue) · `effort` (yellow)

`ctx` renders only if the host provides `.context_window` on stdin. Requires `jq`.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install statusline@junk-drawer
```

A plugin can't auto-activate a status line, so add this **once** to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "${CLAUDE_PLUGIN_ROOT}/statusline.sh"
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` resolves to the installed plugin directory — no absolute paths needed.
