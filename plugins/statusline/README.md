# statusline

A colored Claude Code status line. Segments, separated by a dim `│`:

`ctx` (cyan) · `branch` (green) · `⑂worktree` (magenta, only in a linked worktree) · `model` (bold blue) · `effort` (yellow)

`ctx` renders only if the host provides `.context_window` on stdin. Requires `jq`.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install statusline@junk-drawer
```

A plugin can't auto-activate a status line, so run the setup once — it wires `statusLine` into your
`settings.json` for you (idempotent, backs up first):

```
bash ~/.claude/plugins/marketplaces/junk-drawer/plugins/statusline/setup-statusline.sh
```

Or do it by hand — add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/ABSOLUTE/PATH/TO/plugins/marketplaces/junk-drawer/plugins/statusline/statusline.sh"
  }
}
```

Note: `${CLAUDE_PLUGIN_ROOT}` does **not** resolve inside a user `settings.json`, so use an absolute
path (the `marketplaces/...` one is version-stable; the `cache/.../<version>/...` one breaks on updates).
