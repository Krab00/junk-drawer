---
name: orch-init
description: Scan a repository and create the neutral .orch/config.md adapter used by the junk-drawer orchestrator. Use before the first orch run, when project commands or ports changed, or when the user asks to initialize or reconfigure orchestration.
argument-hint: "[hints for the scan, e.g. the backend]"
allowed-tools: Bash(git:*), Bash(cat:*), Bash(ls:*), Bash(test:*), Bash(${CLAUDE_PLUGIN_ROOT}/bin/orch-state:*), Read, Write, Glob
---

# Initialize orch

Arguments: "$ARGUMENTS"

Usually none. Anything given is a hint for the scan (the backend to pick, an app to leave out); on a host that leaves the placeholder above unfilled, it is the rest of the user's request. The repository still decides every fact it holds.

Read `./commands/init.md` from this skill directory as the canonical initialization specification, with these host mappings:

- Write `.orch/config.md`, not a vendor-specific config path.
- Use your host's tool names instead of Claude frontmatter `allowed-tools`.
- Run helper scripts by paths relative to this skill: `./bin/orch-state`, `./bin/orch-worktree`, and `./bin/orch-sync`. On Claude Code use `${CLAUDE_PLUGIN_ROOT}/bin/orch-state` (and its siblings) instead, as the spec spells them. On Codex, Kimi Code and OpenCode there is no plugin-root `bin/` to fall back on: only this skill's `./bin` (or the sibling `orch` skill's, see below).
- The spec's `/junkd:orch-init` is this skill and its `/junkd:orch` the sibling `orch` skill: `/junkd:orch-init` and `/junkd:orch` on Claude Code, `$orch-init` and `$orch` on Codex, `/skill:orch-init` and `/skill:orch` on Kimi Code, `/orch-init` and `/orch` on OpenCode (the command wrappers `bin/opencode-commands.sh` generates; without them, "use the orch skill").
- The spec's `security` block is proposed by the same scan on every host. On Codex, Kimi Code and OpenCode a declared `security` needs a `security-review` skill on that host for the verify leg to run it; without one each verify round gives a `PM-REVIEW` row, so say that when you propose the block. On Claude Code `security-review` is a built-in skill.
- When you tell the user how to start (the spec's `/junkd:orch <free text>` and `/junkd:orch batch`), name the orch command of the host you run on: `/junkd:orch` on Claude Code, `$orch` on Codex, `/skill:orch` on Kimi Code, `/orch` on OpenCode.

Some plugin installers strip symlinks, so if `./bin` or `./commands` is missing from this skill directory, use the same files from the sibling `orch` skill's `bin/` and `commands/` directories.

Scan the repository before asking questions. Detect the default branch, package manager, applications, dev commands, ports, health routes, and test commands. Ask only for the real backend choice and confirmation of detected commands and ports.

Never overwrite an existing `.orch/config.md` without showing the diff and receiving confirmation. If only legacy `.claude/orch.config.md` exists, offer to migrate it while preserving its content. Create the configured task directory and `_lessons.md`, then confirm `./bin/orch-state list` succeeds.
