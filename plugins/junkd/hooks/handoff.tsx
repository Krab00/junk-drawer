// handoff: /junkd:handoff, /junkd:handon, /junkd:ahandoff, the auto handoff loop (a context threshold, the 5h-limit
// resume), the 🪃 segment and its pane. The `$`-free parts are handoff-lib.ts (state, options), handoff-ui.tsx and
// handoff-views.tsx (the pane). index.tsx runs handoffStart at session start, handoffToolCall inside the one tool.call
// hook and handoffSegment inside the one PromptHint render.
import { atom, read, update } from 'claude-code'
import type { Next, On, RenderInput, RenderSurface, ToolCallInput } from 'claude-code'

import type { JunkdAhandoff as Ahandoff } from '../types'
import type { HideInput, OpenInput, SetResult, ShowInput } from './feature'
import { isSets, shutSet } from './set'
import { configKey, configKeys, fieldOf, groupOptions, keyOf } from './settings'
import { DAY, DEFAULT_PROMPT, LIMIT_GRACE, LIMIT_PROMPT, MAX_ASKS, S, coerce, current, idOf, isField, limit, loadOptions, status, type $, type Entry, type Field, type Route } from './handoff-lib'
import { Footer, P, Rule, TABS, Tabs, fields, type Api, type Ctx, type Elements } from './handoff-ui'
import { VIEWS } from './handoff-views'
import { toolsTurnEnd } from './tools-pane'
import { dashboardTurnEnd } from './dashboard.tsx'
import { lessonsTurnEnd } from './lessons.tsx'

const PANE = 'ahandoff'
const EDGE = 2 // empty columns at the pane's right edge (a docked pane's last column may not show)
const HANDOFF_FILE = /\/handoffs\/[^/]+\.md$/
// What arming says while the `enabled` setting is off; /junkd:handoff, /junkd:handon and the pane keep working.
const OFF = 'handoff: auto handoff is disabled (the enabled setting is off: /config, or the pane\'s Settings tab)'

function redraw($: $) {
  $.ui.invalidate('ui.render')
}

const STORE = 'ahandoff'

const view = atom({ plugin: 'junkd', key: 'ahandoff' } as const, {
  on: false, phase: 'idle', percent: 0, threshold: 85, checkEvery: 5,
  prompt: '', lastId: '', count: 0, route: 'auto', paneOpen: false, base: 0, fresh: false,
} satisfies Ahandoff)

// ponytail: plugin commands are namespaced (`junkd:handon`) — junkd's own first, else any plugin's by suffix.
async function findCommand($: $, suffix: 'handoff' | 'handon'): Promise<string> {
  const names = (await $.command.list()).map(c => c.name)
  return names.find(n => n === `junkd:${suffix}`) ?? names.find(n => n.endsWith(`:${suffix}`)) ?? `junkd:${suffix}`
}

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}

// Paths follow CLAUDE_CONFIG_DIR like Claude Code itself (unset or empty: the home's .claude).
async function configDir($: $): Promise<string> {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}

// Where bin/handoff-path writes: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/handoffs`.
async function handoffDir($: $): Promise<string> {
  return `${await configDir($)}/handoffs`
}

// ------------------------------------------------------------------ the measurement log
// Every measurement the loop makes or skips writes one line to `${CLAUDE_CONFIG_DIR:-~/.claude}/junkd/handoff/<session>.log`:
//   <iso> <hook> percent=<n> limit=<n> armed=<bool> fresh=<bool> decision=<fire|skip:reason> base=<n> threshold=<n> phase=<p> window=<n>
// (a trailing `note=<word>` where the hook did something besides decide). Appended with `>>`, never read back; a log
// that cannot be written is dropped, the loop never waits on it for more than the one append. The last line (without
// its time) is also kept in S.last, for `/junkd:ahandoff status`.
const PLAIN_ID = /^[A-Za-z0-9_-]+$/
type Hook = 'session.start' | 'tool.call' | 'turn.complete' | 'session.measure'
async function logPath($: $): Promise<string | undefined> {
  const sid = await $.session.id().catch(() => '')
  return PLAIN_ID.test(sid) ? `${await configDir($)}/junkd/handoff/${sid}.log` : undefined
}
async function measured($: $, hook: Hook, percent: number, decision: string, note = ''): Promise<void> {
  const body = `${hook} percent=${percent} limit=${limit()} armed=${S.armed} fresh=${S.fresh} decision=${decision} base=${S.base} threshold=${S.threshold} phase=${S.phase} window=${S.window}${note ? ` note=${note}` : ''}`
  S.last = body
  S.lastAt = Date.now()
  try {
    const path = await logPath($)
    if (!path) return
    const dir = path.slice(0, path.lastIndexOf('/'))
    await $.process.run(['sh', '-c', 'mkdir -p -- "$1" && printf \'%s\\n\' "$3" >> "$2"', 'sh', dir, path, `${new Date(S.lastAt).toISOString()} ${body}`])
  } catch {}
}

async function listHandoffs($: $, force?: boolean): Promise<Entry[]> {
  if (S.entries && !force) return S.entries
  const dir = await handoffDir($)
  const home = await homeDir($)
  S.dir = home && dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir
  let files: Awaited<ReturnType<$['fs']['list']>> = []
  try {
    files = await $.fs.list(dir)
  } catch {
    files = [] // ponytail: no folder yet = no handoffs
  }
  const now = Date.now()
  const entries = await Promise.all(
    files
      .filter(f => f.kind === 'file' && f.name.endsWith('.md'))
      .map(async f => {
        const path = `${dir}/${f.name}`
        let title = ''
        try {
          title = (await $.fs.read(path)).split('\n').find(l => l.startsWith('# '))?.slice(2).trim() ?? ''
        } catch {}
        return { id: idOf(f.name) ?? f.name.replace(/\.md$/, ''), path, mtimeMs: f.mtimeMs, title, stale: now - f.mtimeMs > S.staleDays * DAY }
      }),
  )
  S.entries = entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return S.entries
}

// Mirror S into $.state and redraw the pane and the segment.
function sync($: $, percent?: number) {
  if (percent !== undefined) S.percent = percent
  $.ui.invalidate('ui.render')
  return update($, view, v => ({
    ...v, on: S.armed, phase: S.phase, prompt: S.prompt, lastId: S.lastId ?? '', count: S.count,
    threshold: S.threshold, checkEvery: S.checkEvery, percent: S.percent, route: S.route, paneOpen: S.paneOpen,
    base: S.base, fresh: S.fresh,
  }))
}

function persist($: $) {
  return $.store.set(STORE, {
    on: S.armed, prompt: S.prompt,
    pending: S.phase === 'resume' && S.lastId ? { id: S.lastId, prompt: S.prompt } : undefined,
    resumeAt: S.blocked ? S.resumeAt : undefined,
  })
}

// A turn died on the 5h limit: one timer to 2 min past the window's reset, then the continuation prompt.
// ponytail: no 5h interval — the next limit hit schedules the next timer. The timer lives in this
// process only; after a restart session.start just tells you it was pending.
let limitTimer: { cancel(): void } | null = null
async function scheduleResume($: $) {
  if (S.blocked || !S.resetsAt) return
  S.blocked = true
  S.resumeAt = Date.parse(S.resetsAt) + LIMIT_GRACE
  const delay = Math.max(0, S.resumeAt - (await $.clock.now()))
  limitTimer = $.clock.after(delay, () => void resumeAfterLimit($))
  await persist($)
  $.ui.toast(`handoff: 5h limit hit — resuming at ${hhmm(S.resumeAt)}`)
  await sync($)
}
async function resumeAfterLimit($: $) {
  limitTimer = null
  if (!S.blocked) return
  S.blocked = false
  S.resumeAt = null
  await persist($)
  await sync($)
  if (S.armed) await sendPrompt($, S.prompt === DEFAULT_PROMPT ? LIMIT_PROMPT : S.prompt)
}
function cancelResume() {
  limitTimer?.cancel()
  limitTimer = null
  S.blocked = false
  S.resumeAt = null
}
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)


// A handoff file written this session: its id becomes the last one, the list is read again.
function record(path: string) {
  const name = path.replace(/^.*\//, '')
  const id = idOf(name) ?? name.replace(/\.md$/, '')
  S.lastId = id
  if (!S.session.includes(id)) S.session.push(id)
  S.entries = null
  return id
}

async function load($: $) {
  if (S.entries === null) {
    await listHandoffs($)
    redraw($)
  }
}

// /junkd:handoff in the next turn. ponytail: detached — $.command.run is refused inside a hook the turn waits on.
function queueHandoff($: $) {
  void $.clock.sleep(0).then(async () => $.command.run({ command: await findCommand($, 'handoff') }))
}

// /clear → /junkd:handon <id> → the continuation prompt, detached like queueHandoff.
// A slash prompt cannot ride along as text (the host refuses it and the model would only read it),
// so it runs as the command itself right after /junkd:handon.
function continueFrom($: $, id: string) {
  const text = S.prompt || DEFAULT_PROMPT
  void $.clock.sleep(0).then(async () => {
    S.fresh = S.armed // the guard is the loop's: a manual resume while off needs none
    S.phase = 'clear'
    // ponytail: queue /clear before any other await — a headless session exits right after the turn.
    const cleared = $.command.run({ command: 'clear' })
    void sync($)
    await cleared
    S.phase = 'resume'
    void sync($)
    await $.command.run({ command: await findCommand($, 'handon'), args: id })
    S.phase = 'idle'
    await persist($)
    await sync($, 0)
    await sendPrompt($, text)
  })
}

// Runs the armed prompt as the next turn, detached like queueHandoff ($.prompt.submit is refused
// inside a hook the turn waits on). The host refuses a submitted text starting with /, so a slash
// command goes through $.command.run instead.
function runPrompt($: $, text: string) {
  void $.clock.sleep(0).then(() => sendPrompt($, text))
}
async function sendPrompt($: $, text: string) {
  const [, command, args = ''] = /^\/(\S+)\s*([\s\S]*)$/.exec(text) ?? []
  await (command ? $.command.run({ command, args }) : $.prompt.submit({ text }))
}

// `/junkd:ahandoff status`: armed or off, the limit as it stands, the last measurement, and the log's path.
async function statusText($: $): Promise<string> {
  const path = await logPath($)
  const last = S.last ? `${new Date(S.lastAt).toISOString()} ${S.last}` : 'none yet'
  return `handoff auto ${S.armed ? 'on' : 'off'} — threshold ${S.threshold}% — limit ${limit()}% — last measurement: ${last} — log: ${path ?? 'none (no session id)'}`
}

async function panel($: $) {
  await toggle($)
  return {}
}
async function auto($: $, prompt: string, pane = true) {
  if (!S.enabled) return { text: OFF }
  // the pane opens first: only an open made while the command runs is placed at any width
  const opened = pane ? openPane($, 'auto') : undefined
  await arm($)
  await opened
  if (!prompt) return { text: `handoff auto on — threshold ${S.threshold}%` }
  runPrompt($, prompt)
  return { text: `handoff auto on — threshold ${S.threshold}% — running: ${prompt}` }
}
async function off($: $) {
  await disarm($)
  return { text: 'handoff auto off.' }
}

// Who opened the pane through handoffShow({ owner }) (the /junkd set of panes); any other open or close clears
// it, so `hide({ owner })` closes only a pane that owner opened and nobody reopened since.
let owner: string | undefined

// `$.ui.open` before any await: only an open made while the press or command runs counts as asked.
async function openPane($: $, route?: Route, focus = true) {
  const opened = $.ui.open({ id: PANE, title: 'handoff', focus: focus || undefined })
  owner = undefined
  if (route) S.route = route
  S.paneOpen = (await opened).isPlaced
  await sync($)
  void load($)
}

// The engine does not raise our own `$.ui.close` to our `ui.close` hook, so we clear the flag here.
async function closePane($: $) {
  S.paneOpen = false
  owner = undefined
  await $.ui.close({ id: PANE })
  await sync($)
}

function toggle($: $, route?: Route) {
  return S.paneOpen ? closePane($) : openPane($, route)
}

async function arm($: $) {
  if (!S.enabled) {
    S.note = `✗ ${OFF}`
    return void redraw($)
  }
  S.armed = true
  S.phase = 'idle'
  S.calls = 0
  S.asks = 0
  S.armedAt = Date.now()
  await persist($)
  await sync($)
}

// Drops the cycle too: a handoff written but not yet acted on, and the fresh-window guard, are the old loop's.
async function disarm($: $) {
  S.armed = false
  cancelResume()
  S.phase = 'idle'
  S.written = null
  S.asks = 0
  S.fresh = false
  S.base = 0 // the baseline belongs to the window a handoff of this loop started; a loop armed again starts from none
  S.armedAt = null
  await persist($)
  await sync($)
}

async function remove($: $, ids: string[]) {
  const entries = await listHandoffs($)
  const paths = entries.filter(x => ids.includes(x.id)).map(x => x.path)
  if (paths.length) await $.process.run(['rm', '--', ...paths])
  S.entries = null
  S.confirm = null
  await listHandoffs($)
  return paths.length
}

// Writes one field to its `/config` row (`junkd.handoff_<field>`) and mirrors it into S. `{ deny }` when the value
// does not fit or a hook refused; the pane's note says which either way.
async function setOption($: $, field: Field, raw: string | number | boolean) {
  const c = coerce(field, raw)
  if (c.error !== undefined) {
    S.note = `✗ ${c.error}`
    redraw($)
    return { deny: c.error }
  }
  const value = c.value
  const { deny } = await $.config.set({ key: configKey(keyOf('handoff', field)), value })
  if (deny) {
    S.note = `✗ ${deny}`
    redraw($)
    return { deny }
  }
  S.note = `✓ ${field} = ${String(value)}`
  await apply($, field, value)
  return { value: current(field) } as const
}

// One field as its row took it, into S — the one place a write lands, from setOption or the /config menu's hook.
async function apply($: $, field: Field, value: number | boolean) {
  if (field === 'threshold') S.threshold = value as number
  else if (field === 'checkEvery') S.checkEvery = value as number
  else if (field === 'staleDays') { S.staleDays = value as number; S.entries = null; void load($) }
  else if (field === 'segment') S.segment = value as boolean
  else if (field === 'autoOn') S.autoOn = value as boolean
  else if (field === 'resumeAfterLimit') { S.resumeAfterLimit = value as boolean; if (!value) cancelResume() }
  else if (field === 'enabled') await applyEnabled($, value as boolean)
  await sync($)
}

// `enabled` as the row took it. Off disarms the loop (and drops a pending 5h-limit resume), and arm() refuses while
// it is off, so the loop's hooks need only `S.armed`. On arms nothing: the loop waits for /junkd:ahandoff (autoOn arms at
// load only).
async function applyEnabled($: $, on: boolean) {
  S.enabled = on
  if (!on && S.armed) await disarm($)
}

function api($: $): Api {
  return {
    go: route => {
      S.route = route
      S.note = ''
      S.confirm = null
      S.viewing = null
      void sync($)
      void load($)
    },
    arm: () => arm($),
    disarm: () => void disarm($),
    handoffNow: async () => {
      if (S.armed) S.phase = 'handoff'
      S.note = '✓ handoff queued'
      queueHandoff($)
      await sync($)
    },
    resume: async id => continueFrom($, id),
    handon: async id => {
      await $.command.run({ command: await findCommand($, 'handon'), args: id })
    },
    copy: async (id, surface) => {
      const r = await $.ui.copy({ text: id, surface: surface as RenderSurface })
      S.note = r.isCopied ? `✓ copied ${id}` : `✗ could not copy ${id}`
      redraw($)
    },
    remove: async id => {
      S.note = (await remove($, [id])) ? `✓ deleted ${id}` : `✗ ${id} not found`
      redraw($)
    },
    deleteStale: async () => {
      const stale = (await listHandoffs($, true)).filter(x => x.stale).map(x => x.id)
      S.note = `✓ deleted ${await remove($, stale)} stale handoff(s)`
      redraw($)
    },
    openFolder: async () => {
      const r = await $.process.run(['open', await handoffDir($)])
      if (r.exitCode !== 0) S.note = `✗ ${r.stderr.trim() || 'could not open the folder'}`
      redraw($)
    },
    set: async (field, value) => { await setOption($, field, value) },
    refresh: () => {
      redraw($)
      void load($)
    },
  }
}

// ------------------------------------------------------------------ what index.tsx and dispatch.ts call

// $.junkd.open's route is any pane's tab: past this check it is one of handoff's own.
function checkRoute(route: unknown): asserts route is Route | undefined {
  if (route !== undefined && !TABS.some(t => t[2] === route)) throw new Error(`handoff: no tab ${String(route)}`)
}

export async function handoffGet(_$: $, field: string): Promise<number | boolean> {
  return current(field as Field)
}
export async function handoffSet($: $, field: string, raw: unknown): Promise<SetResult> {
  if (!isField(field)) return { deny: `junkd: no setting ${keyOf('handoff', field)}` }
  const r = await setOption($, field, raw as string | number | boolean)
  return r.deny !== undefined ? { deny: r.deny } : { value: r.value }
}
// A route while the pane is up switches its tab; otherwise the call toggles the pane, as /junkd:handoff panel does.
export async function handoffOpen($: $, input: OpenInput = {}): Promise<void> {
  const route = input.route
  checkRoute(route)
  if (route && S.paneOpen) {
    S.route = route
    await sync($)
    void load($)
  } else await toggle($, route)
}
// show never closes: the pane opens (or, up already, is asked again: retitled, its tab switched, the keys asked
// for), on `route` when given; `owner` marks it as that caller's, for hide.
export async function handoffShow($: $, input: ShowInput = {}): Promise<void> {
  checkRoute(input.route)
  const opened = openPane($, input.route, input.focus === true)
  owner = input.owner
  await opened
}
// hide closes the pane; with `owner`, only while the pane is still the one that owner's show opened.
export async function handoffHide($: $, input: HideInput = {}): Promise<void> {
  if (input.owner !== undefined && input.owner !== owner) return
  await closePane($)
}
export function handoffStatus() {
  return status()
}

// A reload of the module (a change in the /config menu, /reload-plugins, a save in a watched plugin folder) runs
// register again with S back at its defaults and the loop disarmed, while $.state still holds what the session's loop
// was doing. Carry the loop on from there; a new process finds nothing and stays as its settings say.
async function restore($: $) {
  if (S.armed || !S.enabled) return
  const kept = await read($, view).catch(() => undefined)
  if (!kept?.on) return
  S.armed = true
  S.armedAt ??= Date.now()
  S.prompt = kept.prompt || S.prompt
  S.count = kept.count
  S.lastId = kept.lastId || null
  S.base = kept.base ?? 0
  S.fresh = kept.fresh ?? false
  await measured($, 'session.start', S.percent, 'skip:restored', 'reload')
  $.ui.toast(`handoff: the plugin reloaded — auto handoff still on, threshold ${S.threshold}%`)
}

export async function handoffStart($: $): Promise<void> {
  const saved = (await $.store.get(STORE)) as { on?: boolean; prompt?: string | null; pending?: { id: string }; resumeAt?: number } | undefined
  if (saved?.pending) $.ui.toast(`handoff: pending handoff ${saved.pending.id} — run /junkd:handon ${saved.pending.id}`)
  if (saved?.resumeAt && saved.resumeAt > Date.now()) {
    const how = S.enabled ? 're-arm with /junkd:ahandoff' : 'auto handoff is disabled: turn the enabled setting on (/config, or the pane\'s Settings tab), then /junkd:ahandoff'
    $.ui.toast(`handoff: a 5h-limit resume was due at ${hhmm(saved.resumeAt)} — ${how}`)
  }
  if (saved?.resumeAt) await $.store.set(STORE, { ...saved, resumeAt: undefined })
  await restore($)
  await sync($)
}

export async function handoffToolCall($: $, e: ToolCallInput, next: Next<'tool.call'>) {
  if (e.agentId) return next(e)
  const isHandoffWrite = e.tool === 'Write' && HANDOFF_FILE.test(String(e.file_path))
  if (!S.armed) {
    if (!isHandoffWrite) return next(e)
    const r = await next(e)
    record(String(e.file_path))
    await sync($)
    return r
  }
  if (S.fresh || S.phase !== 'idle') {
    await measured($, 'tool.call', S.percent, S.fresh ? 'skip:fresh' : `skip:phase-${S.phase}`)
  } else if (++S.calls % S.checkEvery === 0) {
    const { context } = await $.session.usage()
    S.tokens = context.tokens ?? S.tokens
    S.window = context.window ?? S.window
    const percent = context.percent ?? 0
    const fire = percent >= limit()
    await measured($, 'tool.call', percent, fire ? 'fire' : 'skip:below-limit')
    if (fire) S.phase = 'handoff'
    await sync($, percent)
  }
  if (S.phase !== 'handoff') return next(e)
  const isHandoffPath = e.tool === 'Bash' && /handoff-path/.test(String(e.command))
  const isHandoffSkill = e.tool === 'Skill' && /handoff/.test(String((e as { skill?: unknown }).skill))
  if (isHandoffWrite) S.written = String(e.file_path)
  if (isHandoffWrite || isHandoffPath || isHandoffSkill) return next(e)
  return {
    deny: 'ahandoff: context limit reached. Stop the current work now. Call the Skill tool with skill "junkd:handoff" and follow it (run its bin/handoff-path, then Write the handoff markdown to the path it prints — include task ids, branch, worktree, round and what to do next). Then end the turn with one line. Every other tool is denied until the handoff is written.',
  }
}

// The status-line segment: 🪃 NN% (green, yellow within 10 points of the threshold, red past it). undefined while
// handoff is off or the segment setting is.
export function handoffSegment($: $, e: RenderInput<'PromptHint'>) {
  if (!S.enabled || !S.segment) return undefined
  const { Button, Text } = $.ui.resolve(e)
  const label = !S.armed
    ? '🪃 off'
    : S.blocked && S.resumeAt ? `🪃 limit → ${hhmm(S.resumeAt)}`
    : S.phase === 'handoff' ? '🪃 handoff…' : S.phase === 'idle' ? `🪃 ${S.percent}%` : '🪃 resume…'
  const color = !S.armed || S.phase !== 'idle'
    ? P.secondary
    : S.blocked ? P.warn
    : S.percent >= limit() ? P.bad : S.percent >= limit() - 10 ? P.warn : P.ok
  return (
    <Button key="handoff-segment" plain label={label} onPress={() => void toggle($)}>
      <Text color={color}>{label}</Text>
    </Button>
  )
}

export function registerHandoff(on: On, options: Record<string, unknown>): void {
  loadOptions(groupOptions(options, 'handoff'))

  // /junkd:handoff panel | auto [prompt] | off — anything else is the plain skill.
  on('command.run', { command: 'junkd:handoff' }, async ($, e, next) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    if (sub === 'panel') return panel($)
    if (sub === 'auto') return auto($, rest.join(' '))
    if (sub === 'off') return off($)
    return next(e)
  })

  // /junkd:ahandoff [prompt] | off | panel — the short form: anything else is the prompt. Its skill's text runs
  // only when this module is not loaded.
  on('command.run', { command: 'junkd:ahandoff' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'panel') return panel($)
    if (args === 'off') return off($)
    if (args === 'status') return { text: await statusText($) }
    return auto($, args, false) // ponytail: the short form arms and runs the prompt; the pane is /junkd:ahandoff panel
  })

  // The /config menu's own writes to every handoff row pass here (a hook never sees its plugin's own
  // `$.config.set`): read as `set` reads it, refused where `set` refuses, and applied live once the row took it.
  on('config.set', { key: configKeys('handoff') }, async ($, e, next) => {
    const field = fieldOf('handoff', e.key)
    if (!isField(field)) return next(e)
    const c = coerce(field, e.value)
    if (c.error !== undefined) return { deny: c.error }
    const r = await next({ ...e, value: c.value })
    if (r.deny === undefined) await apply($, field, c.value)
    return r
  })

  // The module's one turn.complete hook: the tools pane reads its tree again at every turn's end, first.
  on('turn.complete', async ($, e, next) => {
    toolsTurnEnd($)
    void dashboardTurnEnd($) // the orch dashboard's status.js, while it is open; never throws
    await lessonsTurnEnd($, e) // the lessons stores again, and the dialog when the answer prints BACKLOG:; never throws
    if (e.agentId) return next(e)
    if (!S.armed) {
      await measured($, 'turn.complete', S.percent, 'skip:disarmed')
      return next(e)
    }
    // ponytail: the host names no error kind here — an error with the 5h window at 99%+ is the limit.
    if (e.reason === 'error' && S.resumeAfterLimit && S.fiveHour >= 99) {
      await measured($, 'turn.complete', S.percent, 'skip:five-hour-limit')
      await scheduleResume($)
      return next(e)
    }
    const { context } = await $.session.usage()
    S.tokens = context.tokens ?? S.tokens
    S.window = context.window ?? S.window
    const percent = context.percent ?? 0
    if (S.fresh) {
      // nothing: the first measurement of the new window decides (session.measure)
      await measured($, 'turn.complete', percent, 'skip:fresh')
    } else if (S.phase === 'handoff' && !S.written && S.asks >= MAX_ASKS) {
      // asked MAX_ASKS times, no file: stop here instead of asking every turn for ever
      await measured($, 'turn.complete', percent, `give-up:${MAX_ASKS}-tries`)
      await disarm($)
      $.ui.toast(`ahandoff: handoff not written after ${MAX_ASKS} tries — disarmed`)
    } else if (S.phase === 'handoff' && !S.written) {
      await measured($, 'turn.complete', percent, 'cycle:ask-handoff')
      S.asks++
      queueHandoff($) // model never wrote it mid-turn: ask /junkd:handoff as the next turn
    } else if (S.phase === 'idle' && percent >= limit()) {
      await measured($, 'turn.complete', percent, 'fire')
      S.phase = 'handoff'
      S.asks = 1
      queueHandoff($)
    } else if (S.phase === 'handoff' && S.written) {
      await measured($, 'turn.complete', percent, 'cycle:continue')
      const id = record(S.written)
      S.written = null
      S.calls = 0
      S.asks = 0
      S.count++
      S.phase = 'resume'
      await persist($)
      continueFrom($, id)
    } else {
      await measured($, 'turn.complete', percent, S.phase === 'idle' ? 'skip:below-limit' : `skip:phase-${S.phase}`)
    }
    await sync($, percent)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const fiveHour = e.rateLimits.find(r => r.kind === 'five_hour')
    if (fiveHour) {
      S.fiveHour = fiveHour.percentUsed
      S.resetsAt = fiveHour.resetsAt ?? S.resetsAt
    }
    if (e.changed.includes('context')) {
      S.tokens = e.context.tokens ?? S.tokens
      S.window = e.context.window ?? S.window
      const percent = e.context.percent ?? S.percent
      let note = e.context.percent === undefined ? 'no-percent' : ''
      // The baseline is the fill of a window THIS loop's handoff started (system prompt + handon): a limit that
      // sits at or under it counts growth from it. Any other window (a fresh session, the one the loop was armed
      // in) has none: its limit is the threshold itself, whatever the first turns already filled.
      if (e.context.percent !== undefined && S.fresh) {
        S.base = percent
        note = 'base-set'
        if (S.armed && S.fresh) {
          note = 'base-set,fresh-cleared'
          S.fresh = false
          if (limit() >= 100) {
            // ponytail: a limit no window can reach would never hand off — disarm instead.
            S.armed = false
            S.phase = 'idle'
            note = 'base-set,fresh-cleared,auto-disarmed'
            await persist($)
            $.ui.toast(`handoff: fresh window at ${percent}%, ${S.threshold} more points can't fit — auto disarmed`)
          } else if (S.threshold <= S.base) {
            $.ui.toast(`handoff: fresh window at ${percent}%, next handoff at ${limit()}%`)
          }
        }
      }
      await measured($, 'session.measure', percent, 'skip:measure-only', note)
      await sync($, percent)
    }
    return next(e)
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const r = await next(e)
    if (!r.deny) S.ring = e.element ?? null
    return r
  })

  // The person's closes (q, ✕) pass here; ours go through closePane.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const isSet = isSets(owner)
    S.paneOpen = false
    owner = undefined
    const r = await next(e)
    if (isSet) await shutSet($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    if (e.surface === 'mobile') return next(e)
    S.cols = Math.max(20, (e.props.bodyColumns ?? 100) - EDGE)
    const a = api($)
    const ui = fields($.ui.resolve(e) as Elements, a, e.surface, key => void $.ui.focus({ requestId: PANE, key }))
    const c: Ctx = { api: a, ui, surface: e.surface }
    const screen = VIEWS[S.route](c)
    // Docked, the pane is floor to ceiling: the body takes what is left, the footer sits at the bottom.
    const rows = e.props.placement === 'dock' ? e.props.scroll?.bodyRows : undefined
    return (
      <ui.Box flexDirection="column" paddingRight={EDGE} minHeight={rows}>
        <Tabs c={c} close={() => void (isSets(owner) ? shutSet($) : closePane($))} />
        <Rule c={c} />
        <ui.Box flexDirection="column" flexGrow={1} marginTop={1}>
          {screen.body}
        </ui.Box>
        <Footer c={c} note={S.note || screen.note} hints={screen.keys} />
      </ui.Box>
    )
  })
}
