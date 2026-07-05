# handoff

Save the state of a session to disk and pick it up in a fresh one — by id, not copy-paste.

- **`/handoff`** — writes a handoff to `~/.claude/handoffs/<date>_<id>.md`, prints a short session id and copies it to your clipboard.
- **`/handon <id>`** — in a new session, loads that handoff as context. No id → loads the newest.

Files live in `~/.claude/handoffs/` (outside the plugin cache, so they survive updates). The date + id in each filename make old handoffs greppable.

Session id comes from `$CLAUDE_CODE_SESSION_ID`.
