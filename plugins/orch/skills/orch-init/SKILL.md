---
name: orch-init
description: Scan a repository and create the neutral .orch/config.md adapter used by the junk-drawer orchestrator. Use before the first orch run, when project commands or ports changed, or when the user asks to initialize or reconfigure orchestration.
---

# Initialize orch

Read `../../commands/init.md` from this skill directory as the canonical initialization specification, with these Codex mappings:

- Write `.orch/config.md`, not a vendor-specific config path.
- Use the current tool names instead of Claude frontmatter `allowed-tools`.
- Run helper scripts by paths relative to this skill: `../../bin/orch-state`, `../../bin/orch-worktree`, and `../../bin/orch-sync`.

Scan the repository before asking questions. Detect the default branch, package manager, applications, dev commands, ports, health routes, and test commands. Ask only for the real backend choice and confirmation of detected commands and ports.

Never overwrite an existing `.orch/config.md` without showing the diff and receiving confirmation. If only legacy `.claude/orch.config.md` exists, offer to migrate it while preserving its content. Create the configured task directory and `_lessons.md`, then confirm `../../bin/orch-state list` succeeds.
