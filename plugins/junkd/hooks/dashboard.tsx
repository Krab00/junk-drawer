// The orch dashboard, `$` side: collects what the module knows (the agent list and the spawns, each agent's tool
// calls, the SubagentStop records, the task store, the rate limits), writes status.js beside a copy of the page and
// opens it. The builder and the parsers are dashboard.ts (`$`-free); the page is skills/orch/dashboard/.
// - Where: ${CLAUDE_CONFIG_DIR:-~/.claude}/junkd/orch/dashboard/<repo hash>/ with index.html, scale.js, status.js and
//   the `open` flag. The hash is host-lib's jd_hash8 of the session's git toplevel (bin/orch-status derives the same
//   folder); a session in no repo uses `_none`.
// - When: only while the dashboard is open (the `open` flag file: /junkd:dashboard writes it, `close` removes it,
//   bin/orch-status --open writes it too), at each spawn, each agent's end and each turn's end, and every
//   orch_dashboard_refresh seconds (5-600) on a timer the module owns, cancelled on session.end and on close. Nothing
//   while orch_enabled is off.
// - What: the phases each spawn opens on its task (implement, verify, fix, done; dashboard.ts kindOf) and its end
//   closes (killed when it failed, was killed, or left the list with no SubagentStop record), kept in status.js
//   itself: the first write of a module reads the file back and merges, so a /reload-plugins keeps the history.
// - The write is atomic: status.js.tmp, then `mv` (the engine's fs has no rename); a refused mv writes the file
//   whole and removes the .tmp.
// index.tsx calls dashboardStart and dashboardToolCall, orch.tsx dashboardSpawned, dashboardAgentStop, dashboardOpen,
// dashboardClose and dashboardRetime, handoff.tsx dashboardTurnEnd, tools-pane.tsx dashboardSessionEnd.
import type { AgentInfo, AgentSpawnInput, AgentSpawnResult, On, ToolCallInput, ToolCallResult } from 'claude-code'
import type { $ } from './feature'
import { O } from './orch-lib'
import {
  MAX_AGENT_EVENTS, MAX_EVENTS, buildStatus, ctxText, isTaskFile, kindOf, mergePhases, openArgv, orchRoot, parseLessons, parseTask, parseVerification,
  readStatusJs, relTo, roleOf, shortModel, stateOf, statusJs, stepOf, taskOf, tasksDirOf,
  type DashAgent, type DashEvent, type Lesson, type Phase, type TaskHead, type Verdicts,
} from './dashboard.ts'

export const DASH_OFF = 'junkd: the orch dashboard is off while orch is disabled (/junkd:orch panel → Orchestrator: enabled)'
const PAGE_FILES: readonly [string, string][] = [['orch-dashboard.html', 'index.html'], ['scale.js', 'scale.js']]

// One agent as the module saw it: from its spawn, the agent list and its own tool calls.
type Seen = {
  id: string
  name: string
  type: string
  model: string
  cwd: string
  task?: string
  status?: AgentInfo['status']
  listed?: boolean // the list has named it once: only then is its leaving the list an end
  gone?: boolean
  stopped?: boolean // a SubagentStop record (this module's, or the one on disk)
  tokens?: number
  lastCall?: number
  lastStep?: string
  branch?: string
  events: DashEvent[]
  // What agent.spawn said, until a write places it on its task (the store is read only while a dashboard is open),
  // and its end when it ended before that.
  spawn?: { at: number; cwd: string; name?: string; description: string; prompt: string }
  ended?: { at: number; killed: boolean; tokens?: number }
}

// ponytail: module state, a fresh one per load (register); status.js carries the history across loads.
const D = {
  dir: '', // the folder the history below belongs to
  phases: Object.create(null) as Record<string, Phase[]>,
  seen: new Map<string, Seen>(),
  events: [] as DashEvent[],
  before: [] as DashAgent[], // the agents of the status.js read back
  ids: [] as string[], // the task ids of the last store read
  timer: null as { cancel(): void } | null,
}
function resetDashboard(): void {
  D.timer?.cancel()
  Object.assign(D, { dir: '', phases: Object.create(null), seen: new Map(), events: [], before: [], ids: [], timer: null })
}

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}
async function configDir($: $) {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}

// The session's git toplevel ('' outside a repo) and its folder's hash, both cached: the hash by host-lib's own rule
// (`jd_hash8`, the handoff ids' helper), so bin/orch-status lands in the same folder. undefined: no hash came out.
const tops = new Map<string, string>()
async function toplevel($: $): Promise<string> {
  const cwd = await $.session.cwd().catch(() => '')
  if (!cwd) return ''
  let top = tops.get(cwd)
  if (top === undefined) {
    const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined)
    top = r?.exitCode === 0 ? r.stdout.trim() : ''
    tops.set(cwd, top)
  }
  return top
}
const hashes = new Map<string, string>()
async function repoHash($: $, top: string): Promise<string | undefined> {
  if (!top) return '_none'
  const known = hashes.get(top)
  if (known) return known
  const r = await $.process.run(['bash', '-c', '. "$1" && jd_hash8 "$2"', 'jd', `${$.plugin.root}/bin/host-lib`, top]).catch(() => undefined)
  const hash = r?.exitCode === 0 ? r.stdout.trim() : ''
  if (!/^[0-9a-f]{8}$/.test(hash)) return undefined
  hashes.set(top, hash)
  return hash
}
async function dashDir($: $): Promise<{ dir: string; top: string } | undefined> {
  const top = await toplevel($)
  const hash = await repoHash($, top)
  return hash === undefined ? undefined : { dir: `${await configDir($)}/junkd/orch/dashboard/${hash}`, top }
}

// The SubagentStop record scripts/orch-agent-stop.sh wrote for an agent (orch.tsx reads the same file).
async function hasRecord($: $, id: string): Promise<boolean> {
  const sid = await $.session.id().catch(() => '')
  if (!/^[A-Za-z0-9_-]+$/.test(sid) || !/^[A-Za-z0-9_-]+$/.test(id)) return false
  return $.fs.exists(`${await configDir($)}/junkd/orch/_agents/${sid}/${id}.json`).catch(() => false)
}

// the store ---------------------------------------------------------------------------------------------------------

type Store = { root: string; tasks: { head: TaskHead; verdicts?: Verdicts }[]; lessons: Lesson[] }
async function storeDir($: $, top: string): Promise<{ root: string; dir: string }> {
  const candidates = [top]
  for (let up = top; up.includes('/.worktrees/'); ) candidates.push((up = up.slice(0, up.lastIndexOf('/.worktrees/'))))
  const has = new Set<string>()
  for (const c of candidates) if (await $.fs.exists(`${c}/.orch`).catch(() => false)) has.add(c)
  const root = orchRoot(top, d => has.has(d))
  const config = await $.fs.read(`${root}/.orch/config.md`).catch(() => undefined)
  return { root, dir: `${root}/${tasksDirOf(config)}` }
}
const byId = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
// Each task file of the store (a file that cannot be read, or has no frontmatter, is left out) and _lessons.md.
async function readStore($: $, top: string): Promise<Store> {
  if (!top) return { root: '', tasks: [], lessons: [] }
  const { root, dir } = await storeDir($, top)
  const names = (await $.fs.list(dir).catch(() => [])).filter(e => e.kind === 'file' && isTaskFile(e.name)).map(e => e.name).sort(byId)
  const tasks: Store['tasks'] = []
  for (const name of names) {
    const text = await $.fs.read(`${dir}/${name}`).catch(() => undefined)
    const head = text === undefined ? undefined : parseTask(name, text)
    if (!head) continue
    const verdicts = parseVerification(text!)
    tasks.push(verdicts ? { head, verdicts } : { head })
  }
  D.ids = tasks.map(t => t.head.id)
  return { root, tasks, lessons: parseLessons(await $.fs.read(`${dir}/_lessons.md`).catch(() => '')) }
}
// the history -------------------------------------------------------------------------------------------------------

const isPhase = (p: unknown): p is Phase => typeof p === 'object' && p !== null && typeof (p as Phase).start === 'number' && typeof (p as Phase).agent === 'string'
const isEvent = (e: unknown): e is DashEvent => typeof e === 'object' && e !== null && typeof (e as DashEvent).text === 'string'
// The status.js of this folder read back once per folder: its phases and events under the ones in memory, its agents
// as they were. A file that does not parse is no history.
async function loadPrevious($: $, dir: string): Promise<void> {
  if (D.dir === dir) return
  if (D.dir !== '') Object.assign(D, { phases: Object.create(null), events: [], before: [], ids: [] })
  D.dir = dir
  const prev = readStatusJs(await $.fs.read(`${dir}/status.js`).catch(() => undefined))
  if (!prev) return
  for (const t of Array.isArray(prev.tasks) ? prev.tasks : []) {
    if (typeof t?.id !== 'string' || !Array.isArray(t.phases)) continue
    D.phases[t.id] = mergePhases(D.phases[t.id] ?? [], t.phases.filter(isPhase))
  }
  const mine = new Set(D.events.map(e => `${e.t} ${e.text}`))
  D.events = [...D.events, ...(Array.isArray(prev.events) ? prev.events.filter(isEvent).filter(e => !mine.has(`${e.t} ${e.text}`)) : [])].slice(0, MAX_EVENTS)
  D.before = (Array.isArray(prev.agents) ? prev.agents : []).filter(a => typeof a?.name === 'string')
}

function event(text: string, kind: DashEvent['kind'], t: number): void {
  D.events.unshift({ t, text, kind })
  D.events.length = Math.min(D.events.length, MAX_EVENTS)
}
// Every open phase of an agent ends now; killed marks it so (the page hatches it). A spawn not placed yet keeps its
// end for the placing. The count of what ended: 0 when nothing was open.
function closePhases(id: string, now: number, killed: boolean, tokens?: number): number {
  let n = 0
  const s = D.seen.get(id)
  if (s?.spawn && !s.ended) {
    s.ended = { at: now, killed, ...(tokens !== undefined ? { tokens } : {}) }
    n++
  }
  for (const ps of Object.values(D.phases))
    for (const p of ps) {
      if (!p.open || p.id !== id) continue
      p.open = false
      p.end = now
      if (tokens !== undefined) p.ctx = ctxText(tokens)
      if (killed) {
        p.killed = true
        p.note = p.note ?? 'killed'
      }
      n++
    }
  return n
}
// Each spawn not placed yet goes on the task it names (taskOf), as a phase from its start: implement, verify, fix (an
// implementer on a task with a verify phase before it) or done; open, or closed where it already ended. A spawn
// naming no task is no phase.
function place(ids: readonly string[]): void {
  for (const s of D.seen.values()) {
    const sp = s.spawn
    if (!sp) continue
    delete s.spawn
    const task = taskOf(ids, sp)
    if (!task) continue
    s.task = task
    const ps = (D.phases[task] ??= [])
    const kind = kindOf(s.type, `${s.name} ${sp.description}`, ps.some(p => p.kind === 'verify' && p.start <= sp.at))
    const phase: Phase = { agent: s.name, model: s.model, kind, start: sp.at, end: s.ended?.at ?? sp.at, ctx: ctxText(s.ended?.tokens), id: s.id, open: !s.ended }
    if (s.ended?.killed) Object.assign(phase, { killed: true, note: 'killed' })
    ps.push(phase)
    ps.sort((a, b) => a.start - b.start)
  }
}
const openIds = () => new Set(Object.values(D.phases).flatMap(ps => ps.filter(p => p.open && p.id).map(p => p.id!)))

// The list read now: each agent's status; an agent done in it ends its phases (failed or killed: killed); one that
// was listed and is gone ends them too, killed when no SubagentStop record says it stopped. So do the open phases of
// agents the module never saw (a status.js read back after a reload) that the list no longer has. A list that could
// not be read changes nothing.
async function noteAgents($: $, listed: AgentInfo[], now: number): Promise<void> {
  const ids = new Set(listed.map(a => a.id))
  for (const a of listed) {
    let s = D.seen.get(a.id)
    if (!s) D.seen.set(a.id, (s = { id: a.id, name: a.name || a.description || a.id, type: a.type, model: '—', cwd: '', events: [] }))
    if (a.name) s.name = a.name
    s.listed = true
    s.status = a.status
    const state = stateOf(a.status)
    if ((state === 'done' || state === 'dead') && closePhases(a.id, now, state === 'dead', s.tokens)) event(`${s.name} ${state === 'dead' ? a.status : 'done'}`, state === 'dead' ? 'fail' : 'info', now)
  }
  for (const s of D.seen.values()) {
    if (ids.has(s.id) || !s.listed || s.gone) continue
    s.gone = true
    if (!s.stopped) s.stopped = await hasRecord($, s.id)
    if (closePhases(s.id, now, !s.stopped, s.tokens)) event(s.stopped ? `${s.name} done` : `${s.name} dead: no SubagentStop record`, s.stopped ? 'info' : 'fail', now)
  }
  for (const id of openIds()) {
    if (ids.has(id) || D.seen.has(id)) continue
    const stopped = await hasRecord($, id)
    closePhases(id, now, !stopped)
  }
}

// The agents as the page draws them: the ones seen, then the ones read back that are not (as they were, a running one
// as done with a record, dead without).
async function agentsOut($: $, now: number, root: string, rounds: Map<string, number>): Promise<DashAgent[]> {
  const out: DashAgent[] = []
  for (const s of D.seen.values()) {
    const state = s.gone ? (s.stopped ? 'done' : 'dead') : stateOf(s.status)
    if (s.cwd && state !== 'done' && state !== 'dead') {
      const r = await $.process.run(['git', '-C', s.cwd, 'rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined)
      if (r?.exitCode === 0) s.branch = r.stdout.trim()
    }
    const a: DashAgent = {
      id: s.id,
      name: s.name,
      role: roleOf(s.type) || '—',
      model: s.model,
      status: state,
      lastCallSec: s.lastCall === undefined ? null : Math.max(0, Math.round((now - s.lastCall) / 1000)),
      ctx: ctxText(s.tokens),
      events: s.events,
    }
    if (s.task) a.task = s.task
    if (s.task && rounds.has(s.task)) a.round = rounds.get(s.task)
    if (s.branch) a.branch = s.branch
    if (s.cwd) a.worktree = relTo(root, s.cwd)
    if (s.lastStep) a.lastStep = s.lastStep
    if (state === 'dead' && s.gone) a.deadNote = `no SubagentStop record${s.lastStep ? ` · last: ${s.lastStep}` : ''}`
    out.push(a)
  }
  const names = new Set(out.map(a => a.name))
  for (const b of D.before) {
    if ((b.id && D.seen.has(b.id)) || names.has(b.name)) continue
    if (b.status === 'running' || b.status === 'waiting' || b.status === 'queued') {
      const stopped = b.id ? await hasRecord($, b.id) : false
      out.push({ ...b, status: stopped ? 'done' : 'dead', ...(stopped ? {} : { deadNote: 'gone across a reload, no SubagentStop record' }) })
    } else out.push(b)
  }
  return out
}

// Whether any repo's dashboard is open (a folder under junkd/orch/dashboard/ holding the flag): the cheap check before
// a write needs git for this session's folder.
async function anyOpen($: $): Promise<boolean> {
  const base = `${await configDir($)}/junkd/orch/dashboard`
  for (const d of await $.fs.list(base).catch(() => [])) if (d.kind === 'dir' && (await $.fs.exists(`${base}/${d.name}/open`).catch(() => false))) return true
  return false
}

// the write ---------------------------------------------------------------------------------------------------------

async function writeAtomic($: $, path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`
  await $.fs.write(tmp, text)
  const mv = await $.process.run(['mv', '-f', tmp, path]).catch(() => undefined)
  if (mv?.exitCode === 0) return
  await $.fs.write(path, text)
  await $.process.run(['rm', '-f', tmp]).catch(() => undefined)
}

export type WriteResult = 'off' | 'closed' | 'nowhere' | 'written' | 'failed'
// One status.js, while orch is enabled and the dashboard is open. Never throws: a failure is `failed`.
export async function dashboardWrite($: $): Promise<WriteResult> {
  try {
    if (!O.enabled) return 'off'
    if (!(await anyOpen($))) return 'closed' // no git, no store read in a session no dashboard watches
    const where = await dashDir($)
    if (!where) return 'nowhere'
    if (!(await $.fs.exists(`${where.dir}/open`).catch(() => false))) return 'closed'
    await loadPrevious($, where.dir)
    const now = await $.clock.now()
    const listed = await $.agent.list().catch(() => undefined)
    if (listed) await noteAgents($, listed, now)
    const store = await readStore($, where.top)
    place(store.tasks.map(x => x.head.id))
    const usage = await $.session.usage().catch(() => undefined)
    const rounds = new Map(store.tasks.filter(t => t.verdicts).map(t => [t.head.id, t.verdicts!.round]))
    const agents = await agentsOut($, now, store.root, rounds)
    const top = where.top
    const branch = top ? await $.process.run(['git', '-C', top, 'rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined) : undefined
    const status = buildStatus({
      now,
      windowH: O.dashboard_window_h,
      repo: (store.root || top).replace(/\/+$/, '').split('/').pop() ?? '',
      branch: branch?.exitCode === 0 ? branch.stdout.trim() : '',
      root: store.root,
      tasks: store.tasks,
      phases: D.phases,
      agents,
      events: D.events,
      lessons: store.lessons,
      usage: usage?.rateLimits ?? [],
    })
    await writeAtomic($, `${where.dir}/status.js`, statusJs(status))
    return 'written'
  } catch {
    return 'failed'
  }
}

function stopTimer(): void {
  D.timer?.cancel()
  D.timer = null
}
async function tick($: $): Promise<void> {
  const r = await dashboardWrite($)
  if (r === 'off' || r === 'closed') stopTimer()
}
function startTimer($: $): void {
  stopTimer()
  D.timer = $.clock.every(O.dashboard_refresh * 1000, () => void tick($))
}

// what the other files call -----------------------------------------------------------------------------------------

// /junkd:dashboard, /junkd:orch dashboard and the orch pane's `dashboard: open ▸`: the flag, the page copied from the
// plugin (so an update reaches it), a write, the timer, and the page opened (`open`, `xdg-open`); a toast with the
// path either way. The answer is the command's text, '' when the toast said it.
export async function dashboardOpen($: $): Promise<string> {
  if (!O.enabled) return DASH_OFF
  try {
    const where = await dashDir($)
    if (!where) return '✗ dashboard: the repo folder could not be hashed (host-lib: no shasum, md5sum or md5)'
    await $.fs.write(`${where.dir}/open`, '')
    for (const [from, to] of PAGE_FILES) await $.fs.write(`${where.dir}/${to}`, await $.fs.read(`${$.plugin.root}/skills/orch/dashboard/${from}`))
    await dashboardWrite($)
    startTimer($)
    const page = `${where.dir}/index.html`
    const os = (await $.process.run(['uname', '-s']).catch(() => undefined))?.stdout ?? ''
    const ran = await $.process.run(openArgv(os, page)).catch(() => undefined)
    $.ui.toast(ran?.exitCode === 0 ? `✓ dashboard: ${page}` : `dashboard: open ${page} in a browser`)
    return ''
  } catch (err) {
    return `✗ dashboard: ${(err as Error)?.message ?? String(err)}`
  }
}
// The flag gone and the timer stopped: nothing writes status.js until the next open (the page keeps its last data).
export async function dashboardClose($: $): Promise<string> {
  stopTimer()
  const where = await dashDir($).catch(() => undefined)
  if (where) await $.process.run(['rm', '-f', `${where.dir}/open`]).catch(() => undefined)
  $.ui.toast('dashboard: closed, status.js is no longer written')
  return ''
}
// A new orch_dashboard_refresh retimes a running timer.
export function dashboardRetime($: $): void {
  if (D.timer) startTimer($)
}
// The flag left by an earlier session (or bin/orch-status --open): the cadence starts again.
export async function dashboardStart($: $): Promise<void> {
  if ((await dashboardWrite($)) === 'written') startTimer($)
}
// A turn's end writes; one after a session.end (which cancelled the timer) starts the timer again.
export async function dashboardTurnEnd($: $): Promise<void> {
  if ((await dashboardWrite($)) === 'written' && !D.timer) startTimer($)
}
export function dashboardSessionEnd(): void {
  stopTimer()
}

// orch.tsx's agent.spawn, once the agent started: the agent, and what a write needs to place it on its task. Never
// throws.
export async function dashboardSpawned($: $, e: AgentSpawnInput, r: AgentSpawnResult): Promise<void> {
  try {
    if (!O.enabled || r.agentId === undefined) return
    const now = await $.clock.now()
    const cwd = e.cwd ?? (await $.session.cwd().catch(() => ''))
    const name = e.name || e.description || r.agentId
    D.seen.set(r.agentId, {
      id: r.agentId, name, type: e.subagentType, model: shortModel(r.model), cwd, events: [],
      spawn: { at: now, cwd, ...(e.name ? { name: e.name } : {}), description: e.description, prompt: e.prompt },
    })
    event(`${name} started`, 'info', now)
    await dashboardWrite($)
  } catch {}
}
// orch.tsx's classic.SubagentStop: the agent stopped with a record; its phases end with its context. Never throws.
export async function dashboardAgentStop($: $, id: string, tokens: number | undefined): Promise<void> {
  try {
    if (!O.enabled) return
    const now = await $.clock.now()
    const s = D.seen.get(id)
    if (s) {
      s.stopped = true
      if (tokens !== undefined) s.tokens = tokens
    }
    if (closePhases(id, now, false, tokens)) event(`${s?.name ?? id} done`, 'info', now)
    else if (!s) D.seen.set(id, { id, name: id, type: '', model: '—', cwd: '', events: [], stopped: true, ...(tokens !== undefined ? { tokens } : {}) })
    await dashboardWrite($)
  } catch {}
}
// index.tsx's tool.call, for a subagent's own calls: its last call and step, and the call as one of its events.
// Never throws (tool.call's .catch would run the tool a second time).
export async function dashboardToolCall($: $, e: ToolCallInput, r: ToolCallResult): Promise<void> {
  try {
    const id = (e as { agentId?: string }).agentId
    if (!O.enabled || id === undefined) return
    const now = await $.clock.now()
    let s = D.seen.get(id)
    if (!s) D.seen.set(id, (s = { id, name: id, type: '', model: '—', cwd: '', events: [] }))
    s.lastCall = now
    s.lastStep = stepOf(e.tool, e as unknown as Record<string, unknown>)
    s.events.unshift({ t: now, text: s.lastStep, kind: r.deny !== undefined ? 'fail' : 'info' })
    s.events.length = Math.min(s.events.length, MAX_AGENT_EVENTS)
  } catch {}
}

export function registerDashboard(on: On, _options: Record<string, unknown>): void {
  resetDashboard()
  tops.clear()
  hashes.clear()

  // /junkd:dashboard opens it (again: the page is copied, status.js written, the browser asked); `close` stops it.
  on('command.run', { command: 'junkd:dashboard' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'open' && arg !== 'close') return { text: 'junkd: /junkd:dashboard takes nothing (open) or close' }
    const text = arg === 'close' ? await dashboardClose($) : await dashboardOpen($)
    return text ? { text } : {}
  })
}
