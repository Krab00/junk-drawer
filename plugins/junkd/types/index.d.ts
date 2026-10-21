// What `$.junkd` offers other mods: the plugin's settings (every userConfig row), its panes, and the two live
// reads handoff and orch had on their own nouns before they moved into junkd.
//
// The host builds a noun as one flat object of methods (`$.<noun>.<method>`, one event each): a member that is an
// object is refused at load. So the former `$.handoff`, `$.orch` and `$.tldr` surfaces are not nested objects here:
// their settings are rows of the one schema (key `<group>_<field>`), their panes are `open`'s `pane`, and their
// live reads are `handoffStatus` and `orchGuardState`.
//
// A setting's key is its userConfig row, `<group>_<field>` (`handoff_threshold`): the host takes only identifier
// keys in a manifest's userConfig, so the group and the field are joined by `_`, and the /config row is
// `junkd.<group>_<field>`. The group is the part before the first `_`.

export type JunkdGroup = 'core' | 'handoff' | 'orch' | 'tldr' | 'ctx' | 'statusline' | 'tools'
export type JunkdHandoffField = 'enabled' | 'threshold' | 'checkEvery' | 'autoOn' | 'resumeAfterLimit' | 'staleDays' | 'segment'
export type JunkdOrchField = 'enabled' | 'guard' | 'allow_fable_agents' | 'implementer_ctx_k' | 'ui_review' | 'inject_rules' | 'rounds' | 'claude_md' | JunkdOrchDashboardField | JunkdOrchWatchdogField | 'lessons'
// The orch dashboard's two rows (orch_dashboard_refresh, orch_dashboard_window_h), clamped in code.
export type JunkdOrchDashboardField = 'dashboard_refresh' | 'dashboard_window_h'
// The agent watchdog's rows (hooks/watchdog.tsx): the whole watchdog, stopping idle leftovers, the idle minutes before a
// stop and the stall minutes of an implementer (a reviewer's are 5 more).
export type JunkdOrchWatchdogField = 'watchdog' | 'idle_stop' | 'idle_stop_minutes' | 'stall_minutes'
export type JunkdTldrField = 'enabled' | 'terse' | 'sentences'
export type JunkdCoreField = 'output_style' | 'cache_check_sessions'
export type JunkdCtxField = 'enabled' | 'threshold' | 'action' | 'cmd'
// The status line's segments, in the order the line draws them; each is the row `statusline_<segment>`.
export type JunkdStatuslineSegment = 'ctx' | 'branch' | 'worktree' | 'model' | 'effort' | 'limits'
export type JunkdStatuslineField = 'enabled' | JunkdStatuslineSegment
export type JunkdToolsField = 'enabled' | 'refresh' | 'agents_only'
export type JunkdKey =
  | `core_${JunkdCoreField}`
  | `handoff_${JunkdHandoffField}`
  | `orch_${JunkdOrchField}`
  | `tldr_${JunkdTldrField}`
  | `ctx_${JunkdCtxField}`
  | `statusline_${JunkdStatuslineField}`
  | `tools_${JunkdToolsField}`
export type JunkdValue = string | number | boolean
export type JunkdOrchGuard = 'fable' | 'always' | 'off'
export type JunkdStyle = 'ste' | 'off'
export type JunkdCtxAction = 'block' | 'warn' | 'cmd'

// One row of schema(): the manifest's userConfig row (a string row with `options` is a choice), its group and
// field, and `main` (the rows the /junkd pane draws in its Settings section; the rest live in the feature's pane).
export type JunkdSchemaEntry = {
  key: JunkdKey
  group: JunkdGroup
  field: string
  type: 'string' | 'number' | 'boolean'
  title: string
  default: JunkdValue
  main: boolean
  options?: readonly string[]
}

export type JunkdHandoffRoute = 'auto' | 'handoffs' | 'settings'
// The tools pane's tabs: the agents tree, the tool table, the MCP servers, the skills run.
export type JunkdToolsRoute = 'agents' | 'tools' | 'mcp' | 'skills'
export type JunkdHandoffPhase = 'idle' | 'handoff' | 'clear' | 'resume'
export type JunkdHandoffStatus = { armed: boolean; percent: number; phase: JunkdHandoffPhase }
// Whether the main-loop guard holds right now (enabled and guard against the live main-loop model), and that model.
export type JunkdOrchGuardState = { active: boolean; model: string }
// The handoff loop as it mirrors itself into `$.state` (a status-line mod reads it).
export type JunkdAhandoff = {
  on: boolean
  phase: JunkdHandoffPhase
  percent: number
  threshold: number
  checkEvery: number
  prompt: string
  lastId: string
  count: number
  route: JunkdHandoffRoute
  paneOpen: boolean
  // What a reloaded module needs to carry on the loop it was running (session-scoped, unlike the store): the
  // fresh window's baseline and whether its first measurement is still pending. Absent in a value an older build wrote.
  base?: number
  fresh?: boolean
}

// Every call through `$` resolves asynchronously (a noun's method is an event), and the host hands a method one
// input, so each takes one object. `set`'s `scope`: only `user` (the /config row, user-global) exists today. A
// refused call (unknown key, a value that does not fit, a scope not yet supported, a `config.set` hook's deny, an
// unknown pane or route) rejects the promise with the reason.
export type JunkdGetInput = { key: JunkdKey }
export type JunkdSetInput = { key: JunkdKey; value: JunkdValue; scope?: 'user' }
// `open` toggles one pane: `junkd` is the /junkd set (junkd, handoff, orch, statusline, tools and lessons as tabs),
// `handoff`, `orch`, `statusline`, `tools` and `lessons` the feature's own pane. `route` opens on that tab, or switches to it while the pane
// is up: each pane takes its own routes (handoff a JunkdHandoffRoute, tools a JunkdToolsRoute) and refuses the others;
// junkd, orch, statusline and lessons have no tabs.
export type JunkdPane = 'junkd' | 'handoff' | 'orch' | 'statusline' | 'tools' | 'lessons'
export type JunkdOpenInput = { pane: JunkdPane; route?: JunkdHandoffRoute | JunkdToolsRoute }

export type Junkd = {
  schema(): Promise<JunkdSchemaEntry[]>
  // Every row's current value, by key.
  config(): Promise<Record<JunkdKey, JunkdValue>>
  get(input: JunkdGetInput): Promise<JunkdValue>
  set(input: JunkdSetInput): Promise<JunkdValue>
  open(input: JunkdOpenInput): Promise<void>
  handoffStatus(): Promise<JunkdHandoffStatus>
  orchGuardState(): Promise<JunkdOrchGuardState>
}

declare module 'claude-code' {
  interface PluginState {
    junkd: { ahandoff: JunkdAhandoff }
  }
  interface EngineInterface {
    junkd: Junkd
  }
}
