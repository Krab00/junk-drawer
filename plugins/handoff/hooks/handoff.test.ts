// The /handoff mod: the auto loop (deny gate, clear → handon → continue chain), the
// `panel | auto | off` arguments, the 🪃 prompt-line segment and the pane's three tabs.
// Everything beneath the plugin is answered from memory by `world`; nothing touches a real home.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted, Plugin } from 'claude-code/testing'
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
    focus: [] as (true | undefined)[], // each open's `focus`, beside `opened`
    closed: [] as string[],
    config: [] as { key: string; value: unknown }[],
    runs: [] as string[],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: usage(rec.percent) }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
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
  on('ui.open', (_$, e) => { rec.opened.push(e.id); rec.focus.push(e.focus); return { value: { isPlaced: true as const } } })
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

// A frame plugin beside handoff, as T5 will be: `/frame <method> [json]` calls `$.handoff.<method>` and answers
// what came back (an inline plugin closes over nothing, so the command carries the result out as text).
const FRAME: Plugin = {
  name: 'frame',
  register(on) {
    on('command.run', { command: 'frame' }, async ($, e) => {
      const [method = '', ...rest] = e.args.trim().split(/\s+/)
      const input = rest.length ? JSON.parse(rest.join(' ')) : undefined
      try {
        // The host lets a noun's method be called, never read, so "exists" means "answers a call".
        if (method === 'members') {
          const answered: string[] = []
          if (Array.isArray(await $.handoff.schema())) answered.push('schema')
          if (typeof (await $.handoff.get('threshold')) === 'number') answered.push('get')
          if (typeof (await $.handoff.set({ key: 'threshold', value: await $.handoff.get('threshold') })) === 'number') answered.push('set')
          await $.handoff.open()
          await $.handoff.open()
          answered.push('open')
          await $.handoff.show()
          answered.push('show')
          await $.handoff.hide()
          answered.push('hide')
          if (typeof (await $.handoff.status()).armed === 'boolean') answered.push('status')
          return { text: JSON.stringify({ ok: answered }) }
        }
        if (method === 'schema') return { text: JSON.stringify({ ok: await $.handoff.schema() }) }
        if (method === 'status') return { text: JSON.stringify({ ok: await $.handoff.status() }) }
        if (method === 'get') return { text: JSON.stringify({ ok: await $.handoff.get(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.handoff.set(input) }) }
        if (method === 'open') return { text: JSON.stringify({ ok: await $.handoff.open(input) }) }
        if (method === 'show') return { text: JSON.stringify({ ok: await $.handoff.show(input) }) }
        if (method === 'hide') return { text: JSON.stringify({ ok: await $.handoff.hide(input) }) }
        // The /config menu's write, as another plugin makes it: it reaches handoff's config.set hooks.
        if (method === 'config') return { text: JSON.stringify({ ok: await $.config.set(input) }) }
        return { text: JSON.stringify({ error: `no method ${method}` }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
  },
}
const WITH_FRAME = { plugins: [FRAME] }
// `frame <method> [input]` through the engine; resolves to the method's answer, rejects with its refusal.
async function frame($: Engine, method: string, input?: unknown): Promise<unknown> {
  const args = input === undefined ? method : `${method} ${JSON.stringify(input)}`
  const r = (await $.command.run({ command: 'frame', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })) as { text?: string }
  const out = JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}

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

test('a turn that dies on the 5h limit resumes 2 min after the reset; the setting turns it off', OPTIONS, async ($, on) => {
  const rec = world(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto')
  const hour = 3_600_000
  const fiveHour = { kind: 'five_hour', percentUsed: 100, resetsAt: new Date(hour).toISOString() }
  await $.session.measure({ context: usage(10).context, rateLimits: [fiveHour], changed: ['rateLimits'] })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'error' })

  const surface = 'terminal' as Surface
  const hint = await $.ui.mount({ plugin: 'handoff', surface, ...HINT })
  expect((await hint.findAll({ type: 'Text' })).map(t => t.text).join('')).toMatch(/limit → \d\d:\d\d/)

  await clock.advance(hour + 60_000)
  expect(rec.prompts).toEqual([]) // not yet: 2 min grace
  await clock.advance(60_000)
  expect(rec.prompts).toEqual(['Continue where the rate limit stopped you'])

  // off in Settings: the next limit death schedules nothing
  await handoff($, 'panel')
  const ui = await $.ui.mount({ plugin: 'handoff', surface, ...PANE })
  await hotkey(ui, '3')
  await hotkey(ui, 'l')
  expect(rec.config).toContainEqual({ key: 'handoff.resumeAfterLimit', value: false })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'error' })
  await clock.advance(hour * 2)
  expect(rec.prompts.length).toBe(1)
})

// The manifest's userConfig keys. A test cannot import plugin.json (only code files load), so the keys stand
// here and the defaults come from the engine: with no test options, get() answers the manifest's defaults.
// tests/smoke.sh checks each entry's type, title and default against the manifest itself.
const MANIFEST_KEYS = ['enabled', 'threshold', 'checkEvery', 'autoOn', 'resumeAfterLimit', 'staleDays', 'segment']

test('$.handoff: the seven calls exist; schema mirrors the manifest with main on the five frame fields, enabled first', WITH_FRAME, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'members')).toEqual(['schema', 'get', 'set', 'open', 'show', 'hide', 'status'])

  const schema = (await frame($, 'schema')) as { key: string; type: string; title: string; default: unknown; main: boolean }[]
  expect(schema.map(f => f.key).sort()).toEqual([...MANIFEST_KEYS].sort())
  for (const f of schema) {
    expect(typeof f.default, f.key).toBe(f.type)
    expect(f.title, f.key).toMatch(/\S/)
    expect(await frame($, 'get', f.key), `get(${f.key}) is the manifest default`).toBe(f.default)
  }
  expect(schema.filter(f => f.main).map(f => f.key)).toEqual(['enabled', 'threshold', 'autoOn', 'resumeAfterLimit', 'segment'])
  expect(schema[0]).toEqual({ key: 'enabled', type: 'boolean', title: 'Auto handoff: enabled', default: true, main: true })
})

test('$.handoff.set writes handoff.<key> through $.config and get reads it back; a bad value or scope is refused', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'handoff.checkEvery' }, () => ({ deny: 'locked' })) // one row a hook refuses
  const rec = world(on)
  await start($)
  expect(await frame($, 'set', { key: 'threshold', value: 70 })).toBe(70)
  expect(rec.config).toEqual([{ key: 'handoff.threshold', value: 70 }])
  expect(await frame($, 'get', 'threshold')).toBe(70)

  expect(await frame($, 'set', { key: 'segment', value: 'off', scope: 'user' })).toBe(false)
  expect(rec.config.at(-1)).toEqual({ key: 'handoff.segment', value: false })
  expect(await frame($, 'get', 'segment')).toBe(false)

  // exact bounds: 100 and 1 are in, -5 (and 0, 101 below) are out; 'on' is a true
  expect(await frame($, 'set', { key: 'threshold', value: 100 })).toBe(100)
  expect(await frame($, 'set', { key: 'staleDays', value: 1 })).toBe(1) // checkEvery is the row the deny hook below locks
  expect(await frame($, 'set', { key: 'autoOn', value: 'on' })).toBe(true)
  expect(rec.config.slice(-3)).toEqual([
    { key: 'handoff.threshold', value: 100 }, { key: 'handoff.staleDays', value: 1 }, { key: 'handoff.autoOn', value: true },
  ])
  await expect(frame($, 'set', { key: 'threshold', value: -5 })).rejects.toThrow(/not a valid threshold/)
  expect(await frame($, 'get', 'threshold')).toBe(100)
  expect(await frame($, 'set', { key: 'threshold', value: 70 })).toBe(70)

  const writes = rec.config.length
  await expect(frame($, 'set', { key: 'threshold', value: 'abc' })).rejects.toThrow(/not a valid threshold/)
  await expect(frame($, 'set', { key: 'threshold', value: 101 })).rejects.toThrow(/not a valid threshold/)
  await expect(frame($, 'set', { key: 'checkEvery', value: 0 })).rejects.toThrow(/not a valid checkEvery/)
  await expect(frame($, 'set', { key: 'threshold', value: 70, scope: 'project' })).rejects.toThrow(/scope project/)
  await expect(frame($, 'set', { key: 'nope', value: 1 })).rejects.toThrow(/no setting nope/)
  await expect(frame($, 'get', 'nope')).rejects.toThrow(/no setting nope/)
  expect(rec.config.length).toBe(writes) // none of the refusals reached $.config
  expect(await frame($, 'get', 'threshold')).toBe(70)

  // a config.set hook's deny comes back as the refusal and the value stays
  await expect(frame($, 'set', { key: 'checkEvery', value: 9 })).rejects.toThrow(/locked/)
  expect(await frame($, 'get', 'checkEvery')).toBe(5)
})

test('$.handoff.set: checkEvery is a whole number 1 or more, threshold above 0 up to 100, staleDays above 0; what is stored is what get answers', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  const refused = async (key: string, value: unknown, holds: unknown) => {
    const writes = rec.config.length
    await expect(frame($, 'set', { key, value }), `${key} ${String(value)}`).rejects.toThrow(new RegExp(`not a valid ${key}`))
    expect(rec.config.length, `${key} ${String(value)} reached the row`).toBe(writes)
    expect(await frame($, 'get', key), `${key} after ${String(value)}`).toBe(holds)
  }
  const taken = async (key: string, value: unknown, want: number) => {
    expect(await frame($, 'set', { key, value }), `${key} ${String(value)}`).toBe(want)
    expect(rec.config.at(-1), `${key} ${String(value)}`).toEqual({ key: `handoff.${key}`, value: want })
    expect(await frame($, 'get', key), `${key} ${String(value)}`).toBe(want)
  }
  // checkEvery: 2.6 is refused, not stored as 2.6 and answered as 3; 1 is the floor, 0 and 0.5 are out
  await refused('checkEvery', 2.6, 5)
  await refused('checkEvery', '2.6', 5)
  await taken('checkEvery', 1, 1)
  await refused('checkEvery', 0, 1)
  await refused('checkEvery', 0.5, 1)
  await refused('checkEvery', -1, 1)
  await taken('checkEvery', 3, 3)
  await taken('checkEvery', '7', 7)
  // threshold: 0 out, 1 in, 100 in, 101 out; a fraction is kept as given (no rounding anywhere)
  await refused('threshold', 0, 85)
  await taken('threshold', 1, 1)
  await taken('threshold', 100, 100)
  await refused('threshold', 101, 100)
  await refused('threshold', 100.5, 100)
  await taken('threshold', 85.5, 85.5)
  // staleDays: 0 and below out; a fraction kept as given
  await refused('staleDays', 0, 30)
  await refused('staleDays', -3, 30)
  await refused('staleDays', 'Infinity', 30) // above 0 but no number of days
  await taken('staleDays', 0.5, 0.5)
})

test('options the engine hands at load that set would refuse fall back to the defaults', { ...WITH_FRAME, options: { checkEvery: 2.6, threshold: 101, staleDays: 0 } }, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'get', 'checkEvery')).toBe(5)
  expect(await frame($, 'get', 'threshold')).toBe(85)
  expect(await frame($, 'get', 'staleDays')).toBe(30)
})

test('options at load on the bounds are taken as given', { ...WITH_FRAME, options: { checkEvery: 1, threshold: 100, staleDays: 0.5 } }, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'get', 'checkEvery')).toBe(1)
  expect(await frame($, 'get', 'threshold')).toBe(100)
  expect(await frame($, 'get', 'staleDays')).toBe(0.5)
})

test('$.handoff.open toggles the pane; a route opens it on that tab or switches the tab while it is up', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'open')
  expect(rec.opened).toEqual(['ahandoff'])
  await frame($, 'open')
  expect(rec.closed).toEqual(['ahandoff'])

  await frame($, 'open', { route: 'handoffs' })
  expect(rec.opened).toEqual(['ahandoff', 'ahandoff'])
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'row-aaaaaaaa' }), 'the Handoffs tab is up').toBeDefined()
  await ui.unmount()

  await expect(frame($, 'open', { route: 'bogus' })).rejects.toThrow(/no tab bogus/) // unknown route: refused, pane untouched
  await frame($, 'open', { route: 'settings' }) // up already: switch, do not close
  expect(rec.closed).toEqual(['ahandoff'])
  const settings = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...PANE })
  expect((await settings.findAll({ type: 'Input' })).some(i => /^threshold/.test(i.key ?? '')), 'the Settings tab is up').toBe(true)
  await settings.unmount()
})

// A close of the pane from outside the module, as the person's mark or ctrl+x x is to it: `/shut` closes it through
// another plugin's `$.ui.close`, which reaches the pane's own ui.close hook.
const SHUTTER: Plugin = {
  name: 'shutter',
  register(on) {
    on('command.run', { command: 'shut' }, async $ => { await $.ui.close({ id: 'ahandoff' }); return {} })
  },
}
const shut = ($: Engine) => $.command.run({ command: 'shut', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

test('$.handoff.show opens and never closes; focus and route as asked', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'show', { owner: 'junkd' })
  expect(rec.opened).toEqual(['ahandoff'])
  expect(rec.focus).toEqual([undefined]) // no focus asked: the caller keeps the keys
  await frame($, 'show', { owner: 'junkd' }) // up already: asked again, never closed
  expect(rec.opened).toEqual(['ahandoff', 'ahandoff'])
  expect(rec.closed).toEqual([])

  await frame($, 'hide')
  expect(rec.closed).toEqual(['ahandoff'])
  await frame($, 'show')
  expect(rec.opened).toHaveLength(3)

  await frame($, 'show', { route: 'settings', focus: true })
  expect(rec.focus.at(-1)).toBe(true)
  expect(rec.closed).toHaveLength(1) // up already: switched to Settings, not closed
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...PANE })
  expect((await ui.findAll({ type: 'Input' })).some(i => /^threshold/.test(i.key ?? '')), 'the Settings tab is up').toBe(true)
  await ui.unmount()
  await expect(frame($, 'show', { route: 'bogus' })).rejects.toThrow(/no tab bogus/)
  expect(rec.opened).toHaveLength(4) // the refused route opened nothing
})

test('$.handoff.hide with an owner closes only the pane that owner showed, while nothing reopened or closed it since', { plugins: [FRAME, SHUTTER] }, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'show', { owner: 'junkd' })
  await frame($, 'hide', { owner: 'other' }) // another owner: left up
  expect(rec.closed).toEqual([])
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toEqual(['ahandoff'])

  // Closed by its own command: no longer the owner's, so hide leaves it alone; opened on its own: not the owner's.
  await frame($, 'show', { owner: 'junkd' })
  await handoff($, 'panel')
  expect(rec.closed).toHaveLength(2)
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(2)
  await handoff($, 'panel')
  expect(rec.focus.at(-1)).toBe(true) // its own command still asks for the keys
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(2)
  await frame($, 'hide') // no owner: closes whatever is up
  expect(rec.closed).toHaveLength(3)

  // The person's close clears the mark too.
  await frame($, 'show', { owner: 'junkd' })
  await shut($)
  expect(rec.closed).toHaveLength(4)
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(4)

  // Opened again by /handoff auto while the owner's pane is up: the person's now.
  await frame($, 'show', { owner: 'junkd' })
  await handoff($, 'auto')
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(4)

  // A show without an owner takes the mark away as well.
  await frame($, 'show', { owner: 'junkd' })
  await frame($, 'show', {})
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toHaveLength(4)
})

test('$.handoff.hide on a pane never opened: no error, nothing closed, and /handoff panel still opens it', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  // No owner: the close goes out (a pane opened but not placed is open too); for an id not open the engine leaves
  // it alone. With an owner the pane never had: nothing at all.
  await frame($, 'hide')
  expect(rec.closed).toEqual(['ahandoff'])
  await frame($, 'hide', { owner: 'junkd' })
  expect(rec.closed).toEqual(['ahandoff'])
  expect(rec.opened).toEqual([])
  await handoff($, 'panel')
  expect(rec.opened).toEqual(['ahandoff'])
})

test('$.handoff.status mirrors armed, percent and phase', { ...WITH_FRAME, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  expect(await frame($, 'status')).toEqual({ armed: false, percent: 0, phase: 'idle' })

  await handoff($, 'auto')
  await clock.advance(1)
  rec.percent = 42
  await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
  expect(await frame($, 'status')).toEqual({ armed: true, percent: 42, phase: 'idle' })

  rec.percent = 90
  await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
  expect(await frame($, 'status')).toEqual({ armed: true, percent: 90, phase: 'handoff' })

  await handoff($, 'off')
  expect((await frame($, 'status') as { armed: boolean; phase: string })).toMatchObject({ armed: false, phase: 'idle' })
})

// ------------------------------------------------------------------ enabled

const DISABLED = { options: { threshold: 80, checkEvery: 1, enabled: false, autoOn: true } }
const ahandoff = ($: Engine, args: string) =>
  $.command.run({ command: 'ahandoff', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
const text = (r: unknown) => (r as { text?: string }).text ?? ''
const hint = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...HINT })
  const t = await texts(ui as unknown as Mounted<Surface, 'Pane'>)
  await ui.unmount()
  return t
}
const DIED = (turnId: string) => ({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'error' as const })

test('enabled false: autoOn arms nothing, auto refuses, no deny past the threshold, no 🪃 segment, no 5h resume', { ...WITH_FRAME, ...DISABLED }, async ($, on) => {
  const rec = world(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)
  await start($)
  expect(await frame($, 'get', 'enabled')).toBe(false)
  expect(await frame($, 'status')).toMatchObject({ armed: false }) // autoOn: true does not arm a disabled loop

  expect(text(await handoff($, 'auto do X'))).toMatch(/auto handoff is disabled/)
  expect(text(await ahandoff($, 'do Y'))).toMatch(/auto handoff is disabled/)
  await clock.advance(1)
  expect(rec.prompts).toEqual([]) // neither prompt ran
  expect(rec.opened).toEqual([]) // `auto` opens no pane while disabled
  expect(await frame($, 'status')).toMatchObject({ armed: false })

  rec.percent = 95
  for (let i = 0; i < 3; i++) expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', reason: 'done' })
  await clock.advance(1)
  expect(rec.commands.filter(c => c.startsWith('handoff:handoff'))).toEqual([]) // no handoff queued at the threshold

  const hour = 3_600_000
  const fiveHour = { kind: 'five_hour', percentUsed: 100, resetsAt: new Date(hour).toISOString() }
  await $.session.measure({ context: usage(10).context, rateLimits: [fiveHour], changed: ['rateLimits'] })
  await $.turn.complete(DIED('t1'))
  await clock.advance(hour * 2)
  expect(rec.prompts).toEqual([]) // no 5h-limit resume

  expect(await hint($)).not.toMatch(/🪃/)
})

test('enabled false: /handoff, /handon, the pane and a handoff write still work; the Auto tab offers no Arm', DISABLED, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(text(await handoff($, ''))).toBe('downstream handoff:handoff') // the plain /handoff goes on
  expect(rec.commands).toContain('handoff:handoff')
  const r = await $.command.run({ command: 'handoff:handon', args: 'aaaaaaaa', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(text(r)).toBe('downstream handoff:handon')
  expect(denial(await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-03-03T00-00_cccccccc.md`, content: '# h' }))).toBeUndefined()

  await handoff($, 'panel')
  expect(rec.opened).toEqual(['ahandoff'])
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...PANE })
  expect(await texts(ui)).toMatch(/disabled/)
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.hotkey === 'a'), 'no Arm button').toBe(false)
  expect(await texts(ui)).toMatch(/cccccccc/) // the write was recorded as the last handoff
  await handoff($, 'panel')
  expect(rec.closed).toEqual(['ahandoff'])
})

test('$.handoff.set enabled flips it live: off disarms and drops a pending 5h resume, on re-arms nothing; every spelling', { ...WITH_FRAME, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto')
  expect(await frame($, 'set', { key: 'enabled', value: true })).toBe(true) // on while on: stays armed
  expect(await frame($, 'status')).toMatchObject({ armed: true })
  rec.percent = 90
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)

  expect(await frame($, 'set', { key: 'enabled', value: false })).toBe(false)
  expect(rec.config.at(-1)).toEqual({ key: 'handoff.enabled', value: false })
  expect(await frame($, 'get', 'enabled')).toBe(false)
  expect(await frame($, 'status')).toEqual({ armed: false, percent: 90, phase: 'idle' })
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
  expect(await hint($)).not.toMatch(/🪃/)

  expect(await frame($, 'set', { key: 'enabled', value: true })).toBe(true)
  expect(await frame($, 'status')).toMatchObject({ armed: false }) // on arms nothing
  expect(await hint($)).toMatch(/🪃 off/)
  await handoff($, 'auto')
  expect(await frame($, 'status')).toMatchObject({ armed: true })
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i) // re-armed at once
  await handoff($, 'off')

  // a 5h-limit resume already scheduled is dropped by enabled off
  await handoff($, 'auto')
  rec.prompts.length = 0
  const hour = 3_600_000
  await $.session.measure({ context: usage(10).context, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(hour).toISOString() }], changed: ['rateLimits'] })
  await $.turn.complete(DIED('t1'))
  expect(await hint($)).toMatch(/limit → /)
  await frame($, 'set', { key: 'enabled', value: false })
  await clock.advance(hour * 2)
  expect(rec.prompts).toEqual([])

  // one assertion per spelling: true, 'true', 'on' are on; false, 'false', 'off' are off
  for (const [value, want] of [[true, true], [false, false], ['true', true], ['false', false], ['on', true], ['off', false]] as const) {
    expect(await frame($, 'set', { key: 'enabled', value }), String(value)).toBe(want)
    expect(await frame($, 'get', 'enabled'), String(value)).toBe(want)
  }
})

test('the /config menu write of handoff.enabled lands live too, read as set reads it', { ...WITH_FRAME, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  await start($)
  await handoff($, 'auto')
  rec.percent = 90
  await frame($, 'config', { key: 'handoff.enabled', value: 'off' })
  expect(rec.config.at(-1)).toEqual({ key: 'handoff.enabled', value: false }) // stored as the boolean
  expect(await frame($, 'get', 'enabled')).toBe(false)
  expect(await frame($, 'status')).toMatchObject({ armed: false })
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()

  await frame($, 'config', { key: 'handoff.enabled', value: 'on' })
  expect(rec.config.at(-1)).toEqual({ key: 'handoff.enabled', value: true })
  expect(await frame($, 'get', 'enabled')).toBe(true)
  await handoff($, 'auto')
  expect(await frame($, 'status')).toMatchObject({ armed: true })
})

test('a refused write of handoff.enabled (menu or set) leaves the loop armed', { ...WITH_FRAME, ...OPTIONS }, async ($, on) => {
  on('config.set', { key: 'handoff.enabled' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await handoff($, 'auto')
  rec.percent = 90
  expect(await frame($, 'config', { key: 'handoff.enabled', value: false })).toEqual({ deny: 'locked' }) // $.config.set answers a deny
  await expect(frame($, 'set', { key: 'enabled', value: false })).rejects.toThrow(/locked/)
  expect(await frame($, 'get', 'enabled')).toBe(true)
  expect(await frame($, 'status')).toMatchObject({ armed: true })
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
})

test('Settings tab: the Enabled switch (u) writes handoff.enabled and the Auto tab then says disabled', OPTIONS, async ($, on) => {
  const rec = world(on)
  await start($)
  await handoff($, 'auto')
  const ui = await $.ui.mount({ plugin: 'handoff', surface: 'terminal', ...PANE })
  await hotkey(ui, '3')
  await hotkey(ui, 'u')
  expect(rec.config.at(-1)).toEqual({ key: 'handoff.enabled', value: false })
  await hotkey(ui, '1')
  expect(await texts(ui)).toMatch(/disabled/)
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.hotkey === 'o' || b.props.hotkey === 'a'), 'neither Off nor Arm').toBe(false)
  await hotkey(ui, '3')
  await hotkey(ui, 'u')
  expect(rec.config.at(-1)).toEqual({ key: 'handoff.enabled', value: true })
  await hotkey(ui, '1')
  await hotkey(ui, 'a')
  expect(rec.config.length).toBe(2)
  expect(await texts(ui)).toMatch(/armed/)
})
