---
name: handoff
description: Save a durable Markdown handoff for the current task or resume a prior handoff by short id. Use when work should continue in a fresh session or task, before switching context, or when the user asks to save, load, resume, hand off, or pick up earlier work.
argument-hint: "[panel | auto [prompt] | off]"
---

# Handoff

Choose `save` or `resume` from the request. Default to `save` when the user asks to hand work off, and to `resume` when they provide an id or ask to pick work up.

Run the helpers from this skill directory as `./bin/handoff-path` and `./bin/handoff-load`. They detect the host themselves (Claude Code, Codex, Kimi Code, OpenCode). If one exits 2 saying it cannot tell the host, run it again with `JUNK_DRAWER_RUNTIME` set to yours: `claude`, `codex`, `kimi` or `opencode`. On Codex and Kimi Code the plugin root has no `bin/` (their installers drop or rewrite its symlinks), so always use `./bin` inside this skill; on Claude Code, `${CLAUDE_PLUGIN_ROOT}/bin/` holds the same scripts.

## Save

1. From this skill directory, run `./bin/handoff-path`. It creates the handoffs folder, prints the target file path (line 1) and a short id of 8 hex characters (line 2), and copies the id to the clipboard where the host has one.
2. Use line 1 as the output file and line 2 as the short id.
3. Write a concrete Markdown handoff with your file-writing tool: objective and rationale, current state, completed work, next actions, key paths and commands, decisions, and gotchas learned this session. Start it with a `# ` title line (the handoff list shows it). No filler; assume the next session has no conversation context.
4. Report in one line: `saved - id <id>`, and the command that resumes it in a fresh session of the host you run on (only that one):
   - Claude Code: `/junkd:handon <id>`
   - Codex: `$handon <id>`
   - Kimi Code: `/skill:handon <id>`
   - OpenCode: `/handon <id>` (the command wrapper `bin/opencode-commands.sh` generates; without it, "use the handon skill with <id>")

## Resume

1. Run `./bin/handoff-load [id]` from this skill directory; omit the id to load the newest handoff. An id fragment is enough when it matches one handoff. When it matches several, the helper lists their ids and titles and exits 1 instead of loading: show the list and ask which one, unless the user already named it.
2. Treat the output as working context.
3. Confirm what was picked up in one sentence. Continue immediately only if the user asked to continue; otherwise wait.

Handoffs live under the host's data root, one folder per host (nothing is shared or leaks across hosts):

- Claude Code: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/handoffs/`
- Codex: `${CODEX_HOME:-$HOME/.codex}/junk-drawer/handoffs/`
- Kimi Code: `${KIMI_CODE_HOME:-$HOME/.kimi-code}/junk-drawer/handoffs/`
- OpenCode: `${XDG_DATA_HOME:-$HOME/.local/share}/opencode/junk-drawer/handoffs/`

## panel, auto, off

On Claude Code with the junkd plugin's hooks module loaded, `/junkd:handoff panel` (toggle the handoff pane), `/junkd:handoff auto [prompt]` (arm the auto handoff loop: handoff, `/clear`, `/junkd:handon <id>`, continue) and `/junkd:handoff off` are answered by the module before this text is reached. If the argument is one of these and you are reading this: on Codex, Kimi Code, OpenCode or any other host that is not Claude Code, say in one line that the pane and the auto loop are a Claude Code mod feature; on Claude Code, the module is not loaded, so tell the user in one line to run `/reload-plugins` after enabling `junkd@junk-drawer`. Do nothing else.
