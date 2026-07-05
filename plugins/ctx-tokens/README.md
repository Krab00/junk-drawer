# ctx-tokens

Read the current context-window token usage of the **live** Claude Code session, straight from its
transcript — so an agent (or you) can check how full the context is and act before it degrades.

> Status: **scaffold** — script not shipped yet.

## Install

```
/plugin marketplace add Krab00/junk-drawer
/plugin install ctx-tokens@junk-drawer
```

## Usage

*(intended, lands when the script is added)*

```
ctx-tokens        # current context tokens, e.g. 61951
ctx-tokens -h     # human form, e.g. "ctx 61k (61951) | out 562"
```

Threshold on it in scripts: `[ "$(ctx-tokens)" -gt 300000 ] && …`
