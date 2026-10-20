// tools: the `tools` settings group and the tools pane (junkd-tools): this session's agents on top of the repo's git
// worktrees, and the tools, MCP servers and skills the session used. The `$`-free parts are tools.ts (state, counters,
// parser, tree) and tools-views.tsx (drawing). index.tsx feeds the counters from its tool.call and command.run hooks,
// orch.tsx's agent.spawn hook records each spawn, handoff.tsx's turn.complete hook refreshes at the end of a turn.
// - enabled off: the pane closes, the /junkd set leaves its tab out (panel.tsx), /junkd:tools says it is off and
//   nothing is counted. refresh (10-600 s, clamped here) times the poll; agents_only hides the empty worktrees.
// - The poll runs only while the pane is open: it stops on q, on the pane's ×, when a drawing throws, and when a tick
//   finds the pane gone.
import type { AgentSpawnInput, AgentSpawnResult, CommandRunInput, On, RenderInput, ToolCallInput, ToolCallResult } from 'claude-code'
import type { HideInput, SetResult } from './feature'
import type { $ } from './feature'
import { T, applyToolsSettings, coerce, resetTools, countSkill, tallyTool, isField, isRoute, emptyCounters, readWorktrees, mergeAgents, pickTranscript, projectFolder, revealCommand, type Route } from './tools'
import { toolsView, type Els } from './tools-views'
import { configKey, configKeys, fieldOf, groupOptions, keyOf } from './settings'
import { dashboardSessionEnd } from './dashboard.tsx'
import { watchdogEnd } from './watchdog.tsx'

export const TOOLS_PANE_ID = 'junkd-tools'
export const OFF_TEXT = 'junkd: the tools pane is off: /junkd → tools → Tools pane: enabled'
const NO_TAB = (route: unknown) => `junkd: the tools pane has no tab ${String(route)} (agents, tools, mcp or skills)`
// The pane toggles themselves are no skill runs of the person's.
const NOT_COUNTED = new Set(['junkd', 'junkd:junkd', 'junkd:tools'])

type ToolsInput = { route?: string; focus?: boolean; owner?: string }

let timer: { cancel(): void } | null = null
let owner: string | undefined
let now = 0 // the clock at the last load or count: the Skills tab's `last` is drawn against it
const reason = (err: unknown) => (err as Error)?.message ?? String(err)

function redraw($: $) {
  return $.ui.invalidate('ui.render')
}

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}
// Paths follow CLAUDE_CONFIG_DIR like Claude Code itself.
async function configDir($: $) {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}

// loading -----------------------------------------------------------------------------------------------------------

// The agent list, the worktrees of the session's repo (`git worktree list --porcelain`; outside a repo, or where git
// fails, the session's directory alone) and the MCP schemas of the usage summary (estimated locally; a read that fails
// keeps the last). Only the newest of two loads side by side assigns.
let loads = 0
async function load($: $): Promise<void> {
  if (!T.open) return
  const gen = ++loads
  const listed = await $.agent.list().catch(() => undefined)
  const cwd = await $.session.cwd().catch(() => '')
  const git = cwd ? await $.process.run(['git', '-C', cwd, 'worktree', 'list', '--porcelain']).catch(() => undefined) : undefined
  const trees = git?.exitCode === 0 ? readWorktrees(git.stdout) : []
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  const at = await $.clock.now().catch(() => now)
  if (gen !== loads || !T.open) return
  if (listed) T.agents = mergeAgents(listed)
  T.worktrees = trees.length ? trees : [{ path: cwd, branch: '' }]
  T.mcp = usage?.context.breakdown?.mcpTools ?? T.mcp
  T.loaded = true
  now = at
  redraw($)
}

// A tick: the pane gone with no ui.close (a drawing that threw, say) ends the poll; else a load.
async function poll($: $): Promise<void> {
  const panes = await $.ui.panes().catch(() => undefined)
  if (panes && !panes.some(p => p.id === TOOLS_PANE_ID)) return closed()
  await load($)
}

function startPoll($: $) {
  timer?.cancel()
  timer = $.clock.every(T.refresh * 1000, () => void poll($))
}
function watch($: $) {
  T.open = true
  T.loaded = false
  startPoll($)
  void load($)
}
// The pane is gone, whoever closed it: no poll, no owner.
function closed() {
  T.open = false
  T.loaded = false
  owner = undefined
  timer?.cancel()
  timer = null
}

// `$.ui.open` before any await: only an open made while the press or command runs counts as asked. A refused open
// is no pane; one that waits undrawn (a narrow terminal) is open.
async function openPane($: $, route: Route | undefined, focus: boolean) {
  if (route) T.route = route
  const opened = $.ui.open({ id: TOOLS_PANE_ID, title: 'tools', focus: focus || undefined })
  owner = undefined
  watch($)
  await opened.catch(err => {
    closed()
    throw err
  })
}
// The engine does not raise our own `$.ui.close` to our ui.close hook, so the state is cleared here.
async function closePane($: $) {
  closed()
  await $.ui.close({ id: TOOLS_PANE_ID })
}

// the transcript ----------------------------------------------------------------------------------------------------

// This session's transcript: `$.session` names no path, so it is the `<session id>.jsonl` (else the newest .jsonl) in
// the project folder the engine keeps for the session's directory, <config dir>/projects/<cwd, each non-alphanumeric
// a dash>/. macOS shows it in Finder (`open -R`), elsewhere its folder opens (`xdg-open`). The outcome is a toast.
async function revealTranscript($: $): Promise<void> {
  let text: string
  try {
    const dir = `${await configDir($)}/projects/${projectFolder(await $.session.cwd())}`
    const name = pickTranscript(await $.fs.list(dir).catch(() => []), await $.session.id().catch(() => ''))
    if (name === undefined) text = `✗ no transcript in ${dir} yet: send a prompt first`
    else {
      const os = (await $.process.run(['uname', '-s']).catch(() => undefined))?.stdout.trim() ?? ''
      const argv = revealCommand(os, `${dir}/${name}`)
      const ran = await $.process.run(argv)
      text = ran.exitCode === 0 ? `✓ ${argv.join(' ')}` : `✗ ${ran.stderr.trim() || `${argv[0]} exited ${ran.exitCode}`}`
    }
  } catch (err) {
    text = `✗ ${reason(err)}`
  }
  $.ui.toast(text)
}

// settings ----------------------------------------------------------------------------------------------------------

// A value the row took lands in T. enabled off closes the pane and drops the counters; a new refresh retimes a
// running poll.
async function apply($: $, field: string, value: number | boolean): Promise<void> {
  applyToolsSettings({ enabled: T.enabled, refresh: T.refresh, agents_only: T.agentsOnly, [field]: value })
  if (field === 'refresh' && timer) startPoll($)
  if (field === 'enabled' && !T.enabled) {
    T.counters = emptyCounters()
    if (T.open) await closePane($)
  }
  redraw($)
}

// what index.tsx, dispatch.ts and the hooks call --------------------------------------------------------------------

export async function toolsGet(_$: $, field: string): Promise<number | boolean> {
  if (field === 'refresh') return T.refresh
  if (field === 'agents_only') return T.agentsOnly
  return T.enabled
}
// The host sends this write through the other plugins' hooks and skips ours below, so the value is applied here.
export async function toolsSet($: $, field: string, raw: unknown): Promise<SetResult> {
  if (!isField(field)) return { deny: `junkd: no setting ${keyOf('tools', field)}` }
  const c = coerce(field, raw)
  if (c.error !== undefined) return { deny: c.error }
  const { deny } = await $.config.set({ key: configKey(keyOf('tools', field)), value: c.value })
  if (deny !== undefined) return { deny }
  await apply($, field, c.value)
  return { value: c.value }
}

// show opens the pane (on `route`) and never closes it; up already, it is asked again (and switches to `route`).
// `owner` marks it as that caller's, for hide. Off: refused with the reason.
export async function toolsShow($: $, input: ToolsInput = {}): Promise<void> {
  if (input.route !== undefined && !isRoute(input.route)) throw new Error(NO_TAB(input.route))
  if (!T.enabled) throw new Error(OFF_TEXT)
  const opened = openPane($, input.route, input.focus === true)
  owner = input.owner
  await opened
}
// hide closes the pane; with `owner`, only while the pane is still the one that owner's show opened.
export async function toolsHide($: $, input: HideInput = {}): Promise<void> {
  if (input.owner !== undefined && input.owner !== owner) return
  await closePane($)
}
// open toggles the pane, as /junkd:tools does; a `route` while the pane is up switches its tab instead.
export async function toolsOpen($: $, input: ToolsInput = {}): Promise<void> {
  if (input.route !== undefined && !isRoute(input.route)) throw new Error(NO_TAB(input.route))
  if (!T.enabled) throw new Error(OFF_TEXT)
  if (input.route !== undefined && T.open) {
    T.route = input.route
    redraw($)
    return
  }
  if (T.open) return closePane($)
  return openPane($, input.route, true)
}

// The counters start with the session; a pane left open across a /reload-plugins polls again, or closes while off.
export async function toolsStart($: $): Promise<void> {
  T.since = await $.clock.now().catch(() => T.since)
  now = T.since
  if (!(await $.ui.panes().catch(() => [])).some(p => p.id === TOOLS_PANE_ID)) return
  if (T.enabled) watch($)
  else await $.ui.close({ id: TOOLS_PANE_ID })
}

// index.tsx's tool.call, for the model's own calls only: one more call of the tool, on the main loop or a subagent
// (`agentId`), with the length of the result the model read; a Skill call is a skill run too. A refused call is none.
// Never throws: tool.call's .catch would run the tool a second time.
export async function toolsCount($: $, e: ToolCallInput, r: ToolCallResult): Promise<void> {
  try {
    if (!T.enabled || r.deny !== undefined) return
    tallyTool(T.counters, e.tool, e.agentId !== undefined, r.text?.length ?? 0)
    const { skill } = e as { skill?: unknown }
    if (e.tool === 'Skill' && typeof skill === 'string') countSkill(T.counters, skill, 'tool', (now = await $.clock.now()))
    if (T.open) redraw($)
  } catch {}
}

// index.tsx's command.run, after the command ran: a slash run of a plugin's or the person's skill or command (by the
// command list's source), typed or sent by the person's client; not a plugin's $.command.run, a built-in or an MCP
// prompt, nor the pane toggles. The list is read again for a name it lacks (a /reload-plugins).
let sources = new Map<string, string>()
export async function toolsCommandRan($: $, e: CommandRunInput): Promise<void> {
  try {
    if (!T.enabled || e.origin.kind === 'plugin' || NOT_COUNTED.has(e.command)) return
    if (!sources.has(e.command)) sources = new Map((await $.command.list()).map(c => [c.name, c.source]))
    const source = sources.get(e.command)
    const counted = source === 'user' || source === 'plugin'
    if (!counted) return
    countSkill(T.counters, e.command, 'slash', (now = await $.clock.now()))
    if (T.open) redraw($)
  } catch {}
}

// orch.tsx's agent.spawn, once the agent started: the model it got and the directory it runs in (the call's cwd,
// else the session's), which the agent list has neither of; then the tree reads the list again.
export async function toolsSpawned($: $, e: AgentSpawnInput, r: AgentSpawnResult): Promise<void> {
  try {
    if (!T.enabled || r.agentId === undefined) return
    T.spawned[r.agentId] = { model: r.model, cwd: e.cwd ?? (await $.session.cwd().catch(() => '')), ...(e.name ? { name: e.name } : {}) }
    void load($)
  } catch {}
}

// handoff.tsx's turn.complete: a turn's end (the main loop's or an agent's) reads the tree again.
export function toolsTurnEnd($: $): void {
  if (T.open) void load($)
}

export function registerTools(on: On, options: Record<string, unknown>): void {
  timer?.cancel()
  timer = null
  owner = undefined
  sources = new Map()
  resetTools()
  applyToolsSettings(groupOptions(options, 'tools'))

  // The /config menu's own writes to a tools row land here (a hook never sees its plugin's own `$.config.set`): read as
  // `set` reads it, refused where `set` refuses, applied once the row took it.
  on('config.set', { key: configKeys('tools') }, async ($, e, next) => {
    const field = fieldOf('tools', e.key)
    if (!isField(field)) return next(e)
    const c = coerce(field, e.value)
    if (c.error !== undefined) return { deny: c.error }
    const r = await next({ ...e, value: c.value })
    if (r.deny === undefined) await apply($, field, c.value)
    return r
  })

  // /junkd:tools toggles the pane; /junkd:tools <tab> opens it on that tab, or switches to it.
  on('command.run', { command: 'junkd:tools' }, async ($, e) => {
    if (!T.enabled) return { text: OFF_TEXT }
    const route = e.args.trim().toLowerCase()
    if (route !== '' && !isRoute(route)) return { text: NO_TAB(route) }
    try {
      if (route === '') await toolsOpen($)
      else if (T.open) await toolsOpen($, { route })
      else await openPane($, route, true)
    } catch (err) {
      return { text: `✗ ${reason(err)}` }
    }
    return {}
  })

  // A /clear or a /resume ends the session and the process goes on under another, with no session.start: the counters
  // and the agents seen start over. The folds and the selection stay.
  on('session.end', async ($, end, next) => {
    dashboardSessionEnd() // the module's one session.end hook: the orch dashboard's timer stops too
    if (end.reason === 'resume' || end.reason === 'clear') {
      T.counters = emptyCounters()
      T.seen = Object.create(null)
      T.agents = []
      T.since = await $.clock.now().catch(() => T.since)
      if (T.open) {
        redraw($)
        void load($)
      }
    }
    await watchdogEnd($, end.reason) // the watchdog: /clear and /resume start over, any other end stops its timer
    return next(end)
  })

  // The arrows move the focus ring along the agent rows: the row it lands on is the selection.
  on('ui.focus', { requestId: TOOLS_PANE_ID }, ($, e, next) => {
    if (e.element?.startsWith('node:')) {
      T.selected = e.element.slice('node:'.length)
      redraw($)
    }
    return next(e)
  })

  // The person's closes (q, ×) pass here; ours go through closePane.
  on('ui.close', { id: TOOLS_PANE_ID }, (_$, e, next) => {
    closed()
    return next(e)
  })

  // A drawing that throws ends the poll (the engine drops what it could not draw).
  on('ui.render', { component: 'Pane', requestId: TOOLS_PANE_ID }, ($, e: RenderInput<'Pane'>, next) => {
    if (e.surface === 'mobile') return next(e)
    try {
      return toolsView($.ui.resolve(e) as Els, e.props, now, {
        close: () => void closePane($),
        go: route => {
          T.route = route
          redraw($)
        },
        refresh: () => void load($),
        reveal: () => void revealTranscript($),
        redraw: () => void redraw($),
        focus: key => void $.ui.focus({ requestId: TOOLS_PANE_ID, key }).catch(() => undefined), // a refused ring is no error
      })
    } catch (err) {
      closed()
      throw err
    }
  })
}
