// junkd's statusline group: `$.junkd` (schema, get, set, open) on the statusline_* rows, the /config menu's writes to
// them, bin/statusline-setup on|off run for the enabled row (a refusal is the deny, the row stays), the refresh of the
// installed copy at session start, /junkd:statusline, and the statusline pane (rows, hotkeys, preview, close). The
// whole module loads; everything beneath the plugin is answered from memory by `world`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'
import { FIELDS, SEGMENTS, plain } from './statusline-views'

const HOME = '/home/u'
const CFG = `${HOME}/.claude`
const COPY = `${CFG}/junkd/statusline.sh` // what statusline-setup on installs and settings.json points at
const SCRIPT = '#!/usr/bin/env bash\n# the renderer\n'
const KEYS = ['statusline_enabled', ...SEGMENTS.map(s => `statusline_${s}`)]
const TRUE_SPELLINGS = [true, 'true', 'on'] as const
const FALSE_SPELLINGS = [false, 'false', 'off', 'maybe', 1, 0] as const
// What the renderer prints for the preview: colours, the dim │, a newline.
const LINE = '\x1b[36mctx 139k free / 61k used (30%)\x1b[0m\x1b[2m │ \x1b[0m\x1b[1;34mpreview\x1b[0m\n'
const SHOWN = 'ctx 139k free / 61k used (30%) │ preview'

type Run = { argv: string[]; stdin?: string; env?: Record<string, string> }
// The world's knobs: `setup` answers statusline-setup (by mode: exit code and stdout, or `throw`); `preview` the
// renderer's stdout and exit; `copy` the installed copy (undefined: none); `script` the plugin's own renderer.
type Opts = {
  env?: Record<string, string>
  setup?: Partial<Record<'on' | 'off' | 'status', { exitCode?: number; stdout?: string; stderr?: string } | 'throw'>>
  preview?: { stdout: string; exitCode?: number }
  copy?: string
  script?: string
  panes?: { id: string }[]
}
function world(on: On, o: Opts = {}) {
  mock.store(on)
  mock.env(on, o.env ?? { HOME })
  const rec = {
    config: [] as { key: string; value: unknown }[],
    runs: [] as Run[],
    toasts: [] as string[],
    log: [] as string[],
    files: new Map<string, string>(),
    o,
  }
  const cfg = o.env?.CLAUDE_CONFIG_DIR ?? CFG
  if (o.copy !== undefined) rec.files.set(`${cfg}/junkd/statusline.sh`, o.copy)
  const result = (exitCode = 0, stdout = '', stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('ui.panes', () => ({ value: (o.panes ?? []) as never }))
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('ui.open', (_$, e) => { rec.log.push(`ui.open ${e.id}${e.focus ? ' focus' : ''} ${e.title}`); return { value: { isPlaced: true as const } } })
  on('ui.close', (_$, e) => { rec.log.push(`ui.close ${e.id}`); return { value: undefined } })
  on('ui.focus', () => ({}))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: {} }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/proj' }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('fs.stat', () => ({ value: { kind: 'other', size: 0, mtimeMs: 0 } as never }))
  on('fs.exists', (_$, e) => ({ value: rec.files.has(e.path) }))
  on('fs.write', (_$, e) => { rec.files.set(e.path, e.text); return { value: undefined } })
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('/bin/statusline.sh') && !e.path.startsWith(cfg)) {
      if (o.script === undefined && 'script' in o) throw new Error(`ENOENT ${e.path}`)
      return { value: o.script ?? SCRIPT }
    }
    if (!rec.files.has(e.path)) throw new Error(`ENOENT ${e.path}`)
    return { value: rec.files.get(e.path)! }
  })
  on('process.run', (_$, e) => {
    const run: Run = { argv: [...e.argv], stdin: e.init?.stdin, env: e.init?.env }
    rec.runs.push(run)
    const bin = e.argv[0] ?? ''
    if (bin.endsWith('/bin/statusline-setup')) {
      const mode = e.argv[1] as 'on' | 'off' | 'status'
      const a = o.setup?.[mode]
      if (a === 'throw') throw new Error('spawn EACCES')
      const ok = (a?.exitCode ?? 0) === 0
      if (ok && mode === 'on') rec.files.set(`${cfg}/junkd/statusline.sh`, o.script ?? SCRIPT)
      if (ok && mode === 'off') rec.files.delete(`${cfg}/junkd/statusline.sh`)
      return result(a?.exitCode ?? 0, a?.stdout ?? (a ? '' : mode === 'status' ? 'on\n' : `statusline: ${mode}\n`), a?.stderr ?? '')
    }
    if (bin.endsWith('/bin/statusline.sh')) return result(o.preview?.exitCode ?? 0, o.preview?.stdout ?? LINE)
    if (bin === 'rm') rec.files.delete(e.argv.at(-1)!)
    return result()
  })
  return rec
}
const setups = (rec: { runs: Run[] }) => rec.runs.filter(r => r.argv[0]!.endsWith('/bin/statusline-setup'))
const previews = (rec: { runs: Run[] }) => rec.runs.filter(r => r.argv[0]!.endsWith('/bin/statusline.sh'))
const start = ($: Engine) => $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })

// `/frame <method> [json]`: `$.junkd.<method>`, or `$.config.set` for `config` (the /config menu's own path).
const FRAME: Plugin = {
  name: 'frame',
  register(on) {
    on('command.run', { command: 'frame' }, async ($, e) => {
      const [method = '', ...rest] = e.args.trim().split(/\s+/)
      const input = rest.length ? JSON.parse(rest.join(' ')) : undefined
      try {
        if (method === 'schema') return { text: JSON.stringify({ ok: await $.junkd.schema() }) }
        if (method === 'get') return { text: JSON.stringify({ ok: await $.junkd.get(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.junkd.set(input) }) }
        if (method === 'open') return { text: JSON.stringify({ ok: (await $.junkd.open(input)) ?? null }) }
        if (method === 'config') return { text: JSON.stringify({ ok: await $.config.set(input) }) }
        if (method === 'shut') {
          await $.ui.close({ id: 'statusline' })
          return { text: JSON.stringify({ ok: null }) }
        }
        return { text: JSON.stringify({ error: `no method ${method}` }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
  },
}
const HOST: Plugin = {
  name: 'host',
  tier: 'prepend',
  register(on) {
    on('config.set', (_$, e, next) => (next.origin.plugin === 'junkd' ? next.to(e, 'append') : next(e)))
  },
}
const W = { plugins: [HOST, FRAME] }
const withOptions = (options: Record<string, boolean>) => ({ ...W, options })
const composer = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
async function frame($: Engine, method: string, input?: unknown): Promise<unknown> {
  const args = input === undefined ? method : `${method} ${JSON.stringify(input)}`
  const r = (await $.command.run({ command: 'frame', args, ...composer })) as { text?: string }
  const out = JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}
const get = ($: Engine, key: string) => frame($, 'get', { key })
const set = ($: Engine, key: string, value: unknown) => frame($, 'set', { key, value })
const menu = async ($: Engine, key: string, value: unknown) => (await frame($, 'config', { key: `junkd.${key}`, value })) as { value?: unknown; deny?: string }
const command = ($: Engine, args: string) => $.command.run({ command: 'junkd:statusline', args, ...composer })
const PANE = { component: 'Pane', requestId: 'statusline', props: { title: 'statusline', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const mount = ($: Engine, surface: 'terminal' | 'mobile' = 'terminal') => $.ui.mount({ plugin: 'junkd', surface: surface as never, ...PANE })
const REFUSED = 'statusline-setup: settings.json has a statusLine of your own (/my/line.sh); not replaced (on --force replaces it)'

// ------------------------------------------------------------------ schema, defaults, options

test('the statusline rows mirror the manifest: enabled, then the six segments; all on by default; only enabled is main', W, async ($, on) => {
  world(on)
  await start($)
  const schema = ((await frame($, 'schema')) as { key: string; group: string; field: string; type: string; default: unknown; main: boolean }[]).filter(f => f.group === 'statusline')
  expect(schema.map(f => f.key)).toEqual(KEYS)
  expect(schema.map(f => f.field)).toEqual([...FIELDS])
  expect(schema.map(f => f.main)).toEqual([true, false, false, false, false, false, false])
  for (const f of schema) {
    expect(f.type, f.key).toBe('boolean')
    expect(f.default, f.key).toBe(true)
    expect(await get($, f.key), f.key).toBe(true)
  }
})
for (const field of FIELDS) {
  test(`a statusline_${field} option of false at load is what get answers`, withOptions({ [`statusline_${field}`]: false }), async ($, on) => {
    world(on, { copy: SCRIPT })
    await start($)
    for (const f of FIELDS) expect(await get($, `statusline_${f}`), f).toBe(f !== field)
  })
}

// ------------------------------------------------------------------ segments: plain rows

for (const seg of SEGMENTS) {
  test(`set statusline_${seg}: the row coerced (true, 'true', 'on' on; the rest off), no script run`, W, async ($, on) => {
    const rec = world(on, { copy: SCRIPT })
    await start($)
    for (const v of FALSE_SPELLINGS) {
      expect(await set($, `statusline_${seg}`, v), String(v)).toBe(false)
      expect(await get($, `statusline_${seg}`)).toBe(false)
    }
    for (const v of TRUE_SPELLINGS) {
      expect(await set($, `statusline_${seg}`, v), String(v)).toBe(true)
      expect(await get($, `statusline_${seg}`)).toBe(true)
    }
    expect(rec.config.map(c => c.key)).toEqual(Array(FALSE_SPELLINGS.length + TRUE_SPELLINGS.length).fill(`junkd.statusline_${seg}`))
    expect(rec.config.map(c => c.value)).toEqual([...FALSE_SPELLINGS.map(() => false), ...TRUE_SPELLINGS.map(() => true)])
    expect(setups(rec)).toEqual([])
  })
}
for (const v of [...TRUE_SPELLINGS, ...FALSE_SPELLINGS]) {
  test(`the /config menu's junkd.statusline_model ${JSON.stringify(v)} is ${TRUE_SPELLINGS.includes(v as never) ? 'on' : 'off'}: the row and get follow`, W, async ($, on) => {
    const rec = world(on, { copy: SCRIPT })
    await start($)
    const want = TRUE_SPELLINGS.includes(v as never)
    if (want) await set($, 'statusline_model', false)
    expect(await menu($, 'statusline_model', v)).toEqual({ value: want })
    expect(rec.config.at(-1)).toEqual({ key: 'junkd.statusline_model', value: want })
    expect(await get($, 'statusline_model')).toBe(want)
  })
}

// ------------------------------------------------------------------ enabled: statusline-setup on|off first

test('set enabled false runs statusline-setup off, true runs on, each before the row; the config dir goes along', { ...W }, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, env: { HOME, CLAUDE_CONFIG_DIR: '/cfg' } })
  await start($)
  expect(await set($, 'statusline_enabled', false)).toBe(false)
  expect(setups(rec).map(r => r.argv.slice(1))).toEqual([['off']])
  expect(setups(rec)[0]!.argv[0]).toMatch(/\/bin\/statusline-setup$/)
  expect(setups(rec)[0]!.env).toEqual({ CLAUDE_CONFIG_DIR: '/cfg' })
  expect(rec.config).toEqual([{ key: 'junkd.statusline_enabled', value: false }])
  expect(await get($, 'statusline_enabled')).toBe(false)
  expect(await set($, 'statusline_enabled', 'on')).toBe(true)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['off', 'on'])
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.statusline_enabled', value: true })
})
for (const v of TRUE_SPELLINGS) {
  test(`the /config menu's junkd.statusline_enabled ${JSON.stringify(v)} runs statusline-setup on, then the row`, withOptions({ statusline_enabled: false }), async ($, on) => {
    const rec = world(on)
    await start($)
    expect(await menu($, 'statusline_enabled', v)).toEqual({ value: true })
    expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
    expect(rec.config).toEqual([{ key: 'junkd.statusline_enabled', value: true }])
    expect(await get($, 'statusline_enabled')).toBe(true)
  })
}
for (const v of FALSE_SPELLINGS) {
  test(`the /config menu's junkd.statusline_enabled ${JSON.stringify(v)} runs statusline-setup off, then the row`, W, async ($, on) => {
    const rec = world(on, { copy: SCRIPT })
    await start($)
    expect(await menu($, 'statusline_enabled', v)).toEqual({ value: false })
    expect(setups(rec).map(r => r.argv[1])).toEqual(['off'])
    expect(await get($, 'statusline_enabled')).toBe(false)
  })
}

test("a refused statusline-setup on (a statusLine of the person's own) is the deny: the reason, no row, enabled stays off", withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { setup: { on: { exitCode: 1, stdout: `${REFUSED}\n` } } })
  await start($)
  await expect(set($, 'statusline_enabled', true)).rejects.toThrow(REFUSED)
  expect((await menu($, 'statusline_enabled', true)).deny).toBe(REFUSED)
  expect(rec.config).toEqual([])
  expect(await get($, 'statusline_enabled')).toBe(false)
})
test('a failing statusline-setup with only stderr, or none, or a run that cannot start, is the deny too', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { setup: { on: { exitCode: 1, stderr: 'statusline-setup: needs jq\n' }, off: { exitCode: 3 } } })
  await start($)
  await expect(set($, 'statusline_enabled', true)).rejects.toThrow('statusline-setup: needs jq')
  rec.o.setup = { off: { exitCode: 3 } }
  await set($, 'statusline_enabled', 'off') // already off: the script runs and exits 3
    .then(() => { throw new Error('not refused') }, err => expect(String(err)).toMatch(/statusline-setup off exited 3/))
  rec.o.setup = { on: 'throw' }
  await expect(set($, 'statusline_enabled', true)).rejects.toThrow(/statusline-setup on did not run: /) // the kit skips a throwing hook: the run rejects
  expect(rec.config).toEqual([])
  expect(await get($, 'statusline_enabled')).toBe(false)
})
test('a denied statusline_enabled row runs the other mode to put settings.json back, by set and by the menu', W, async ($, on) => {
  on('config.set', { key: 'junkd.statusline_enabled' }, () => ({ deny: 'locked' }))
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await expect(set($, 'statusline_enabled', false)).rejects.toThrow(/locked/)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['off', 'on'])
  expect((await menu($, 'statusline_enabled', false)).deny).toBe('locked')
  expect(setups(rec).map(r => r.argv[1])).toEqual(['off', 'on', 'off', 'on'])
  expect(await get($, 'statusline_enabled')).toBe(true)
  expect(rec.config).toEqual([])
})

// ------------------------------------------------------------------ session start

test('session start while enabled with no installed copy runs statusline-setup on (a fresh install wires the line)', W, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
  expect(rec.config, 'no row').toEqual([])
})
test('session start while enabled with the copy the plugin ships runs nothing', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  expect(setups(rec)).toEqual([])
})
test('session start while enabled with an older copy (a plugin update) runs statusline-setup on', W, async ($, on) => {
  const rec = world(on, { copy: '#!/usr/bin/env bash\n# an older renderer\n' })
  await start($)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
})
test('session start while disabled runs nothing, the copy missing or not', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on)
  await start($)
  expect(setups(rec)).toEqual([])
})
test("session start: a refusal of on (the person's own statusLine) is silent: no toast, no note, the start resolves", W, async ($, on) => {
  const rec = world(on, { setup: { on: { exitCode: 1, stdout: `${REFUSED}\n` } } })
  await start($)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
  expect(rec.toasts).toEqual([])
  await command($, '')
  const pane = await mount($)
  expect((await pane.find({ key: 'note' }))?.text).not.toMatch(/✗/)
})
test('session start follows CLAUDE_CONFIG_DIR for the installed copy and the script', W, async ($, on) => {
  const rec = world(on, { env: { HOME, CLAUDE_CONFIG_DIR: '/cfg' }, copy: SCRIPT })
  await start($)
  expect(setups(rec)).toEqual([])
  rec.files.set('/cfg/junkd/statusline.sh', 'old')
  await start($)
  expect(setups(rec).map(r => r.env)).toEqual([{ CLAUDE_CONFIG_DIR: '/cfg' }])
})
test('session start: a plugin renderer that cannot be read runs on (the script copies it, or says why)', { ...W }, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, script: undefined })
  await start($)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
})

// ------------------------------------------------------------------ the pane

test('/junkd:statusline toggles the pane: title, the enabled switch and six segment switches a-g, the preview, q closes', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  expect(rec.log).toEqual(['ui.open statusline focus statusline'])
  const pane = await mount($)
  expect((await pane.find({ type: 'Text', text: 'statusline' }))?.props.color).toBe('claude')
  for (const [i, f] of FIELDS.entries()) {
    const b = await pane.find({ type: 'Button', key: `set:${f}` })
    expect(b?.props.hotkey, f).toBe('abcdefg'[i])
    expect(b?.text, f).toBe('off') // on now: the button turns it off
    expect((await pane.find({ type: 'Box', key: `${f}-pill` }))?.text, f).toBe(' on ')
  }
  expect((await pane.find({ type: 'Box', key: 'preview' }))?.text).toBe(SHOWN)
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys a-g switch  tab move  q close')
  // the preview: the renderer on the sample session, with the config dir it reads the segments from
  expect(previews(rec)).toHaveLength(1)
  const sample = JSON.parse(previews(rec)[0]!.stdin!)
  expect(sample).toEqual({
    model: { display_name: 'preview' },
    cwd: '/work/proj',
    workspace: { current_dir: '/work/proj' },
    context_window: { context_window_size: 200000, total_input_tokens: 61000, total_output_tokens: 0, used_percentage: 30.5 },
    rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 33 } },
  })
  expect(previews(rec)[0]!.env).toEqual({ CLAUDE_CONFIG_DIR: CFG })
  // a flip: the row through the group's set, the note, the preview run again
  await pane.press({ key: 'set:model' })
  expect(rec.config).toEqual([{ key: 'junkd.statusline_model', value: false }])
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ model off')
  expect((await pane.find({ type: 'Button', key: 'set:model' }))?.text).toBe('on')
  expect((await pane.find({ type: 'Box', key: 'model-pill' }))?.text).toBe(' off ')
  expect(previews(rec)).toHaveLength(2)
  await pane.press({ key: 'set:enabled' })
  expect(setups(rec).map(r => r.argv[1])).toEqual(['off'])
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ enabled off')
  expect(previews(rec)).toHaveLength(3)
  await pane.press({ key: 'close' })
  expect(rec.log.at(-1)).toBe('ui.close statusline')
  await command($, '')
  expect(rec.log.at(-1), 'closed by q: the next toggle opens').toBe('ui.open statusline focus statusline')
  await command($, '')
  expect(rec.log.at(-1)).toBe('ui.close statusline')
})
test("the pane's refused flip is the note (✗ and the reason); the row and the switch stay", withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { setup: { on: { exitCode: 1, stdout: `${REFUSED}\n` } } })
  await start($)
  await command($, '')
  const pane = await mount($)
  await pane.press({ key: 'set:enabled' })
  expect((await pane.find({ key: 'note' }))?.text).toBe(`✗ ${REFUSED}`)
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' off ')
  expect(rec.config).toEqual([])
})
test('a preview the renderer cannot draw (exit non-zero) says so; a line of control characters is drawn plain', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, preview: { stdout: 'junk', exitCode: 1 } })
  await start($)
  await command($, '')
  const pane = await mount($)
  expect((await pane.find({ type: 'Box', key: 'preview' }))?.text).toBe('(nothing to draw)')
  rec.o.preview = { stdout: '\x1b[1;38;2;239;68;68m88%\x1b[0m\tx\x07\n' }
  await pane.press({ key: 'set:ctx' })
  expect((await pane.find({ type: 'Box', key: 'preview' }))?.text).toBe('88% x')
})
test('plain: the colours out, other control characters a space, the end trimmed', () => {
  expect(plain(LINE)).toBe(SHOWN)
  expect(plain('a\x1b[2mb\x1b[0m\rc\n\n')).toBe('ab c')
})
test("the person's close (another plugin's $.ui.close) is seen: the next /junkd:statusline opens", W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  await frame($, 'shut')
  await command($, '')
  expect(rec.log).toEqual(['ui.open statusline focus statusline', 'ui.close statusline', 'ui.open statusline focus statusline'])
})
test("$.junkd.open({ pane: 'statusline' }) toggles the pane; a route is refused", W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  expect(await frame($, 'open', { pane: 'statusline' })).toBe(null)
  expect(rec.log).toEqual(['ui.open statusline focus statusline'])
  await frame($, 'open', { pane: 'statusline' })
  expect(rec.log).toEqual(['ui.open statusline focus statusline', 'ui.close statusline'])
  await expect(frame($, 'open', { pane: 'statusline', route: 'settings' })).rejects.toThrow(/the statusline pane has no tab settings/)
  expect(rec.log).toHaveLength(2)
})
test('the mobile surface gets the engine pane, not ours', W, async ($, on) => {
  world(on, { copy: SCRIPT })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  const pane = await mount($, 'mobile')
  expect(await pane.find({ key: 'engine' })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'close' })).toBeUndefined()
})

// ------------------------------------------------------------------ /junkd:statusline on|off|status

test('/junkd:statusline off and on set the enabled row through statusline-setup; each says so in a toast', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, 'off')
  expect(setups(rec).map(r => r.argv[1])).toEqual(['off'])
  expect(rec.config).toEqual([{ key: 'junkd.statusline_enabled', value: false }])
  expect(rec.toasts.at(-1)).toBe('✓ statusline off')
  await command($, ' on ')
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.statusline_enabled', value: true })
  expect(rec.toasts.at(-1)).toBe('✓ statusline on')
  expect(rec.log, 'no pane').toEqual([])
})
test('/junkd:statusline on refused: a ✗ toast with the reason, no row', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { setup: { on: { exitCode: 1, stdout: `${REFUSED}\n` } } })
  await start($)
  await command($, 'on')
  expect(rec.toasts.at(-1)).toBe(`✗ ${REFUSED}`)
  expect(rec.config).toEqual([])
})
test('/junkd:statusline status toasts what statusline-setup status says, and the segments that are off', withOptions({ statusline_model: false, statusline_limits: false }), async ($, on) => {
  const rec = world(on, { copy: SCRIPT, setup: { status: { stdout: 'off (/my/line.sh)\n' } } })
  await start($)
  await command($, 'status')
  expect(setups(rec).map(r => r.argv[1])).toEqual(['status'])
  expect(rec.toasts.at(-1)).toBe('statusline: off (/my/line.sh); segments off: model, limits')
  rec.o.setup = {}
  await set($, 'statusline_model', true)
  await set($, 'statusline_limits', true)
  await command($, 'status')
  expect(rec.toasts.at(-1)).toBe('statusline: on')
  rec.o.setup = { status: { exitCode: 1, stderr: 'statusline-setup: x does not parse\n' } }
  await command($, 'status')
  expect(rec.toasts.at(-1)).toBe('✗ statusline-setup: x does not parse')
  expect(rec.config.map(c => c.key)).toEqual(['junkd.statusline_model', 'junkd.statusline_limits'])
})
test('/junkd:statusline with another argument: a usage toast, nothing run or written', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, 'bogus')
  expect(rec.toasts.at(-1)).toBe('✗ usage: /junkd:statusline [on | off | status]')
  expect(setups(rec)).toEqual([])
  expect(rec.config).toEqual([])
})
