---
name: tools
description: Toggle the tools pane, a Claude Code mod that shows this session's agents over the repo's git worktrees and the tools, MCP servers and skills the session used; an argument (agents, tools, mcp or skills) opens it on that tab. Use when the user runs /junkd:tools or asks to see what the session's agents and tools are doing.
argument-hint: "[agents | tools | mcp | skills]"
---

# tools

In Claude Code the junkd hooks module opens, closes or switches the pane on this command before this text is reached. If you read this, the module did not answer:

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: tell the user in one line that the tools pane is a Claude Code mod and this host has none, and do nothing else.
- Claude Code: the hooks module is not loaded (a mod needs function hooks). Tell the user in one line to run `/reload-plugins` after enabling `junkd@junk-drawer`, and do nothing else.
