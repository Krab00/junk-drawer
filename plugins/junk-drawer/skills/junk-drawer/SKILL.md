---
name: junk-drawer
description: Show a runtime catalog of the junk-drawer marketplace, including installed plugin versions, Codex skills, and Claude Code commands. Use when the user asks what junk-drawer contains, which workflows are installed, or how to invoke a bundled utility.
---

# Junk drawer catalog

From this skill directory run:

```bash
JUNK_DRAWER_RUNTIME=codex ../../bin/junk-drawer
```

Return the output verbatim in a code block. Do not reorder or summarize it: the script reads manifests and workflow metadata at runtime so the catalog stays aligned with the installed bundle.
