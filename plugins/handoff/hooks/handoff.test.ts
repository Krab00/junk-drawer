// The /handoff mod: the auto loop (deny gate, clear → handon → continue chain), the
// `panel | auto | off` arguments, the 🪃 prompt-line segment and the pane's three tabs.
// Everything beneath the plugin is answered from memory by `world`; nothing touches a real home.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/u'
const DIR = `${HOME}/.claude/handoffs`
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]
const OPTIONS = { options: { threshold: 80, checkEvery: 1 } }

const PANE = {
  component: 'Pane',
  requestId: 'ahandoff',
  props: { title: 'handoff', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '' } } as const

const FILES: Record<string, { mtimeMs: number; text: string }> = {
  '2026-01-01T00-00_aaaaaaaa.md': { mtimeMs: Date.UTC(2026, 0, 1), text: '# Title A\n\nbody a\n' },
  '2026-02-02T00-00_bbbbbbbb.md': { mtimeMs: Date.UTC(2026, 1, 2), text: '# Title B\n\nbody b\n' },
}

const usage = (percent: number) => ({
  startedAt: 0, context: { window: 200000, tokens: percent * 2000, percent }, rateLimits: [],
})

function world(on: On) {
  mock.store(on)
  mock.env(on, { HOME })
  const rec = {
    percent: 10,
    commands: [] as string[],
    prompts: [] as string[],
    opened: [] as string[],
    closed: [] as string[],
    config: [] as { key: string; value: unknown }[],
    runs: [] as string[],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(rec.percent) }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('command.list', () => ({
    value: [
      { name: 'handoff:handoff', description: '', source: 'plugin' },
      { name: 'handoff:handon', description: '', source: 'plugin' },
      { name: 'clear', description: '', source: 'builtin' },
    ],
  }))
  on('command.run', (_$, e) => {
    rec.commands.push(`${e.command} ${e.args ?? ''}`.trim())
    return { text: `downstream ${e.command}` }
  })
  on('prompt.submit', (_$, e) => { rec.prompts.push(e.text); return { text: e.text } })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.open', (_$, e) => { rec.opened.push(e.id); return { value: { isPlaced: true as const } } })
  on('ui.close', (_$, e) => { rec.closed.push(e.id); return { value: undefined } })
  on('ui.focus', () => ({}))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true as const } }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('process.run', (_$, e) => {
    rec.runs.push(e.argv.join(' '))
    const stdout = e.argv.join(' ').includes('$HOME') ? `${HOME}\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.list', (_$, e) => ({
    value: e.path.replace(/\/$/, '') === DIR
      ? Object.entries(FILES).map(([name, f]) => ({ name, kind: 'file' as const, size: f.text.length, mtimeMs: f.mtimeMs, isLink: false }))
      : [],
  }))
  on('fs.read', (_$, e) => {
    const f = FILES[e.path.replace(/^.*\//, '')]
    if (!f) throw new Error('ENOENT')
    return { value: f.text }
  })
  // The engine's own drawing where the mod passes.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  return rec
}

const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const handoff = ($: Engine, args: string) =>
  $.command.run({ command: 'handoff:handoff', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

// What a denied call carries: `deny` for a plugin's call, the errored `text` for the engine's.
const denial = (r: unknown) => {
  const o = r as { deny?: string; isError?: boolean; text?: string }
  return o.deny ?? (o.isError ? o.text : undefined)
}

// Presses the Button bound to a hotkey (a tab digit, a letter), as the person typing it does.
async function hotkey(ui: Mounted<Surface, 'Pane'>, key: string) {
  const b = (await ui.findAll({ type: 'Button' })).find(x => x.props.hotkey === key)
  expect(b?.key, `a Button with hotkey ${key}`).toBeDefined()
  await ui.press({ key: b!.key! })
}

const texts = async (ui: Mounted<Surface, 'Pane'>) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

test('auto arms, denies tools past the threshold, lets the handoff through', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto do X')
  await clock.advance(1)
  expect(rec.prompts.at(-1)).toBe('do X')

  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()

  rec.percent = 90
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
  expect(denial(await $.tool.call({ tool: 'Bash', command: '/x/skills/handoff/bin/handoff-path' }))).toBeUndefined()
  expect(denial(await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' }))).toBeUndefined()
})

test('off disarms: tools pass again past the threshold', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto do X')
  await clock.advance(1)
  rec.percent = 90
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
  await handoff($, 'off')
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
})

test('/ahandoff <prompt> | off is the short form', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  const run = (args: string) =>
    $.command.run({ command: 'ahandoff', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await run('/orch:orch all')
  await clock.advance(1)
  expect(rec.commands.at(-1)).toBe('orch:orch all') // a slash prompt runs as the command
  await run('fix the flaky test')
  await clock.advance(1)
  expect(rec.prompts.at(-1)).toBe('fix the flaky test')
  rec.percent = 90
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
  await run('off')
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
})

test('the written handoff ends the turn into clear → handon <id> → continue', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto do X')
  rec.percent = 90

  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await $.turn.complete({ answer: 'saved', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1)

  const clear = rec.commands.indexOf('clear')
  expect(clear).toBeGreaterThanOrEqual(0)
  expect(rec.commands.indexOf('handoff:handon abcdef12')).toBeGreaterThan(clear)
  expect(rec.prompts.at(-1)).toBe('Continue after the handoff') // the task text is not the continuation
})

test('a fresh window over the threshold keeps the loop armed with a raised limit', { options: { threshold: 10, checkEvery: 1 } }, async ($, on) => {
  const rec = world(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto do X')
  await clock.advance(1)
  rec.percent = 12

  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await $.turn.complete({ answer: 'saved', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1)
  expect(rec.commands.includes('handoff:handon abcdef12')).toBe(true)

  // the new window starts at 13% (system prompt + handon), over the 10% threshold
  rec.percent = 13
  await $.session.measure({ context: usage(13).context, rateLimits: [], changed: ['context'] })
  rec.percent = 15
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
  rec.percent = 23 // 10 points above the 13% baseline
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
})

test('a slash task runs now; after clear → handon the default continuation is sent', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto /orch:orch all')
  await clock.advance(1)
  rec.percent = 90
  const before = rec.commands.length

  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await $.turn.complete({ answer: 'saved', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const prompts = rec.prompts.length
  await clock.advance(1)

  const chain = rec.commands.slice(before)
  const handon = chain.indexOf('handoff:handon abcdef12')
  expect(handon).toBeGreaterThan(chain.indexOf('clear'))
  expect(chain.includes('orch:orch all')).toBe(false) // the task ran once, at arm time
  expect(rec.prompts.length).toBe(prompts + 1)
  expect(rec.prompts.at(-1)).toBe('Continue after the handoff')
})

test('panel toggles the pane; no argument goes on to /handoff', async ($, on) => {
  const rec = world(on)
  await start($)

  await handoff($, 'panel')
  expect(rec.opened).toEqual(['ahandoff'])
  await handoff($, 'panel')
  expect(rec.closed).toEqual(['ahandoff'])

  const run = await handoff($, '')
  expect(rec.commands).toEqual(['handoff:handoff'])
  expect((run as { text?: string }).text).toBe('downstream handoff:handoff')
})

test('the 🪃 segment shows usage or off, and a press opens the pane', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'handoff', surface, ...HINT })
    expect(await ui.find({ type: 'Button', text: '🪃 off' })).toBeDefined()
    await ui.unmount()
  }

  await handoff($, 'auto do X')
  await clock.advance(1)
  await handoff($, 'panel') // auto opened it; close it so the press below opens it again
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'handoff', surface, ...HINT })
    const seg = await ui.find({ type: 'Button', text: /🪃 \d+%/ })
    expect(seg?.key).toBeDefined()
    const opened = rec.opened.length
    const closed = rec.closed.length
    await ui.press({ key: seg!.key! })
    expect(rec.opened.length + rec.closed.length).toBe(opened + closed + 1)
    await ui.unmount()
  }
  expect(rec.opened.at(-1) ?? rec.closed.at(-1)).toBe('ahandoff')
  expect(rec.opened.length).toBeGreaterThanOrEqual(2) // auto, then the first press
})

test('Handoffs tab lists the folder newest first; enter resumes one by id', async ($, on) => {
  const rec = world(on)
  await start($)
  await handoff($, 'panel')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'handoff', surface, ...PANE })
    await hotkey(ui, '2')
    const t = await texts(ui)
    expect(t).toContain('Title A')
    expect(t).toContain('Title B')
    expect(t.indexOf('Title B')).toBeLessThan(t.indexOf('Title A'))

    // Rows are `row-<id>` Buttons; the selected one carries the `handon` action (Enter).
    expect(await ui.find({ key: 'row-aaaaaaaa' })).toBeDefined()
    expect(await ui.find({ key: 'row-bbbbbbbb' })).toBeDefined()
    const before = rec.commands.length
    await ui.press({ key: 'handon' })
    const ran = rec.commands.slice(before)
    expect(ran.some(c => /^handoff:handon (aaaaaaaa|bbbbbbbb)$/.test(c)), ran.join(' | ')).toBe(true)
    await ui.unmount()
  }
})

test('Settings tab: threshold field writes handoff.threshold', async ($, on) => {
  const rec = world(on)
  await start($)
  await handoff($, 'panel')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'handoff', surface, ...PANE })
    await hotkey(ui, '3')
    const field = (await ui.findAll({ type: 'Input' })).find(i => /^threshold/.test(i.key ?? ''))
    expect(field?.key, 'the threshold Input').toBeDefined()
    await ui.input({ key: field!.key!, text: '90' })
    expect(rec.config.at(-1)).toEqual({ key: 'handoff.threshold', value: 90 })
    await ui.unmount()
  }
})
