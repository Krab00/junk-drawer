// junkd's agent watchdog: the pure rules and reducer of watchdog.ts over fixed clocks, then the module (watchdog.tsx)
// over a world in memory: the timer, the stop, the toasts and the log, the injected line, the ⚠ segment, the tools
// pane's suffix, /junkd:orch watchdog, the four orch rows (by $.junkd.set, the /config menu and the ⚙ pane).
// Nothing touches a real home: every fs, process and session call is answered by `world`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { AgentInfo, Args, On } from 'claude-code'
import {
  MINUTE, TICK_MS, assess, baseType, countText, deathLine, emptyState, segmentText, stallLimit, stallLine, statusOf, stopClass, suffixOf,
  takePending, taskOf, tick, verdictTable, type Snapshot, type TaskInfo, type Watched, type WatchSettings, type WatchState,
} from './watchdog.ts'
import { callText, statusOfTaskFile } from './watchdog.tsx'
import { CLAMPED, coerce } from './orch-lib'

const S: WatchSettings = { on: true, idleStop: true, idleStopMinutes: 10, stallMinutes: 15 }
const T0 = 1_000_000_000

// One agent as assess reads it: running, listed, alive, its last call ended at T0.
const wa = (more: Partial<Watched> = {}): Watched => ({
  id: 'a1', name: 'impl-T17', type: 'junkd:implementer', listed: true, status: 'running', nested: false, wasAlive: true, finished: false,
  inFlight: false, lastEnd: T0, lastCall: 'Bash tests/smoke.sh', task: 'T17', ...more,
})
const none: Record<string, TaskInfo> = {}
const ids = (xs: { id: string }[]) => xs.map(x => x.id)

// roles and names --------------------------------------------------------------------------------------------------

test('roles: the base type after the last colon; reviewers, orch-ops and pr-/gh- names stop at once; implementers by task', () => {
  expect(['junkd:verify-coordinator', 'orch:implementer', 'implementer', '', 'a:b:c'].map(baseType)).toEqual(['verify-coordinator', 'implementer', 'implementer', '', 'c'])
  for (const t of ['verify-coordinator', 'junkd:test-planner', 'orch:test-reviewer', 'ui-reviewer', 'junkd:orch-ops']) expect(stopClass(t, 'x'), t).toBe('reviewer')
  for (const n of ['pr-12', 'gh-merge']) expect(stopClass('general-purpose', n), n).toBe('reviewer')
  for (const n of ['xpr-1', 'pr', 'ghost-1', 'my-pr-1']) expect(stopClass('general-purpose', n), n).toBe('other')
  expect(stopClass('junkd:implementer', 'pr-1')).toBe('implementer') // the type wins over the name
  expect(stopClass('lead-implementer', 'lead')).toBe('implementer')
  expect(stopClass('general-purpose', 'scout')).toBe('other')
})

test('the task of an agent: T<n> in its name, else in its worktree path, else none', () => {
  expect(taskOf('impl-T17')).toBe('T17')
  expect(taskOf('T20-fix', '/r/.worktrees/T9')).toBe('T20')
  expect(taskOf('verify', '/r/.worktrees/T9')).toBe('T9')
  expect(taskOf('verify', '/r/.worktrees/T9/plugins/junkd')).toBe('T9')
  expect(taskOf('verify', '/r/.worktrees/T9x')).toBe(undefined) // not a T<n> folder
  expect(taskOf('verify', '/r/worktrees/T9')).toBe(undefined)
  expect(taskOf('aT17', undefined)).toBe(undefined) // a T glued to a word is no task id
  expect(taskOf('impl-T17b')).toBe('T17')
  expect(taskOf('scout')).toBe(undefined)
})

test('the agent list\'s status: completed, failed and killed are done; waiting and idle wait; the rest runs', () => {
  expect(['completed', 'failed', 'killed', 'waiting', 'idle', 'running', 'pending'].map(statusOf)).toEqual(['done', 'done', 'done', 'waiting', 'waiting', 'running', 'running'])
})

// stalls -----------------------------------------------------------------------------------------------------------

test('stall: running, no call in flight, past the limit since the last call ended; exactly at the limit is none', () => {
  const limit = 15 * MINUTE
  expect(ids(assess([wa()], T0 + limit, S, none).stalls)).toEqual([])
  expect(ids(assess([wa()], T0 + limit + 1, S, none).stalls)).toEqual(['a1'])
  expect(ids(assess([wa()], T0 + limit - 1, S, none).stalls)).toEqual([])
})

test('stall: a permission prompt (waiting) never counts, however long', () => {
  expect(assess([wa({ status: 'waiting' })], T0 + 999 * MINUTE, S, none).stalls).toEqual([])
})

test('stall: a tool call in flight never counts (a long Bash is no stall)', () => {
  expect(assess([wa({ inFlight: true })], T0 + 999 * MINUTE, S, none).stalls).toEqual([])
})

test('stall limits per role: implementer and anything else the setting, a reviewer 5 more; orch_stall_minutes moves both', () => {
  const at = (type: string, s = S) => stallLimit(type, s) / MINUTE
  expect([at('junkd:implementer'), at('lead-implementer'), at('general-purpose'), at('orch-ops')]).toEqual([15, 15, 15, 15])
  expect([at('verify-coordinator'), at('junkd:test-planner'), at('test-reviewer'), at('ui-reviewer')]).toEqual([20, 20, 20, 20])
  const s7 = { ...S, stallMinutes: 7 }
  expect([at('implementer', s7), at('verify-coordinator', s7)]).toEqual([7, 12])
  // a reviewer at 16 and 20 minutes: no stall; past 20: a stall
  const rev = wa({ type: 'junkd:verify-coordinator', name: 'verify-T17' })
  expect(assess([rev], T0 + 16 * MINUTE, S, none).stalls).toEqual([])
  expect(assess([rev], T0 + 20 * MINUTE, S, none).stalls).toEqual([])
  expect(ids(assess([rev], T0 + 20 * MINUTE + 1, S, none).stalls)).toEqual(['a1'])
  expect(ids(assess([rev], T0 + 12 * MINUTE + 1, s7, none).stalls)).toEqual(['a1'])
  expect(ids(assess([wa()], T0 + 7 * MINUTE + 1, s7, none).stalls)).toEqual(['a1'])
})

// deaths -----------------------------------------------------------------------------------------------------------

test('dead: alive at the last tick, gone now, no stop record; gone with a record is finished; gone while done is no death', () => {
  const gone = wa({ listed: false })
  expect(ids(assess([gone], T0, S, none).deaths)).toEqual(['a1'])
  expect(assess([{ ...gone, finished: true }], T0, S, none).deaths).toEqual([])
  expect(assess([{ ...gone, wasAlive: false }], T0, S, none).deaths).toEqual([])
  // a gone agent is neither a stall nor an idle leftover
  const r = assess([gone], T0 + 99 * MINUTE, S, none)
  expect([r.stalls, r.idle, r.toStop]).toEqual([[], [], []])
})

// idle leftovers ---------------------------------------------------------------------------------------------------

const fin = (more: Partial<Watched> = {}) => wa({ status: 'done', finished: true, finishedAt: T0, ...more })

test('idle: a reviewer that reported is stopped at once, whatever its task says', () => {
  for (const [type, name] of [['junkd:verify-coordinator', 'verify-T17'], ['test-planner', 'plan-T17'], ['junkd:orch-ops', 'ops'], ['general-purpose', 'pr-12']]) {
    const r = assess([fin({ type, name })], T0, S, { T17: { status: 'in_progress', verify: true } })
    expect(ids(r.toStop), `${type} ${name}`).toEqual(['a1'])
    expect(r.idle[0]).toMatchObject({ idleMs: 0, want: true, stop: true })
  }
})

test('idle: an implementer stays while its task is in_progress (a verify round or not), however long it idles', () => {
  for (const verify of [true, false]) {
    const r = assess([fin()], T0 + 999 * MINUTE, S, { T17: { status: 'in_progress', verify } })
    expect(r.toStop, String(verify)).toEqual([])
    expect(r.idle[0]).toMatchObject({ want: false, stop: false, why: verify ? 'T17 in verify' : 'T17 in progress' })
  }
})

test('idle: an implementer is stopped once its task is done or blocked, idle or not', () => {
  for (const status of ['done', 'blocked']) {
    const r = assess([fin()], T0, S, { T17: { status, verify: true } })
    expect(ids(r.toStop), status).toEqual(['a1'])
    expect(r.idle[0]!.why).toBe(`T17 is ${status}`)
  }
})

test('idle: an implementer with no task in progress (todo, no file, no task id) goes after the idle minutes; exactly N is not past', () => {
  const N = 10 * MINUTE
  for (const [label, a, tasks] of [
    ['todo', fin(), { T17: { status: 'todo', verify: false } }],
    ['no file', fin(), { T17: { status: '', verify: false } }],
    ['no task id', fin({ name: 'impl', task: undefined }), none],
    ['other role', fin({ type: 'general-purpose', name: 'scout', task: undefined }), none],
  ] as const) {
    expect(assess([a], T0 + N, S, tasks).toStop, `${label} at N`).toEqual([])
    expect(ids(assess([a], T0 + N + 1, S, tasks).toStop), `${label} past N`).toEqual(['a1'])
  }
  // the idle time runs from the finish, else from the last call's end
  expect(assess([fin({ finishedAt: T0 + N })], T0 + N + 1, S, { T17: { status: 'todo', verify: false } }).toStop).toEqual([])
  expect(ids(assess([fin({ finishedAt: undefined, lastEnd: T0, task: undefined })], T0 + N + 1, S, none).toStop)).toEqual(['a1'])
  // orch_idle_stop_minutes moves the bound
  expect(ids(assess([fin({ task: undefined })], T0 + MINUTE + 1, { ...S, idleStopMinutes: 1 }, none).toStop)).toEqual(['a1'])
})

test('idle: an implementer whose task status was never read is kept', () => {
  const r = assess([fin()], T0 + 999 * MINUTE, S, none)
  expect(r.toStop).toEqual([])
  expect(r.idle[0]).toMatchObject({ want: false, why: 'T17 status unknown' })
})

test('idle: orch_idle_stop off reports only: the verdict wants the stop, nothing is stopped', () => {
  const r = assess([fin({ type: 'verify-coordinator', name: 'verify-T17' })], T0, { ...S, idleStop: false }, none)
  expect(r.toStop).toEqual([])
  expect(r.idle[0]).toMatchObject({ want: true, stop: false })
})

test('a running agent is no idle leftover; a nested one is nothing at all; the watchdog off assesses nothing', () => {
  expect(assess([wa()], T0 + MINUTE, S, none).idle).toEqual([])
  const nested = [wa({ nested: true }), fin({ nested: true, type: 'verify-coordinator' }), wa({ nested: true, listed: false })]
  expect(assess(nested, T0 + 99 * MINUTE, S, none)).toEqual({ stalls: [], deaths: [], idle: [], toStop: [] })
  const all = [wa(), fin({ id: 'a2', type: 'verify-coordinator' }), wa({ id: 'a3', listed: false })]
  expect(assess(all, T0 + 99 * MINUTE, { ...S, on: false }, none)).toEqual({ stalls: [], deaths: [], idle: [], toStop: [] })
})

// the reducer ------------------------------------------------------------------------------------------------------

const agent = (id: string, status: AgentInfo['status'], more: Partial<AgentInfo> = {}): AgentInfo => ({ id, description: `task ${id}`, type: 'junkd:implementer', status, ...more })
const snap = (listed: AgentInfo[] | undefined, more: Partial<Snapshot> = {}): Snapshot => ({ listed, calls: {}, spawns: {}, records: {}, tasks: {}, settings: S, ...more })
// Ticks one after the other, each `TICK_MS` later, from `st`; every event of every tick.
function run(st: WatchState, snaps: Snapshot[], from = T0) {
  const events: ReturnType<typeof tick>['events'] = []
  let at = from
  for (const s of snaps) {
    const r = tick(st, s, at)
    st = r.state
    events.push(...r.events)
    at += TICK_MS
  }
  return { st, events, at }
}

test('tick: a stall is raised once, however many ticks it lasts, and cleared by the next call; then it can come again', () => {
  const calls = { a1: { start: T0 - 1000, end: T0, inFlight: 0, last: 'Edit hooks/x.ts' } }
  const listed = [agent('a1', 'running', { name: 'impl-T19' })]
  let r = run(emptyState(), [snap(listed, { calls })])
  r = run(r.st, Array.from({ length: 5 }, () => snap(listed, { calls })), T0 + 16 * MINUTE)
  expect(r.events.map(e => [e.kind, e.agent])).toEqual([['stall', 'impl-T19']])
  expect(r.events[0]!.line).toBe('watchdog: impl-T19 idle 16 min, last call Edit hooks/x.ts; ping it or stop it')
  expect(r.st.verdicts.a1).toMatchObject({ kind: 'stall' })
  // it moved: a new call started and ended
  const moved = { a1: { start: T0 + 30 * MINUTE, end: T0 + 30 * MINUTE + 5, inFlight: 0, last: 'Read a' } }
  r = run(r.st, [snap(listed, { calls: moved })], T0 + 31 * MINUTE)
  expect(r.events).toEqual([])
  expect(r.st.alarms.a1).toBe(undefined)
  expect(r.st.verdicts.a1).toMatchObject({ kind: 'running' })
  r = run(r.st, [snap(listed, { calls: moved })], T0 + 46 * MINUTE)
  expect(r.events.map(e => e.kind)).toEqual(['stall'])
})

test('tick: a call in flight holds off the stall until it ends; a new call start alone is movement', () => {
  const listed = [agent('a1', 'running')]
  const held = { a1: { start: T0, end: T0 - 5, inFlight: 1, last: 'Bash sleep 90' } }
  let r = run(emptyState(), [snap(listed, { calls: held })])
  r = run(r.st, [snap(listed, { calls: held })], T0 + 60 * MINUTE)
  expect(r.events).toEqual([])
  expect(r.st.verdicts.a1).toEqual({ kind: 'call' })
  const ended = { a1: { ...held.a1, end: T0 + 60 * MINUTE, inFlight: 0 } }
  r = run(r.st, [snap(listed, { calls: ended })], T0 + 61 * MINUTE)
  expect(r.events).toEqual([])
  r = run(r.st, [snap(listed, { calls: ended })], T0 + 75 * MINUTE + 1)
  expect(r.events.map(e => e.kind)).toEqual(['stall'])
})

test('tick: a death is raised once with its line and its note, and the dead stay dead (not finished) until the agent is back', () => {
  const calls = { a1: { start: T0 - 1, end: T0, inFlight: 0, last: 'Bash tests/smoke.sh' } }
  let r = run(emptyState(), [snap([agent('a1', 'running', { name: 'impl-T17' })], { calls, spawns: { a1: { at: T0 - 9, cwd: '/r/.worktrees/T17' } } })])
  r = run(r.st, [snap([], { calls, branches: { a1: 'task/T17-tools-pane' } })], T0 + 18 * MINUTE)
  expect(r.events).toEqual([{
    kind: 'dead', id: 'a1', agent: 'impl-T17', stop: false,
    note: 'no SubagentStop record · last: Bash tests/smoke.sh',
    line: 'watchdog: impl-T17 died (no stop record, last call Bash tests/smoke.sh 18 min ago); resume it with SendMessage or spawn a fresh agent on task/T17-tools-pane',
  }])
  expect(r.st.pending).toEqual([r.events[0]!.line])
  r = run(r.st, [snap([], { calls }), snap([], { calls }), snap([], { calls, records: { a1: T0 + 99 * MINUTE } })], T0 + 19 * MINUTE)
  expect(r.events).toEqual([])
  expect(r.st.verdicts.a1).toEqual({ kind: 'dead' })
  expect(segmentText(r.st)).toBe('⚠ 1 dead')
  // back in the list (a SendMessage resumed it): the alarm is gone
  r = run(r.st, [snap([agent('a1', 'running', { name: 'impl-T17' })], { calls })], T0 + 30 * MINUTE)
  expect(r.st.alarms.a1).toBe(undefined)
  expect(segmentText(r.st)).toBe('')
})

test('tick: gone with a record is finished, no alarm; gone after it was listed done is no death either', () => {
  let r = run(emptyState(), [snap([agent('a1', 'running'), agent('a2', 'running')])])
  r = run(r.st, [snap([agent('a2', 'completed')], { records: { a1: T0 + 1 } })], T0 + MINUTE)
  r = run(r.st, [snap([])], T0 + 2 * MINUTE)
  expect(r.events.filter(e => e.kind === 'dead')).toEqual([])
})

test('tick: the death line without a branch names the task\'s branch, or the agent\'s; without a call it says none was seen', () => {
  expect(deathLine(wa(), T0 + 3 * MINUTE)).toBe('watchdog: impl-T17 died (no stop record, last call Bash tests/smoke.sh 3 min ago); resume it with SendMessage or spawn a fresh agent on T17\'s branch')
  expect(deathLine(wa({ task: undefined, lastCall: undefined }), T0)).toBe('watchdog: impl-T17 died (no stop record, no tool call seen); resume it with SendMessage or spawn a fresh agent on its branch')
  expect(stallLine(wa({ lastCall: undefined }), T0 + 2 * MINUTE)).toBe('watchdog: impl-T17 idle 2 min, last call none seen; ping it or stop it')
})

test('tick: a stop record older than the agent\'s last call start is from an earlier run (it was resumed): not finished', () => {
  const listed = [agent('a1', 'waiting', { type: 'verify-coordinator', name: 'verify-T17' })]
  const calls = { a1: { start: T0 + 10, end: T0 + 20, inFlight: 0 } }
  const old = run(emptyState(), [snap(listed, { calls, records: { a1: T0 } })])
  expect(old.events).toEqual([])
  const fresh = run(emptyState(), [snap(listed, { calls, records: { a1: T0 + 10 } })])
  expect(fresh.events.map(e => e.kind)).toEqual(['idle-stopped'])
  // a record older than the agent's own spawn is another agent's of the same name
  const spawned = run(emptyState(), [snap(listed, { spawns: { a1: { at: T0 + 5 } }, records: { a1: T0 } })])
  expect(spawned.events).toEqual([])
})

test('tick: an idle reviewer is stopped once; with orch_idle_stop off it is reported once and never stopped', () => {
  const listed = [agent('a1', 'completed', { type: 'junkd:verify-coordinator', name: 'verify-T17' })]
  const on = run(emptyState(), [snap(listed), snap(listed), snap(listed)])
  expect(on.events.map(e => [e.kind, e.stop, e.note])).toEqual([['idle-stopped', true, 'reported 0 min ago']])
  expect(on.st.verdicts.a1).toMatchObject({ kind: 'stopped' })
  const off = { ...S, idleStop: false }
  const rep = run(emptyState(), [snap(listed, { settings: off }), snap(listed, { settings: off })])
  expect(rep.events.map(e => [e.kind, e.stop])).toEqual([['idle', false]])
  expect(rep.events[0]!.note).toBe('reported 0 min ago · reviewers are never messaged again · orch_idle_stop off')
  expect(rep.st.verdicts.a1).toMatchObject({ kind: 'idle' })
})

test('tick: an implementer is kept while its task is in a verify round, then stopped when the task is done', () => {
  const impl = agent('a1', 'completed', { name: 'impl-T17' })
  const verify = agent('v1', 'waiting', { type: 'junkd:verify-coordinator', name: 'verify-T17' }) // at a prompt: no stall
  let r = run(emptyState(), [snap([impl, verify], { tasks: { T17: 'in_progress' } })])
  r = run(r.st, [snap([impl, verify], { tasks: {} })], T0 + 99 * MINUTE) // not read this tick: the last status stands
  expect(r.events).toEqual([])
  expect(r.st.verdicts.a1).toMatchObject({ kind: 'kept', why: 'T17 in verify' })
  r = run(r.st, [snap([impl, verify], { tasks: { T17: 'done' } })], T0 + 100 * MINUTE)
  expect(r.events.map(e => [e.kind, e.id])).toEqual([['idle-stopped', 'a1']])
})

test('tick: a nested agent (a parent in the list or at its spawn) raises nothing, ever', () => {
  const listed = [agent('n1', 'completed', { type: 'verify-coordinator', parentId: 'a9' }), agent('n2', 'running'), agent('n3', 'running')]
  let r = run(emptyState(), [snap(listed, { spawns: { n2: { at: T0, parent: 'a9' }, n3: { at: T0, parent: 'a9' } } })])
  r = run(r.st, [snap([listed[0]!, listed[1]!])], T0 + 99 * MINUTE)
  expect(r.events).toEqual([])
  expect(verdictTable(r.st)).toBe('agent  role  status  idle  verdict')
})

test('tick: a failed agent list keeps the last verdict, raises nothing and drops nothing; the watchdog off empties it', () => {
  const listed = [agent('a1', 'running')]
  const first = run(emptyState(), [snap(listed), snap(listed, {}),], T0)
  const r = run(first.st, [snap(undefined), snap(undefined)], T0 + 99 * MINUTE)
  expect(r.events).toEqual([])
  expect(r.st).toBe(first.st)
  expect(run(first.st, [snap(listed, { settings: { ...S, on: false } })]).st).toEqual(emptyState())
})

test('the injected lines are taken once', () => {
  const st = emptyState()
  st.pending.push('a', 'b')
  expect(takePending(st)).toEqual(['a', 'b'])
  expect(takePending(st)).toEqual([])
})

// texts ------------------------------------------------------------------------------------------------------------

test('texts: the segment, the pane suffix, the table and the count', () => {
  expect(segmentText(emptyState())).toBe('')
  const st = emptyState()
  st.verdicts = { a: { kind: 'dead' }, b: { kind: 'stall', idleMs: 16 * MINUTE }, c: { kind: 'stall', idleMs: MINUTE }, d: { kind: 'idle', idleMs: 4 * MINUTE + 59_999 } }
  expect(segmentText(st)).toBe('⚠ 1 dead · 2 stalled')
  expect(segmentText({ ...st, verdicts: { b: st.verdicts.b! } })).toBe('⚠ 1 stalled')
  expect(['a', 'b', 'd'].map(k => suffixOf(st.verdicts[k]))).toEqual(['✝ dead', '⚠ stalled 16m', '· idle 4m'])
  expect(suffixOf({ kind: 'kept', idleMs: 0 })).toBe('· idle 0m')
  expect(suffixOf({ kind: 'stop', idleMs: 2 * MINUTE })).toBe('· idle 2m')
  expect(suffixOf({ kind: 'stopped' })).toBe('· stopped')
  for (const kind of ['running', 'waiting', 'call'] as const) expect(suffixOf({ kind }), kind).toBe('')
  expect(suffixOf(undefined)).toBe('')
  st.agents = {
    a: { id: 'a', name: 'impl-T17', type: 'junkd:implementer', status: 'running', listed: false, nested: false, firstSeen: 0, moved: 0 },
    b: { id: 'b', name: 'impl-T19', type: 'orch:implementer', status: 'running', listed: true, nested: false, firstSeen: 0, moved: 0 },
    d: { id: 'd', name: 'verify-T17', type: 'verify-coordinator', status: 'done', listed: true, nested: false, firstSeen: 0, moved: 0 },
  }
  st.verdicts.d = { kind: 'stopped', idleMs: 12 * MINUTE, why: 'reviewers are never messaged again' }
  expect(verdictTable(st).split('\n')).toEqual([
    'agent       role                status   idle  verdict',
    'impl-T17    implementer         gone     -     dead (no stop record)',
    'impl-T19    implementer         running  16m   stalled',
    'verify-T17  verify-coordinator  done     12m   stopped (reviewers are never messaged again)',
  ])
  expect(countText(st)).toBe('watchdog: 4 agents · 1 dead · 2 stalled · 1 idle')
  expect(countText(emptyState())).toBe('watchdog: 0 agents')
})

test('a call\'s text: the tool and the head of its first plain argument, cut at 40 characters, one line', () => {
  expect(callText({ tool: 'Bash', command: 'tests/smoke.sh' })).toBe('Bash tests/smoke.sh')
  expect(callText({ tool: 'Edit', file_path: '/a/b.ts', old_string: 'x' })).toBe('Edit /a/b.ts')
  expect(callText({ tool: 'Bash', command: 'a\n  b' })).toBe('Bash a b')
  expect(callText({ tool: 'Bash', command: 'x'.repeat(41) })).toBe(`Bash ${'x'.repeat(39)}…`)
  expect(callText({ tool: 'Bash', command: 'x'.repeat(40) })).toBe(`Bash ${'x'.repeat(40)}`)
  expect(callText({ tool: 'TaskList' })).toBe('TaskList')
  expect(callText({ tool: 'Bash', command: '  ', description: 'run' })).toBe('Bash run')
})

test('a task file\'s status: the frontmatter\'s status line; none outside it, none without it', () => {
  expect(statusOfTaskFile('---\nid: T17\nstatus: in_progress\n---\nbody')).toBe('in_progress')
  expect(statusOfTaskFile('---\r\nstatus: done\r\n---\r\n')).toBe('done')
  expect(statusOfTaskFile('---\nid: T1\n---\nstatus: done\n')).toBe('')
  expect(statusOfTaskFile('status: done\n')).toBe('')
  expect(statusOfTaskFile('')).toBe('')
})

test('the watchdog minutes: any finite number, rounded and clamped to 1-120; anything else refused; the spellings of the switches', () => {
  expect([...CLAMPED].sort()).toEqual(['idle_stop_minutes', 'stall_minutes'])
  for (const key of ['idle_stop_minutes', 'stall_minutes'] as const) {
    expect([0, 1, 1.4, 2, 119, 120, 121, -5, '7', ' 30 '].map(v => coerce(key, v).value), key).toEqual([1, 1, 1, 2, 119, 120, 120, 1, 7, 30])
    for (const bad of ['x', '', ' ', NaN, Infinity, true, null, undefined]) expect(coerce(key, bad).error, `${key} ${String(bad)}`).toMatch(new RegExp(`is not a valid ${key} \\(minutes, 1–120\\)`))
  }
  for (const key of ['watchdog', 'idle_stop'] as const) {
    for (const v of [true, 'true', 'on']) expect(coerce(key, v).value, `${key} ${String(v)}`).toBe(true)
    for (const v of [false, 'false', 'off', 'yes', 1, '']) expect(coerce(key, v).value, `${key} ${String(v)}`).toBe(false)
  }
})

// the module -------------------------------------------------------------------------------------------------------

const CFG = '/fake/cfg'
const HOME = '/home/u'
const REPO = '/repo'
const WT = '/repo/.worktrees/T17'
const SID = 's1'
const LOG = `${CFG}/junkd/orch/watchdog/${SID}.log`
const RECS = `${CFG}/junkd/orch/_agents/${SID}`
const TASK = `${REPO}/.orch/tasks/T17.md`
const taskFile = (status: string) => `---\nid: T17\nstatus: ${status}\n---\n`

type Opts = { sessionId?: string }
// Each clock.every the module asks for, by its interval: a plugin of its own (a test registers one hook per event, and
// a plugin keeps to its own scope), read back through /spy.
const SPY: Plugin = {
  name: 'spy',
  tier: 'prepend',
  register(on) {
    const everies: number[] = []
    on('clock.every', (_$, e, next) => {
      everies.push(e.ms)
      return next(e)
    })
    on('command.run', { command: 'spy' }, () => ({ text: JSON.stringify(everies) }))
  },
}
function world(on: On, o: Opts = {}) {
  const rec = {
    lists: 0, // agent.list reads
    toasts: [] as string[],
    logs: [] as string[],
    config: [] as { key: string; value: unknown }[],
    stops: [] as unknown[], // TaskStop calls
    stopAnswer: { result: 'ok', text: 'stopped' } as Record<string, unknown>,
    prompts: [] as { text: string; context?: readonly string[] }[],
    dropPrompt: false,
    agents: [] as AgentInfo[],
    nextAgent: 'a1',
    files: {} as Record<string, string>,
    mtimes: {} as Record<string, number>,
    unreadable: new Set<string>(),
    failList: false,
    opened: [] as string[],
    runs: [] as string[][],
    hold: undefined as Promise<void> | undefined, // a subagent call waits on it while set
  }
  mock.store(on)
  mock.env(on, { CLAUDE_CONFIG_DIR: CFG, HOME })
  const clock = mock.clock(on, { now: T0 })
  const done = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('ui.log', (_$, e) => { rec.logs.push(e.text); return { value: undefined } })
  on('ui.open', (_$, e) => { rec.opened.push(e.id); return { value: { isPlaced: true as const } } })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.focus', () => ({}))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('command.run', (_$, e) => ({ text: `downstream ${e.command} ${e.args}` }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, ev) => ({ sessionId: ev.sessionId }))
  on('session.cwd', () => ({ value: '/repo/.worktrees/orch' }))
  on('session.id', () => ({ value: o.sessionId ?? SID }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { breakdown: { mcpTools: [] } } } as never }))
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_$, e) => {
    rec.prompts.push({ text: e.text, context: e.context })
    return rec.dropPrompt ? { drop: 'no' } : { text: e.text, context: e.context }
  })
  on('agent.list', () => {
    rec.lists++
    if (rec.failList) return { deny: 'agents unreadable' } as never
    return { value: rec.agents }
  })
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-haiku-5-5', agentId: rec.nextAgent }))
  on('tool.call', async (_$, e) => {
    if (e.tool === 'TaskStop') {
      rec.stops.push((e as { task_id?: string }).task_id)
      return rec.stopAnswer as never
    }
    if ((e as { hold?: boolean }).hold) await rec.hold
    return { result: 'ok', text: 'ok' }
  })
  on('fs.exists', (_$, e) => ({ value: e.path in rec.files }))
  on('fs.stat', (_$, e) => {
    if (!(e.path in rec.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: 0, mtimeMs: rec.mtimes[e.path] ?? clock.now(), isLink: false, realPath: e.path } }
  })
  on('fs.read', (_$, e) => {
    if (rec.unreadable.has(e.path)) throw new Error(`EACCES ${e.path}`)
    if (!(e.path in rec.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: rec.files[e.path]! }
  })
  on('fs.write', (_$, e) => { rec.files[e.path] = e.text; rec.mtimes[e.path] = clock.now(); return { value: undefined } })
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    rec.runs.push(argv)
    if (argv[0] === 'git' && argv.includes('--show-toplevel')) return done(`${REPO}\n`)
    if (argv[0] === 'git' && argv.includes('--show-current')) return done('task/T17-tools-pane\n')
    if (argv[0] === 'git') return done('', 128)
    if (argv[0] === 'rm') delete rec.files[argv.at(-1)!]
    return done()
  })
  on('classic.SubagentStop', () => ({}))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  return { ...rec, clock, rec }
}
type World = ReturnType<typeof world>

const start = ($: Engine) => $.session.start({ cwd: '/repo/.worktrees/orch', surface: 'terminal', isInteractive: true })
const composer = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
const run$ = ($: Engine, command: string, args = '') => $.command.run({ command, args, ...composer }) as Promise<{ text?: string }>
const spawn = ($: Engine, e: Partial<Args<'agent.spawn'>> = {}) =>
  $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'd', subagentType: 'junkd:implementer', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: true, fork: false, cwd: WT, ...e })
const sub = (tool: string, agentId: string, more: Record<string, unknown> = {}) => ({ tool, agentId, ...more }) as unknown as Parameters<Engine['tool']['call']>[0]
const stopRecord = ($: Engine, id: string, type = 'junkd:verify-coordinator') =>
  $.classic.SubagentStop({ agent_id: id, agent_type: type, agent_transcript_path: `/t/${id}.jsonl`, stop_hook_active: false })
const submit = ($: Engine, text = 'go') => $.prompt.submit({ text } as never)
const logLines = (w: World) => (w.rec.files[LOG] ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, string>)
const ticks = async (w: World, n = 1) => {
  for (let i = 0; i < n; i++) await w.clock.advance(TICK_MS)
}
const watchdogTimers = async ($: Engine) => (JSON.parse((await run$($, 'spy')).text ?? '[]') as number[]).filter(ms => ms === TICK_MS).length

// The caller plugin of the other suites: `/frame <method> [json]` calls $.junkd.<method>, `config` the /config menu.
const FRAME: Plugin = {
  name: 'frame',
  register(on) {
    on('command.run', { command: 'frame' }, async ($, e) => {
      const [method = '', ...rest] = e.args.trim().split(/\s+/)
      const input = rest.length ? JSON.parse(rest.join(' ')) : undefined
      try {
        if (method === 'get') return { text: JSON.stringify({ ok: await $.junkd.get(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.junkd.set(input) }) }
        if (method === 'config') return { text: JSON.stringify({ ok: await $.config.set(input) }) }
        return { text: JSON.stringify({ error: `no method ${method}` }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
  },
}
// The host's rule for a plugin's own write: `$.config.set` skips the caller's own config.set hooks.
const HOST: Plugin = {
  name: 'host',
  tier: 'prepend',
  register(on) {
    on('config.set', (_$, e, next) => (next.origin.plugin === 'junkd' ? next.to(e, 'append') : next(e)))
  },
}
const W_ = { plugins: [SPY, HOST, FRAME] }
const SPIED = { plugins: [SPY] }
async function frame($: Engine, method: string, input?: unknown): Promise<unknown> {
  const r = await run$($, 'frame', input === undefined ? method : `${method} ${JSON.stringify(input)}`)
  const out = JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}

// clock.every is dispatched once per period, so the spy counts periods: one live timer asks exactly one per tick.
const periods = async ($: Engine, w: World, n = 1) => {
  const before = await watchdogTimers($)
  await ticks(w, n)
  return (await watchdogTimers($)) - before
}

test('the timer: one 30 s interval at session start while orch and the watchdog are on', SPIED, async ($, on) => {
  const w = world(on)
  await start($)
  expect(await watchdogTimers($)).toBe(1)
  expect(await periods($, w, 3)).toBe(3)
  await start($) // a second session start keeps the one timer
  expect(await periods($, w, 2)).toBe(2)
})

for (const options of [{ orch_watchdog: false }, { orch_enabled: false }]) {
  test(`the timer: never created with ${JSON.stringify(options)}, and no agent list is read however long it runs`, { ...SPIED, options }, async ($, on) => {
    const w = world(on)
    w.rec.agents = [agent('a1', 'completed', { type: 'junkd:verify-coordinator', name: 'verify-T17' })]
    await start($)
    await ticks(w, 10)
    expect(await watchdogTimers($)).toBe(0)
    expect(w.rec.lists).toBe(0)
    expect(w.rec.stops).toEqual([])
    expect(w.rec.toasts).toEqual([])
  })
}

test('the timer follows the rows: watchdog off cancels it and clears the alarms, on starts one again', W_, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { name: 'impl-T17' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T17' })]
  await ticks(w, 1)
  await w.clock.advance(16 * MINUTE)
  expect(w.rec.toasts.filter(t => /stalled/.test(t))).toHaveLength(1)
  expect(await hintText($)).toMatch(/⚠ 1 stalled/)
  await frame($, 'set', { key: 'orch_watchdog', value: false })
  const toasts = w.rec.toasts.length
  const lists = w.rec.lists
  await w.clock.advance(TICK_MS) // the period already asked may still resolve: its tick does nothing
  expect(await periods($, w, 120)).toBe(0)
  expect(w.rec.toasts.length).toBe(toasts)
  expect(w.rec.lists).toBe(lists)
  // the segment is gone while off
  expect(await hintText($)).not.toMatch(/⚠/)
  await frame($, 'set', { key: 'orch_watchdog', value: true })
  expect(await periods($, w)).toBe(1)
  await frame($, 'set', { key: 'orch_watchdog', value: true }) // on again: still the one timer
  expect(await periods($, w)).toBe(1)
  await frame($, 'set', { key: 'orch_enabled', value: false })
  await w.clock.advance(TICK_MS)
  expect(await periods($, w, 4)).toBe(0)
  await frame($, 'set', { key: 'orch_enabled', value: true })
  expect(await periods($, w, 2)).toBe(2)
})

const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '' } } as const
async function hintText($: Engine) {
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  try {
    return (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  } finally {
    await ui.unmount()
  }
}

test('AC3: a finished agent idle past orch_idle_stop_minutes is stopped through TaskStop: a toast and a log line, once', { options: { orch_idle_stop_minutes: 1 } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { subagentType: 'general-purpose', name: 'haiku-1', cwd: '/tmp/x' })
  w.rec.agents = [agent('a1', 'running', { type: 'general-purpose', name: 'haiku-1' })]
  await ticks(w, 1)
  w.rec.agents = [agent('a1', 'completed', { type: 'general-purpose', name: 'haiku-1' })]
  await ticks(w, 1) // finished now: idle 0
  expect(w.rec.stops).toEqual([])
  await ticks(w, 2) // 60 s idle: not past 1 min
  expect(w.rec.stops).toEqual([])
  await ticks(w, 1) // 90 s
  expect(w.rec.stops).toEqual(['a1'])
  expect(w.rec.toasts).toEqual(['⚠ stopped haiku-1: reported 1 min ago'])
  expect(logLines(w)).toEqual([{ t: new Date(T0 + 5 * TICK_MS).toISOString(), agent: 'haiku-1', kind: 'idle-stopped', note: 'reported 1 min ago' }])
  await ticks(w, 10)
  expect(w.rec.stops).toEqual(['a1'])
  expect(logLines(w)).toHaveLength(1)
})

test('AC3: with orch_idle_stop off the same agent is reported once and never stopped', { options: { orch_idle_stop_minutes: 1, orch_idle_stop: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { subagentType: 'general-purpose', name: 'haiku-2', cwd: '/tmp/x' })
  w.rec.agents = [agent('a1', 'completed', { type: 'general-purpose', name: 'haiku-2' })]
  await ticks(w, 10)
  expect(w.rec.stops).toEqual([])
  expect(w.rec.toasts).toEqual(['· haiku-2 idle: reported 1 min ago · idle over 1 min · orch_idle_stop off'])
  expect(logLines(w).map(l => l.kind)).toEqual(['idle'])
})

test('a reviewer that reported (SubagentStop) and is still listed is stopped at the next tick', async ($, on) => {
  const w = world(on)
  await start($)
  w.rec.nextAgent = 'v1'
  await spawn($, { subagentType: 'junkd:verify-coordinator', name: 'verify-T17' })
  w.rec.agents = [agent('v1', 'running', { type: 'junkd:verify-coordinator', name: 'verify-T17' })]
  await ticks(w, 1)
  await stopRecord($, 'v1')
  w.rec.agents = [agent('v1', 'waiting', { type: 'junkd:verify-coordinator', name: 'verify-T17' })]
  await ticks(w, 1)
  expect(w.rec.stops).toEqual(['v1'])
  expect(w.rec.toasts).toEqual(['⚠ stopped verify-T17: reported 0 min ago'])
})

test('the stop record on disk counts too (a reload lost the module\'s), its mtime the finish; one of the watchdog\'s own (deadNote) does not', async ($, on) => {
  const w = world(on)
  await start($)
  w.rec.files[`${RECS}/v1.json`] = '{"type":"junkd:test-reviewer","tokens":5}\n'
  w.rec.mtimes[`${RECS}/v1.json`] = T0
  w.rec.files[`${RECS}/rev-2.json`] = '{"type":"junkd:test-reviewer","tokens":5}\n' // by name
  w.rec.files[`${RECS}/v3.json`] = '{"type":"junkd:test-reviewer","tokens":null,"deadNote":"x"}\n'
  w.rec.files[`${RECS}/v4.json`] = 'not json'
  w.rec.agents = ['v1', 'v2', 'v3', 'v4'].map(id => agent(id, 'waiting', { type: 'junkd:test-reviewer', name: id === 'v2' ? 'rev-2' : id }))
  await ticks(w, 1)
  expect(w.rec.stops).toEqual(['v1', 'v2'])
})

test('a stop that fails is said once, logged, and not tried again; a denied one too', async ($, on) => {
  const w = world(on)
  await start($)
  w.rec.stopAnswer = { result: 'x', isError: true, text: 'no such task' }
  w.rec.agents = [agent('v1', 'completed', { type: 'ui-reviewer', name: 'ui-T17' }), agent('v2', 'completed', { type: 'ui-reviewer', name: 'ui-T18' })]
  await ticks(w, 1)
  expect(w.rec.toasts).toEqual(['⚠ could not stop ui-T17: no such task', '⚠ could not stop ui-T18: no such task'])
  w.rec.stopAnswer = { deny: 'refused' }
  w.rec.agents.push(agent('v3', 'completed', { type: 'ui-reviewer', name: 'ui-T19' }))
  await ticks(w, 3)
  expect(w.rec.stops).toEqual(['v1', 'v2', 'v3'])
  expect(w.rec.toasts.at(-1)).toBe('⚠ could not stop ui-T19: refused')
  expect(logLines(w).map(l => [l.kind, l.note])).toEqual([['stop-failed', 'no such task'], ['stop-failed', 'no such task'], ['stop-failed', 'refused']])
})

test('ACX2: no stop for a nested agent, nor for a listed agent the main loop never spawned by a parent', async ($, on) => {
  const w = world(on)
  await start($)
  w.rec.nextAgent = 'n2'
  await spawn($, { subagentType: 'junkd:test-planner', parentAgentId: 'a9', name: 'plan-T17' })
  w.rec.agents = [agent('n1', 'completed', { type: 'junkd:verify-coordinator', parentId: 'a9' }), agent('n2', 'completed', { type: 'junkd:test-planner', name: 'plan-T17' })]
  await stopRecord($, 'n1')
  await stopRecord($, 'n2', 'junkd:test-planner')
  await ticks(w, 20)
  expect(w.rec.stops).toEqual([])
  expect(w.rec.toasts).toEqual([])
})

test('implementers: kept while the task is in a verify round, stopped once it is done; a task file unreadable keeps the last status', async ($, on) => {
  const w = world(on)
  await start($)
  w.rec.files[TASK] = taskFile('in_progress')
  await spawn($, { name: 'impl-T17' })
  w.rec.nextAgent = 'v1'
  await spawn($, { subagentType: 'junkd:verify-coordinator', name: 'verify-T17' })
  w.rec.agents = [agent('a1', 'completed', { name: 'impl-T17' }), agent('v1', 'waiting', { type: 'junkd:verify-coordinator', name: 'verify-T17' })]
  await ticks(w, 1)
  await w.clock.advance(99 * MINUTE)
  expect(w.rec.stops).toEqual([])
  // the task file cannot be read (and it says done meanwhile): the last status, in_progress, stands
  w.rec.files[TASK] = taskFile('done')
  w.rec.unreadable.add(TASK)
  await ticks(w, 4)
  expect(w.rec.stops).toEqual([])
  w.rec.unreadable.clear()
  await ticks(w, 1)
  expect(w.rec.stops).toEqual(['a1'])
  expect(w.rec.toasts).toEqual(['⚠ stopped impl-T17: reported 101 min ago']) // finished at the first tick, 30 s in
})

test('implementers: a task that left in_progress (todo) or has no file goes after the idle minutes', async ($, on) => {
  const w = world(on)
  await start($)
  w.rec.files[TASK] = taskFile('todo')
  await spawn($, { name: 'impl-T17' })
  w.rec.nextAgent = 'a2'
  await spawn($, { name: 'impl-T99', cwd: '/repo/.worktrees/T99' })
  w.rec.agents = [agent('a1', 'completed', { name: 'impl-T17' }), agent('a2', 'completed', { name: 'impl-T99' })]
  await ticks(w, 1)
  await w.clock.advance(10 * MINUTE)
  expect(w.rec.stops).toEqual([])
  await ticks(w, 1)
  expect(w.rec.stops.sort()).toEqual(['a1', 'a2'])
})

test('a stall: one toast, one log line, the ⚠ segment, one injected line; a long call in flight is none', async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { name: 'impl-T19' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T19' })]
  // a Bash call that runs 30 minutes: held in flight, no stall
  let release!: () => void
  w.rec.hold = new Promise<void>(r => { release = r })
  const call = $.tool.call(sub('Bash', 'a1', { command: 'sleep 1800', hold: true }))
  await w.clock.advance(30 * MINUTE)
  expect(w.rec.toasts).toEqual([])
  expect(await hintText($)).not.toMatch(/⚠/)
  release()
  await call
  await w.clock.settle()
  await w.clock.advance(15 * MINUTE)
  expect(w.rec.toasts).toEqual([])
  await w.clock.advance(TICK_MS)
  expect(w.rec.toasts).toEqual(['⚠ impl-T19 stalled: idle 15 min · last: Bash sleep 1800'])
  expect(logLines(w).map(l => [l.agent, l.kind, l.note])).toEqual([['impl-T19', 'stall', 'idle 15 min · last: Bash sleep 1800']])
  expect(await hintText($)).toMatch(/⚠ 1 stalled/)
  await w.clock.advance(10 * MINUTE)
  expect(w.rec.toasts).toHaveLength(1)
  await submit($)
  await submit($, 'again')
  expect(w.rec.prompts.map(p => p.context)).toEqual([['watchdog: impl-T19 idle 15 min, last call Bash sleep 1800; ping it or stop it'], undefined])
})

test('a death: toast, log, the deadNote record by id and name, the segment, and its line once at the next prompt', async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { name: 'impl-T17' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T17' })]
  await $.tool.call(sub('Bash', 'a1', { command: 'tests/smoke.sh' }))
  await ticks(w, 1)
  w.rec.agents = []
  await w.clock.advance(18 * MINUTE)
  expect(w.rec.toasts).toEqual(['⚠ impl-T17 died: no SubagentStop record · last: Bash tests/smoke.sh'])
  expect(logLines(w).map(l => [l.kind, l.note])).toEqual([['dead', 'no SubagentStop record · last: Bash tests/smoke.sh']])
  const note = { type: 'junkd:implementer', tokens: null, deadNote: 'no SubagentStop record · last: Bash tests/smoke.sh' }
  expect(JSON.parse(w.rec.files[`${RECS}/a1.json`]!)).toEqual(note)
  expect(JSON.parse(w.rec.files[`${RECS}/impl-T17.json`]!)).toEqual(note)
  expect(await hintText($)).toMatch(/⚠ 1 dead/)
  await submit($)
  await submit($)
  expect(w.rec.prompts[0]!.context).toEqual(['watchdog: impl-T17 died (no stop record, last call Bash tests/smoke.sh 1 min ago); resume it with SendMessage or spawn a fresh agent on task/T17-tools-pane'])
  expect(w.rec.prompts[1]!.context).toBe(undefined)
  expect(w.rec.toasts).toHaveLength(1)
})

test('a prompt that does not enter keeps the line for the next one', async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { name: 'impl-T17' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T17' })]
  await ticks(w, 1)
  w.rec.agents = []
  await ticks(w, 1)
  w.rec.dropPrompt = true
  await submit($).catch(() => undefined)
  w.rec.dropPrompt = false
  await submit($)
  await submit($)
  expect(w.rec.prompts.map(p => p.context?.length ?? 0)).toEqual([1, 1, 0])
})

test('gone with a SubagentStop record is finished, even with no report: no death', async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { name: 'impl-T17' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T17' })]
  await ticks(w, 1)
  await stopRecord($, 'a1', 'junkd:implementer')
  w.rec.agents = []
  await ticks(w, 5)
  expect(w.rec.toasts).toEqual([])
  expect(await hintText($)).not.toMatch(/⚠/)
})

test('ACX3: an agent list that throws keeps the last verdict, no alarm, no exception; a tick never runs twice at once', async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { name: 'impl-T17' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T17' })]
  await ticks(w, 1)
  w.rec.failList = true
  await w.clock.advance(60 * MINUTE)
  expect(w.rec.toasts).toEqual([])
  w.rec.failList = false
  w.rec.agents = []
  await ticks(w, 1)
  expect(w.rec.toasts.filter(t => /died/.test(t))).toHaveLength(1) // the death is seen against the last good list
})

test('/clear resets everything: the alarms, the segment, the agents seen; the timer keeps running; an exit stops it', async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { name: 'impl-T19' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T19' })]
  await ticks(w, 1)
  await w.clock.advance(16 * MINUTE)
  expect(await hintText($)).toMatch(/⚠ 1 stalled/)
  await $.session.end({ reason: 'clear', sessionId: SID, resume: {} as never })
  expect(await hintText($)).not.toMatch(/⚠/)
  await ticks(w, 1) // the same agent, seen afresh: the stall comes again as a new alarm
  await w.clock.advance(16 * MINUTE)
  expect(w.rec.toasts.filter(t => /stalled/.test(t))).toHaveLength(2)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SID, resume: {} as never } as never)
  const lists = w.rec.toasts.length
  w.rec.agents = []
  await w.clock.advance(60 * MINUTE)
  expect(w.rec.toasts.length).toBe(lists)
})

test('the ⚠ segment is red, sits after what is beneath, and a press opens the tools pane on Agents', async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { name: 'impl-T19' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T19' })]
  await ticks(w, 1)
  await w.clock.advance(16 * MINUTE)
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  const seg = await ui.find({ type: 'Button', key: 'junkd-watchdog' })
  expect(seg?.text).toBe('⚠ 1 stalled')
  expect((await ui.findAll({ type: 'Text' })).find(t => t.text === '⚠ 1 stalled')?.props.color).toBe('error')
  await ui.press({ key: 'junkd-watchdog' })
  await ui.unmount()
  expect(w.rec.opened).toEqual(['junkd-tools'])
  const pane = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', component: 'Pane', requestId: 'junkd-tools', props: { title: 'tools', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as never)
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.find(t => t.startsWith(' 1 Agents'))).toBeDefined() // the active tab
  expect(texts.some(t => /impl-T19.*⚠ stalled 16m/.test(t))).toBe(true)
  await pane.unmount()
})

test('/junkd:orch watchdog prints the table to the transcript and the count as a toast; off and on flip the row', W_, async ($, on) => {
  const w = world(on)
  await start($)
  await spawn($, { name: 'impl-T19' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T19' })]
  await ticks(w, 1)
  await w.clock.advance(16 * MINUTE)
  w.rec.toasts.length = 0
  expect(await run$($, 'junkd:orch', 'watchdog')).toEqual({})
  expect(w.rec.logs.at(-1)!.split('\n')).toEqual([
    'agent     role         status   idle  verdict',
    'impl-T19  implementer  running  16m   stalled',
  ])
  expect(w.rec.toasts).toEqual(['watchdog: 1 agent · 1 stalled'])
  expect(await run$($, 'junkd:orch', 'watchdog off')).toEqual({ text: 'watchdog off' })
  expect(w.rec.config.at(-1)).toEqual({ key: 'junkd.orch_watchdog', value: false })
  expect(await frame($, 'get', { key: 'orch_watchdog' })).toBe(false)
  await run$($, 'junkd:orch', 'watchdog')
  expect(w.rec.logs.at(-1)).toBe('watchdog: off (/junkd:orch watchdog on)')
  expect(await run$($, 'junkd:orch', ' watchdog  ON ')).toEqual({ text: 'watchdog on' })
  expect(w.rec.config.at(-1)).toEqual({ key: 'junkd.orch_watchdog', value: true })
  expect(await run$($, 'junkd:orch', 'watchdog maybe')).toEqual({ text: 'junkd: /junkd:orch watchdog takes on, off or nothing, not "maybe"' })
  // a word that only starts alike is the plain skill
  expect(await run$($, 'junkd:orch', 'watchdogs')).toEqual({ text: 'downstream junkd:orch watchdogs' })
})

test('/junkd:orch watchdog while orch is disabled says so', { options: { orch_enabled: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await run$($, 'junkd:orch', 'watchdog')
  expect(w.rec.logs).toEqual(['watchdog: off (orch_enabled is off)'])
  expect(w.rec.toasts).toEqual(['watchdog: off'])
})

test('the rows by $.junkd.set: the switches take true, "true" and "on"; the minutes are clamped, a non-number refused', W_, async ($, on) => {
  const w = world(on)
  await start($)
  for (const key of ['orch_watchdog', 'orch_idle_stop']) {
    for (const v of [true, 'true', 'on']) {
      await frame($, 'set', { key, value: false })
      expect(await frame($, 'set', { key, value: v }), `${key} ${String(v)}`).toBe(true)
      expect(await frame($, 'get', { key })).toBe(true)
    }
    expect(await frame($, 'set', { key, value: 'off' })).toBe(false)
  }
  for (const key of ['orch_idle_stop_minutes', 'orch_stall_minutes']) {
    for (const [v, want] of [[0, 1], [1, 1], [120, 120], [121, 120], ['45', 45], [2.6, 3]] as const) {
      expect(await frame($, 'set', { key, value: v }), `${key} ${String(v)}`).toBe(want)
      expect(w.rec.config.at(-1)).toEqual({ key: `junkd.${key}`, value: want })
    }
    await expect(frame($, 'set', { key, value: 'x' })).rejects.toThrow(new RegExp(`x is not a valid ${key.slice(5)}`))
  }
})

test('the rows by the /config menu: each spelling of a switch, the minutes clamped, a non-number refused; the stall bound moves', W_, async ($, on) => {
  const w = world(on)
  await start($)
  for (const v of [true, 'true', 'on']) {
    await frame($, 'config', { key: 'junkd.orch_idle_stop', value: false })
    expect(await frame($, 'get', { key: 'orch_idle_stop' })).toBe(false)
    await frame($, 'config', { key: 'junkd.orch_idle_stop', value: v })
    expect(await frame($, 'get', { key: 'orch_idle_stop' }), String(v)).toBe(true)
  }
  for (const v of [true, 'true', 'on']) {
    await frame($, 'config', { key: 'junkd.orch_watchdog', value: 'off' })
    expect(await frame($, 'get', { key: 'orch_watchdog' })).toBe(false)
    await frame($, 'config', { key: 'junkd.orch_watchdog', value: v })
    expect(await frame($, 'get', { key: 'orch_watchdog' }), String(v)).toBe(true)
  }
  await frame($, 'config', { key: 'junkd.orch_idle_stop_minutes', value: 500 })
  expect(w.rec.config.at(-1)).toEqual({ key: 'junkd.orch_idle_stop_minutes', value: 120 })
  expect(await frame($, 'get', { key: 'orch_idle_stop_minutes' })).toBe(120)
  expect(await frame($, 'config', { key: 'junkd.orch_stall_minutes', value: 'soon' })).toEqual({ deny: 'soon is not a valid stall_minutes (minutes, 1–120)' })
  expect(await frame($, 'get', { key: 'orch_stall_minutes' })).toBe(15)
  await frame($, 'config', { key: 'junkd.orch_stall_minutes', value: '0' })
  expect(await frame($, 'get', { key: 'orch_stall_minutes' })).toBe(1)
  // the bound moved to 1 minute: an agent idle 61 s stalls
  await spawn($, { name: 'impl-T19' })
  w.rec.agents = [agent('a1', 'running', { name: 'impl-T19' })]
  await ticks(w, 2)
  expect(w.rec.toasts.filter(t => /stalled/.test(t))).toHaveLength(0)
  await w.clock.advance(TICK_MS)
  expect(w.rec.toasts.filter(t => /stalled/.test(t))).toEqual(['⚠ impl-T19 stalled: idle 1 min · last: no tool call seen'])
})

test('the ⚙ orch pane draws the four rows and edits them: h and i flip the switches, a minutes field saves clamped, a word is refused', W_, async ($, on) => {
  const w = world(on)
  await start($)
  await run$($, 'junkd:orch', 'panel')
  const PANE = { component: 'Pane', requestId: 'orch', props: { title: 'orch', isFocused: true, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE } as never)
  const words = async () => [...(await ui.findAll({ type: 'Text' })).map(t => t.text), ...(await ui.findAll({ type: 'Button' })).map(b => String(b.props.label ?? ''))].join('\n')
  const t = await words()
  for (const title of ['Agent watchdog', 'Watchdog: stop idle leftovers', 'Watchdog: idle minutes before a stop', 'Watchdog: stall after N minutes']) expect(t, title).toContain(title)
  expect(t).toContain('1–120')
  const buttons = await ui.findAll({ type: 'Button' })
  expect(['h', 'i', 'j', 'k'].map(k => buttons.find(b => b.props.hotkey === k)?.key)).toEqual(['orch:watchdog', 'orch:idle_stop', 'orch:idle_stop_minutes-focus', 'orch:stall_minutes-focus'])
  const press = async (key: string) => ui.press({ key: (await ui.findAll({ type: 'Button' })).find(b => b.props.hotkey === key)!.key! })
  await press('h')
  expect(w.rec.config.at(-1)).toEqual({ key: 'junkd.orch_watchdog', value: false })
  expect(await frame($, 'get', { key: 'orch_watchdog' })).toBe(false)
  await press('h')
  expect(w.rec.config.at(-1)).toEqual({ key: 'junkd.orch_watchdog', value: true })
  await press('i')
  expect(w.rec.config.at(-1)).toEqual({ key: 'junkd.orch_idle_stop', value: false })
  expect(await frame($, 'get', { key: 'orch_idle_stop' })).toBe(false)
  const field = async (name: string) => (await ui.findAll({ type: 'Input' })).find(i => new RegExp(`^orch:${name}`).test(i.key ?? ''))!.key!
  await ui.input({ key: await field('idle_stop_minutes'), text: '200' })
  expect(w.rec.config.at(-1)).toEqual({ key: 'junkd.orch_idle_stop_minutes', value: 120 })
  await ui.input({ key: await field('stall_minutes'), text: '7' })
  expect(w.rec.config.at(-1)).toEqual({ key: 'junkd.orch_stall_minutes', value: 7 })
  const writes = w.rec.config.length
  await ui.input({ key: await field('stall_minutes'), text: 'soon' })
  expect(await words()).toMatch(/stall_minutes takes a whole number 1–120, not "soon"/)
  expect(w.rec.config.length).toBe(writes)
  await ui.unmount()
})
