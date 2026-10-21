// junkd's statusline group: `$.junkd` (schema, get, set, open) on the statusline_* rows, the /config menu's writes to
// them, bin/statusline-setup on|off run for the enabled row (a refusal is the deny, the row stays), the refresh of the
// installed copy at session start, /junkd:statusline, and the statusline pane (rows, hotkeys, preview, close). The
// whole module loads; everything beneath the plugin is answered from memory by `world`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'
import { configNote, pluginKey } from './statusline'

// Pinned here, not imported: a change of the module's waits is a change of behaviour the tests must notice.
const SETTLE_MS = 100 // one look at the host's copy every 100 ms ...
const SETTLE_TRIES = 50 // ... 50 times: the wait ends after 5 s
const VERIFY_MS = 3000 // the second look at session start, 3 s later
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
const KEY = 'junkd@inline' // the pluginConfigs key of a --plugin-dir session: the test plugin's root is no cache folder
const WIRED = `${COPY} --config ${KEY}` // the statusLine command statusline-setup on --config <KEY> writes
const wiredSettings = { statusLine: { type: 'command', command: WIRED } }

type Run = { argv: string[]; stdin?: string; env?: Record<string, string> }
// The world's knobs: `setup` answers statusline-setup (by mode: exit code and stdout, or `throw`); `preview` the
// renderer's stdout and exit; `copy` the installed copy (undefined: none); `script` the plugin's own renderer;
// `settings` the user's settings.json as an object (default: the line wired to WIRED when a copy is installed, else
// no file); statusline-setup on and off edit it as the script does.
type Opts = {
  settings?: Record<string, unknown>
  env?: Record<string, string>
  setup?: Partial<Record<'on' | 'off' | 'status', { exitCode?: number; stdout?: string; stderr?: string } | 'throw'>>
  preview?: { stdout: string; exitCode?: number }
  copy?: string
  script?: string
  panes?: { id: string }[]
  // The host keeps its own copy of settings.json (the `statusLine` of its snapshot) and writes it back whole with a /config
  // row (`config.set`). hostLag: how many settle sleeps (SETTLE_MS) it takes to read the file again after
  // statusline-setup changed it: 0 (default) at once, Infinity never.
  hostLag?: number
  // No `settings.read` beneath the plugin: the call rejects, as it does in a world that does not model the host.
  noSettingsRead?: boolean
  // What the plugin's $.store holds when the world starts: the state a copy of the module that was running before a reload
  // left behind.
  store?: Record<string, unknown>
  // The first `statusline-setup on` does not answer until the test calls rec.releaseOn(): a script that is still writing
  // settings.json.
  holdOn?: boolean
  // The first look of the wait for the host (the sleep of SETTLE_MS) does not end until the test calls rec.releaseSettle().
  holdSettle?: boolean
}
function world(on: On, o: Opts = {}) {
  mock.env(on, o.env ?? { HOME })
  const rec = {
    config: [] as { key: string; value: unknown }[],
    runs: [] as Run[],
    toasts: [] as string[],
    log: [] as string[],
    files: new Map<string, string>(),
    // Everything the module asked of the world in order, for the tests that pin an order: `setup <mode>`, `sleep <ms>`,
    // `config.set <key>`.
    order: [] as string[],
    // The host's snapshot of the user's statusLine (undefined: none), what `settings.read` answers and what a row's write
    // puts back into the file.
    host: { line: undefined as unknown, behind: 0 },
    // The `source` of every settings.read the module made.
    reads: [] as (string | undefined)[],
    // The plugin's $.store (what survives a reload of the module), and what it held at each write of a row.
    kept: new Map<string, unknown>(Object.entries(o.store ?? {})),
    keptAtWrite: [] as unknown[],
    releaseOn: () => {},
    releaseSettle: () => {},
    // Releases the sleeps of VERIFY_MS the module started and lets what follows them run.
    verify: async () => {},
    o,
  }
  const verifying: (() => void)[] = []
  let held = false
  let heldSettle = false
  rec.verify = async () => {
    verifying.splice(0).forEach(release => release())
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0))
  }
  const cfg = o.env?.CLAUDE_CONFIG_DIR ?? CFG
  if (o.copy !== undefined) rec.files.set(`${cfg}/junkd/statusline.sh`, o.copy)
  const settingsPath = `${cfg}/settings.json`
  const initial = o.settings ?? (o.copy !== undefined ? wiredSettings : undefined)
  if (initial !== undefined) rec.files.set(settingsPath, JSON.stringify(initial))
  const edit = (change: (s: Record<string, unknown>) => void) => {
    const s = JSON.parse(rec.files.get(settingsPath) ?? '{}') as Record<string, unknown>
    change(s)
    rec.files.set(settingsPath, JSON.stringify(s))
  }
  const fileLine = () => (JSON.parse(rec.files.get(settingsPath) ?? '{}') as Record<string, unknown>).statusLine
  const lag = o.hostLag ?? 0
  rec.host.line = fileLine()
  // What the host holds: the file as it is now when it keeps up (lag 0), else its snapshot, which statusline-setup's change
  // of the file brings up to date after `lag` settle sleeps.
  const hostLine = () => (lag === 0 ? fileLine() : rec.host.line)
  const changed = () => {
    rec.host.behind = lag === 0 ? 0 : lag
  }
  const result = (exitCode = 0, stdout = '', stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('ui.panes', () => ({ value: (o.panes ?? []) as never }))
  on('store.get', (_$, e) => ({ value: rec.kept.get(e.key) }))
  on('store.set', (_$, e) => { rec.kept.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_$, e) => { rec.kept.delete(e.key); return { value: undefined } })
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('ui.open', (_$, e) => { rec.log.push(`ui.open ${e.id}${e.focus ? ' focus' : ''} ${e.title}`); return { value: { isPlaced: true as const } } })
  on('ui.close', (_$, e) => { rec.log.push(`ui.close ${e.id}`); return { value: undefined } })
  on('ui.focus', () => ({}))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  if (!o.noSettingsRead) {
    on('settings.read', (_$, e) => {
      rec.reads.push((e as { source?: string }).source)
      const line = hostLine()
      return { value: line === undefined ? {} : { statusLine: line } }
    })
  }
  on('clock.sleep', (_$, e) => {
    rec.order.push(`sleep ${e.ms}`)
    if (e.ms === VERIFY_MS) return new Promise<{ value: undefined }>(release => verifying.push(() => release({ value: undefined })))
    if (e.ms === SETTLE_MS && o.holdSettle && !heldSettle) {
      heldSettle = true
      return new Promise<{ value: undefined }>(release => { rec.releaseSettle = () => release({ value: undefined }) })
    }
    if (rec.host.behind > 0 && --rec.host.behind === 0) rec.host.line = fileLine()
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/work/proj' }))
  on('config.set', (_$, e) => {
    rec.order.push(`config.set ${e.key}`)
    rec.keptAtWrite.push(rec.kept.get('statusline-pane'))
    rec.config.push({ key: e.key, value: e.value })
    // The host writes its copy of the file back whole: its statusLine replaces the file's.
    const line = hostLine()
    if (line !== fileLine()) edit(s => { if (line === undefined) delete s.statusLine; else s.statusLine = line })
    return { value: e.value }
  })
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
      rec.order.push(`setup ${mode}`)
      const a = o.setup?.[mode]
      if (a === 'throw') throw new Error('spawn EACCES')
      const ok = (a?.exitCode ?? 0) === 0
      const run = () => {
        if (ok && mode === 'on') {
          rec.files.set(`${cfg}/junkd/statusline.sh`, o.script ?? SCRIPT)
          const key = e.argv[2] === '--config' ? e.argv[3] : undefined
          edit(s => { s.statusLine = { type: 'command', command: key ? `${cfg}/junkd/statusline.sh --config ${key}` : `${cfg}/junkd/statusline.sh` } })
          changed()
        }
        if (ok && mode === 'off') {
          rec.files.delete(`${cfg}/junkd/statusline.sh`)
          edit(s => { delete s.statusLine })
          changed()
        }
        return result(a?.exitCode ?? 0, a?.stdout ?? (a ? '' : mode === 'status' ? 'on\n' : `statusline: ${mode}\n`), a?.stderr ?? '')
      }
      if (mode === 'on' && o.holdOn && !held) {
        held = true
        return new Promise<ReturnType<typeof run>>(release => { rec.releaseOn = () => release(run()) })
      }
      return run()
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

// ------------------------------------------------------------------ T29: the key the line reads (--config <key>)

test('pluginKey: a cache folder is junkd@<marketplace>, any other directory is junkd@inline', () => {
  expect(pluginKey('/home/u/.claude/plugins/cache/junk-drawer/junkd/0.11.2')).toBe('junkd@junk-drawer')
  expect(pluginKey('/home/u/.claude/plugins/cache/junk-drawer/junkd/0.11.2/')).toBe('junkd@junk-drawer')
  expect(pluginKey('/x/cfg/plugins/cache/other-mkt/junkd/1.0.0')).toBe('junkd@other-mkt')
  expect(pluginKey('/home/u/work/junk-drawer/plugins/junkd')).toBe('junkd@inline')
  expect(pluginKey('/home/u/.claude/plugins/cache/junk-drawer/other/0.1.0')).toBe('junkd@inline') // another plugin's folder
  expect(pluginKey('/home/u/.claude/plugins/cache/junk-drawer/junkd')).toBe('junkd@inline') // no version folder
})
test('"wired on" names the key: the menu, set and /junkd:statusline on pass --config; off passes none', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { copy: SCRIPT, settings: {} })
  await start($)
  expect(setups(rec).map(r => r.argv.slice(1)), 'session start with the row off runs nothing').toEqual([])
  await menu($, 'statusline_enabled', true)
  await set($, 'statusline_enabled', false)
  await set($, 'statusline_enabled', true)
  await command($, 'off')
  await command($, 'on')
  expect(setups(rec).map(r => r.argv.slice(1))).toEqual([['on', '--config', KEY], ['off'], ['on', '--config', KEY], ['off'], ['on', '--config', KEY]])
  expect(JSON.parse(rec.files.get(`${CFG}/settings.json`)!)).toEqual(wiredSettings)
})
test('session start: the first wiring names the key, and the settings.json command ends with it', W, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(setups(rec).map(r => r.argv.slice(1))).toEqual([['on', '--config', KEY]])
  expect(JSON.parse(rec.files.get(`${CFG}/settings.json`)!).statusLine.command).toBe(WIRED)
})
const OLD_COMMAND = [
  ['no statusLine at all', {}],
  ['a null statusLine (the host leaves that when the line is removed)', { statusLine: null }],
  ['the copy with no --config (wired before the key existed)', { statusLine: { type: 'command', command: COPY } }],
  ['the copy wired for another key (the marketplace session wired it)', { statusLine: { type: 'command', command: `${COPY} --config junkd@junk-drawer` } }],
  ['the legacy path (statusline-setup moves it)', { statusLine: { type: 'command', command: `${CFG}/junk-drawer-statusline.sh` } }],
] as const
for (const [what, settings] of OLD_COMMAND) {
  test(`session start with the current copy runs statusline-setup on when settings.json has ${what}`, W, async ($, on) => {
    const rec = world(on, { copy: SCRIPT, settings })
    await start($)
    expect(setups(rec).map(r => r.argv.slice(1))).toEqual([['on', '--config', KEY]])
    expect(JSON.parse(rec.files.get(`${CFG}/settings.json`)!).statusLine.command).toBe(WIRED)
  })
}
for (const settings of [{ statusLine: { type: 'command', command: '/my/line.sh' } }, { statusLine: { type: 'static', text: 'hi' } }, { statusLine: 'text' }]) {
  test(`session start leaves a statusLine of the person's own alone when the copy is current: ${JSON.stringify(settings)}`, W, async ($, on) => {
    const rec = world(on, { copy: SCRIPT, settings })
    await start($)
    expect(setups(rec)).toEqual([])
  })
}
test('session start rewrites a stale script even when the command is right', W, async ($, on) => {
  const rec = world(on, { copy: '# older\n', settings: wiredSettings })
  await start($)
  expect(setups(rec).map(r => r.argv.slice(1))).toEqual([['on', '--config', KEY]])
  expect(rec.files.get(COPY)).toBe(SCRIPT)
})
test('the preview runs the renderer with --config <key>, so it draws what the line draws', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  await mount($)
  expect(previews(rec).map(r => r.argv.slice(1))).toEqual([['--config', KEY]])
})

test('configNote: one junkd config is no warning; a second names the one the line reads', () => {
  const configs = (...keys: string[]) => ({ pluginConfigs: Object.fromEntries(keys.map(k => [k, { options: {} }])) })
  const line = (command: string) => ({ statusLine: { type: 'command', command } })
  expect(configNote({ ...configs(KEY), ...line(WIRED) }, KEY, CFG)).toEqual({ key: KEY, warn: '' })
  expect(configNote(undefined, KEY, CFG)).toEqual({ key: KEY, warn: '' })
  expect(configNote({ pluginConfigs: { 'other@x': { options: {} } } }, KEY, CFG)).toEqual({ key: KEY, warn: '' })
  // two entries, the line reads ours
  expect(configNote({ ...configs('junkd@junk-drawer', KEY), ...line(WIRED) }, KEY, CFG)).toEqual({ key: KEY, warn: `two junkd configs: ${KEY} wins` })
  // two entries, the line reads the other one
  expect(configNote({ ...configs(KEY, 'junkd@junk-drawer'), ...line(`${COPY} --config junkd@junk-drawer`) }, KEY, CFG).warn).toBe(`two junkd configs: junkd@junk-drawer wins (this session writes ${KEY})`)
  // a command with no --config reads the first junkd@ entry in the file
  expect(configNote({ ...configs('junkd@junk-drawer', KEY), ...line(COPY) }, KEY, CFG).warn).toBe(`two junkd configs: junkd@junk-drawer wins (this session writes ${KEY})`)
  // a line that is not junkd's: the line reads nothing of ours, this session's key counts
  expect(configNote({ ...configs('junkd@junk-drawer'), ...line('/my/line.sh --config junkd@junk-drawer') }, KEY, CFG).warn).toBe(`two junkd configs: ${KEY} wins`)
  // the other config alone (this session's entry not stored yet) is already a second one
  expect(configNote({ ...configs('junkd@junk-drawer'), ...line(WIRED) }, KEY, CFG).warn).toBe(`two junkd configs: ${KEY} wins`)
})
test('the pane shows the key it is wired for, and the two-configs warning only when another junkd@ entry exists', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, settings: { ...wiredSettings, pluginConfigs: { [KEY]: { options: {} } } } })
  await start($)
  await command($, '')
  const pane = await mount($)
  expect((await pane.find({ key: 'config-key' }))?.text).toBe(`config: pluginConfigs ${KEY}`)
  expect(await pane.find({ key: 'config-warn' })).toBeUndefined()
  rec.files.set(`${CFG}/settings.json`, JSON.stringify({ ...wiredSettings, pluginConfigs: { 'junkd@junk-drawer': { options: {} }, [KEY]: { options: {} } } }))
  await pane.press({ key: 'set:model' })
  expect((await pane.find({ key: 'config-warn' }))?.text).toBe(`✗ two junkd configs: ${KEY} wins`)
})

// ------------------------------------------------------------------ T29: "wired" is the settings.json statusLine, not the option

test('wired: the option on with no statusLine shows off; a press writes the statusLine and shows on', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, settings: {}, setup: {} })
  rec.o.setup = { on: { exitCode: 1, stdout: 'held\n' } } // session start cannot wire it: the line stays missing
  await start($)
  rec.o.setup = {}
  expect(await get($, 'statusline_enabled')).toBe(true)
  await command($, '')
  const pane = await mount($)
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' off ')
  expect((await pane.find({ type: 'Button', key: 'set:enabled' }))?.text).toBe('on')
  await pane.press({ key: 'set:enabled' })
  expect(setups(rec).at(-1)!.argv.slice(1)).toEqual(['on', '--config', KEY])
  expect(JSON.parse(rec.files.get(`${CFG}/settings.json`)!).statusLine.command).toBe(WIRED)
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' on ')
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ enabled on')
  expect(await get($, 'statusline_enabled')).toBe(true)
})
test('wired: with the statusLine there, a press removes it and shows off', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, settings: { ...wiredSettings, theme: 'dark' } })
  await start($)
  await command($, '')
  const pane = await mount($)
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' on ')
  await pane.press({ key: 'set:enabled' })
  expect(setups(rec).at(-1)!.argv.slice(1)).toEqual(['off'])
  expect(JSON.parse(rec.files.get(`${CFG}/settings.json`)!)).toEqual({ theme: 'dark' })
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' off ')
  expect(await get($, 'statusline_enabled')).toBe(false)
  await pane.press({ key: 'set:enabled' })
  expect(setups(rec).at(-1)!.argv.slice(1)).toEqual(['on', '--config', KEY])
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' on ')
})
test('wired: a statusLine of the person\'s own is not "wired" (off) even with the option on', W, async ($, on) => {
  world(on, { copy: SCRIPT, settings: { statusLine: { type: 'command', command: '/my/line.sh' } } })
  await start($)
  await command($, '')
  const pane = await mount($)
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' off ')
})

// ------------------------------------------------------------------ T29 round 2: the host writes its copy of settings.json back

// Seen live: `off` removed the statusLine and the copy, and the row's own write (the host writes the whole file from its
// copy, which still held the line) put the line back; `on` lost it the same way. The world's host (Opts.hostLag) holds a
// snapshot of the statusLine and reads the file again only after some settle sleeps.
const lineIn = (rec: { files: Map<string, string> }) => (JSON.parse(rec.files.get(`${CFG}/settings.json`) ?? '{}') as { statusLine?: { command?: string } }).statusLine
const at = (order: string[], what: string) => order.findIndex(o => o.startsWith(what))

test('set enabled false with a host that reads the file two sleeps late: the row waits for it, the statusLine stays removed', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, hostLag: 2 })
  await start($)
  rec.order.length = 0
  expect(await set($, 'statusline_enabled', false)).toBe(false)
  expect(rec.order).toEqual(['setup off', `sleep ${SETTLE_MS}`, `sleep ${SETTLE_MS}`, 'config.set junkd.statusline_enabled'])
  expect(lineIn(rec), 'the row\'s write did not bring the line back').toBeUndefined()
  expect(setups(rec).map(r => r.argv[1])).toEqual(['off'])
})
test('set enabled true with a host that reads the file late: the statusLine stays, one run of on', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { hostLag: 3 })
  await start($)
  rec.order.length = 0
  expect(await set($, 'statusline_enabled', true)).toBe(true)
  expect(rec.order).toEqual(['setup on', `sleep ${SETTLE_MS}`, `sleep ${SETTLE_MS}`, `sleep ${SETTLE_MS}`, 'config.set junkd.statusline_enabled'])
  expect(lineIn(rec)?.command).toBe(WIRED)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
})
test('the /config menu path waits for the host the same way: off keeps the line out, on keeps it in', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, hostLag: 1 })
  await start($)
  rec.order.length = 0
  expect(await menu($, 'statusline_enabled', false)).toEqual({ value: false })
  expect(rec.order).toEqual(['setup off', `sleep ${SETTLE_MS}`, 'config.set junkd.statusline_enabled'])
  expect(lineIn(rec)).toBeUndefined()
  rec.order.length = 0
  expect(await menu($, 'statusline_enabled', true)).toEqual({ value: true })
  expect(rec.order).toEqual(['setup on', `sleep ${SETTLE_MS}`, 'config.set junkd.statusline_enabled'])
  expect(lineIn(rec)?.command).toBe(WIRED)
})
test('the pane\'s wired switch and /junkd:statusline off|on wait too', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, hostLag: 1 })
  await start($)
  await command($, '')
  const pane = await mount($)
  rec.order.length = 0
  await pane.press({ key: 'set:enabled' })
  expect(lineIn(rec)).toBeUndefined()
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' off ')
  await command($, 'on')
  expect(lineIn(rec)?.command).toBe(WIRED)
  await command($, 'off')
  expect(lineIn(rec)).toBeUndefined()
  expect(rec.order.filter(o => o.startsWith('sleep'))).toHaveLength(3) // one per flip: the host is one sleep late each time
})
test("the wait compares with the user's settings.json (source user), not the merge over the project's", W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, hostLag: 1 })
  await start($)
  rec.reads.length = 0
  await set($, 'statusline_enabled', false)
  expect(rec.reads.length).toBeGreaterThan(0)
  expect(rec.reads.every(source => source === 'user')).toBe(true)
})
test('a host copy that says statusLine null and a file with none agree: no wait (the host writes null for a removed line)', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, hostLag: 1000 })
  await start($)
  rec.host.line = null
  rec.order.length = 0
  await set($, 'statusline_enabled', false)
  expect(rec.order).toEqual(['setup off', 'config.set junkd.statusline_enabled'])
})
test('the host\'s copy and the file hold different statusLine objects: the wait goes on until they are the same', W, async ($, on) => {
  // junkd's command without --config is installed; the start rewrites it to WIRED, and the host still holds the old object
  const rec = world(on, { copy: SCRIPT, settings: { statusLine: { type: 'command', command: COPY } }, hostLag: 2 })
  await start($)
  expect(lineIn(rec)?.command).toBe(WIRED)
  expect(rec.order).toEqual(['setup on', 'sleep 100', 'sleep 100', 'sleep 3000'])
})
test('a host that already holds the file is not waited for: no sleep', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  rec.order.length = 0
  await set($, 'statusline_enabled', false)
  expect(rec.order).toEqual(['setup off', 'config.set junkd.statusline_enabled'])
})
test('a segment row waits for nothing and runs no script', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, hostLag: 5 })
  await start($)
  rec.order.length = 0
  await set($, 'statusline_model', false)
  expect(rec.order).toEqual(['config.set junkd.statusline_model'])
})
test('a host that never reads the file: the wait ends after SETTLE_TRIES sleeps, the row is stored, and the script runs once more', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, hostLag: Infinity })
  await start($)
  rec.order.length = 0
  expect(await set($, 'statusline_enabled', false)).toBe(false)
  expect(rec.order.filter(o => o === `sleep ${SETTLE_MS}`)).toHaveLength(SETTLE_TRIES)
  expect(at(rec.order, 'config.set')).toBeGreaterThan(at(rec.order, 'sleep'))
  expect(setups(rec).map(r => r.argv[1]), 'the row\'s write brought the line back: off runs again').toEqual(['off', 'off'])
  expect(rec.order.slice(-1)).toEqual(['setup off'])
  expect(lineIn(rec), 'the second off took it out after the row\'s write').toBeUndefined()
  expect(await get($, 'statusline_enabled')).toBe(false)
})
test('after the row is stored the file is looked at: on that is lost to the host runs on again, with the key', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { hostLag: Infinity })
  await start($)
  expect(await set($, 'statusline_enabled', true)).toBe(true)
  expect(setups(rec).map(r => r.argv.slice(1))).toEqual([['on', '--config', KEY], ['on', '--config', KEY]])
  expect(lineIn(rec)?.command).toBe(WIRED)
})
test('a file that already says what the row says is not run a second time (the host kept up or never undid it)', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, hostLag: 1 })
  await start($)
  await set($, 'statusline_enabled', false)
  await set($, 'statusline_enabled', true)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['off', 'on'])
})
test("off with a statusLine of the person's own: the file never says wired, so it is not run again after the row", W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, settings: { statusLine: { type: 'command', command: '/my/line.sh' } }, hostLag: Infinity })
  await start($)
  expect(await set($, 'statusline_enabled', false)).toBe(false)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['off'])
  expect(lineIn(rec)?.command).toBe('/my/line.sh')
})
test('a host that cannot say what it holds (settings.read rejects) is waited for like one that never catches up, and the row is stored', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { noSettingsRead: true })
  await start($)
  rec.order.length = 0
  expect(await set($, 'statusline_enabled', true)).toBe(true)
  expect(rec.order.filter(o => o === `sleep ${SETTLE_MS}`)).toHaveLength(SETTLE_TRIES)
  expect(rec.config).toEqual([{ key: 'junkd.statusline_enabled', value: true }])
  expect(lineIn(rec)?.command).toBe(WIRED)
})
test('a refused run of on waits for nothing: no sleep, no row', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { hostLag: 4, setup: { on: { exitCode: 1, stdout: `${REFUSED}\n` } } })
  await start($)
  await expect(set($, 'statusline_enabled', true)).rejects.toThrow(REFUSED)
  expect(rec.order.filter(o => o.startsWith('sleep'))).toEqual([])
  expect(rec.config).toEqual([])
})

// ------------------------------------------------------------------ T29 round 2: the wiring at session start is looked at again

test('session start wires the line, waits for the host to read the file, and looks again VERIFY_MS later: still there, nothing more runs', W, async ($, on) => {
  const rec = world(on, { hostLag: 2 })
  await start($)
  expect(rec.order).toEqual(['setup on', `sleep ${SETTLE_MS}`, `sleep ${SETTLE_MS}`, `sleep ${VERIFY_MS}`])
  await rec.verify()
  expect(setups(rec).map(r => r.argv.slice(1))).toEqual([['on', '--config', KEY]])
})
test("session start: a writer that undid the line meanwhile (setup.sh's output style, the host's first write) is answered by on again", W, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(lineIn(rec)?.command).toBe(WIRED)
  const file = JSON.parse(rec.files.get(`${CFG}/settings.json`)!)
  delete file.statusLine
  rec.files.set(`${CFG}/settings.json`, JSON.stringify({ ...file, outputStyle: 'junkd:STE' }))
  await rec.verify()
  expect(setups(rec).map(r => r.argv.slice(1))).toEqual([['on', '--config', KEY], ['on', '--config', KEY]])
  expect(lineIn(rec)?.command).toBe(WIRED)
})
test('session start: the second look runs nothing when the row was switched off in between', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await set($, 'statusline_enabled', false)
  await rec.verify()
  expect(setups(rec).map(r => r.argv[1]), 'enabled is off: no wiring behind the person\'s back').toEqual(['on', 'off'])
})
test("session start: the second look leaves a statusLine of the person's own alone", W, async ($, on) => {
  const rec = world(on)
  await start($)
  rec.files.set(`${CFG}/settings.json`, JSON.stringify({ statusLine: { type: 'command', command: '/my/line.sh' } }))
  await rec.verify()
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
  expect(lineIn(rec)?.command).toBe('/my/line.sh')
})
test('session start with nothing to wire (the copy is current, the line is ours) sleeps and runs nothing', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await rec.verify()
  expect(rec.order).toEqual([])
  expect(setups(rec)).toEqual([])
})
test('session start with the row off sleeps and runs nothing', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on)
  await start($)
  await rec.verify()
  expect(rec.order).toEqual([])
})

// ------------------------------------------------------------------ T32: a flip makes the host load the module again; presses are served in order

// Every write of a row (`$.config.set` on pluginConfigs) makes the host load this module again while the pane is still on the
// screen: the new copy starts with nothing in memory, and the copy that was running does not finish what it began. A reload
// is a session start with the pane among `$.ui.panes()` and what the old copy kept in `$.store`.
const KEPT = 'statusline-pane'
const kept = (note: string, ago = 0) => ({ [KEPT]: { note, at: Date.now() - ago } })
const HINT = 'also in /config, under junkd (statusline_…)' // the note row when there is no note

test('a reload with the pane up: the new copy takes it back (the note kept for it, the switch, the key, the preview) and the next /junkd:statusline closes it', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, panes: [{ id: 'statusline' }], store: kept('✓ ctx off') })
  await start($)
  const pane = await mount($)
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ ctx off')
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text, 'the line is wired: the switch says so at once').toBe(' on ')
  expect((await pane.find({ key: 'config-key' }))?.text).toBe(`config: pluginConfigs ${KEY}`)
  expect((await pane.find({ type: 'Box', key: 'preview' }))?.text).toBe(SHOWN)
  expect(previews(rec)).toHaveLength(1)
  await command($, '')
  expect(rec.log, 'closed, not opened a second time').toEqual(['ui.close statusline'])
})
test('a reload with the pane up and the row off: nothing is wired, the pane is taken back all the same', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { panes: [{ id: 'statusline' }] })
  await start($)
  expect(previews(rec)).toHaveLength(1)
  await command($, '')
  expect(rec.log).toEqual(['ui.close statusline'])
  expect(setups(rec)).toEqual([])
})
test('a note kept longer than 10 s ago, or one that is no note, is not shown', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, panes: [{ id: 'statusline' }], store: kept('✓ ctx off', 10_001) })
  await start($)
  const pane = await mount($)
  expect((await pane.find({ key: 'note' }))?.text, 'too old').toBe(HINT)
  rec.kept.set(KEPT, { note: 5, at: Date.now() })
  await start($)
  expect((await pane.find({ key: 'note' }))?.text, 'not a string').toBe(HINT)
  rec.kept.set(KEPT, { note: '✓ ctx off' })
  await start($)
  expect((await pane.find({ key: 'note' }))?.text, 'no time').toBe(HINT)
  rec.kept.set(KEPT, { note: '✓ ctx off', at: Date.now() - 9_000 })
  await start($)
  expect((await pane.find({ key: 'note' }))?.text, 'still fresh').toBe('✓ ctx off')
})
test('a start with no pane up reads no note and draws no preview', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, store: kept('✓ ctx off') })
  await start($)
  expect(previews(rec)).toEqual([])
  await command($, '')
  expect(rec.log, 'not up: the command opens it').toEqual(['ui.open statusline focus statusline'])
  expect((await (await mount($)).find({ key: 'note' }))?.text).toBe(HINT)
})
test('the key row is there from the first drawing: the rows below it do not move when the files are read', W, async ($, on) => {
  world(on, { copy: SCRIPT })
  await start($)
  const pane = await mount($) // a copy that has read nothing yet
  expect((await pane.find({ key: 'config-key' }))?.text).toBe(`config: pluginConfigs ${KEY}`)
})
test('every switch, in the order the pane draws them, writes its own row (a-g)', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  const pane = await mount($)
  const drawn = (await pane.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('set:'))
  expect(drawn).toEqual(FIELDS.map(f => `set:${f}`))
  for (const key of drawn) {
    await pane.press({ key: key! })
    expect(rec.config.at(-1)?.key, key).toBe(key!.replace('set:', 'junkd.statusline_'))
  }
  expect(rec.config).toHaveLength(FIELDS.length)
})
test('a press while the wired switch is being applied is refused with a note and writes nothing; after it a press is served', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, hostLag: 1, holdSettle: true })
  await start($)
  await command($, '')
  const pane = await mount($)
  const first = pane.press({ key: 'set:enabled' }) // runs the script and waits for the host: held
  await new Promise(r => setTimeout(r, 30))
  await pane.press({ key: 'set:ctx' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ the wired switch is still being applied: press again in a moment')
  expect(rec.config, 'the refused press wrote nothing').toEqual([])
  rec.releaseSettle()
  await first
  await new Promise(r => setTimeout(r, 30)) // the flip goes on after the press returned
  expect(rec.config).toEqual([{ key: 'junkd.statusline_enabled', value: false }])
  await pane.press({ key: 'set:ctx' })
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.statusline_ctx', value: false })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ ctx off')
})
test('the same segment pressed twice from one drawing writes the same value twice (the row as it stood); a press served later flips it back', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  const pane = await mount($)
  await Promise.all([pane.press({ key: 'set:ctx' }), pane.press({ key: 'set:ctx' })])
  expect(rec.config.map(c => c.value)).toEqual([false, false])
  await pane.press({ key: 'set:ctx' })
  expect(rec.config.map(c => c.value)).toEqual([false, false, true])
  expect(await get($, 'statusline_ctx')).toBe(true)
})
test('two different segments pressed together are both written: only the wired switch makes a press wait', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  const pane = await mount($)
  await Promise.all([pane.press({ key: 'set:ctx' }), pane.press({ key: 'set:model' })])
  expect(rec.config.map(c => c.key).sort()).toEqual(['junkd.statusline_ctx', 'junkd.statusline_model'])
})
test('the wired switch pressed while a segment is being written is applied, and a press after it is served', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  const pane = await mount($)
  await Promise.all([pane.press({ key: 'set:ctx' }), pane.press({ key: 'set:enabled' })])
  expect(rec.config.map(c => c.key).sort()).toEqual(['junkd.statusline_ctx', 'junkd.statusline_enabled'])
  await pane.press({ key: 'set:model' })
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.statusline_model', value: false })
})
test('a press whose flip failed is the note, and the next press is served', W, async ($, on) => {
  on('clock.sleep', { ms: SETTLE_MS }, () => ({ deny: 'no sleeping' }))
  const rec = world(on, { copy: SCRIPT, hostLag: 1 })
  await start($)
  await command($, '')
  const pane = await mount($)
  await pane.press({ key: 'set:enabled' }) // the wait for the host rejects
  expect((await pane.find({ key: 'note' }))?.text).toMatch(/^✗ .*no sleeping/)
  await pane.press({ key: 'set:ctx' })
  expect(rec.config).toEqual([{ key: 'junkd.statusline_ctx', value: false }])
})
test('a press after a refused write is served', W, async ($, on) => {
  on('config.set', { key: 'junkd.statusline_ctx' }, () => ({ deny: 'locked' }))
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  const pane = await mount($)
  await pane.press({ key: 'set:ctx' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ locked')
  await pane.press({ key: 'set:model' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ model off')
  expect(rec.config).toEqual([{ key: 'junkd.statusline_model', value: false }])
})
test('the note is in $.store when the row is written, and gone when the write is refused', W, async ($, on) => {
  on('config.set', { key: 'junkd.statusline_effort' }, () => ({ deny: 'locked' }))
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  const pane = await mount($)
  await pane.press({ key: 'set:model' })
  expect(rec.keptAtWrite).toEqual([{ note: '✓ model off', at: expect.any(Number) }])
  await pane.press({ key: 'set:effort' })
  expect(rec.kept.has(KEPT), 'refused: nothing for a reload to show').toBe(false)
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ locked')
})
test('a refused wiring is no write: the note is not kept', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { setup: { on: { exitCode: 1, stdout: `${REFUSED}\n` } } })
  await start($)
  await command($, '')
  await (await mount($)).press({ key: 'set:enabled' })
  expect(rec.kept.size).toBe(0)
  expect(rec.keptAtWrite).toEqual([])
})
test('a reload that has to wire the line again draws the pane after the script: the switch says wired', W, async ($, on) => {
  const rec = world(on, { panes: [{ id: 'statusline' }] }) // no copy, no line: the start runs on
  await start($)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
  const pane = await mount($)
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' on ')
  expect((await pane.find({ type: 'Box', key: 'preview' }))?.text).toBe(SHOWN)
})
test('a press that comes while the script of the start still writes settings.json is served after it', W, async ($, on) => {
  const rec = world(on, { panes: [{ id: 'statusline' }], holdOn: true })
  const started = start($)
  const pane = await mount($)
  const pressed = pane.press({ key: 'set:ctx' })
  await new Promise(r => setTimeout(r, 30))
  expect(rec.config, 'the script has not answered: no write beside it').toEqual([])
  rec.releaseOn()
  await Promise.all([started, pressed])
  expect(rec.order.filter(o => o === 'setup on' || o.startsWith('config.set'))).toEqual(['setup on', 'config.set junkd.statusline_ctx'])
})
test('the second look of the start draws the pane again when it wires the line once more', W, async ($, on) => {
  const rec = world(on, { panes: [{ id: 'statusline' }] })
  await start($)
  const pane = await mount($)
  expect(previews(rec)).toHaveLength(1)
  rec.files.set(`${CFG}/settings.json`, '{}') // a writer dropped the line meanwhile
  await rec.verify()
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on', 'on'])
  expect(previews(rec), 'the pane was drawn from the files again').toHaveLength(2)
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' on ')
})
test('a press on a switch is served by the module\'s hook and never reaches the closure beneath; the other buttons pass on', W, async ($, on) => {
  const reached: string[] = []
  on('ui.press', (_$, e, next) => { reached.push(e.element); return next(e) })
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  const pane = await mount($)
  for (const f of FIELDS) await pane.press({ key: `set:${f}` })
  expect(rec.config).toHaveLength(FIELDS.length)
  expect(reached, 'the hook took every switch').toEqual([])
  await pane.press({ key: 'close' })
  expect(reached, 'the × is not ours to take').toEqual(['close'])
  expect(rec.log.at(-1)).toBe('ui.close statusline')
})
test('a segment that ends while the wired switch is being applied does not end the refusal', W, async ($, on) => {
  let open = () => {}
  const gate = new Promise<void>(r => { open = r })
  on('config.set', { key: 'junkd.statusline_ctx' }, async (_$, e, next) => { await gate; return next(e) }) // the segment's write is slow
  const rec = world(on, { copy: SCRIPT, hostLag: 1, holdSettle: true })
  await start($)
  await command($, '')
  const pane = await mount($)
  void pane.press({ key: 'set:ctx' }) // begins first, ends before the wired switch
  void pane.press({ key: 'set:enabled' }) // runs off, then waits for the host: held
  await new Promise(r => setTimeout(r, 30))
  open()
  await new Promise(r => setTimeout(r, 30)) // the segment is done, the wired switch still waits
  expect(rec.config.map(c => c.key)).toEqual(['junkd.statusline_ctx'])
  await pane.press({ key: 'set:model' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ the wired switch is still being applied: press again in a moment')
  expect(rec.config.map(c => c.key)).toEqual(['junkd.statusline_ctx'])
  rec.releaseSettle()
  await new Promise(r => setTimeout(r, 30))
  expect(rec.config.map(c => c.key)).toEqual(['junkd.statusline_ctx', 'junkd.statusline_enabled'])
})
test('the second look of the start with nothing to wire draws nothing again', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT, panes: [{ id: 'statusline' }], settings: {} }) // a copy and no line: the start wires
  await start($)
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
  const before = previews(rec).length
  await rec.verify() // the script wrote the line: the second look finds nothing to do
  expect(setups(rec)).toHaveLength(1)
  expect(previews(rec)).toHaveLength(before)
})
test('the note stays in $.store after the row is written: the copy the host loads next reads it (segment and wired switch)', W, async ($, on) => {
  const rec = world(on, { copy: SCRIPT })
  await start($)
  await command($, '')
  const pane = await mount($)
  await pane.press({ key: 'set:model' })
  expect(rec.kept.get(KEPT)).toEqual({ note: '✓ model off', at: expect.any(Number) })
  await pane.press({ key: 'set:enabled' })
  expect(rec.kept.get(KEPT)).toEqual({ note: '✓ enabled off', at: expect.any(Number) })
  expect(rec.keptAtWrite.at(-1), 'kept before the wired switch is written too').toEqual({ note: '✓ enabled off', at: expect.any(Number) })
})
test('the row off with the line still wired: the switch reads off and a press runs on', withOptions({ statusline_enabled: false }), async ($, on) => {
  const rec = world(on, { copy: SCRIPT }) // the line is wired in settings.json, the row is off
  await start($)
  await command($, '')
  const pane = await mount($)
  expect((await pane.find({ type: 'Box', key: 'enabled-pill' }))?.text).toBe(' off ')
  await pane.press({ key: 'set:enabled' })
  expect(setups(rec).map(r => r.argv[1])).toEqual(['on'])
  expect(rec.config).toEqual([{ key: 'junkd.statusline_enabled', value: true }])
})
