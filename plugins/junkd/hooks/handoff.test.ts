// handoff inside junkd: the auto loop (deny gate, clear → handon → continue chain), /junkd:handoff's
// `panel | auto | off` arguments, /junkd:ahandoff, the 🪃 prompt-line segment, the pane's three tabs, and the
// handoff rows of `$.junkd` (keys `handoff_<field>`, /config rows `junkd.handoff_<field>`).
// The whole junkd module loads (core, orch, tldr and the /junkd frame beside handoff), so `world` answers what every
// session start touches; everything beneath the plugin is answered from memory, nothing touches a real home.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/u'
const DIR = `${HOME}/.claude/handoffs`
const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]
const OPTIONS = { options: { handoff_threshold: 80, handoff_checkEvery: 1 } }
// A handoff field's setting key and its /config row.
const KEY = (field: string) => `handoff_${field}`
const ROW = (field: string) => `junkd.handoff_${field}`

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
// The host before a window's first response: the fill is absent, not zero.
const noFill = () => ({ startedAt: 0, context: { window: 200000 }, rateLimits: [] })

// The slash commands the host lists (findCommand picks /junkd:handon from these).
const COMMANDS = [
  { name: 'junkd:handoff', description: '', source: 'plugin' as const },
  { name: 'junkd:handon', description: '', source: 'plugin' as const },
  { name: 'clear', description: '', source: 'builtin' as const },
]

function world(on: On, o: { commands?: { name: string; description: string; source: 'plugin' | 'builtin' }[] } = {}) {
  mock.store(on)
  mock.env(on, { HOME })
  const rec = {
    percent: 10,
    commands: [] as string[],
    prompts: [] as string[],
    opened: [] as string[],
    focus: [] as (true | undefined)[], // each open's `focus`, beside `opened`
    closed: [] as string[],
    events: [] as string[], // `open <id>` / `close <id>` in order, for "is it up"
    config: [] as { key: string; value: unknown }[],
    runs: [] as string[],
    toasts: [] as string[],
    sid: 'sess-1' as string | undefined, // $.session.id; undefined: it throws
    noFill: false, // usage() answers no percent (a window before its first response)
    logs: [] as { dir: string; path: string; line: string }[], // the measurement log's appends, in order
    logFails: false, // the append itself fails
    contexts: [] as (readonly string[] | undefined)[], // each submission's context, beside rec.prompts
    handonHold: undefined as Promise<void> | undefined, // /junkd:handon does not end until this resolves
    dropPrompt: undefined as string | undefined, // the prompt.submit bottom refuses with this reason
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: rec.noFill ? noFill() : usage(rec.percent) }))
  on('session.id', () => {
    if (rec.sid === undefined) throw new Error('no session')
    return { value: rec.sid }
  })
  // A model that is no Fable: orch's main-loop guard (same module) holds nothing in these tests.
  on('session.model', () => ({ value: 'claude-opus-4-1' }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: o.commands ?? COMMANDS }))
  on('command.run', async (_$, e) => {
    rec.commands.push(`${e.command} ${e.args ?? ''}`.trim())
    if (rec.handonHold && /(^|:)handon$/.test(e.command)) await rec.handonHold // the host raises its submission meanwhile
    return { text: `downstream ${e.command}` }
  })
  on('prompt.submit', (_$, e) => {
    rec.prompts.push(e.text)
    rec.contexts.push(e.context)
    return rec.dropPrompt === undefined ? { text: e.text } : { drop: rec.dropPrompt }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_$, e) => {
    rec.opened.push(e.id); rec.focus.push(e.focus); rec.events.push(`open ${e.id}`)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => { rec.closed.push(e.id); rec.events.push(`close ${e.id}`); return { value: undefined } })
  on('ui.focus', () => ({}))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('ui.copy', () => ({ value: { isCopied: true as const } }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('settings.read', () => ({ value: {} }))
  on('process.run', (_$, e) => {
    rec.runs.push(e.argv.join(' '))
    if (e.argv[0] === 'sh' && e.argv[2]?.includes('>>')) { // the log's append: sh -c '<script>' sh <dir> <path> <line>
      if (rec.logFails) throw new Error('read-only file system')
      rec.logs.push({ dir: e.argv[4]!, path: e.argv[5]!, line: e.argv[6]! })
    }
    const stdout = e.argv.join(' ').includes('$HOME') ? `${HOME}\n` : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.stat', () => ({ deny: 'ENOENT' })) // no file: the stat rejects
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

// Whether a pane is up: its last open or close.
const isUp = (rec: { events: string[] }, id: string) => rec.events.filter(x => x.endsWith(` ${id}`)).at(-1) === `open ${id}`

const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const run = ($: Engine, command: string, args: string) =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
const handoff = ($: Engine, args: string) => run($, 'junkd:handoff', args)
const ahandoff = ($: Engine, args: string) => run($, 'junkd:ahandoff', args)

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

// Another mod beside junkd: `/caller <method> [json]` calls `$.junkd.<method>` and answers what came back (an inline
// plugin closes over nothing, so the command carries the result out as text).
const CALLER: Plugin = {
  name: 'caller',
  register(on) {
    on('command.run', { command: 'caller' }, async ($, e) => {
      const [method = '', ...rest] = e.args.trim().split(/\s+/)
      const input = rest.length ? JSON.parse(rest.join(' ')) : undefined
      try {
        if (method === 'schema') return { text: JSON.stringify({ ok: await $.junkd.schema() }) }
        if (method === 'config') return { text: JSON.stringify({ ok: await $.junkd.config() }) }
        if (method === 'status') return { text: JSON.stringify({ ok: await $.junkd.handoffStatus() }) }
        if (method === 'get') return { text: JSON.stringify({ ok: await $.junkd.get(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.junkd.set(input) }) }
        if (method === 'open') return { text: JSON.stringify({ ok: (await $.junkd.open(input)) ?? null }) }
        // The /config menu's write, as another plugin makes it: it reaches junkd's config.set hooks.
        if (method === 'menu') return { text: JSON.stringify({ ok: await $.config.set(input) }) }
        return { text: JSON.stringify({ error: `no method ${method}` }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
  },
}
const WITH_CALLER = { plugins: [CALLER] }
// `caller <method> [input]` through the engine; resolves to the method's answer, rejects with its refusal.
async function call($: Engine, method: string, input?: unknown): Promise<unknown> {
  const args = input === undefined ? method : `${method} ${JSON.stringify(input)}`
  const r = (await run($, 'caller', args)) as { text?: string }
  const out = JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}
const get = ($: Engine, field: string) => call($, 'get', { key: KEY(field) })
const set = ($: Engine, field: string, value: unknown, scope?: string) =>
  call($, 'set', { key: KEY(field), value, ...(scope === undefined ? {} : { scope }) })
const status = ($: Engine) => call($, 'status')
// The /config menu's write of one handoff row.
const menu = ($: Engine, field: string, value: unknown) => call($, 'menu', { key: ROW(field), value }) as Promise<{ value?: unknown; deny?: string }>

test('auto arms, denies tools past the threshold, lets the handoff through', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto do X')
  await clock.advance(1000)
  expect(rec.prompts.at(-1)).toBe('do X')

  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()

  rec.percent = 90
  const deny = denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))
  expect(deny).toMatch(/handoff/i)
  expect(deny).toContain('Call the Skill tool with skill "junkd:handoff"') // the skill as the host names it now
  expect(denial(await $.tool.call({ tool: 'Skill', skill: 'junkd:handoff' } as never))).toBeUndefined()
  expect(denial(await $.tool.call({ tool: 'Bash', command: '/x/skills/handoff/bin/handoff-path' }))).toBeUndefined()
  expect(denial(await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' }))).toBeUndefined()
})

test('off disarms: tools pass again past the threshold', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto do X')
  await clock.advance(1000)
  rec.percent = 90
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
  await handoff($, 'off')
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
})

// A handoff written mid-cycle, then the loop stopped before the turn ended: the next cycle must not resume that old id.
for (const stop of ['off', 'enabled off'] as const) {
  test(`${stop} after the handoff Write and before the turn ends: the next cycle queues a new handoff, not the old id`, { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
    const rec = world(on)
    const clock = mock.clock(on)
    await start($)
    await handoff($, 'auto')
    rec.percent = 90
    expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
    await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_0dd0dd00.md`, content: '# old' })
    if (stop === 'off') await handoff($, 'off')
    else {
      await set($, 'enabled', false)
      await set($, 'enabled', true)
    }
    await $.turn.complete({ answer: 'stopped', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(1000)

    await handoff($, 'auto')
    expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
    const before = rec.commands.length
    await $.turn.complete({ answer: 'no write', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
    await clock.advance(1000)
    const ran = rec.commands.slice(before)
    expect(ran, ran.join(' | ')).toContain('junkd:handoff') // the new handoff is asked for
    expect(ran.some(c => c.startsWith('junkd:handon') || c === 'clear'), ran.join(' | ')).toBe(false)
  })
}

test('off while the fresh window is unmeasured: re-armed, the loop checks usage again at once', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto')
  rec.percent = 90
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await $.turn.complete({ answer: 'saved', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1000) // clear → handon: the fresh-window guard is up until session.measure
  await handoff($, 'off')
  await handoff($, 'auto')
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
})

test('/junkd:ahandoff <prompt> | off | panel is the short form', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  expect((await ahandoff($, '/junkd:orch all') as { text?: string }).text).toBe('handoff auto on — threshold 80% — running: /junkd:orch all')
  await clock.advance(1000)
  expect(rec.commands.at(-1)).toBe('junkd:orch all') // a slash prompt runs as the command
  expect(rec.opened).toEqual([]) // the short form opens no pane
  await ahandoff($, 'fix the flaky test')
  await clock.advance(1000)
  expect(rec.prompts.at(-1)).toBe('fix the flaky test')
  rec.percent = 90
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
  expect((await ahandoff($, 'off') as { text?: string }).text).toBe('handoff auto off.')
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
  // panel toggles the pane, and arms nothing
  await ahandoff($, 'panel')
  expect(rec.opened).toEqual(['ahandoff'])
  await ahandoff($, 'panel')
  expect(rec.closed).toEqual(['ahandoff'])
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
  // nothing reached the skill's own text: the module answered every form
  expect(rec.commands.filter(c => c.startsWith('junkd:ahandoff'))).toEqual([])
})

test('the written handoff ends the turn into clear → junkd:handon <id> → continue', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto do X')
  await clock.advance(1000)
  rec.percent = 90

  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await $.turn.complete({ answer: 'saved', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await handonRuns($, rec, clock, [handonOf('abcdef12')])

  const clear = rec.commands.indexOf('clear')
  expect(clear).toBeGreaterThanOrEqual(0)
  expect(rec.commands.indexOf('junkd:handon abcdef12')).toBeGreaterThan(clear)
  // one turn: the handon submission carries the continuation (the task text is not the continuation); no prompt of its own
  expect(rec.prompts.filter(p => p !== 'do X')).toEqual(['/junkd:handon abcdef12'])
  expect(rec.contexts.at(-1)?.join('\n')).toContain('continue as they asked: Continue after the handoff')
})

// findCommand: junkd's own /junkd:handon (and /junkd:handoff) first, even where another plugin lists one of the
// same suffix ahead of it; any plugin's by suffix when junkd's is not listed; junkd's spelling when nothing is.
for (const [listed, want] of [
  [['handoff:handon', 'handoff:handoff', 'junkd:handon', 'junkd:handoff'], 'junkd'],
  [['other:handon', 'other:handoff'], 'other'],
  [[], 'junkd'],
] as const) {
  test(`the loop runs ${want}:handoff and ${want}:handon when the host lists ${listed.join(', ') || 'nothing'}`, OPTIONS, async ($, on) => {
    const rec = world(on, { commands: [...listed.map(name => ({ name, description: '', source: 'plugin' as const })), { name: 'clear', description: '', source: 'builtin' as const }] })
    const clock = mock.clock(on)
    await start($)
    await handoff($, 'auto')
    rec.percent = 90
    await $.turn.complete({ answer: 'no write', durationMs: 1, isAborted: false, turnId: 't0', reason: 'answer' })
    await clock.advance(1000)
    expect(rec.commands, rec.commands.join(' | ')).toContain(`${want}:handoff`)
    await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
    await $.turn.complete({ answer: 'saved', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(1000)
    expect(rec.commands, rec.commands.join(' | ')).toContain(`${want}:handon abcdef12`)
  })
}

test('a fresh window over the threshold keeps the loop armed with a raised limit', { options: { handoff_threshold: 10, handoff_checkEvery: 1 } }, async ($, on) => {
  const rec = world(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto do X')
  await clock.advance(1000)
  rec.percent = 12

  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await $.turn.complete({ answer: 'saved', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(1000)
  expect(rec.commands.includes('junkd:handon abcdef12')).toBe(true)

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
  await handoff($, 'auto /junkd:orch all')
  await clock.advance(1000)
  rec.percent = 90
  const before = rec.commands.length

  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await $.turn.complete({ answer: 'saved', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const prompts = rec.prompts.length
  await handonRuns($, rec, clock, [handonOf('abcdef12')])

  const chain = rec.commands.slice(before)
  const handon = chain.indexOf('junkd:handon abcdef12')
  expect(handon).toBeGreaterThan(chain.indexOf('clear'))
  expect(chain.includes('junkd:orch all')).toBe(false) // the task ran once, at arm time
  expect(rec.prompts.length).toBe(prompts + 1) // the handon submission only
  expect(rec.prompts.at(-1)).toBe('/junkd:handon abcdef12')
  expect(rec.contexts.at(-1)?.join('\n')).toContain('continue as they asked: Continue after the handoff')
})

test('panel toggles the pane; no argument goes on to the junkd:handoff skill', async ($, on) => {
  const rec = world(on)
  await start($)

  await handoff($, 'panel')
  expect(rec.opened).toEqual(['ahandoff'])
  await handoff($, 'panel')
  expect(rec.closed).toEqual(['ahandoff'])

  const r = await handoff($, '')
  expect(rec.commands).toEqual(['junkd:handoff'])
  expect((r as { text?: string }).text).toBe('downstream junkd:handoff')
})

test('the 🪃 segment sits beside ✚ junkd in the prompt line, shows usage or off, and a press opens the pane', OPTIONS, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'junkd', surface, ...HINT })
    expect(await ui.find({ type: 'Button', text: '🪃 off' })).toBeDefined()
    expect(await ui.find({ key: 'junkd-toggle' }), 'the frame button beside it').toBeDefined()
    const order = (await ui.findAll({ type: 'Button' })).map(b => b.key)
    expect(order.indexOf('handoff-segment')).toBeLessThan(order.indexOf('junkd-toggle')) // [below, 🪃, ✚ junkd]
    await ui.unmount()
  }

  await handoff($, 'auto do X')
  await clock.advance(1000)
  await handoff($, 'panel') // auto opened it; close it so the press below opens it again
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'junkd', surface, ...HINT })
    const seg = await ui.find({ type: 'Button', text: /🪃 \d+%/ })
    expect(seg?.key).toBe('handoff-segment')
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
    const ui = await $.ui.mount({ plugin: 'junkd', surface, ...PANE })
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
    expect(ran.some(c => /^junkd:handon (aaaaaaaa|bbbbbbbb)$/.test(c)), ran.join(' | ')).toBe(true)
    await ui.unmount()
  }
})

// CLAUDE_CONFIG_DIR moves the handoffs folder, as bin/handoff-path follows it; empty means unset.
for (const [config, dir] of [['/cfg', '/cfg/handoffs'], ['', DIR]] as const) {
  test(`the pane lists and opens ${dir} with CLAUDE_CONFIG_DIR ${config ? config : 'empty'}`, async ($, on) => {
    on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: config }))
    on('fs.list', { path: '/cfg/handoffs' }, () => ({
      value: [{ name: '2026-03-03T00-00_cfcfcfcf.md', kind: 'file' as const, size: 10, mtimeMs: Date.UTC(2026, 2, 3), isLink: false }],
    }))
    on('fs.read', { path: '/cfg/handoffs/2026-03-03T00-00_cfcfcfcf.md' }, () => ({ value: '# Title CFG\n' }))
    const rec = world(on)
    await start($)
    await handoff($, 'panel')
    const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
    await hotkey(ui, '2')
    const t = await texts(ui)
    if (config) {
      expect(t).toContain('Title CFG')
      expect(t).not.toContain('Title A')
      expect(t).toContain('1 in /cfg/handoffs') // the folder drawn is the one read
    } else {
      expect(t).toContain('Title A')
      expect(t).not.toContain('Title CFG')
      expect(t).toContain('2 in ~/.claude/handoffs')
    }
    await hotkey(ui, '3')
    await hotkey(ui, 'o')
    expect(rec.runs).toContain(`open ${dir}`)
    await ui.unmount()
  })
}

// The home is drawn as ~ only where the folder is inside it: a sibling whose name starts with the home's is not.
for (const [config, drawn] of [['/home/u2/.claude', '/home/u2/.claude/handoffs'], ['/home/u/cfg', '~/cfg/handoffs']] as const) {
  test(`HOME ${HOME} with CLAUDE_CONFIG_DIR ${config} draws ${drawn}`, async ($, on) => {
    on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: config }))
    on('fs.list', { path: `${config}/handoffs` }, () => ({
      value: [{ name: '2026-03-03T00-00_cfcfcfcf.md', kind: 'file' as const, size: 10, mtimeMs: Date.UTC(2026, 2, 3), isLink: false }],
    }))
    on('fs.read', { path: `${config}/handoffs/2026-03-03T00-00_cfcfcfcf.md` }, () => ({ value: '# Title CFG\n' }))
    world(on)
    await start($)
    await handoff($, 'panel')
    const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
    await hotkey(ui, '2')
    const t = await texts(ui)
    expect(t).toContain(`1 in ${drawn}`)
    expect(t).not.toContain('~2/')
    await ui.unmount()
  })
}

test('Settings tab: threshold field writes junkd.handoff_threshold', async ($, on) => {
  const rec = world(on)
  await start($)
  await handoff($, 'panel')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'junkd', surface, ...PANE })
    await hotkey(ui, '3')
    const field = (await ui.findAll({ type: 'Input' })).find(i => /^threshold/.test(i.key ?? ''))
    expect(field?.key, 'the threshold Input').toBeDefined()
    await ui.input({ key: field!.key!, text: '90' })
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.handoff_threshold', value: 90 })
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
  const hint = await $.ui.mount({ plugin: 'junkd', surface, ...HINT })
  expect((await hint.findAll({ type: 'Text' })).map(t => t.text).join('')).toMatch(/limit → \d\d:\d\d/)

  await clock.advance(hour + 60_000)
  expect(rec.prompts).toEqual([]) // not yet: 2 min grace
  await clock.advance(60_000)
  expect(rec.prompts).toEqual(['Continue where the rate limit stopped you'])

  // off in Settings: the next limit death schedules nothing
  await handoff($, 'panel')
  const ui = await $.ui.mount({ plugin: 'junkd', surface, ...PANE })
  await hotkey(ui, '3')
  await hotkey(ui, 'l')
  expect(rec.config).toContainEqual({ key: 'junkd.handoff_resumeAfterLimit', value: false })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'error' })
  await clock.advance(hour * 2)
  expect(rec.prompts.length).toBe(1)
})

// The manifest's handoff rows. A test cannot import plugin.json (only code files load), so the keys stand here and
// the defaults come from the engine: with no test options, get() answers the manifest's defaults.
// tests/smoke.sh checks each entry's type, title and default against the manifest itself.
const MANIFEST_FIELDS = ['enabled', 'threshold', 'checkEvery', 'autoOn', 'resumeAfterLimit', 'staleDays', 'segment']

test('$.junkd: the handoff rows of schema mirror the manifest, enabled first, main on the five frame fields; get and config answer the defaults; handoffStatus answers', WITH_CALLER, async ($, on) => {
  world(on)
  await start($)
  type Entry = { key: string; group: string; field: string; type: string; title: string; default: unknown; main: boolean }
  const rows = ((await call($, 'schema')) as Entry[]).filter(f => f.group === 'handoff')
  expect(rows.map(f => f.key)).toEqual(MANIFEST_FIELDS.map(KEY))
  const config = (await call($, 'config')) as Record<string, unknown>
  for (const f of rows) {
    expect(f.key, f.field).toBe(KEY(f.field))
    expect(typeof f.default, f.key).toBe(f.type)
    expect(f.title, f.key).toMatch(/\S/)
    expect(await call($, 'get', { key: f.key }), `get(${f.key}) is the manifest default`).toBe(f.default)
    expect(config[f.key], `config()'s ${f.key}`).toBe(f.default)
  }
  expect(rows.filter(f => f.main).map(f => f.field)).toEqual(['enabled', 'threshold', 'autoOn', 'resumeAfterLimit', 'segment'])
  expect(rows[0]).toEqual({ key: 'handoff_enabled', group: 'handoff', field: 'enabled', type: 'boolean', title: 'Auto handoff: enabled', default: true, main: true })
  expect(await status($)).toEqual({ armed: false, percent: 0, phase: 'idle' })
})

test('$.junkd.set writes junkd.handoff_<field> through $.config and get reads it back; a bad value or scope is refused', WITH_CALLER, async ($, on) => {
  on('config.set', { key: 'junkd.handoff_checkEvery' }, () => ({ deny: 'locked' })) // one row a hook refuses
  const rec = world(on)
  await start($)
  expect(await set($, 'threshold', 70)).toBe(70)
  expect(rec.config).toEqual([{ key: 'junkd.handoff_threshold', value: 70 }])
  expect(await get($, 'threshold')).toBe(70)

  expect(await set($, 'segment', 'off', 'user')).toBe(false)
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.handoff_segment', value: false })
  expect(await get($, 'segment')).toBe(false)

  // exact bounds: 100 and 1 are in, -5 (and 0, 101 below) are out; 'on' is a true
  expect(await set($, 'threshold', 100)).toBe(100)
  expect(await set($, 'staleDays', 1)).toBe(1) // checkEvery is the row the deny hook below locks
  expect(await set($, 'autoOn', 'on')).toBe(true)
  expect(rec.config.slice(-3)).toEqual([
    { key: 'junkd.handoff_threshold', value: 100 }, { key: 'junkd.handoff_staleDays', value: 1 }, { key: 'junkd.handoff_autoOn', value: true },
  ])
  await expect(set($, 'threshold', -5)).rejects.toThrow(/not a valid threshold/)
  expect(await get($, 'threshold')).toBe(100)
  expect(await set($, 'threshold', 70)).toBe(70)

  const writes = rec.config.length
  await expect(set($, 'threshold', 'abc')).rejects.toThrow(/not a valid threshold/)
  await expect(set($, 'threshold', 101)).rejects.toThrow(/not a valid threshold/)
  await expect(set($, 'checkEvery', 0)).rejects.toThrow(/not a valid checkEvery/)
  await expect(set($, 'threshold', 70, 'project')).rejects.toThrow(/scope project/)
  await expect(set($, 'nope', 1)).rejects.toThrow(/no setting handoff_nope/)
  await expect(get($, 'nope')).rejects.toThrow(/no setting handoff_nope/)
  // the old keys are no settings any more
  await expect(call($, 'set', { key: 'threshold', value: 60 })).rejects.toThrow(/: junkd: no setting threshold$/)
  await expect(call($, 'get', { key: 'handoff.threshold' })).rejects.toThrow(/: junkd: no setting handoff\.threshold$/)
  expect(rec.config.length).toBe(writes) // none of the refusals reached $.config
  expect(await get($, 'threshold')).toBe(70)

  // a config.set hook's deny comes back as the refusal and the value stays
  await expect(set($, 'checkEvery', 9)).rejects.toThrow(/locked/)
  expect(await get($, 'checkEvery')).toBe(5)
})

test('$.junkd.set and get reach every handoff row: the value lands in its own row and get answers it', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const [field, value] of [
    ['enabled', false], ['threshold', 66], ['checkEvery', 4], ['autoOn', true], ['resumeAfterLimit', false], ['staleDays', 12], ['segment', false],
  ] as const) {
    const before = await get($, field)
    expect(before, `${field} differs before`).not.toBe(value)
    expect(await set($, field, value), field).toBe(value)
    expect(rec.config.at(-1), field).toEqual({ key: ROW(field), value })
    expect(await get($, field), field).toBe(value)
    expect(((await call($, 'config')) as Record<string, unknown>)[KEY(field)], `config()'s ${field}`).toBe(value)
  }
})

test('$.junkd.set: checkEvery is a whole number 1 or more, threshold above 0 up to 100, staleDays above 0; what is stored is what get answers', WITH_CALLER, async ($, on) => {
  const rec = world(on)
  await start($)
  const refused = async (field: string, value: unknown, holds: unknown) => {
    const writes = rec.config.length
    await expect(set($, field, value), `${field} ${String(value)}`).rejects.toThrow(new RegExp(`not a valid ${field}`))
    expect(rec.config.length, `${field} ${String(value)} reached the row`).toBe(writes)
    expect(await get($, field), `${field} after ${String(value)}`).toBe(holds)
  }
  const taken = async (field: string, value: unknown, want: number) => {
    expect(await set($, field, value), `${field} ${String(value)}`).toBe(want)
    expect(rec.config.at(-1), `${field} ${String(value)}`).toEqual({ key: ROW(field), value: want })
    expect(await get($, field), `${field} ${String(value)}`).toBe(want)
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

test('options the engine hands at load that set would refuse fall back to the defaults', { ...WITH_CALLER, options: { handoff_checkEvery: 2.6, handoff_threshold: 101, handoff_staleDays: 0 } }, async ($, on) => {
  world(on)
  await start($)
  expect(await get($, 'checkEvery')).toBe(5)
  expect(await get($, 'threshold')).toBe(85)
  expect(await get($, 'staleDays')).toBe(30)
})

test('options at load on the bounds are taken as given', { ...WITH_CALLER, options: { handoff_checkEvery: 1, handoff_threshold: 100, handoff_staleDays: 0.5 } }, async ($, on) => {
  world(on)
  await start($)
  expect(await get($, 'checkEvery')).toBe(1)
  expect(await get($, 'threshold')).toBe(100)
  expect(await get($, 'staleDays')).toBe(0.5)
})

test('options at load are read from the handoff_<field> keys only: a bare field name is no option', { ...WITH_CALLER, options: { threshold: 50, autoOn: true, handoff_threshold: 70 } }, async ($, on) => {
  world(on)
  await start($)
  expect(await get($, 'threshold')).toBe(70)
  expect(await get($, 'autoOn')).toBe(false)
  expect(await status($)).toMatchObject({ armed: false })
})

test('$.junkd.open toggles the handoff pane; a route opens it on that tab or switches the tab while it is up; an unknown route or pane is refused', WITH_CALLER, async ($, on) => {
  const rec = world(on)
  await start($)
  await call($, 'open', { pane: 'handoff' })
  expect(rec.opened).toEqual(['ahandoff'])
  expect(rec.focus).toEqual([true]) // open asks for the keys, as /junkd:handoff panel does
  await call($, 'open', { pane: 'handoff' })
  expect(rec.closed).toEqual(['ahandoff'])

  await call($, 'open', { pane: 'handoff', route: 'handoffs' })
  expect(rec.opened).toEqual(['ahandoff', 'ahandoff'])
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'row-aaaaaaaa' }), 'the Handoffs tab is up').toBeDefined()
  await ui.unmount()

  // unknown route: refused, pane untouched
  await expect(call($, 'open', { pane: 'handoff', route: 'bogus' })).rejects.toThrow(/: junkd: no tab bogus$/)
  await expect(call($, 'open', { pane: 'hand', route: 'settings' })).rejects.toThrow(/: junkd: no pane hand$/)
  expect(rec.opened).toHaveLength(2)
  expect(rec.closed).toEqual(['ahandoff'])

  await call($, 'open', { pane: 'handoff', route: 'settings' }) // up already: switch, do not close
  expect(rec.closed).toEqual(['ahandoff'])
  expect(rec.opened).toHaveLength(2)
  const settings = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  expect((await settings.findAll({ type: 'Input' })).some(i => /^threshold/.test(i.key ?? '')), 'the Settings tab is up').toBe(true)
  await settings.unmount()

  // up, with every route: each switches the tab and closes nothing
  for (const route of ['auto', 'handoffs', 'settings'] as const) {
    await call($, 'open', { pane: 'handoff', route })
    expect(rec.closed, route).toEqual(['ahandoff'])
  }
})

// A close of the pane from outside the module, as the person's mark or ctrl+x x is to it: `/shut` closes it through
// another plugin's `$.ui.close`, which reaches the pane's own ui.close hook.
const SHUTTER: Plugin = {
  name: 'shutter',
  register(on) {
    on('command.run', { command: 'shut' }, async $ => { await $.ui.close({ id: 'ahandoff' }); return {} })
  },
}
const shut = ($: Engine) => run($, 'shut', '')

test('the person\'s close (another plugin\'s $.ui.close) is seen: the next $.junkd.open or /junkd:handoff panel opens again', { plugins: [CALLER, SHUTTER] }, async ($, on) => {
  const rec = world(on)
  await start($)
  await call($, 'open', { pane: 'handoff' })
  await shut($)
  expect(rec.closed).toEqual(['ahandoff'])
  await call($, 'open', { pane: 'handoff' })
  expect(rec.opened).toEqual(['ahandoff', 'ahandoff']) // opened, not closed a second time
  expect(rec.closed).toEqual(['ahandoff'])
  await shut($)
  await handoff($, 'panel')
  expect(rec.opened).toHaveLength(3)
  expect(rec.focus.at(-1)).toBe(true)
  expect(rec.closed).toHaveLength(2)
})

// show and hide are no longer on the noun: the /junkd set calls them (with its owner mark) inside the module. Driven
// here through /junkd, asserting only the handoff pane: the set shows it without the keys and hides it only while
// it is still the set's; any other open or close since (the pane's own command, /junkd:handoff auto, the person's
// close) takes the mark away.
test('the /junkd set shows the handoff pane without the keys, and closes it only while it is still the set\'s', { plugins: [SHUTTER] }, async ($, on) => {
  const rec = world(on)
  await start($)
  const junkd = () => run($, 'junkd', '')

  await junkd()
  expect(isUp(rec, 'ahandoff')).toBe(true)
  expect(rec.focus[rec.opened.lastIndexOf('ahandoff')]).toBeUndefined() // the set's show: the keys stay with junkd
  await junkd()
  expect(isUp(rec, 'ahandoff')).toBe(false) // still the set's: hidden with it

  // Reopened by its own command while the set is up: the person's now, so closing the set leaves it.
  await junkd()
  await handoff($, 'panel') // closes it (it is up)
  await handoff($, 'panel') // opens it again, asking for the keys
  expect(rec.focus[rec.opened.lastIndexOf('ahandoff')]).toBe(true)
  const closes = rec.closed.length
  await junkd()
  expect(rec.closed.slice(closes)).not.toContain('ahandoff')
  expect(isUp(rec, 'ahandoff')).toBe(true)
  await handoff($, 'panel')
  expect(isUp(rec, 'ahandoff')).toBe(false)

  // Closed by its own command while the set is up: closing the set does not close it a second time.
  await junkd()
  await handoff($, 'panel')
  expect(isUp(rec, 'ahandoff')).toBe(false)
  const ownCloses = rec.closed.length
  await junkd()
  expect(rec.closed.slice(ownCloses)).not.toContain('ahandoff')

  // The person's close of the set's handoff pane takes the whole set down: handoff closes once (the person's), the
  // set's own close of it finds the mark cleared and the set is not up to close again.
  await junkd()
  const shutCloses = rec.closed.length
  await shut($)
  expect(rec.closed.slice(shutCloses).filter(id => id === 'ahandoff')).toEqual(['ahandoff'])
  expect(isUp(rec, 'ahandoff')).toBe(false)
  expect(rec.closed.slice(shutCloses)).toContain('junkd')

  // Opened again by /junkd:handoff auto while the set's pane is up: the person's now.
  await junkd()
  await handoff($, 'auto')
  const autoCloses = rec.closed.length
  await junkd()
  expect(rec.closed.slice(autoCloses)).not.toContain('ahandoff')
  expect(isUp(rec, 'ahandoff')).toBe(true)
})

test('$.junkd.handoffStatus mirrors armed, percent and phase', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  expect(await status($)).toEqual({ armed: false, percent: 0, phase: 'idle' })

  await handoff($, 'auto')
  await clock.advance(1000)
  rec.percent = 42
  await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
  expect(await status($)).toEqual({ armed: true, percent: 42, phase: 'idle' })

  rec.percent = 90
  await $.tool.call({ tool: 'Read', file_path: '/tmp/a' })
  expect(await status($)).toEqual({ armed: true, percent: 90, phase: 'handoff' })

  await handoff($, 'off')
  expect((await status($) as { armed: boolean; phase: string })).toMatchObject({ armed: false, phase: 'idle' })
})

// ------------------------------------------------------------------ enabled

const DISABLED = { options: { handoff_threshold: 80, handoff_checkEvery: 1, handoff_enabled: false, handoff_autoOn: true } }
const text = (r: unknown) => (r as { text?: string }).text ?? ''
const hint = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  const t = await texts(ui as unknown as Mounted<Surface, 'Pane'>)
  await ui.unmount()
  return t
}
const DIED = (turnId: string) => ({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'error' as const })

test('enabled false: autoOn arms nothing, auto refuses, no deny past the threshold, no 🪃 segment, no 5h resume', { ...WITH_CALLER, ...DISABLED }, async ($, on) => {
  const rec = world(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)
  await start($)
  expect(await get($, 'enabled')).toBe(false)
  expect(await status($)).toMatchObject({ armed: false }) // autoOn: true does not arm a disabled loop

  expect(text(await handoff($, 'auto do X'))).toMatch(/auto handoff is disabled/)
  expect(text(await ahandoff($, 'do Y'))).toMatch(/auto handoff is disabled/)
  await clock.advance(1000)
  expect(rec.prompts).toEqual([]) // neither prompt ran
  expect(rec.opened).toEqual([]) // `auto` opens no pane while disabled
  expect(await status($)).toMatchObject({ armed: false })

  rec.percent = 95
  for (let i = 0; i < 3; i++) expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't0', reason: 'done' })
  await clock.advance(1000)
  expect(rec.commands.filter(c => c.startsWith('junkd:handoff'))).toEqual([]) // no handoff queued at the threshold

  const hour = 3_600_000
  const fiveHour = { kind: 'five_hour', percentUsed: 100, resetsAt: new Date(hour).toISOString() }
  await $.session.measure({ context: usage(10).context, rateLimits: [fiveHour], changed: ['rateLimits'] })
  await $.turn.complete(DIED('t1'))
  await clock.advance(hour * 2)
  expect(rec.prompts).toEqual([]) // no 5h-limit resume

  const line = await hint($)
  expect(line).not.toMatch(/🪃/)
  expect(line).toMatch(/✚/) // the rest of the prompt line (✚ junkd) is still drawn
})

test('enabled false: /junkd:handoff, /junkd:handon, the pane and a handoff write still work; the Auto tab offers no Arm', DISABLED, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(text(await handoff($, ''))).toBe('downstream junkd:handoff') // the plain skill goes on
  expect(rec.commands).toContain('junkd:handoff')
  const r = await run($, 'junkd:handon', 'aaaaaaaa')
  expect(text(r)).toBe('downstream junkd:handon')
  expect(denial(await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-03-03T00-00_cccccccc.md`, content: '# h' }))).toBeUndefined()

  await handoff($, 'panel')
  expect(rec.opened).toEqual(['ahandoff'])
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  expect(await texts(ui)).toMatch(/disabled/)
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.hotkey === 'a'), 'no Arm button').toBe(false)
  expect(await texts(ui)).toMatch(/cccccccc/) // the write was recorded as the last handoff
  await handoff($, 'panel')
  expect(rec.closed).toEqual(['ahandoff'])
})

test('$.junkd.set handoff_enabled flips it live: off disarms and drops a pending 5h resume, on re-arms nothing; every spelling', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto')
  expect(await set($, 'enabled', true)).toBe(true) // on while on: stays armed
  expect(await status($)).toMatchObject({ armed: true })
  rec.percent = 90
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)

  expect(await set($, 'enabled', false)).toBe(false)
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.handoff_enabled', value: false })
  expect(await get($, 'enabled')).toBe(false)
  expect(await status($)).toEqual({ armed: false, percent: 90, phase: 'idle' })
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
  expect(await hint($)).not.toMatch(/🪃/)

  expect(await set($, 'enabled', true)).toBe(true)
  expect(await status($)).toMatchObject({ armed: false }) // on arms nothing
  expect(await hint($)).toMatch(/🪃 off/)
  await handoff($, 'auto')
  expect(await status($)).toMatchObject({ armed: true })
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i) // re-armed at once
  await handoff($, 'off')

  // a 5h-limit resume already scheduled is dropped by enabled off
  await handoff($, 'auto')
  rec.prompts.length = 0
  const hour = 3_600_000
  await $.session.measure({ context: usage(10).context, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(hour).toISOString() }], changed: ['rateLimits'] })
  await $.turn.complete(DIED('t1'))
  expect(await hint($)).toMatch(/limit → /)
  await set($, 'enabled', false)
  await clock.advance(hour * 2)
  expect(rec.prompts).toEqual([])

  // one assertion per spelling: true, 'true', 'on' are on; false, 'false', 'off' are off
  for (const [value, want] of [[true, true], [false, false], ['true', true], ['false', false], ['on', true], ['off', false]] as const) {
    expect(await set($, 'enabled', value), String(value)).toBe(want)
    expect(await get($, 'enabled'), String(value)).toBe(want)
  }
})

test('the /config menu write of junkd.handoff_enabled lands live too, read as set reads it', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  await start($)
  await handoff($, 'auto')
  rec.percent = 90
  await menu($, 'enabled', 'off')
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.handoff_enabled', value: false }) // stored as the boolean
  expect(await get($, 'enabled')).toBe(false)
  expect(await status($)).toMatchObject({ armed: false })
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()

  await menu($, 'enabled', 'on')
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.handoff_enabled', value: true })
  expect(await get($, 'enabled')).toBe(true)
  await handoff($, 'auto')
  expect(await status($)).toMatchObject({ armed: true })
})

test('the /config menu refuses what set refuses: threshold 150, checkEvery 2.6 and the rest; the row and get stay', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const [field, value, holds] of [
    ['threshold', 150, 80], ['threshold', 101, 80], ['threshold', 0, 80], ['threshold', 'abc', 80],
    ['checkEvery', 2.6, 1], ['checkEvery', 0, 1], ['staleDays', 0, 30], ['staleDays', -1, 30],
  ] as const) {
    const writes = rec.config.length
    expect((await menu($, field, value)).deny, `${field} ${value}`).toMatch(new RegExp(`not a valid ${field}`))
    expect(rec.config.length, `${field} ${value} reached the row`).toBe(writes)
    expect(await get($, field), `${field} ${value}`).toBe(holds)
  }
  // the bounds themselves go through
  expect(await menu($, 'threshold', 100)).toEqual({ value: 100 })
  expect(await menu($, 'checkEvery', 1)).toEqual({ value: 1 })
  // a handoff row the module has no field for is left to the host
  expect(await menu($, 'nope', 3)).toEqual({ value: 3 })
})

// The handoff config.set hook takes the handoff rows only: the old row spelling, another group's row, a row with
// the group as a mere prefix or inside the key pass to the host untouched, and handoff's settings stay.
test('the /config menu hook of handoff matches only the junkd.handoff_* rows', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const key of ['handoff.threshold', 'junkd.handoffthreshold', 'junkd.handoff.threshold', 'xjunkd.handoff_threshold', 'other.junkd.handoff_threshold', 'junkd.handoff_threshold_x', 'junkd.handoff_x_threshold', 'junkd.handoff_.threshold', 'junkd.orch_handoff_threshold']) {
    expect(await call($, 'menu', { key, value: 150 }), key).toEqual({ value: 150 }) // not refused as threshold 150 would be
    expect(rec.config.at(-1), key).toEqual({ key, value: 150 })
    expect(await get($, 'threshold'), key).toBe(80)
  }
  for (const key of ['handoff.enabled', 'junkd.tldr_enabled', 'junkd.orch_enabled']) {
    await call($, 'menu', { key, value: false })
    expect(await get($, 'enabled'), key).toBe(true)
  }
  // and the handoff row itself is refused as set refuses it
  expect((await menu($, 'threshold', 150)).deny).toMatch(/not a valid threshold/)
})

test('a /config menu write of every field lands live: get answers it at once', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const [field, value] of [
    ['threshold', 70], ['checkEvery', 3], ['staleDays', 7], ['autoOn', true], ['resumeAfterLimit', false], ['segment', false], ['enabled', false],
  ] as const) {
    expect(await menu($, field, value), field).toEqual({ value })
    expect(rec.config.at(-1), field).toEqual({ key: ROW(field), value })
    expect(await get($, field), field).toBe(value)
  }
  expect(await menu($, 'threshold', '55')).toEqual({ value: 55 }) // a typed number is stored as the number
  expect(await get($, 'threshold')).toBe(55)
})

test('a /config menu threshold acts at once: the next check denies past it', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  await start($)
  await handoff($, 'auto')
  rec.percent = 60
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toBeUndefined()
  await menu($, 'threshold', 50)
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
})

test('segment off in the /config menu hides the 🪃 segment; on brings it back', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  world(on)
  await start($)
  expect(await hint($)).toMatch(/🪃/)
  await menu($, 'segment', false)
  expect(await hint($)).not.toMatch(/🪃/)
  await menu($, 'segment', 'on')
  expect(await hint($)).toMatch(/🪃/)
  // a prompt line already drawn is drawn again: the write asks for the redraw
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  expect(await texts(ui as unknown as Mounted<Surface, 'Pane'>)).toMatch(/🪃/)
  await menu($, 'segment', false)
  expect(await texts(ui as unknown as Mounted<Surface, 'Pane'>)).not.toMatch(/🪃/)
  await ui.unmount()
})

test('resumeAfterLimit off in the /config menu cancels a scheduled 5h-limit resume', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const clock = mock.clock(on)
  await start($)
  await handoff($, 'auto')
  const hour = 3_600_000
  await $.session.measure({ context: usage(10).context, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(hour).toISOString() }], changed: ['rateLimits'] })
  await $.turn.complete(DIED('t1'))
  expect(await hint($)).toMatch(/limit → /)
  await menu($, 'resumeAfterLimit', false)
  expect(await hint($)).not.toMatch(/limit → /)
  await clock.advance(hour * 2)
  expect(rec.prompts).toEqual([])
})

test('every boolean row through the /config menu: true, \'true\' and \'on\' are on, the rest off', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const field of ['enabled', 'autoOn', 'resumeAfterLimit', 'segment']) {
    for (const value of [true, 'true', 'on']) {
      await menu($, field, false)
      expect(await get($, field), `${field} off before ${String(value)}`).toBe(false)
      expect(await menu($, field, value), `${field} ${String(value)}`).toEqual({ value: true })
      expect(rec.config.at(-1), `${field} ${String(value)} stored`).toEqual({ key: ROW(field), value: true })
      expect(await get($, field), `${field} ${String(value)}`).toBe(true)
    }
    for (const value of ['false', 'off']) {
      expect(await menu($, field, value), `${field} ${value}`).toEqual({ value: false })
      expect(await get($, field), `${field} ${value}`).toBe(false)
      await menu($, field, true)
    }
  }
})

test('a refused write of junkd.handoff_enabled (menu or set) leaves the loop armed', { ...WITH_CALLER, ...OPTIONS }, async ($, on) => {
  on('config.set', { key: 'junkd.handoff_enabled' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await handoff($, 'auto')
  rec.percent = 90
  expect(await menu($, 'enabled', false)).toEqual({ deny: 'locked' }) // $.config.set answers a deny
  await expect(set($, 'enabled', false)).rejects.toThrow(/locked/)
  expect(await get($, 'enabled')).toBe(true)
  expect(await status($)).toMatchObject({ armed: true })
  expect(denial(await $.tool.call({ tool: 'Read', file_path: '/tmp/a' }))).toMatch(/handoff/i)
})

// A 5h-limit resume a previous session left scheduled: the startup notice says how to get it back.
for (const enabled of [true, false]) {
  test(`the startup notice of a lost 5h-limit resume, enabled ${enabled}: ${enabled ? 're-arm with /junkd:ahandoff' : 'names the enabled setting'}`, { options: { handoff_enabled: enabled } }, async ($, on) => {
    on('store.get', { key: 'ahandoff' }, () => ({ value: { on: true, resumeAt: Date.now() + 3_600_000 } }))
    const rec = world(on)
    await start($)
    const notice = rec.toasts.find(t => /^handoff: a 5h-limit resume was due/.test(t))
    expect(notice, rec.toasts.join(' | ')).toBeDefined()
    if (enabled) {
      expect(notice).toMatch(/re-arm with \/junkd:ahandoff$/)
      expect(notice).not.toMatch(/disabled/)
    } else {
      expect(notice).toMatch(/auto handoff is disabled: turn the enabled setting on \(\/config, or the pane's Settings tab\), then \/junkd:ahandoff$/)
      expect(notice).not.toMatch(/re-arm with/)
    }
  })
}

test('the startup notice of a pending handoff names /junkd:handon <id>; none without one', async ($, on) => {
  on('store.get', { key: 'ahandoff' }, () => ({ value: { on: true, pending: { id: 'abcdef12', prompt: 'x' } } }))
  const rec = world(on)
  await start($)
  expect(rec.toasts).toContain('handoff: pending handoff abcdef12 — run /junkd:handon abcdef12')
})

test('no startup notice without a pending handoff or a due resume', async ($, on) => {
  const rec = world(on)
  await start($)
  expect(rec.toasts.filter(t => t.startsWith('handoff:'))).toEqual([])
})

test('Settings tab: the Enabled switch (u) writes junkd.handoff_enabled and the Auto tab then says disabled', OPTIONS, async ($, on) => {
  const rec = world(on)
  await start($)
  await handoff($, 'auto')
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  await hotkey(ui, '3')
  await hotkey(ui, 'u')
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.handoff_enabled', value: false })
  await hotkey(ui, '1')
  expect(await texts(ui)).toMatch(/disabled/)
  expect((await ui.findAll({ type: 'Button' })).some(b => b.props.hotkey === 'o' || b.props.hotkey === 'a'), 'neither Off nor Arm').toBe(false)
  await hotkey(ui, '3')
  await hotkey(ui, 'u')
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.handoff_enabled', value: true })
  await hotkey(ui, '1')
  await hotkey(ui, 'a')
  expect(rec.config.length).toBe(2)
  expect(await texts(ui)).toMatch(/armed/)
})

// ---------------------------------------------------------------------------------------------------------------------
// T30: the measurement log, and why a loop armed at 7% with a threshold of 5 never handed off.

const TURN = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
const turn = ($: Engine) => $.turn.complete(TURN)
const measure = ($: Engine, percent: number) => $.session.measure({ context: usage(percent).context, rateLimits: [], changed: ['context'] })
const passMeasure = (on: On) => on('session.measure', (_$, e) => ({ changed: e.changed }))
// A log line without its time: `<hook> percent=.. limit=.. armed=.. fresh=.. decision=.. base=.. threshold=.. phase=.. window=..`.
const bodies = (rec: { logs: { line: string }[] }) => rec.logs.map(l => l.line.replace(/^\S+ /, ''))
const LOG_LINE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z (tool\.call|turn\.complete|session\.measure|session\.start) percent=\d+ limit=\d+ armed=(true|false) fresh=(true|false) decision=(fire|skip:[a-z-]+|cycle:[a-z-]+) base=\d+ threshold=\d+ phase=\w+ window=\d+( note=\S+)?$/
const THRESHOLD_5 = { options: { handoff_threshold: 5, handoff_checkEvery: 1 } }
const READ = { tool: 'Read', file_path: '/tmp/a' } as const

// The live run on the real host (fake API, 1M window): one ordinary turn fills the window to 7%, then
// /junkd:ahandoff arms with threshold 5. The host raises turn.complete, then session.measure, after each turn.
test('percent 7 with threshold 5, armed after an earlier turn: the turn end hands off, and the log says fire', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  const clock = mock.clock(on)
  await start($)
  rec.percent = 7
  await turn($) // not armed yet
  await measure($, 7) // the first measurement of the session: it must not become the baseline
  await ahandoff($, 'read the README')
  await clock.advance(1000)
  await turn($) // the arming turn ends at 7%

  expect(bodies(rec).at(-1)).toBe('turn.complete percent=7 limit=5 armed=true fresh=false decision=fire base=0 threshold=5 phase=idle window=200000')
  await clock.advance(1000)
  expect(rec.commands).toContain('junkd:handoff') // the next turn writes the handoff
  expect(rec.logs.every(l => LOG_LINE.test(l.line)), rec.logs.map(l => l.line).join('\n')).toBe(true)
})

test('percent 4 with threshold 5: no handoff, and the log names the skip', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, 'x')
  await clock.advance(1000)
  rec.percent = 4
  await turn($)
  expect(bodies(rec).at(-1)).toBe('turn.complete percent=4 limit=5 armed=true fresh=false decision=skip:below-limit base=0 threshold=5 phase=idle window=200000')
  expect(denial(await $.tool.call(READ))).toBeUndefined()
  expect(bodies(rec).at(-1)).toBe('tool.call percent=4 limit=5 armed=true fresh=false decision=skip:below-limit base=0 threshold=5 phase=idle window=200000')
  await clock.advance(1000)
  expect(rec.commands).not.toContain('junkd:handoff')
  rec.percent = 5 // the threshold itself is enough
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
  expect(bodies(rec).at(-1)).toContain('decision=fire')
})

test('an armed loop measured while the window is not fresh keeps no baseline: the limit stays the threshold', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  mock.clock(on)
  await start($)
  await ahandoff($, '')
  await measure($, 9)
  expect(bodies(rec).at(-1)).toBe('session.measure percent=9 limit=5 armed=true fresh=false decision=skip:measure-only base=0 threshold=5 phase=idle window=200000')
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
})

test('a threshold the /config menu stores as a string is compared as a number', { options: { handoff_threshold: 80, handoff_checkEvery: 1 }, ...WITH_CALLER }, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  await start($)
  expect((await menu($, 'threshold', '10')).deny).toBeUndefined()
  expect(await get($, 'threshold')).toBe(10)
  await ahandoff($, '')
  rec.percent = 7 // '7' >= '10' as strings is true; as numbers it is not
  expect(denial(await $.tool.call(READ))).toBeUndefined()
  expect(bodies(rec).at(-1)).toContain('percent=7 limit=10 armed=true fresh=false decision=skip:below-limit')
  rec.percent = 9 // '9' >= '10' as strings is true too, at the turn end
  await turn($)
  expect(bodies(rec).at(-1)).toContain('percent=9 limit=10 armed=true fresh=false decision=skip:below-limit')
  rec.percent = 12
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
})

test('a window with no fill yet (the host sends no percent) measures 0: skip, not a crash', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.noFill = true
  expect(denial(await $.tool.call(READ))).toBeUndefined()
  expect(bodies(rec).at(-1)).toBe('tool.call percent=0 limit=5 armed=true fresh=false decision=skip:below-limit base=0 threshold=5 phase=idle window=200000')
})

test('the log: <config dir>/junkd/handoff/<session>.log, appended; no session id, no write; a failed append never stops the loop', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 3
  await $.tool.call(READ)
  expect(rec.logs.at(-1)?.path).toBe(`${HOME}/.claude/junkd/handoff/sess-1.log`)
  expect(rec.logs.at(-1)?.dir).toBe(`${HOME}/.claude/junkd/handoff`)
  expect(rec.runs.at(-1)).toContain("printf '%s\\n'") // an append (>>), nothing is read back
  expect(rec.runs.at(-1)).toContain('>>')

  const before = rec.logs.length
  rec.sid = undefined
  await $.tool.call(READ)
  rec.sid = '../etc'
  await $.tool.call(READ)
  expect(rec.logs.length).toBe(before)

  rec.sid = 'sess-2'
  rec.logFails = true
  rec.percent = 9
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i) // still fired
})

test('the log follows CLAUDE_CONFIG_DIR', THRESHOLD_5, async ($, on) => {
  on('env.get', { name: 'CLAUDE_CONFIG_DIR' }, () => ({ value: '/cfg' }))
  const rec = world(on)
  mock.clock(on)
  await start($)
  await ahandoff($, '')
  await $.tool.call(READ)
  expect(rec.logs.at(-1)?.path).toBe('/cfg/junkd/handoff/sess-1.log')
})

test('a turn end with the loop off is logged; an unarmed tool call and an agent\'s turn end are not measurements', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  await start($)
  await turn($)
  expect(bodies(rec).at(-1)).toBe('turn.complete percent=0 limit=5 armed=false fresh=false decision=skip:disarmed base=0 threshold=5 phase=idle window=0')
  const n = rec.logs.length
  await $.tool.call(READ)
  await $.turn.complete({ ...TURN, agentId: 'a1' } as never)
  expect(rec.logs.length).toBe(n)
})

test('a turn that dies on the 5h limit logs skip:five-hour-limit', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  mock.clock(on)
  await start($)
  await ahandoff($, '')
  const fiveHour = { kind: 'five_hour', percentUsed: 100, resetsAt: new Date(3_600_000).toISOString() }
  await $.session.measure({ context: usage(10).context, rateLimits: [fiveHour], changed: ['rateLimits'] })
  await $.turn.complete({ ...TURN, reason: 'error' })
  expect(bodies(rec).at(-1)).toContain('decision=skip:five-hour-limit')
})

test('the whole cycle is logged: fire, the denied calls, the retry, the continue, the fresh window and its cleared flag', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, 'do X')
  await clock.advance(1000)
  rec.percent = 7
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
  expect(bodies(rec).at(-1)).toContain('decision=fire')
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i) // denied while the handoff is due
  expect(bodies(rec).at(-1)).toBe('tool.call percent=7 limit=5 armed=true fresh=false decision=skip:phase-handoff base=0 threshold=5 phase=handoff window=200000')
  await turn($) // the model wrote none
  expect(bodies(rec).at(-1)).toContain('decision=cycle:ask-handoff')
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  expect(bodies(rec).at(-1)).toContain('decision=cycle:continue')
  await clock.advance(1000) // clear → handon → continue: fresh until the first measurement of the new window

  await $.tool.call(READ)
  expect(bodies(rec).at(-1)).toBe('tool.call percent=0 limit=5 armed=true fresh=true decision=skip:fresh base=0 threshold=5 phase=idle window=200000')
  rec.percent = 13
  await turn($)
  expect(bodies(rec).at(-1)).toBe('turn.complete percent=13 limit=5 armed=true fresh=true decision=skip:fresh base=0 threshold=5 phase=idle window=200000')
  await measure($, 13)
  expect(bodies(rec).at(-1)).toBe('session.measure percent=13 limit=18 armed=true fresh=false decision=skip:measure-only base=13 threshold=5 phase=idle window=200000 note=base-set,fresh-cleared')
  rec.percent = 17
  expect(denial(await $.tool.call(READ))).toBeUndefined() // growth counts from the baseline
  rec.percent = 18
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)

  // off drops the baseline: armed again, the limit is the threshold
  await ahandoff($, 'off')
  await ahandoff($, '')
  rec.percent = 6
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
  expect(bodies(rec).at(-1)).toContain('percent=6 limit=5')
})

test('a fresh window no threshold can reach disarms the loop and the log says so', { options: { handoff_threshold: 90, handoff_checkEvery: 1 } }, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 95
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  await clock.advance(1000)
  await measure($, 95) // 95 + 90 can never be reached
  expect(bodies(rec).at(-1)).toContain('note=base-set,fresh-cleared,auto-disarmed')
  expect(bodies(rec).at(-1)).toContain('armed=false')
})

test('/junkd:ahandoff status: off or on, the limit, the last measurement and the log path', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  await start($)
  const text = async () => ((await ahandoff($, 'status')) as { text: string }).text
  expect(await text()).toBe(`handoff auto off — threshold 5% — limit 5% — last measurement: none yet — log: ${HOME}/.claude/junkd/handoff/sess-1.log`)
  await ahandoff($, '')
  rec.percent = 3
  await $.tool.call(READ)
  const t = await text()
  expect(t).toMatch(/^handoff auto on — threshold 5% — limit 5% — last measurement: \d{4}-\d\d-\d\dT[\d:.]+Z tool\.call percent=3 limit=5 armed=true fresh=false decision=skip:below-limit base=0 threshold=5 phase=idle window=200000 — log: /)
  expect(t).toContain(`log: ${HOME}/.claude/junkd/handoff/sess-1.log`)
  rec.sid = undefined
  expect(await text()).toContain('log: none (no session id)')
  expect(rec.commands.filter(c => c.startsWith('junkd:ahandoff'))).toEqual([]) // answered by the module; "status" is not a prompt
  expect(rec.prompts).toEqual([])
})

// A reload (a /config change, /reload-plugins, a save in a watched plugin folder) runs register again with S at its
// defaults; $.state keeps what the session's loop was doing.
const KEPT = { plugin: 'junkd', key: 'ahandoff' } as const
const kept = (over: Record<string, unknown>) => ({
  on: true, phase: 'idle', percent: 0, threshold: 5, checkEvery: 1, prompt: 'keep going', lastId: 'abcdef12', count: 2, route: 'auto', paneOpen: false, ...over,
})
// What $.state holds for the loop when the module starts again: the host's answer to the one read.
const seed = (on: On, value: Record<string, unknown>) => {
  let first = true // only the module's first read finds it; the kit's own state answers after that
  on('state.get', KEPT, (_$, e, next) => {
    if (!first) return next(e)
    first = false
    return { value: { value: value as never, version: 1 } }
  })
}

test('a reloaded module takes the armed loop back from $.state: armed, its baseline', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  seed(on, kept({ base: 13, fresh: false }))
  await start($)
  expect(rec.toasts.some(t => /reloaded — auto handoff still on, threshold 5%/.test(t))).toBe(true)
  expect(bodies(rec).at(-1)).toBe('session.start percent=0 limit=18 armed=true fresh=false decision=skip:restored base=13 threshold=5 phase=idle window=0 note=reload')
  rec.percent = 17
  expect(denial(await $.tool.call(READ))).toBeUndefined()
  rec.percent = 18
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
  expect(((await ahandoff($, 'status')) as { text: string }).text).toContain('handoff auto on')
})

test('a reload keeps the fresh window\'s pending measurement and the continuation prompt', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  const clock = mock.clock(on)
  seed(on, kept({ base: 0, fresh: true, prompt: 'keep going' }))
  await start($)
  rec.percent = 30
  expect(denial(await $.tool.call(READ))).toBeUndefined() // fresh: no check
  expect(bodies(rec).at(-1)).toContain('decision=skip:fresh')
  await measure($, 30)
  expect(bodies(rec).at(-1)).toContain('note=base-set,fresh-cleared')
  rec.percent = 60 // 30 + 5 reached: hand off, and the prompt after it is the one the loop had
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_cdef1234.md`, content: '# h' })
  await turn($)
  await handonRuns($, rec, clock, [handonOf('cdef1234')])
  expect(rec.contexts.at(-1)?.join('\n')).toContain('continue as they asked: keep going')
})

test('a kept loop that was off stays off after a reload', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  seed(on, kept({ on: false }))
  await start($)
  expect(rec.toasts.some(t => /reloaded/.test(t))).toBe(false)
  rec.percent = 90
  expect(denial(await $.tool.call(READ))).toBeUndefined()
})

test('nothing kept (a new process): the loop is off, no toast', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  await start($)
  expect(rec.toasts.some(t => /reloaded/.test(t))).toBe(false)
  expect(((await ahandoff($, 'status')) as { text: string }).text).toContain('handoff auto off')
})

test('a kept loop does not come back while the enabled setting is off', { options: { handoff_threshold: 5, handoff_checkEvery: 1, handoff_enabled: false } }, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  seed(on, kept({}))
  await start($)
  expect(rec.toasts.some(t => /reloaded/.test(t))).toBe(false)
  rec.percent = 90
  expect(denial(await $.tool.call(READ))).toBeUndefined()
})

test('a loop the autoOn setting armed is not restored over', { options: { handoff_threshold: 5, handoff_checkEvery: 1, handoff_autoOn: true } }, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  seed(on, kept({ base: 40 }))
  await start($)
  expect(rec.toasts.some(t => /reloaded/.test(t))).toBe(false)
  expect(rec.logs.some(l => l.line.includes('skip:restored'))).toBe(false)
  rec.percent = 6 // the kept baseline 40 was not taken
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
})

test('a window that starts at the threshold itself counts growth from its baseline', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 7
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  await clock.advance(1000)
  await measure($, 5) // the new window opens at 5%: the threshold itself
  expect(bodies(rec).at(-1)).toContain('percent=5 limit=10 armed=true fresh=false decision=skip:measure-only base=5')
  rec.percent = 9
  expect(denial(await $.tool.call(READ))).toBeUndefined()
  rec.percent = 10
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
})

test('a measurement with no percent in it keeps the last one and says so', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  mock.clock(on)
  await start($)
  await $.session.measure({ context: noFill().context, rateLimits: [], changed: ['context'] })
  expect(bodies(rec).at(-1)).toBe('session.measure percent=0 limit=5 armed=false fresh=false decision=skip:measure-only base=0 threshold=5 phase=idle window=200000 note=no-percent')
})

// The cap: a model that never writes the handoff is asked 3 times in all, then the loop disarms.
const asked = (rec: { commands: string[] }) => rec.commands.filter(c => c === 'junkd:handoff').length
for (const via of ['the turn end', 'a tool call'] as const) {
  test(`a model that never writes the handoff is asked 3 times (due at ${via}), then the loop disarms with a toast and a log line`, THRESHOLD_5, async ($, on) => {
    const rec = world(on)
    const clock = mock.clock(on)
    await start($)
    await ahandoff($, '')
    rec.percent = 7
    if (via === 'a tool call') expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
    for (let i = 0; i < 6; i++) {
      await turn($)
      await clock.advance(1000)
    }
    expect(asked(rec)).toBe(3)
    expect(bodies(rec).filter(l => l.includes('decision=cycle:ask-handoff')).length).toBe(via === 'a tool call' ? 3 : 2)
    expect(bodies(rec).filter(l => l.includes('decision=give-up:3-tries')).length).toBe(1)
    expect(rec.toasts).toContain('ahandoff: handoff not written after 3 tries — disarmed')
    expect(((await ahandoff($, 'status')) as { text: string }).text).toContain('handoff auto off')
    expect(denial(await $.tool.call(READ))).toBeUndefined() // no gate any more
    await turn($)
    await clock.advance(1000)
    expect(asked(rec)).toBe(3)
  })
}

test('a written handoff gives the next cycle its 3 tries again', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 7
  await turn($) // fire: ask 1
  await turn($) // miss: ask 2
  await clock.advance(1000)
  expect(asked(rec)).toBe(2)
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  await clock.advance(1000) // cleared and resumed
  await measure($, 7) // the new window opens at 7%: the limit is 12
  rec.percent = 12
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i) // due at a tool call this time: no ask yet
  for (let i = 0; i < 6; i++) {
    await turn($)
    await clock.advance(1000)
  }
  expect(asked(rec)).toBe(2 + 3)
  expect(bodies(rec).filter(l => l.includes('give-up')).length).toBe(1)
})

test('a handoff written on the 3rd (last) ask is continued, not given up: no give-up line, no toast, the loop stays armed', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 7
  await turn($) // fire: ask 1
  await turn($) // miss: ask 2
  await turn($) // miss: ask 3
  await clock.advance(1000)
  expect(asked(rec)).toBe(3)
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($) // the 3rd ask was answered: the turn end continues, it does not give up
  await clock.advance(1000)
  expect(bodies(rec).filter(l => l.includes('give-up')).length).toBe(0)
  expect(bodies(rec).filter(l => l.includes('decision=cycle:continue')).length).toBe(1)
  expect(rec.toasts).not.toContain('ahandoff: handoff not written after 3 tries — disarmed')
  expect(rec.commands).toContain('junkd:handon abcdef12')
  expect(((await ahandoff($, 'status')) as { text: string }).text).toContain('handoff auto on')
  expect(asked(rec)).toBe(3) // no fourth ask either
})

// ---------------------------------------------------------------------------------------------------------------------
// T30: a turn that really starts, and one turn after the handon.

test('the arming prompt is submitted PROMPT_DELAY_MS after the command ended, not at once (the host parks an earlier one)', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  expect(((await ahandoff($, 'read the README')) as { text: string }).text).toBe('handoff auto on — threshold 5% — running: read the README')
  await clock.advance(999)
  expect(rec.prompts).toEqual([])
  await clock.advance(1)
  expect(rec.prompts).toEqual(['read the README']) // one prompt.submit, the exact text
  expect(rec.commands).toEqual([])
})

test('a prompt the host refuses is said in a toast, not left silent', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  rec.dropPrompt = 'blocked by a hook'
  await ahandoff($, 'read the README')
  await clock.advance(1000)
  expect(rec.toasts).toContain('ahandoff: the prompt was refused — blocked by a hook')
})

// /junkd:handon is a skill: the host runs it as a prompt.submit carrying the command (probed live: origin plugin, the
// module's own prompt.submit hook sees it). The test host runs no skill, so the test raises that submission while the
// loop's handon command is held, as the host does, then lets the command end.
const handonOf = (id: string, name = 'junkd:handon') => ({ text: `/${name} ${id}`, command: { name, args: id } }) as never
async function handonRuns($: Engine, rec: { commands: string[]; handonHold?: Promise<void> }, clock: { advance(ms: number): Promise<unknown> }, submissions: never[]) {
  let release!: () => void
  rec.handonHold = new Promise<void>(r => { release = r })
  const advanced = clock.advance(1000)
  for (let i = 0; i < 100 && !rec.commands.some(c => c.startsWith('junkd:handon ')); i++) await new Promise(r => setTimeout(r, 5))
  for (const submission of submissions) await $.prompt.submit(submission)
  release()
  await advanced
  rec.handonHold = undefined
  await new Promise(r => setTimeout(r, 20)) // the chain's own last steps (persist, sync) end before the test does
}

test('the continuation rides the handon submission once, for the right handoff, and no prompt of its own follows', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 7
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  // submissions the host could raise while the loop runs handon: another command, another handoff, the right one twice
  await handonRuns($, rec, clock, [handonOf('abcdef12', 'junkd:orch'), handonOf('zzzzzzzz'), handonOf('abcdef12'), handonOf('abcdef12')])
  expect(rec.prompts).toEqual(['/junkd:orch abcdef12', '/junkd:handon zzzzzzzz', '/junkd:handon abcdef12', '/junkd:handon abcdef12']) // no 'Continue after the handoff' of its own
  expect(rec.contexts.map(c => c?.join('') ?? '')).toEqual(['', '', expect.stringContaining('continue as they asked: Continue after the handoff'), ''])
})

test('a handon that raises no submission leaves the continuation to a prompt of its own', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 7
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  await clock.advance(1000)
  await new Promise(r => setTimeout(r, 20))
  expect(rec.commands).toContain('junkd:handon abcdef12')
  expect(rec.prompts).toEqual(['Continue after the handoff'])
  // the continuation went out on its own: a later handon of the same handoff (the person's) carries nothing
  await $.prompt.submit(handonOf('abcdef12'))
  expect(rec.contexts.at(-1)?.join('') ?? '').toBe('')
})

test('a slash continuation prompt is handed to the model as a command to run, in the same turn', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  seed(on, kept({ prompt: '/junkd:orch all' }))
  await start($)
  rec.percent = 7
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  await handonRuns($, rec, clock, [handonOf('abcdef12')])
  expect(rec.prompts).toEqual(['/junkd:handon abcdef12'])
  expect(rec.commands.filter(c => c.startsWith('junkd:orch'))).toEqual([]) // not a second turn
  expect(rec.contexts.at(-1)?.join('\n')).toContain('run this slash command (the Skill tool, the command name as the skill and the rest as its arguments): /junkd:orch all')
  expect(rec.contexts.at(-1)?.join('\n')).toContain('do not stop after loading it or wait for them')
})

// ---------------------------------------------------------------------------------------------------------------------
// T30 verify round 0: the survivors of the verifier's mutants, one test each, and the sync → $.state → restore round trip.

// The state sync() writes for the loop, as the host would keep it across a reload: part 1 of the round trip captures it,
// parts 2a and 2b hand it back to a module that starts over. (Tests run in file order; 2a and 2b read what part 1 stored.)
const written: Record<string, unknown>[] = []
const captured: { fresh?: Record<string, unknown>; base?: Record<string, unknown> } = {}
const capture = (on: On) => on('state.set', KEPT, (_$, e, next) => { written.push({ ...(e.value as object) }); return next(e) })

test('round trip 1/3: what sync() writes while the loop runs a cycle (the fresh window, then its baseline)', { ...THRESHOLD_5 }, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  capture(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 7
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  await handonRuns($, rec, clock, [])
  captured.fresh = written.at(-1)
  await measure($, 13)
  captured.base = written.at(-1)
  expect(captured.fresh).toMatchObject({ on: true, fresh: true, base: 0, count: 1, lastId: 'abcdef12' })
  expect(captured.base).toMatchObject({ on: true, fresh: false, base: 13, count: 1, lastId: 'abcdef12', prompt: 'Continue after the handoff', threshold: 5 })
})

test('round trip 2/3: a module that starts over takes the baseline, the count and the last id back', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  capture(on)
  mock.clock(on)
  expect(captured.base, 'round trip 1/3 ran first').toBeDefined()
  seed(on, captured.base!)
  written.length = 0
  await start($)
  expect(((await ahandoff($, 'status')) as { text: string }).text).toContain('handoff auto on — threshold 5% — limit 18%') // 13 + 5
  expect(written.at(-1)).toMatchObject({ on: true, base: 13, fresh: false, count: 1, lastId: 'abcdef12' }) // and mirrors them again
  rec.percent = 17
  expect(denial(await $.tool.call(READ))).toBeUndefined()
  rec.percent = 18
  expect(denial(await $.tool.call(READ))).toMatch(/handoff/i)
})

test('round trip 3/3: a module that starts over in a fresh window keeps waiting for its first measurement', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  expect(captured.fresh, 'round trip 1/3 ran first').toBeDefined()
  seed(on, captured.fresh!)
  await start($)
  rec.percent = 30
  expect(denial(await $.tool.call(READ))).toBeUndefined()
  expect(bodies(rec).at(-1)).toContain('fresh=true decision=skip:fresh')
})

test('a turn end exactly at the threshold hands off (>=, as a tool call does)', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 4
  await turn($)
  expect(bodies(rec).at(-1)).toContain('decision=skip:below-limit')
  rec.percent = 5
  await turn($)
  expect(bodies(rec).at(-1)).toBe('turn.complete percent=5 limit=5 armed=true fresh=false decision=fire base=0 threshold=5 phase=idle window=200000')
  await clock.advance(1000) // the handoff asked for runs before the test ends
  expect(rec.commands).toContain('junkd:handoff')
})

test('a measurement with no percent leaves the fresh window waiting: no baseline, the flag stays', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 7
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  await handonRuns($, rec, clock, [])
  await $.session.measure({ context: noFill().context, rateLimits: [], changed: ['context'] })
  expect(bodies(rec).at(-1)).toBe('session.measure percent=0 limit=5 armed=true fresh=true decision=skip:measure-only base=0 threshold=5 phase=idle window=200000 note=no-percent')
  await measure($, 13)
  expect(bodies(rec).at(-1)).toContain('fresh=false decision=skip:measure-only base=13')
})

test('a read of $.state that fails at startup leaves the loop off and the session starting', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  capture(on)
  written.length = 0
  let first = true
  on('state.get', KEPT, (_$, e, next) => {
    if (!first) return next(e)
    first = false
    return { deny: 'state unavailable' } as never // the read rejects with the reason
  })
  await start($) // resolves: the restore's read is allowed to fail
  expect(written.at(-1)).toMatchObject({ on: false }) // and the start went on to mirror the loop
  expect(rec.toasts.some(t => /reloaded/.test(t))).toBe(false)
  expect(((await ahandoff($, 'status')) as { text: string }).text).toContain('handoff auto off')
})

test('only the word status is the status command: a prompt that starts with it is a prompt', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  const clock = mock.clock(on)
  await start($)
  expect(((await ahandoff($, 'status report of the build')) as { text: string }).text).toBe('handoff auto on — threshold 5% — running: status report of the build')
  await clock.advance(1000)
  expect(rec.prompts).toEqual(['status report of the build'])
})

test('the log writer makes the folder before it appends', THRESHOLD_5, async ($, on) => {
  const rec = world(on)
  mock.clock(on)
  await start($)
  await ahandoff($, '')
  await $.tool.call(READ)
  const script = rec.runs.find(r => r.includes('>>')) ?? ''
  expect(script).toContain('mkdir -p -- "$1" && printf')
})

test('a fresh window that leaves exactly 100 as the limit disarms too (nothing above 100 is reachable, 100 only at the very end)', { options: { handoff_threshold: 50, handoff_checkEvery: 1 } }, async ($, on) => {
  const rec = world(on)
  passMeasure(on)
  const clock = mock.clock(on)
  await start($)
  await ahandoff($, '')
  rec.percent = 60
  await $.tool.call({ tool: 'Write', file_path: `${DIR}/2026-01-01T00-00_abcdef12.md`, content: '# h' })
  await turn($)
  await clock.advance(1000)
  await new Promise(r => setTimeout(r, 20))
  await measure($, 50) // the window opens at the threshold: 50 + 50 = 100
  expect(bodies(rec).at(-1)).toContain('note=base-set,fresh-cleared,auto-disarmed')
})
