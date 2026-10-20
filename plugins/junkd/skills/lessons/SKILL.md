---
name: lessons
description: Show and resolve the orch lessons of the three stores (the run's .orch/tasks/_lessons.md, the repo's lessons.md, ~/.claude/junkd/lessons.md) — list the pending ones, promote one to its target, drop one, or move one a store up. Use when the user runs /junkd:lessons, asks what lessons are pending, or an orch run says lessons block it.
argument-hint: "[list | promote <id> | drop <id> | up <id>]"
---

# lessons

Arguments: "$ARGUMENTS"

Nothing or `list` shows the pending lessons; `promote <id>`, `drop <id>` and `up <id>` act on one (`<id>` is `L3`, or `local:L3`, `repo:L3`, `global:L3` when two stores have an `L3`). On a host that leaves the placeholder above unfilled, the argument is the rest of the user's request.

In Claude Code the junkd hooks module answers this command before this text is reached: it toggles the lessons tab of the /junkd pane, or runs the one action. If you read this, the module did not answer:

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: run `./bin/orch-state lesson list --pending` from this skill directory, with the user's repository as the working directory, and show the table. For an action, run `./bin/orch-state lesson promote <id>`, `./bin/orch-state lesson drop <id>` or `./bin/orch-state lesson up <id>` and show its output. A promote to `check` exits 3 and prints the proposed `standing_checks_extra` line: ask the user, and only on a yes run it again with `--yes`. If `./bin` is missing (some installers strip symlinks), use the sibling `orch` skill's `./bin/orch-state`.
- Claude Code: the hooks module is not loaded (a mod needs function hooks). Run `${CLAUDE_PLUGIN_ROOT}/bin/orch-state lesson list --pending` (or the action, as above), show the output, and tell the user in one line to run `/reload-plugins` after enabling `junkd@junk-drawer` for the lessons tab.

Never edit a lessons file by hand: `orch-state lesson` is the one writer.
