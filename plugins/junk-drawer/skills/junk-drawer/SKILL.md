---
name: junk-drawer
description: Show a runtime catalog of the junk-drawer marketplace, including installed plugin versions, skills, and commands. Use when the user asks what junk-drawer contains, which workflows are installed, or how to invoke a bundled utility.
---

# Junk drawer catalog

From this skill directory run (set the runtime to your host: `codex`, `kimi`, or omit on Claude Code):

```bash
JUNK_DRAWER_RUNTIME=<host> ../../bin/junk-drawer
```

Return the output verbatim in a code block. Do not reorder or summarize it: the script reads manifests and workflow metadata at runtime so the catalog stays aligned with the installed bundle.
