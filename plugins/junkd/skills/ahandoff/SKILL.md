---
name: ahandoff
description: Arm the auto handoff loop (at a context threshold - handoff, /clear, /junkd:handon, continue; and resume after the 5h rate limit), optionally running a prompt now; off disarms it, panel toggles its pane. A Claude Code mod feature of the junkd plugin.
argument-hint: "[prompt] | off | panel | status"
---

# Auto handoff

On Claude Code the junkd plugin's hooks module answers `/junkd:ahandoff` before this text is reached: a prompt (or nothing) arms the loop and runs the prompt, `off` disarms it, `panel` toggles the handoff pane, `status` prints the loop's state, the last measurement and the log path.

If you are reading this, the module did not answer. Do nothing except tell the user in one line:

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: the auto handoff loop is a Claude Code mod feature; the `handoff` and `handon` skills save and resume handoffs by hand.
- Claude Code: the junkd hooks module is not loaded; run `/reload-plugins` after enabling `junkd@junk-drawer`.
