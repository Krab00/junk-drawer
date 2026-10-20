---
name: explain
description: Explain a topic from the current repo or conversation in the format that fits it - a self-contained HTML page with a slider per parameter, a Mermaid diagram for structure or flow, or short STE text. Works the same on Codex, Kimi Code, OpenCode and Claude Code. Use when the user runs /junkd:explain or asks how a setting, a formula, a flow or a concept works.
argument-hint: "<topic>"
---

# explain

Topic: "$ARGUMENTS"

The topic is the text after the command (on hosts that do not fill `$ARGUMENTS` above, the text the user gave with the skill). The command is `/junkd:explain` on Claude Code, `$explain` on Codex, `/skill:explain` on Kimi Code, and `/explain` on OpenCode (the command wrapper `bin/opencode-commands.sh` generates) or "use the explain skill". Take the facts about the topic from the current repo (read the files; do not guess) or from the conversation. If the topic is empty, ask what to explain, in one question.

## Pick the route

Run this test once, in this order. Produce exactly one format, never two.

1. Parameters: the topic has numbers that can change (a config value, a formula with knobs, a rate limit, a threshold, a timeout). Route: slider page.
2. Structure or flow: the question is "how does X flow", "what calls what", "which states", or the topic is modules, a call graph, a state machine, a pipeline or a request path. Route: mermaid.
3. Anything else. Route: STE text.

When two routes fit or none fits clearly, ask one question and wait. Do not answer in two formats to be safe.

## Route 1: slider page

Write ONE self-contained HTML file with a slider per parameter and a live readout of the effect (the formula result, the time, the count). Rules for the page:

- Inline CSS and JS only. No `http://` or `https://` load, no `fetch`, no `<script type="module">`, no `import`.
- Each slider shows its name, its current value and its unit; min, max and default come from the repo (the config, the code). If the repo gives no range, use 0 to twice the default and say so on the page.
- The readout recomputes on `input`. It uses the real formula from the repo, copied into the page, not a made-up one.
- It works at phone width and in light and dark.

Save it under the session scratchpad: `$CLAUDE_SCRATCHPAD` or the scratchpad path the host names; elsewhere `${TMPDIR:-/tmp}/junkd-explain/` (create the folder). Use a file name from the topic, such as `orch-watchdog-stall.html`. Never write into the repo.

The reply is the absolute path of the file plus two sentences: what the sliders move, and what to look at.

- Codex, Kimi Code, OpenCode or any other host that is not Claude Code: stop at the path and the two sentences. The user opens the file in a browser.
- Claude Code: when the Artifact tool exists, also publish the page as an Artifact and give its link next to the path. This line is Claude Code specific; no other host has an Artifact tool.

## Route 2: mermaid

Put one inline Mermaid block in the reply (a fenced block tagged `mermaid`). At most 25 nodes: group the rest into one node each. Use `flowchart` for modules and flows, `stateDiagram-v2` for states, `sequenceDiagram` for a request path. Name nodes after real files, functions or states in the repo. Add two sentences after the block. Write no file.

## Route 3: STE text

Plain text in the plugin's STE style: short sentences, one idea each, no headers when under 500 words. At most 12 sentences. Write no file.

## Always

The skill never writes into the repo. If the repo does not hold the facts the topic needs, say what is missing in one sentence instead of inventing them.
