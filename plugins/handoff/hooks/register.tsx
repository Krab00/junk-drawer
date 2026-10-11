import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Ahandoff } from '../types'

const PANE = 'ahandoff'
const STORE = 'ahandoff'
const HANDOFF_ID = /_([0-9a-f]{8})\.md$/

const view = atom({ plugin: 'handoff', key: 'ahandoff' } as const, {
  on: false, phase: 'idle', percent: 0, threshold: 85, checkEvery: 5,
  prompt: '', lastId: '', count: 0,
} satisfies Ahandoff)

// ponytail: runtime state in a module object — it survives /clear (no reload); $.state is only the pane's mirror.
const S = {
  armed: false, phase: 'idle' as Ahandoff['phase'], threshold: 85, checkEvery: 5,
  prompt: '', lastPrompt: '', written: '', calls: 0, count: 0, lastId: '',
}

function sync($: EngineInterface, percent?: number) {
  return update($, view, v => ({
    ...v, on: S.armed, phase: S.phase, prompt: S.prompt, lastId: S.lastId, count: S.count,
    threshold: S.threshold, checkEvery: S.checkEvery, percent: percent ?? v.percent,
  }))
}
function status($: EngineInterface, percent: number) {
  $.ui.status(S.armed ? `ahandoff ${percent}%/${S.threshold}%${S.phase === 'idle' ? '' : ` · ${S.phase}`}` : undefined)
}
function persist($: EngineInterface) {
  return $.store.set(STORE, { on: S.armed, prompt: S.prompt, pending: S.phase === 'resume' ? { id: S.lastId, prompt: S.prompt } : undefined })
}

export const register: Register = (on, options) => {
  S.threshold = Number(options.threshold ?? 85)
  S.checkEvery = Math.max(1, Number(options.checkEvery ?? 5))
  S.armed = Boolean(options.autoOn)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ahandoff',
      description: 'Auto handoff at a context threshold: handoff → /clear → /handon → continue. off stops, panel opens the pane.',
      argumentHint: '[prompt] | off | panel',
    })
    const saved = (await $.store.get(STORE)) as { on?: boolean; prompt?: string; pending?: { id: string; prompt: string } } | undefined
    if (saved?.pending) $.ui.toast(`ahandoff: pending handoff ${saved.pending.id} — run /handon ${saved.pending.id}`)
    if (saved?.on && S.armed) S.prompt = saved.prompt ?? ''
    await sync($)
    return next(e)
  })

  on('command.run', { command: 'ahandoff' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'off') {
      S.armed = false; S.phase = 'idle'
      await persist($); await sync($); $.ui.status(undefined)
      return { text: 'ahandoff off.' }
    }
    if (args !== 'panel') {
      S.armed = true; S.phase = 'idle'
      S.prompt = args || S.lastPrompt
      await persist($)
    }
    await sync($)
    const opened = await $.ui.open({ id: PANE, title: 'ahandoff' })
    if (!opened.isPlaced) $.ui.toast('ahandoff: widen the terminal to see the pane')
    return args === 'panel'
      ? { text: 'ahandoff pane opened.' }
      : { text: `ahandoff on — threshold ${S.threshold}%, continue with: ${S.prompt || '(last prompt)'}` }
  })

  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind !== 'plugin' && !e.text.startsWith('/ahandoff')) S.lastPrompt = e.text
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (!S.armed || e.agentId) return next(e)
    if (S.phase === 'idle' && ++S.calls % S.checkEvery === 0) {
      const { context } = await $.session.usage()
      const percent = context.percent ?? 0
      status($, percent)
      if (percent >= S.threshold) { S.phase = 'handoff'; await sync($, percent) }
    }
    if (S.phase !== 'handoff') return next(e)
    const isHandoffWrite = e.tool === 'Write' && /\/handoffs\/[^/]+\.md$/.test(String(e.file_path))
    const isHandoffPath = e.tool === 'Bash' && /handoff-path/.test(String(e.command))
    if (isHandoffWrite) S.written = String(e.file_path)
    if (isHandoffWrite || isHandoffPath) return next(e)
    return {
      deny: 'ahandoff: context limit reached. Stop the current work now. Run the /handoff skill: `${CLAUDE_PLUGIN_ROOT}/bin/handoff-path` (plugin handoff) then Write the handoff markdown to that path — include task ids, branch, worktree, round and what to do next. Then end the turn with one line. Every other tool is denied until then.',
    }
  })

  on('turn.complete', async ($, e, next) => {
    if (!S.armed || e.agentId) return next(e)
    const { context } = await $.session.usage()
    const percent = context.percent ?? 0
    if (S.phase === 'handoff' && !S.written) {
      // model never wrote it mid-turn: ask /handoff as the next turn
      void $.clock.sleep(0).then(() => $.command.run({ command: 'handoff' }))
    } else if (S.phase === 'idle' && percent >= S.threshold) {
      S.phase = 'handoff'
      void $.clock.sleep(0).then(() => $.command.run({ command: 'handoff' }))
    } else if (S.phase === 'handoff' && S.written) {
      S.lastId = HANDOFF_ID.exec(S.written)?.[1] ?? ''
      S.written = ''; S.calls = 0; S.count++
      S.phase = 'resume'
      await persist($)
      const id = S.lastId
      const text = `Kontynuuj pracę wg handoffu ${id}, bez pytań: ${S.prompt || S.lastPrompt}`
      // ponytail: detached chain — $.command.run is refused inside a hook the turn waits on.
      void $.clock.sleep(0).then(async () => {
        await $.command.run({ command: 'clear' })
        await $.command.run({ command: 'handon', args: id })
        S.phase = 'idle'
        await $.store.set(STORE, { on: S.armed, prompt: S.prompt })
        await sync($, 0)
        await $.prompt.submit({ text })
      })
    }
    status($, percent)
    await sync($, percent)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (S.armed && e.changed.includes('context')) {
      const percent = e.context.percent ?? 0
      status($, percent)
      await sync($, percent)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const Input = 'Input' in els ? els.Input : null // the mobile table draws no field
    const v = await read($, view)
    const width = Math.max(10, Math.min(30, (e.props.bodyColumns ?? 40) - 12))
    const filled = Math.round((Math.min(100, v.percent) / 100) * width)
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
    const setNumber = (key: 'handoff.threshold' | 'handoff.checkEvery') => async (value: string) => {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) return $.ui.toast(`ahandoff: ${value} is not a number`)
      const { deny } = await $.config.set({ key, value: n })
      if (deny) $.ui.toast(`ahandoff: ${deny}`)
    }
    return (
      <Box flexDirection="column">
        <Text>{v.on ? 'ON' : 'off'} · {v.phase}</Text>
        <Text color={v.percent >= v.threshold ? 'red' : 'green'}>{bar} {v.percent}% / {v.threshold}%</Text>
        <Text dimColor>handoffs: {v.count}{v.lastId ? ` · last ${v.lastId}` : ''}</Text>
        <Text>continue: <Text dimColor>{v.prompt || '(last prompt)'}</Text></Text>
        {Input && <Input key="threshold" label="threshold %" value={String(v.threshold)} onSubmit={setNumber('handoff.threshold')} />}
        {Input && <Input key="checkEvery" label="check every N calls" value={String(v.checkEvery)} onSubmit={setNumber('handoff.checkEvery')} />}
        <Text dimColor>/ahandoff [prompt] | off | panel</Text>
      </Box>
    )
  })
}
