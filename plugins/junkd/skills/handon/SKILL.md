---
name: handon
description: Resume a saved handoff by short id, or the newest one when no id is given. Use as the resume half of the handoff skill, when the user asks to pick up, load, or continue earlier work in a fresh session or task.
argument-hint: "[id]"
---

# Resume a handoff

Argument: "$ARGUMENTS"

Load the handoff with that id (a fragment is enough), or the newest one when the argument is empty (on a host that leaves the placeholder above unfilled, the argument is the id the user gave, if any):

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: run `./bin/handoff-load <id>` from this skill directory and use its output. The helper detects the host; if it exits 2 saying it cannot tell, run it again with `JUNK_DRAWER_RUNTIME` set to `codex`, `kimi` or `opencode`. The plugin root has no `bin/` on Codex and Kimi Code: use this skill's own `./bin`.
- Claude Code: run `${CLAUDE_PLUGIN_ROOT}/bin/handoff-load $ARGUMENTS` and use its output.

If the helper finds no handoff, say so in one line and stop. If it lists several handoffs that match the fragment, show the list and ask which one.

Treat the loaded handoff as the working context for this session. Then confirm in one line what you picked up (the handoff's topic) and wait. Do not act on it until the user tells you to. (The auto handoff loop sends its continuation prompt right after this command; that prompt is the user telling you to continue.)
