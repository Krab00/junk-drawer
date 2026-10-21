---
name: junkd
description: Toggle the junkd pane, a Claude Code mod with the marketplace's plugins, every junkd setting group (core, handoff, orch, tldr, ctx, statusline) and the commands, opened beside the handoff, orch and statusline tabs. Use when the user runs /junkd:junkd or asks to open or close the junkd pane.
---

# junkd

In Claude Code the junkd hooks module opens or closes the pane on this command before this text is reached. If you read this, the module did not answer:

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: tell the user in one line that the junkd pane is a Claude Code mod and this host has none, and do nothing else.
- Claude Code: the hooks module is not loaded (a mod needs function hooks). Tell the user in one line to run `/reload-plugins` after enabling `junkd@junk-drawer`, and do nothing else.
