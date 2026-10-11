import { atom, update } from 'claude-code'
import type { RenderSurface, Register } from 'claude-code'

import type { Ahandoff } from '../types'
import { DAY, S, idOf, loadOptions, type $, type Entry, type Route } from './lib'
import { Footer, P, Rule, Tabs, fields, type Api, type Ctx, type Elements } from './ui'
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
    ...v, on: S.armed, phase: S.phase, prompt: S.prompt ?? '', lastId: S.lastId ?? '', count: S.count,
    threshold: S.threshold, checkEvery: S.checkEvery, percent: S.percent, route: S.route, paneOpen: S.paneOpen,
  }))
}

function persist($: $) {
  return $.store.set(STORE, {
    on: S.armed, prompt: S.prompt,
    pending: S.phase === 'resume' && S.lastId ? { id: S.lastId, prompt: S.prompt } : undefined,
  })
}

// The continuation sent after a handoff is restored.
const continuation = (id: string) => {
  const p = S.prompt
  return `Continue the work from handoff ${id} without asking${p ? `: ${p}` : '.'}`
}

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
function continueFrom($: $, id: string) {
  const text = continuation(id)
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
    await $.prompt.submit({ text })
  })
}

async function panel($: $) {
  await toggle($)
  return {}
}
async function auto($: $, prompt: string) {
  // the pane opens first: only an open made while the command runs is placed at any width
  const opened = openPane($, 'auto')
  await arm($, prompt || null)
  await opened
  return { text: `handoff auto on — threshold ${S.threshold}%, continue with: ${S.prompt || '(continue the handoff)'}` }
}
async function off($: $) {
  await disarm($)
  return { text: 'handoff auto off.' }
}

// `$.ui.open` before any await: only an open made while the press or command runs counts as asked.
async function openPane($: $, route?: Route) {
  const opened = $.ui.open({ id: PANE, title: 'handoff', focus: true })
  if (route) S.route = route
  S.paneOpen = (await opened).isPlaced
  await sync($)
  void load($)
}

// The engine does not raise our own `$.ui.close` to our `ui.close` hook, so we clear the flag here.
async function closePane($: $) {
  S.paneOpen = false
  await $.ui.close({ id: PANE })
  await sync($)
}

function toggle($: $, route?: Route) {
  return S.paneOpen ? closePane($) : openPane($, route)
}

async function arm($: $, prompt?: string | null) {
  S.armed = true
  S.phase = 'idle'
  S.calls = 0
  S.armedAt = Date.now()
  if (prompt) S.prompt = prompt
  await persist($)
  await sync($)
}

async function disarm($: $) {
  S.armed = false
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

async function setOption($: $, field: Parameters<Api['set']>[0], raw: string | number | boolean) {
  let value: string | number | boolean = raw
  if (field === 'threshold' || field === 'checkEvery' || field === 'staleDays') {
    value = Number(raw)
    if (!Number.isFinite(value) || value <= 0 || (field === 'threshold' && value > 100)) {
      S.note = `✗ ${String(raw)} is not a valid ${field}`
      return redraw($)
    }
  } else if (field === 'autoOn' || field === 'segment') value = raw === true || raw === 'true' || raw === 'on'
  else return redraw($)
  const { deny } = await $.config.set({ key: `handoff.${field}`, value })
  if (deny) {
    S.note = `✗ ${deny}`
    return redraw($)
  }
  if (field === 'threshold') S.threshold = value as number
  else if (field === 'checkEvery') S.checkEvery = Math.max(1, Math.round(value as number))
  else if (field === 'staleDays') { S.staleDays = value as number; S.entries = null; void load($) }
  else if (field === 'segment') S.segment = value as boolean
  else if (field === 'autoOn') S.autoOn = value as boolean
  S.note = `✓ ${field} = ${String(value)}`
  await sync($)
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
    arm: prompt => arm($, prompt),
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
    set: (field, value) => setOption($, field, value),
    refresh: () => {
      redraw($)
      void load($)
    },
  }
}

export const register: Register = (on, options) => {
  loadOptions(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ahandoff',
      description: 'Auto handoff at a context threshold: handoff → /clear → /handon → continue. off stops, panel toggles the pane.',
      argumentHint: '[prompt] | off | panel',
    })
    const saved = (await $.store.get(STORE)) as { on?: boolean; prompt?: string | null; pending?: { id: string } } | undefined
    if (saved?.pending) $.ui.toast(`handoff: pending handoff ${saved.pending.id} — run /handoff:handon ${saved.pending.id}`)
    if (saved?.prompt && S.armed) S.prompt = saved.prompt
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
    return auto($, args)
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
      if (percent >= S.threshold) S.phase = 'handoff'
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
    const { context } = await $.session.usage()
    S.tokens = context.tokens ?? S.tokens
    const percent = context.percent ?? 0
    if (S.fresh) {
      // nothing: the first measurement of the new window decides (session.measure)
    } else if (S.phase === 'handoff' && !S.written) {
      queueHandoff($) // model never wrote it mid-turn: ask /handoff as the next turn
    } else if (S.phase === 'idle' && percent >= S.threshold) {
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
    if (e.changed.includes('context')) {
      S.tokens = e.context.tokens ?? S.tokens
      const percent = e.context.percent ?? S.percent
      if (S.armed && S.fresh && e.context.percent !== undefined) {
        S.fresh = false
        if (percent >= S.threshold) {
          // ponytail: a fresh window already over the limit would loop forever — disarm instead.
          S.armed = false
          S.phase = 'idle'
          await persist($)
          $.ui.toast(`handoff: fresh session already at ${percent}% ≥ ${S.threshold}% — auto disarmed`)
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
    return next(e)
  })

  // The status-line segment: 🪃 NN% (green, yellow within 10 points of the threshold, red past it).
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    if (!S.segment) return next(e)
    const { Button, Text } = $.ui.resolve(e)
    const label = !S.armed
      ? '🪃 off'
      : S.phase === 'handoff' ? '🪃 handoff…' : S.phase === 'idle' ? `🪃 ${S.percent}%` : '🪃 resume…'
    const color = !S.armed || S.phase !== 'idle'
      ? P.secondary
      : S.percent >= S.threshold ? P.bad : S.percent >= S.threshold - 10 ? P.warn : P.ok
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
