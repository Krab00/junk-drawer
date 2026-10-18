import { atom, update } from 'claude-code'
import type { RenderSurface, Register } from 'claude-code'

import type { Ahandoff, Handoff } from '../types'
import { DAY, DEFAULT_PROMPT, LIMIT_GRACE, LIMIT_PROMPT, S, SCHEMA, coerce, current, idOf, isField, limit, loadOptions, status, type $, type Entry, type Field, type Route } from './lib'
import { Footer, P, Rule, TABS, Tabs, fields, type Api, type Ctx, type Elements } from './ui'
import { VIEWS } from './views'

const PANE = 'ahandoff'
const EDGE = 2 // empty columns at the pane's right edge (a docked pane's last column may not show)
const HANDOFF_FILE = /\/handoffs\/[^/]+\.md$/

function redraw($: $) {
  $.ui.invalidate('ui.render')
}

const STORE = 'ahandoff'

const view = atom({ plugin: 'handoff', key: 'ahandoff' } as const, {
  on: false, phase: 'idle', percent: 0, threshold: 85, checkEvery: 5,
  prompt: '', lastId: '', count: 0, route: 'auto', paneOpen: false,
} satisfies Ahandoff)

// ponytail: plugin commands are namespaced (`handoff:handon`) — find by suffix instead of guessing the prefix.
async function findCommand($: $, suffix: 'handoff' | 'handon'): Promise<string> {
  const names = (await $.command.list()).map(c => c.name)
  return names.find(n => n === `handoff:${suffix}`) ?? names.find(n => n.endsWith(`:${suffix}`)) ?? `handoff:${suffix}`
}

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}

async function handoffDir($: $): Promise<string> {
  return `${await homeDir($)}/.claude/handoffs`
}

async function listHandoffs($: $, force?: boolean): Promise<Entry[]> {
  if (S.entries && !force) return S.entries
  const dir = await handoffDir($)
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

// /handoff in the next turn. ponytail: detached — $.command.run is refused inside a hook the turn waits on.
function queueHandoff($: $) {
  void $.clock.sleep(0).then(async () => $.command.run({ command: await findCommand($, 'handoff') }))
}

// /clear → /handon <id> → the continuation prompt, detached like queueHandoff.
// A slash prompt cannot ride along as text (the host refuses it and the model would only read it),
// so it runs as the command itself right after /handon.
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

async function panel($: $) {
  await toggle($)
  return {}
}
async function auto($: $, prompt: string, pane = true) {
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

// Who opened the pane through `$.handoff.show({ owner })` (a frame's set of panes); any other open or close clears
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
  S.armed = true
  S.phase = 'idle'
  S.calls = 0
  S.armedAt = Date.now()
  await persist($)
  await sync($)
}

async function disarm($: $) {
  S.armed = false
  cancelResume()
  S.phase = 'idle'
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

// Writes one field to its `/config` row (`handoff.<field>`) and mirrors it into S. `{ deny }` when the value
// does not fit or a hook refused; the pane's note says which either way.
async function setOption($: $, field: Field, raw: string | number | boolean) {
  const c = coerce(field, raw)
  if (c.error !== undefined) {
    S.note = `✗ ${c.error}`
    redraw($)
    return { deny: c.error }
  }
  const value = c.value
  const { deny } = await $.config.set({ key: `handoff.${field}`, value })
  if (deny) {
    S.note = `✗ ${deny}`
    redraw($)
    return { deny }
  }
  if (field === 'threshold') S.threshold = value as number
  else if (field === 'checkEvery') S.checkEvery = Math.max(1, Math.round(value as number))
  else if (field === 'staleDays') { S.staleDays = value as number; S.entries = null; void load($) }
  else if (field === 'segment') S.segment = value as boolean
  else if (field === 'autoOn') S.autoOn = value as boolean
  else if (field === 'resumeAfterLimit') { S.resumeAfterLimit = value as boolean; if (!value) cancelResume() }
  S.note = `✓ ${field} = ${String(value)}`
  await sync($)
  return { value: current(field) } as const
}

// `$.handoff`, the noun other plugins call. The host hands a noun's method exactly one input and the hooks on
// it see that input as `e`, so set and open take one object; get, schema and status need no `$` and answer here.
// `set`'s `scope`: only `user` (the /config row) exists today; the field is there so project/session scopes can
// be added later without changing callers. The hooks on handoff.set / handoff.open below do the `$` work.
const NO_HOOK = 'handoff: the hooks module did not answer'
function handoffNoun(): Handoff {
  return {
    schema: async () => SCHEMA.map(f => ({ ...f })),
    get: async key => {
      if (!isField(key)) throw new Error(`handoff: no setting ${String(key)}`)
      return current(key)
    },
    set: async () => { throw new Error(NO_HOOK) },
    open: async () => { throw new Error(NO_HOOK) },
    show: async () => { throw new Error(NO_HOOK) },
    hide: async () => { throw new Error(NO_HOOK) },
    status: async () => status(),
  }
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

export const register: Register = (on, options) => {
  loadOptions(options)

  on('engine.create', async (_$, e, next) => ({ ...(await next(e)), handoff: handoffNoun() }))
  // A `{ deny }` here rejects the caller's promise with the reason (the host's own rule for a noun's event).
  on('handoff.set', async ($, e) => {
    if (!isField(e.key)) return { deny: `handoff: no setting ${String(e.key)}` }
    if (e.scope !== undefined && e.scope !== 'user') return { deny: `handoff: scope ${String(e.scope)} is not supported yet` }
    const r = await setOption($, e.key, e.value)
    return r.deny !== undefined ? { deny: r.deny } : { value: r.value }
  })
  on('handoff.open', async ($, e) => {
    const route = e?.route
    if (route !== undefined && !TABS.some(t => t[2] === route)) return { deny: `handoff: no tab ${String(route)}` }
    // A route while the pane is up switches its tab; otherwise the call toggles the pane, as /handoff panel does.
    if (route && S.paneOpen) {
      S.route = route
      await sync($)
      void load($)
    } else await toggle($, route)
    return { value: undefined }
  })
  // show never closes: the pane opens (or, up already, is asked again: retitled, its tab switched, the keys asked
  // for), on `route` when given. `reopen` closes a pane that is up first, so its tab goes after the caller's; `owner`
  // marks it as that caller's, for hide.
  on('handoff.show', async ($, e) => {
    const route = e?.route
    if (route !== undefined && !TABS.some(t => t[2] === route)) return { deny: `handoff: no tab ${String(route)}` }
    if (e?.reopen === true && S.paneOpen) await closePane($)
    const opened = openPane($, route, e?.focus === true)
    owner = e?.owner
    await opened
    return { value: undefined }
  })
  // hide closes the pane; with `owner`, only while the pane is still the one that owner's show opened.
  on('handoff.hide', async ($, e) => {
    if (e?.owner !== undefined && e.owner !== owner) return { value: undefined }
    await closePane($)
    return { value: undefined }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ahandoff',
      description: 'Auto handoff at a context threshold: handoff → /clear → /handon → continue. off stops, panel toggles the pane.',
      argumentHint: '[prompt] | off | panel',
    })
    const saved = (await $.store.get(STORE)) as { on?: boolean; prompt?: string | null; pending?: { id: string }; resumeAt?: number } | undefined
    if (saved?.pending) $.ui.toast(`handoff: pending handoff ${saved.pending.id} — run /handoff:handon ${saved.pending.id}`)
    if (saved?.resumeAt && saved.resumeAt > Date.now()) $.ui.toast(`handoff: a 5h-limit resume was due at ${hhmm(saved.resumeAt)} — re-arm with /ahandoff`)
    if (saved?.resumeAt) await $.store.set(STORE, { ...saved, resumeAt: undefined })
    await sync($)
    return next(e)
  })

  // /handoff panel | auto [prompt] | off — anything else is the plain /handoff.
  on('command.run', { command: 'handoff:handoff' }, async ($, e, next) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    if (sub === 'panel') return panel($)
    if (sub === 'auto') return auto($, rest.join(' '))
    if (sub === 'off') return off($)
    return next(e)
  })

  // /ahandoff [prompt] | off | panel — the short form: anything else is the prompt.
  on('command.run', { command: 'ahandoff' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'panel') return panel($)
    if (args === 'off') return off($)
    return auto($, args, false) // ponytail: the short form arms and runs the prompt; the pane is /ahandoff panel
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const isHandoffWrite = e.tool === 'Write' && HANDOFF_FILE.test(String(e.file_path))
    if (!S.armed) {
      if (!isHandoffWrite) return next(e)
      const r = await next(e)
      record(String(e.file_path))
      await sync($)
      return r
    }
    if (S.phase === 'idle' && !S.fresh && ++S.calls % S.checkEvery === 0) {
      const { context } = await $.session.usage()
      S.tokens = context.tokens ?? S.tokens
      const percent = context.percent ?? 0
      if (percent >= limit()) S.phase = 'handoff'
      await sync($, percent)
    }
    if (S.phase !== 'handoff') return next(e)
    const isHandoffPath = e.tool === 'Bash' && /handoff-path/.test(String(e.command))
    const isHandoffSkill = e.tool === 'Skill' && /handoff/.test(String((e as { skill?: unknown }).skill))
    if (isHandoffWrite) S.written = String(e.file_path)
    if (isHandoffWrite || isHandoffPath || isHandoffSkill) return next(e)
    return {
      deny: 'ahandoff: context limit reached. Stop the current work now. Call the Skill tool with skill "handoff:handoff" and follow it (run its bin/handoff-path, then Write the handoff markdown to the path it prints — include task ids, branch, worktree, round and what to do next). Then end the turn with one line. Every other tool is denied until the handoff is written.',
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (!S.armed || e.agentId) return next(e)
    // ponytail: the host names no error kind here — an error with the 5h window at 99%+ is the limit.
    if (e.reason === 'error' && S.resumeAfterLimit && S.fiveHour >= 99) {
      await scheduleResume($)
      return next(e)
    }
    const { context } = await $.session.usage()
    S.tokens = context.tokens ?? S.tokens
    const percent = context.percent ?? 0
    if (S.fresh) {
      // nothing: the first measurement of the new window decides (session.measure)
    } else if (S.phase === 'handoff' && !S.written) {
      queueHandoff($) // model never wrote it mid-turn: ask /handoff as the next turn
    } else if (S.phase === 'idle' && percent >= limit()) {
      S.phase = 'handoff'
      queueHandoff($)
    } else if (S.phase === 'handoff' && S.written) {
      const id = record(S.written)
      S.written = null
      S.calls = 0
      S.count++
      S.phase = 'resume'
      await persist($)
      continueFrom($, id)
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
      const percent = e.context.percent ?? S.percent
      if (e.context.percent !== undefined && (S.fresh || !S.base)) {
        S.base = percent
        if (S.armed && S.fresh) {
          S.fresh = false
          if (limit() >= 100) {
            // ponytail: a limit no window can reach would never hand off — disarm instead.
            S.armed = false
            S.phase = 'idle'
            await persist($)
            $.ui.toast(`handoff: fresh window at ${percent}%, ${S.threshold} more points can't fit — auto disarmed`)
          } else if (S.threshold <= S.base) {
            $.ui.toast(`handoff: fresh window at ${percent}%, next handoff at ${limit()}%`)
          }
        }
      }
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
    S.paneOpen = false
    owner = undefined
    return next(e)
  })

  // The status-line segment: 🪃 NN% (green, yellow within 10 points of the threshold, red past it).
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (!S.segment) return next(e)
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
        <Tabs c={c} close={() => void closePane($)} />
        <Rule c={c} />
        <ui.Box flexDirection="column" flexGrow={1} marginTop={1}>
          {screen.body}
        </ui.Box>
        <Footer c={c} note={S.note || screen.note} hints={screen.keys} />
      </ui.Box>
    )
  })
}
