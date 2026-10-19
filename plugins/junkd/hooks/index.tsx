// Plugin junkd's one hooks module: handoff, orch, tldr, ctx, statusline and tools, the core setting and the /junkd
// frame, each in its own files, composed here. A feature file exports `register<Feature>(on, options)` for the hooks only it has, and plain
// named functions for the rest (see feature.ts); this file holds what is shared:
// - `$.junkd`, the noun other mods call (types/index.d.ts): schema answers here; get, set, config, open and
//   orchGuardState need `$`, which a noun may not capture, so the hooks on junkd.<method> below answer them.
// - session.start, tool.call, the unfiltered command.run and the PromptHint render: the host takes one hook per
//   event and filter from a module (a repeat `on` fails the load), and more than one feature needs each of them.
// - handoff.tsx: /junkd:handoff, /junkd:handon, /junkd:ahandoff, the auto handoff loop, the 🪃 segment, its pane.
// - orch.tsx: the main-loop guard (tool.call, agent.spawn), /junkd:orch panel and its pane.
// - tldr.tsx: /junkd:tldr's sentences and the terse flag file bin/tldr-hook reads.
// - ctx.ts: the ctx rows and /junkd:ctx-limit, mirrored into the files bin/ctx-limit-hook reads.
// - statusline.tsx: the statusline rows, /junkd:statusline, its pane, and bin/statusline-setup on|off.
// - tools-pane.tsx (with tools.ts and tools-views.tsx): /junkd:tools and its pane, this session's agents over the
//   repo's worktrees and the tools, MCP servers and skills it used (counted by tool.call and command.run here).
// - core.ts: the core rows: output_style (and the flag file scripts/setup.sh reads), cache_check_sessions.
// - cache.tsx: the prompt-cache check at session start (scripts/cache-check.sh) and its band above the prompt.
// - panel.tsx: /junkd, ✚ junkd and the set of tabs (junkd, handoff, orch, statusline, tools).
// Settings: one userConfig row per `<group>_<field>` (settings.ts), the /config row `junkd.<group>_<field>`.
// Paths follow CLAUDE_CONFIG_DIR like Claude Code itself; the flag files live under its junkd/ folder.
import type { Register } from 'claude-code'
import type { JunkdHandoffRoute, JunkdToolsRoute } from '../types'
import { registerCache } from './cache'
import { coreStart, registerCore } from './core'
import { ctxStart, registerCtx } from './ctx'
import { allSettings, getSetting, openPane, setSetting } from './dispatch'
import { handoffSegment, handoffStart, handoffStatus, handoffToolCall, registerHandoff } from './handoff'
import { orchCatchDeny, orchGuardState, orchStart, orchToolDeny, registerOrch } from './orch'
import { panelButton, panelStart, panelToggle, registerPanel } from './panel'
import { SCHEMA, isKey } from './settings'
import { registerStatusline, statuslineStart } from './statusline'
import { registerTldr, tldrStart } from './tldr'
import { registerTools, toolsCommandRan, toolsCount, toolsStart } from './tools-pane'

const NO_HOOK = 'junkd: the hooks module did not answer'
const ROUTES: readonly JunkdHandoffRoute[] = ['auto', 'handoffs', 'settings']
const TOOLS_ROUTES: readonly JunkdToolsRoute[] = ['agents', 'tools', 'mcp', 'skills']
const reason = (err: unknown) => (err as Error)?.message ?? String(err)

export const register: Register = (on, options) => {
  // `$.junkd`. The host hands a noun's method one input and forbids the noun capturing `$`: schema and handoffStatus
  // need none and answer here; the rest throw unless the hooks below answer (they always do while this module runs).
  on('engine.create', async (_$, e, next) => ({
    ...(await next(e)),
    junkd: {
      schema: async () => SCHEMA.map(f => ({ ...f, ...(f.options ? { options: [...f.options] } : {}) })),
      config: async () => { throw new Error(NO_HOOK) },
      get: async () => { throw new Error(NO_HOOK) },
      set: async () => { throw new Error(NO_HOOK) },
      open: async () => { throw new Error(NO_HOOK) },
      handoffStatus: async () => handoffStatus(),
      orchGuardState: async () => { throw new Error(NO_HOOK) },
    },
  }))
  // A `{ deny }` here rejects the caller's promise with the reason (the host's own rule for a noun's event).
  on('junkd.get', async ($, e) => {
    if (!isKey(e?.key)) return { deny: `junkd: no setting ${String(e?.key)}` }
    try {
      return { value: await getSetting($, e.key) }
    } catch (err) {
      return { deny: reason(err) }
    }
  })
  on('junkd.set', async ($, e) => {
    if (!isKey(e?.key)) return { deny: `junkd: no setting ${String(e?.key)}` }
    if (e.scope !== undefined && e.scope !== 'user') return { deny: `junkd: scope ${String(e.scope)} is not supported yet` }
    try {
      const r = await setSetting($, e.key, e.value)
      return r.deny !== undefined ? { deny: r.deny } : { value: r.value }
    } catch (err) {
      return { deny: reason(err) }
    }
  })
  on('junkd.config', async $ => {
    try {
      return { value: await allSettings($) }
    } catch (err) {
      return { deny: reason(err) }
    }
  })
  on('junkd.open', async ($, e) => {
    const pane = e?.pane
    const route = e?.route
    // Each pane its own routes: the tools tabs on the tools pane, handoff's on the others (which refuse them).
    const known: readonly string[] = pane === 'tools' ? TOOLS_ROUTES : ROUTES
    if (route !== undefined && !known.includes(route)) return { deny: `junkd: no tab ${String(route)}` }
    try {
      if (pane === 'junkd') {
        if (route !== undefined) return { deny: `junkd: the junkd pane has no tab ${String(route)}` }
        await panelToggle($)
      } else if (pane === 'handoff' || pane === 'orch' || pane === 'statusline' || pane === 'tools') await openPane($, pane, route === undefined ? {} : { route })
      else return { deny: `junkd: no pane ${String(pane)}` }
    } catch (err) {
      return { deny: reason(err) }
    }
    return { value: undefined }
  })
  on('junkd.orchGuardState', async $ => ({ value: await orchGuardState($) }))

  // Every feature's start, side by side; one that fails leaves the others started, and its error is raised after.
  on('session.start', async ($, e, next) => {
    const failed = (await Promise.allSettled([coreStart($), handoffStart($), orchStart($), tldrStart($), ctxStart($), statuslineStart($), toolsStart($), panelStart($)])).find(
      r => r.status === 'rejected',
    )
    if (failed) throw failed.reason
    return next(e)
  })

  // orch's guard first (the model's own calls only), then handoff's gate past the context threshold, then the tools
  // pane's count of the model's call (it never throws). A hook that throws is skipped and the tool runs: the .catch
  // refuses instead while the guard holds the main loop.
  on('tool.call', async ($, e, next) => {
    const deny = next.origin.plugin === 'engine' ? await orchToolDeny($, e) : undefined
    if (deny) return { deny }
    const r = await handoffToolCall($, e, next)
    if (next.origin.plugin === 'engine') await toolsCount($, e, r)
    return r
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    const deny = orchCatchDeny(e.agentId)
    return deny ? { deny } : next(e)
  })

  // Every command, after it ran: the tools pane's Skills tab counts the slash runs. Registered before the features'
  // own command.run hooks, so it is the outermost and sees a run one of them answers.
  on('command.run', async ($, e, next) => {
    const r = await next(e)
    await toolsCommandRan($, e)
    return r
  })

  // What is beneath (another plugin's hint, or the engine's own line), then 🪃 (handoff) and ✚ junkd, side by side.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e)
    const below = await next(e).catch(() => undefined)
    const parts = [below, handoffSegment($, e), panelButton($, e)].filter(Boolean)
    if (parts.length === 1) return parts[0]!
    return (
      <Box flexDirection="row" gap={2}>
        {parts}
      </Box>
    )
  })

  registerCore(on, options)
  registerCache(on, options)
  registerHandoff(on, options)
  registerOrch(on, options)
  registerTldr(on, options)
  registerCtx(on, options)
  registerStatusline(on, options)
  registerTools(on, options)
  registerPanel(on, options)
}
