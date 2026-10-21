// The agent watchdog's module side: a 30 s timer ($.clock.every, owned here) runs watchdog.ts's tick over what the
// hooks saw, and acts on what it raises. Zero tokens: no model is asked, nothing is respawned.
// - index.tsx's tool.call hook hands each subagent call's start and end (watchCallStart, watchCallEnd), orch.tsx's
//   agent.spawn hook each spawn (watchSpawned), its classic.SubagentStop hook each stop record (watchStopped).
// - A stop is the engine's own: the TaskStop tool through $.tool.call (the API has no agent.stop), which takes an
//   agent's id. Every stop, death, stall and reported idle leftover is a toast and a line of the watchdog log,
//   ${CLAUDE_CONFIG_DIR}/junkd/orch/watchdog/<session>.log, one JSON {t, agent, kind, note} per line.
// - A death or a stall: the ⚠ segment under the prompt (index.tsx lays it out; a press opens the tools pane on Agents)
//   and one line for the orchestrator at its next turn, attached by index.tsx's prompt.submit hook. A death also leaves
//   a record with a deadNote on disk, so SendMessage still reaches the agent by id or name.
// - Off (orch_enabled or orch_watchdog off): no timer, no alarms. /clear and /resume start everything over
//   (tools-pane.tsx's session.end hook calls watchdogEnd); any other end of the session stops the timer.
import type { AgentInfo, AgentSpawnInput, AgentSpawnResult, On, RenderInput, ToolCallInput } from 'claude-code'
import type { $ } from './feature'
import { O } from './orch-lib'
import {
  TICK_MS, W, countText, emptyState, segmentText, stopClass, takePending, taskOf, tick, verdictTable,
  type Call, type Spawn, type WatchEvent, type WatchSettings, type WatchState,
} from './watchdog.ts'

const PLAIN_ID = /^[A-Za-z0-9_-]+$/
const reason = (err: unknown) => (err as Error)?.message ?? String(err)

let timer: { cancel(): void } | null = null
let ticking = false
let gen = 0 // bumped by every reset: a tick that began before one drops its result
const stopFailed = new Map<string, string>() // agent id -> why its last stop failed (said once, retried each tick)
let calls: Record<string, Call> = Object.create(null)
let spawns: Record<string, Spawn> = Object.create(null)
let records: Record<string, number> = Object.create(null) // agent id -> when this module saw its SubagentStop
let logs: Promise<void> = Promise.resolve()

export const settingsNow = (): WatchSettings => ({
  on: O.enabled && O.watchdog,
  idleStop: O.idle_stop,
  idleStopMinutes: O.idle_stop_minutes,
  stallMinutes: O.stall_minutes,
})

function resetWatch() {
  gen++
  stopFailed.clear()
  calls = Object.create(null)
  spawns = Object.create(null)
  records = Object.create(null)
  W.state = emptyState()
}

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}
// Paths follow CLAUDE_CONFIG_DIR like Claude Code itself; tests point it at a fake tree.
async function configDir($: $) {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}
async function sessionId($: $): Promise<string> {
  const sid = await $.session.id().catch(() => '')
  return PLAIN_ID.test(sid) ? sid : ''
}

// The session's repo (git's toplevel of its cwd), whose .orch/tasks/ holds the task files; '' outside a repo.
const repos = new Map<string, string>()
async function sessionRepo($: $): Promise<string> {
  const cwd = await $.session.cwd().catch(() => '')
  if (!cwd) return ''
  let repo = repos.get(cwd)
  if (repo === undefined) {
    const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined)
    repo = r?.exitCode === 0 ? r.stdout.trim() : ''
    repos.set(cwd, repo)
  }
  return repo
}

function redraw($: $) {
  return $.ui.invalidate('ui.render')
}

// the timer ----------------------------------------------------------------------------------------------------------

// The timer runs while the watchdog is on, and only then: started, stopped or left as it is.
function syncTimer($: $) {
  if (settingsNow().on) {
    if (!timer) timer = $.clock.every(TICK_MS, () => void runTick($))
  } else {
    timer?.cancel()
    timer = null
  }
}

// One tick: the snapshot, the reducer, the actions. Never two at once; a read that fails keeps the last verdict, and
// nothing here throws out of the timer.
async function runTick($: $): Promise<void> {
  if (ticking || !settingsNow().on) return
  ticking = true
  const g = gen
  try {
    const listed = await $.agent.list().catch(() => undefined)
    const now = await $.clock.now()
    const prev = W.state
    const snap = {
      listed,
      calls,
      spawns,
      records: listed ? await readRecords($, prev, listed) : {},
      tasks: listed ? await readTasks($, listed) : {},
      branches: listed ? await deathBranches($, prev, listed) : {},
      settings: settingsNow(),
    }
    if (g !== gen) return // /clear or the switch went off meanwhile: this tick's state is stale
    const { state, events } = tick(prev, snap, now)
    W.state = state
    for (const ev of events) await act($, ev, state, now)
    redraw($)
  } catch {
    // a tick that fails is skipped: the next one reads again
  } finally {
    ticking = false
  }
}

// The stop records: the ones this module saw, else the file scripts/orch-agent-stop.sh wrote (by id, then by name),
// dated by its mtime. A record of the watchdog's own (deadNote) is none: it marks a death. Read for the agents that
// can have one now: gone since the last tick, or listed and not running.
async function readRecords($: $, prev: WatchState, listed: readonly AgentInfo[]): Promise<Record<string, number>> {
  const out: Record<string, number> = { ...records }
  const sid = await sessionId($)
  if (!sid) return out
  const dir = `${await configDir($)}/junkd/orch/_agents/${sid}`
  const ids = new Set(listed.map(a => a.id))
  const ask: { id: string; name?: string }[] = listed.filter(a => a.status !== 'running').map(a => ({ id: a.id, name: a.name }))
  for (const m of Object.values(prev.agents)) if (m.listed && !ids.has(m.id)) ask.push({ id: m.id, name: m.name })
  for (const { id, name } of ask) {
    if (out[id] !== undefined) continue
    for (const key of [id, name]) {
      if (!key || !PLAIN_ID.test(key)) continue
      const at = await savedAt($, `${dir}/${key}.json`)
      if (at === undefined) continue
      out[id] = at
      break
    }
  }
  return out
}
async function savedAt($: $, path: string): Promise<number | undefined> {
  const text = await $.fs.read(path).catch(() => undefined)
  if (text === undefined) return undefined
  try {
    const saved = JSON.parse(text) as Record<string, unknown>
    if (typeof saved !== 'object' || saved === null || 'deadNote' in saved) return undefined
  } catch {
    return undefined
  }
  return (await $.fs.stat(path).catch(() => undefined))?.mtimeMs
}

// The task file's status of each implementer's task, read once a tick: `.orch/tasks/<id>.md` of the session's repo,
// its frontmatter's `status:`. No repo or no file is '' (the idle rule alone); a file that cannot be read is left out,
// so the last status read stands.
async function readTasks($: $, listed: readonly AgentInfo[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const wanted = new Set<string>()
  for (const a of listed) {
    const task = taskOf(a.name || spawns[a.id]?.name || '', spawns[a.id]?.cwd)
    if (task && stopClass(a.type, a.name ?? '') === 'implementer') wanted.add(task)
  }
  if (!wanted.size) return out
  const repo = await sessionRepo($)
  for (const task of wanted) {
    if (!repo) {
      out[task] = ''
      continue
    }
    const path = `${repo}/.orch/tasks/${task}.md`
    const exists = await $.fs.exists(path).catch(() => undefined)
    if (exists === false) {
      out[task] = ''
      continue
    }
    const text = exists ? await $.fs.read(path).catch(() => undefined) : undefined
    if (text === undefined) continue
    out[task] = statusOfTaskFile(text)
  }
  return out
}
// `status:` inside the leading `---` block; '' when there is none.
export function statusOfTaskFile(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  return (m && /^status:[ \t]*([A-Za-z_-]+)/m.exec(m[1]!)?.[1]) || ''
}

// The branch of each agent that may have died this tick (alive at the last, gone now), for the line that names it.
async function deathBranches($: $, prev: WatchState, listed: readonly AgentInfo[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const ids = new Set(listed.map(a => a.id))
  for (const m of Object.values(prev.agents)) {
    if (!m.listed || m.status === 'done' || ids.has(m.id) || !m.cwd) continue
    const r = await $.process.run(['git', '-C', m.cwd, 'branch', '--show-current']).catch(() => undefined)
    const branch = r?.exitCode === 0 ? r.stdout.trim() : ''
    if (branch) out[m.id] = branch
  }
  return out
}

// actions ------------------------------------------------------------------------------------------------------------

async function act($: $, ev: WatchEvent, state: WatchState, now: number): Promise<void> {
  if (ev.kind === 'idle-stopped') {
    const stopped = await stopAgent($, ev.id, state)
    if (stopped === true) {
      stopFailed.delete(ev.id)
      $.ui.toast(`⚠ stopped ${ev.agent}: ${ev.note}`)
      return logEvent($, now, ev.agent, 'idle-stopped', ev.note)
    }
    // Not stopped: no alarm and no "stopped" verdict, so the next tick raises it again and retries.
    state.alarms[ev.id] = (state.alarms[ev.id] ?? []).filter(k => k !== 'idle-stopped')
    const v = state.verdicts[ev.id]
    if (v?.kind === 'stopped') state.verdicts[ev.id] = { ...v, kind: 'stop' }
    // ponytail: the toast and the log line come once per reason, not every 30 s retry
    if (stopFailed.get(ev.id) === stopped) return
    stopFailed.set(ev.id, stopped)
    $.ui.toast(`⚠ could not stop ${ev.agent}: ${stopped}`)
    return logEvent($, now, ev.agent, 'stop-failed', stopped)
  }
  if (ev.kind === 'dead') {
    $.ui.toast(`⚠ ${ev.agent} died: ${ev.note}`)
    await writeDeadNote($, ev, state)
    return logEvent($, now, ev.agent, 'dead', ev.note)
  }
  if (ev.kind === 'stall') {
    $.ui.toast(`⚠ ${ev.agent} stalled: ${ev.note}`)
    return logEvent($, now, ev.agent, 'stall', ev.note)
  }
  $.ui.toast(`· ${ev.agent} idle: ${ev.note}`)
  return logEvent($, now, ev.agent, 'idle', ev.note)
}

// The engine's stop of an agent the main loop spawned and the watchdog lists; never a nested one, never the main
// loop (no id). true, or the reason it failed.
async function stopAgent($: $, id: string, state: WatchState): Promise<true | string> {
  const m = state.agents[id]
  if (!id || !m || m.nested) return 'not an agent of the main loop'
  try {
    const r = (await $.tool.call({ tool: 'TaskStop', task_id: id } as never)) as { deny?: string; isError?: boolean; text?: string }
    if (r.deny !== undefined) return r.deny
    if (r.isError) return r.text || 'TaskStop failed'
    return true
  } catch (err) {
    return reason(err)
  }
}

// One JSON line per event, appended in order (read and written whole: the log of one session stays small).
function logEvent($: $, now: number, agent: string, kind: string, note: string): Promise<void> {
  const write = logs.then(async () => {
    const sid = await sessionId($)
    if (!sid) return
    const dir = `${await configDir($)}/junkd/orch/watchdog`
    const path = `${dir}/${sid}.log`
    const line = `${JSON.stringify({ t: new Date(now).toISOString(), agent, kind, note })}\n`
    const old = await $.fs.read(path).catch(() => '')
    await $.fs.write(path, old + line).catch(async () => {
      await $.process.run(['mkdir', '-p', '--', dir])
      await $.fs.write(path, old + line)
    })
  })
  logs = write.catch(() => undefined)
  return logs
}

// The dead agent's record, by id and by name, as orch-agent-stop.sh writes one, with the note of how it died.
async function writeDeadNote($: $, ev: WatchEvent, state: WatchState): Promise<void> {
  try {
    const sid = await sessionId($)
    if (!sid) return
    const dir = `${await configDir($)}/junkd/orch/_agents/${sid}`
    const text = `${JSON.stringify({ type: state.agents[ev.id]?.type ?? '', tokens: null, deadNote: ev.note })}\n`
    for (const key of new Set([ev.id, ev.agent])) if (PLAIN_ID.test(key)) await $.fs.write(`${dir}/${key}.json`, text)
  } catch {}
}

// what the other files call -------------------------------------------------------------------------------------------

// The text of a call for the injected line: the tool and the head of its first plain argument.
const ARG_KEYS = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt'] as const
export function callText(e: Record<string, unknown>): string {
  const arg = ARG_KEYS.map(k => e[k]).find((v): v is string => typeof v === 'string' && v.trim() !== '')
  const head = arg ? [...arg.replace(/\s+/g, ' ').trim()] : []
  return `${String(e.tool)}${head.length ? ` ${head.length > 40 ? `${head.slice(0, 39).join('')}…` : head.join('')}` : ''}`
}

// index.tsx's tool.call, the model's own calls in a subagent: one more call in flight, and when it started. Never
// throws (tool.call's .catch would run the tool again).
export async function watchCallStart($: $, e: ToolCallInput, origin: string | undefined): Promise<void> {
  try {
    const id = (e as { agentId?: string }).agentId
    if (origin !== 'engine' || !id) return
    const c = calls[id] ?? (calls[id] = { inFlight: 0 })
    c.start = await $.clock.now()
    c.inFlight++
    c.last = callText(e as unknown as Record<string, unknown>)
  } catch {}
}
// ... and its end, however it ended.
export async function watchCallEnd($: $, e: ToolCallInput, origin: string | undefined): Promise<void> {
  try {
    const id = (e as { agentId?: string }).agentId
    if (origin !== 'engine' || !id) return
    const c = calls[id] ?? (calls[id] = { inFlight: 1 })
    c.end = await $.clock.now()
    c.inFlight = Math.max(0, c.inFlight - 1)
  } catch {}
}
// orch.tsx's agent.spawn, once it started: when, where, by whom (a parent agent: nested) and under which name.
export async function watchSpawned($: $, e: AgentSpawnInput, r: AgentSpawnResult): Promise<void> {
  try {
    if (r.agentId === undefined) return
    spawns[r.agentId] = {
      at: await $.clock.now(),
      cwd: e.cwd ?? (await $.session.cwd().catch(() => undefined)),
      ...(e.parentAgentId ? { parent: e.parentAgentId } : {}),
      ...(e.name ? { name: e.name } : {}),
    }
  } catch {}
}
// orch.tsx's classic.SubagentStop: the agent's stop record, now.
export async function watchStopped($: $, id: string): Promise<void> {
  try {
    records[id] = await $.clock.now()
  } catch {}
}

// Session start (index.tsx): the timer while the watchdog is on.
export async function watchdogStart($: $): Promise<void> {
  syncTimer($)
}
// A write to an orch row (orch.tsx's apply): the timer follows orch_enabled and orch_watchdog; off drops the alarms.
export async function watchdogApplied($: $): Promise<void> {
  syncTimer($)
  if (!settingsNow().on) {
    gen++
    W.state = emptyState()
  }
}
// tools-pane.tsx's session.end: /clear and /resume start over (the process goes on, with no session.start); any
// other end stops the timer.
export async function watchdogEnd(_$: $, why: string): Promise<void> {
  if (why === 'clear' || why === 'resume') return resetWatch()
  timer?.cancel()
  timer = null
}

// /junkd:orch watchdog: a tick now, then the verdict table in the transcript and the count as a toast.
export async function watchdogReport($: $): Promise<void> {
  if (!settingsNow().on) {
    const how = O.enabled ? '/junkd:orch watchdog on' : 'orch_enabled is off'
    $.ui.log(`watchdog: off (${how})`)
    $.ui.toast('watchdog: off')
    return
  }
  await runTick($)
  $.ui.log(verdictTable(W.state))
  $.ui.toast(countText(W.state))
}

// The ⚠ segment under the prompt: red, a press opens the tools pane on its Agents tab; none while nothing is wrong.
export function watchdogSegment($: $, e: RenderInput<'PromptHint'>, open: () => void) {
  const text = settingsNow().on ? segmentText(W.state) : ''
  if (!text) return undefined
  const { Button, Text } = $.ui.resolve(e)
  return (
    <Button key="junkd-watchdog" plain label={text} onPress={open}>
      <Text color="error">{text}</Text>
    </Button>
  )
}

export function registerWatchdog(on: On, _options: Record<string, unknown>): void {
  // A register is a fresh load of the module: nothing seen yet, no timer (session start starts it).
  timer?.cancel()
  timer = null
  ticking = false
  logs = Promise.resolve()
  repos.clear()
  resetWatch()

}

// index.tsx's prompt.submit, the orchestrator's next turn (a prompt, a task notification, a scheduled run): the
// pending watchdog lines ride along as context, once; a prompt that does not enter gives them back for the next.
export function watchdogLines(): string[] {
  return takePending(W.state)
}
export function watchdogKeep(lines: readonly string[]): void {
  W.state.pending.unshift(...lines)
}
