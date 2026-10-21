---
name: dashboard
description: Open the orch dashboard, a local HTML page with the task board, the agents' timeline, recent events and the lessons, fed by a status.js written beside it; `close` stops the writes. Use when the user runs /junkd:dashboard or /junkd:orch dashboard, or asks to see the orch run in a browser.
argument-hint: "[open | close]"
---

# dashboard

Arguments: "$ARGUMENTS"

Nothing (or `open`) opens the dashboard; `close` stops writing its data. On a host that leaves the placeholder above unfilled, the argument is the rest of the user's request.

In Claude Code the junkd hooks module answers this command before this text is reached: it writes `status.js`, copies the page beside it, opens it and keeps the file current while the dashboard is open. If you read this, the module did not answer:

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: run `./bin/orch-status --open` from this skill directory, with the user's repository as the working directory, and tell the user the path it prints. The file is a snapshot: run it again to refresh what the page shows. For `close`, there is nothing to stop on these hosts; say so in one line. If `./bin` is missing (some installers strip symlinks), use the sibling `orch` skill's `./bin/orch-status`.
- Claude Code: the hooks module is not loaded (a mod needs function hooks). Run `${CLAUDE_PLUGIN_ROOT}/bin/orch-status --open` for a one-off snapshot, tell the user the path it prints, and tell them in one line to run `/reload-plugins` after enabling `junkd@junk-drawer` for the live dashboard.
