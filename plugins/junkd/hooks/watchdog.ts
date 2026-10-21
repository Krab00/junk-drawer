// The agent watchdog's `$`-free half: the rules (assess), the reducer the 30 s timer drives (tick), and the texts the
// module shows (toasts, the injected line, the ⚠ segment, the tools pane's suffix, the /junkd:orch watchdog table).
// watchdog.tsx feeds it: the agent list, the tool calls and spawns it saw, the SubagentStop records, the task files.
// No model is in the loop and nothing is ever respawned.
//
// Per agent of this session that the main loop spawned (a nested one is its parent's business):
// - stall: running, no tool call in flight, and longer than its role's limit since its last call ended (a
//   permission prompt is `waiting`, never a stall);
// - dead: alive at the last tick, gone now, and no stop record (gone with a record = finished);
// - idle leftover: finished (done, or a stop record newer than its last move) and still listed. A reviewer is stopped
//   at once; an implementer stays while its task is in_progress (a verify or fix round reuses it) and goes once the
//   task is done or blocked; any other agent, and an implementer with no task in progress, after the idle minutes.
// Each alarm is raised once per agent and kind and cleared when the agent moves again.
import type { AgentInfo } from 'claude-code'

export const TICK_MS = 30_000
export const MINUTE = 60_000
// A reviewer's stall limit is the implementer's plus this many minutes.
export const REVIEWER_EXTRA = 5

export type Kind = 'stall' | 'dead' | 'idle' | 'idle-stopped'
export type StopClass = 'reviewer' | 'implementer' | 'other'
export type Status = 'running' | 'waiting' | 'done'

// on: orch_enabled and orch_watchdog; idleStop: orch_idle_stop; the minutes as clamped by orch-lib.ts.
export type WatchSettings = { on: boolean; idleStop: boolean; idleStopMinutes: number; stallMinutes: number }

// roles --------------------------------------------------------------------------------------------------------------

// `junkd:verify-coordinator`, `orch:implementer` -> the part after the last `:`.
export const baseType = (type: string) => type.slice(type.lastIndexOf(':') + 1)
const IMPLEMENTERS = new Set(['implementer', 'lead-implementer'])
const REVIEWERS = new Set(['verify-coordinator', 'test-planner', 'ui-reviewer'])

// Who is stopped when: the reviewers, the orch-ops helpers and any `pr-`/`gh-` agent at once; the implementers by
// their task; the rest by the idle minutes.
export function stopClass(type: string, name: string): StopClass {
  const base = baseType(type)
  if (IMPLEMENTERS.has(base)) return 'implementer'
  if (REVIEWERS.has(base) || base === 'orch-ops' || /^(pr|gh)-/.test(name)) return 'reviewer'
  return 'other'
}
// The stall limit in ms: the setting for an implementer and anything else, 5 minutes more for a reviewer.
export const stallLimit = (type: string, s: WatchSettings) => (REVIEWERS.has(baseType(type)) ? s.stallMinutes + REVIEWER_EXTRA : s.stallMinutes) * MINUTE

// The task of an agent: the `T<n>` in its name (`impl-T17`), else in its worktree (`.worktrees/T17`), else none.
export function taskOf(name: string, cwd?: string): string | undefined {
  return /(?<![A-Za-z0-9])T\d+(?![0-9])/.exec(name)?.[0] ?? (cwd ? /\/\.worktrees\/(T\d+)(?:\/|$)/.exec(cwd)?.[1] : undefined)
}

// assess -------------------------------------------------------------------------------------------------------------

// One agent as the rules read it.
export type Watched = {
  id: string
  name: string
  type: string
  listed: boolean // in the agent list now
  status: Status // as listed, or as last listed when gone
  nested: boolean // spawned by another agent
  wasAlive: boolean // listed and not done at the previous tick
  finished: boolean // done, or a stop record newer than its last call start, spawn and resume
  finishedAt?: number
  inFlight: boolean // a tool call of its own is running
  lastEnd: number // when its last tool call ended, else when it started
  lastCall?: string // `Bash tests/smoke.sh`
  task?: string
}
// A task file's status (`''` when there is no such file); verify: a verify-coordinator for it ran this session.
export type TaskInfo = { status?: string; verify: boolean }
export type IdleVerdict = { agent: Watched; idleMs: number; want: boolean; stop: boolean; why: string }
export type Assessment = { stalls: Watched[]; deaths: Watched[]; idle: IdleVerdict[]; toStop: Watched[] }

function idleVerdict(a: Watched, now: number, s: WatchSettings, task: TaskInfo | undefined): IdleVerdict {
  const idleMs = Math.max(0, now - (a.finishedAt ?? a.lastEnd))
  const over = idleMs > s.idleStopMinutes * MINUTE
  const cls = stopClass(a.type, a.name)
  const status = task?.status
  let want = over
  let why = over ? `idle over ${s.idleStopMinutes} min` : `idle under ${s.idleStopMinutes} min`
  if (cls === 'reviewer') {
    want = true
    why = 'reviewers are never messaged again'
  } else if (cls === 'implementer' && a.task !== undefined && (status === 'done' || status === 'blocked')) {
    want = true
    why = `${a.task} is ${status}`
  } else if (cls === 'implementer' && a.task !== undefined && status === 'in_progress') {
    want = false
    why = task!.verify ? `${a.task} in verify` : `${a.task} in progress`
  } else if (cls === 'implementer' && a.task !== undefined && status === undefined) {
    want = false // the task file was never read: keep it until it is
    why = `${a.task} status unknown`
  }
  return { agent: a, idleMs, want, stop: want && s.idleStop, why }
}

export function assess(agents: readonly Watched[], now: number, s: WatchSettings, tasks: Readonly<Record<string, TaskInfo>>): Assessment {
  const out: Assessment = { stalls: [], deaths: [], idle: [], toStop: [] }
  if (!s.on) return out
  for (const a of agents) {
    if (a.nested) continue
    if (!a.listed) {
      if (a.wasAlive && !a.finished) out.deaths.push(a)
      continue
    }
    if (a.finished) {
      const v = idleVerdict(a, now, s, a.task === undefined ? undefined : tasks[a.task])
      out.idle.push(v)
      if (v.stop) out.toStop.push(a)
      continue
    }
    if (a.status === 'running' && !a.inFlight && now - a.lastEnd > stallLimit(a.type, s)) out.stalls.push(a)
  }
  return out
}

// tick ---------------------------------------------------------------------------------------------------------------

// What the module saw of each agent's tool calls (index.tsx's tool.call hook) and spawn (orch.tsx's agent.spawn hook).
export type Call = { start?: number; end?: number; inFlight: number; last?: string }
export type Spawn = { at: number; cwd?: string; parent?: string; name?: string }
export type Snapshot = {
  listed?: readonly AgentInfo[] // undefined: the read failed, and the last verdict stands
  calls: Readonly<Record<string, Call>>
  spawns: Readonly<Record<string, Spawn>>
  records: Readonly<Record<string, number>> // agent id -> when its stop record was made
  tasks: Readonly<Record<string, string>> // task id -> status as read this tick ('' = no file); unread tasks keep their last
  branches?: Readonly<Record<string, string>> // agent id -> its worktree's branch (for the death line)
  settings: WatchSettings
}
// One agent as the watchdog remembers it across ticks.
export type Mem = {
  id: string
  name: string
  type: string
  status: Status
  listed: boolean
  nested: boolean
  firstSeen: number
  moved: number // the newest call start or end, or the spawn, seen so far
  finishedAt?: number
  resumed?: number // when it was last seen back from done or from the dead: a stop record older than this is an earlier run's
  cwd?: string
}
export type VerdictKind = 'running' | 'waiting' | 'call' | 'stall' | 'dead' | 'idle' | 'kept' | 'stop' | 'stopped' | 'done'
export type Verdict = { kind: VerdictKind; idleMs?: number; why?: string }
export type WatchState = {
  agents: Record<string, Mem>
  alarms: Record<string, Kind[]>
  tasks: Record<string, string> // the last status read of each task
  verdicts: Record<string, Verdict>
  pending: string[] // the lines for the orchestrator's next turn
}
export type WatchEvent = { kind: Kind; id: string; agent: string; note: string; stop: boolean; line?: string }

export const emptyState = (): WatchState => ({ agents: {}, alarms: {}, tasks: {}, verdicts: {}, pending: [] })

const isDone = (status: string) => status === 'completed' || status === 'failed' || status === 'killed'
// The agent list's status: done, a wait (a permission prompt, a teammate waiting for a message), or running.
export const statusOf = (status: string): Status => (isDone(status) ? 'done' : status === 'waiting' || status === 'idle' ? 'waiting' : 'running')
export const minutes = (ms: number) => Math.floor(Math.max(0, ms) / MINUTE)

const raised = (st: WatchState, id: string, kind: Kind) => (st.alarms[id] ?? []).includes(kind)

export const deathNote = (a: Watched) => `no SubagentStop record · last: ${a.lastCall ?? 'no tool call seen'}`
export function deathLine(a: Watched, now: number, branch?: string): string {
  const last = a.lastCall ? `last call ${a.lastCall} ${minutes(now - a.lastEnd)} min ago` : 'no tool call seen'
  const where = branch ?? (a.task ? `${a.task}'s branch` : 'its branch')
  return `watchdog: ${a.name} died (no stop record, ${last}); resume it with SendMessage or spawn a fresh agent on ${where}`
}
export const stallNote = (a: Watched, now: number) => `idle ${minutes(now - a.lastEnd)} min · last: ${a.lastCall ?? 'no tool call seen'}`
export const stallLine = (a: Watched, now: number) =>
  `watchdog: ${a.name} idle ${minutes(now - a.lastEnd)} min, last call ${a.lastCall ?? 'none seen'}; ping it or stop it`

// One step of the clock: the agents as listed now against what the last tick knew. Pure: the state is copied.
export function tick(prev: WatchState, snap: Snapshot, now: number): { state: WatchState; events: WatchEvent[] } {
  if (snap.listed === undefined || !snap.settings.on) return { state: snap.settings.on ? prev : emptyState(), events: [] }
  const st: WatchState = {
    agents: Object.fromEntries(Object.entries(prev.agents).map(([k, m]) => [k, { ...m }])),
    alarms: Object.fromEntries(Object.entries(prev.alarms).map(([k, a]) => [k, [...a]])),
    tasks: { ...prev.tasks, ...snap.tasks },
    verdicts: {},
    pending: [...prev.pending],
  }
  const listed = new Map(snap.listed.map(a => [a.id, a]))
  const wasAlive = new Set(Object.values(prev.agents).filter(m => m.listed && m.status !== 'done').map(m => m.id))
  for (const a of snap.listed) {
    const sp = snap.spawns[a.id]
    const m = st.agents[a.id]
    const status = statusOf(a.status)
    const name = a.name || sp?.name || a.description || a.type || a.id
    if (!m) {
      st.agents[a.id] = { id: a.id, name, type: a.type, status, listed: true, nested: a.parentId !== undefined || sp?.parent !== undefined, firstSeen: now, moved: sp?.at ?? now, cwd: sp?.cwd }
      continue
    }
    // Back from done or from the dead (a SendMessage resumed it): it moved.
    if (!m.listed || (m.status === 'done' && status !== 'done')) {
      m.moved = now
      m.resumed = now
      m.finishedAt = undefined
      delete st.alarms[a.id]
    }
    Object.assign(m, { name, type: a.type, status, listed: true, cwd: sp?.cwd ?? m.cwd, nested: m.nested || a.parentId !== undefined || sp?.parent !== undefined })
  }
  for (const m of Object.values(st.agents)) if (!listed.has(m.id)) m.listed = false

  // A verify-coordinator seen for a task this session: the task is in a verify or fix round while it is in_progress.
  const verified = new Set(Object.values(st.agents).filter(m => baseType(m.type) === 'verify-coordinator').map(m => taskOf(m.name, m.cwd)).filter(Boolean))
  const tasks: Record<string, TaskInfo> = {}
  for (const [task, status] of Object.entries(st.tasks)) tasks[task] = { status, verify: verified.has(task) }

  const watched: Watched[] = []
  for (const m of Object.values(st.agents)) {
    const call = snap.calls[m.id]
    const moved = Math.max(m.moved, call?.start ?? 0, call?.end ?? 0)
    if (moved > m.moved) {
      // A call since the last tick: every alarm of the agent is cleared, and a finish before it no longer stands.
      m.moved = moved
      m.finishedAt = undefined
      delete st.alarms[m.id]
    }
    const recordAt = snap.records[m.id]
    const hasRecord = recordAt !== undefined && recordAt >= Math.max(m.resumed ?? 0, call?.start ?? 0, snap.spawns[m.id]?.at ?? 0)
    const finished = m.status === 'done' || hasRecord
    if (finished && m.listed && m.finishedAt === undefined) m.finishedAt = hasRecord ? recordAt : now
    if (!m.listed && !wasAlive.has(m.id)) continue // gone before this tick: settled already
    watched.push({
      id: m.id,
      name: m.name,
      type: m.type,
      listed: m.listed,
      status: m.status,
      nested: m.nested,
      wasAlive: wasAlive.has(m.id),
      finished,
      finishedAt: m.finishedAt,
      inFlight: (call?.inFlight ?? 0) > 0,
      lastEnd: Math.max(call?.end ?? 0, m.moved), // a resume or a call start moves it too
      lastCall: call?.last,
      task: taskOf(m.name, m.cwd),
    })
  }

  const r = assess(watched, now, snap.settings, tasks)
  const events: WatchEvent[] = []
  const raise = (a: Watched, kind: Kind, note: string, stop: boolean, line?: string) => {
    if (raised(st, a.id, kind)) return
    st.alarms[a.id] = [...(st.alarms[a.id] ?? []), kind]
    events.push({ kind, id: a.id, agent: a.name, note, stop, ...(line ? { line } : {}) })
    if (line) st.pending.push(line)
  }
  for (const a of r.deaths) raise(a, 'dead', deathNote(a), false, deathLine(a, now, snap.branches?.[a.id]))
  for (const a of r.stalls) raise(a, 'stall', stallNote(a, now), false, stallLine(a, now))
  for (const v of r.idle) {
    const note = `reported ${minutes(v.idleMs)} min ago`
    if (v.stop) raise(v.agent, 'idle-stopped', note, true)
    else if (v.want) raise(v.agent, 'idle', `${note} · ${v.why} · orch_idle_stop off`, false)
  }

  // The verdict of every agent still listed, and of the dead: the pane's suffix and the table's last column.
  const stalls = new Set(r.stalls.map(a => a.id))
  const idle = new Map(r.idle.map(v => [v.agent.id, v]))
  for (const a of watched) {
    if (a.nested) continue
    const iv = idle.get(a.id)
    if (!a.listed) continue // the dead get theirs below
    if (stalls.has(a.id)) st.verdicts[a.id] = { kind: 'stall', idleMs: now - a.lastEnd }
    else if (iv && raised(st, a.id, 'idle-stopped')) st.verdicts[a.id] = { kind: 'stopped', idleMs: iv.idleMs, why: iv.why }
    else if (iv) st.verdicts[a.id] = { kind: iv.want ? (iv.stop ? 'stop' : 'idle') : 'kept', idleMs: iv.idleMs, why: iv.why }
    else if (a.inFlight) st.verdicts[a.id] = { kind: 'call' }
    else st.verdicts[a.id] = { kind: a.status === 'waiting' ? 'waiting' : 'running', idleMs: now - a.lastEnd }
  }
  for (const [id, alarms] of Object.entries(st.alarms)) if (alarms.includes('dead') && !st.verdicts[id] && !listed.has(id)) st.verdicts[id] = { kind: 'dead' }
  return { state: st, events }
}

// The lines for the orchestrator's next turn, each once: taken, they are gone.
export function takePending(st: WatchState): string[] {
  const lines = st.pending
  st.pending = []
  return lines
}

// texts --------------------------------------------------------------------------------------------------------------

// The ⚠ segment under the prompt: `⚠ 1 dead`, `⚠ 2 stalled`, both; '' when nothing is wrong.
export function segmentText(st: WatchState): string {
  const count = (kind: VerdictKind) => Object.values(st.verdicts).filter(v => v.kind === kind).length
  const parts = [count('dead') ? `${count('dead')} dead` : '', count('stall') ? `${count('stall')} stalled` : ''].filter(Boolean)
  return parts.length ? `⚠ ${parts.join(' · ')}` : ''
}

// The tools pane's suffix of an agent row: `⚠ stalled 16m`, `✝ dead`, `· idle 4m`, `· stopped`; '' otherwise.
export function suffixOf(v: Verdict | undefined): string {
  if (!v) return ''
  const m = `${minutes(v.idleMs ?? 0)}m`
  if (v.kind === 'dead') return '✝ dead'
  if (v.kind === 'stall') return `⚠ stalled ${m}`
  if (v.kind === 'stopped') return '· stopped'
  if (v.kind === 'idle' || v.kind === 'stop' || v.kind === 'kept') return `· idle ${m}`
  return ''
}

// The module's state, for the `$`-free views (tools-views.tsx draws the suffix from it).
export const W = { state: emptyState() }
export const verdictSuffix = (id: string) => suffixOf(W.state.verdicts[id])

// The /junkd:orch watchdog table: agent | role | status | idle | verdict, the main loop's agents only.
export function verdictTable(st: WatchState): string {
  const rows: string[][] = [['agent', 'role', 'status', 'idle', 'verdict']]
  for (const m of Object.values(st.agents)) {
    const v = st.verdicts[m.id]
    if (m.nested || !v) continue
    const status = m.listed ? m.status : 'gone'
    const idle = v.kind === 'call' ? 'in a call' : v.idleMs === undefined ? '-' : `${minutes(v.idleMs)}m`
    const word: Record<VerdictKind, string> = {
      running: 'ok', waiting: 'ok (waiting)', call: 'ok', stall: 'stalled', dead: 'dead (no stop record)', idle: `idle, report only (${v.why})`,
      kept: `kept (${v.why})`, stop: `stop (${v.why})`, stopped: `stopped (${v.why})`, done: 'done',
    }
    rows.push([m.name, baseType(m.type) || '-', status, idle, word[v.kind]])
  }
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map(r => [...r[i]!].length)))
  return rows.map(r => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join('  ')).join('\n')
}
// The toast after /junkd:orch watchdog: `watchdog: 3 agents · 1 dead · 2 stalled · 1 idle`.
export function countText(st: WatchState): string {
  const vs = Object.entries(st.verdicts).filter(([id]) => !st.agents[id]?.nested).map(([, v]) => v)
  const n = (kinds: VerdictKind[]) => vs.filter(v => kinds.includes(v.kind)).length
  const parts = [`${vs.length} agent${vs.length === 1 ? '' : 's'}`]
  if (n(['dead'])) parts.push(`${n(['dead'])} dead`)
  if (n(['stall'])) parts.push(`${n(['stall'])} stalled`)
  if (n(['idle', 'stop', 'kept', 'stopped'])) parts.push(`${n(['idle', 'stop', 'kept', 'stopped'])} idle`)
  return `watchdog: ${parts.join(' · ')}`
}
