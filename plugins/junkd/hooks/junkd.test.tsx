// The /junkd frame and the `$.junkd` noun of the one junkd module: the pane's three sections over a fake config
// tree, the set of tabs (junkd, and the real handoff and orch panes of the same module), the core group's
// output_style row, and the noun's calls and refusals. handoff, orch and tldr are no plugins of their own: their
// settings are groups of this module and their panes are its own, so the world answers what their starts and panes
// touch. Nothing touches a real home: every fs/process/settings call is answered from memory by `world`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'
import { panelStart } from './panel'
import { panelView, type Els } from './junkd-views'
import { C, applyCacheSettings } from './cache-lib'
import { SCHEMA } from './settings'

const CFG = '/fake/claude'
const MKT = `${CFG}/plugins/marketplaces/junk-drawer`
const MARKETPLACE_JSON = `${MKT}/.claude-plugin/marketplace.json`
const SETTINGS = `${CFG}/settings.json`
const STYLE_FLAG = `${CFG}/junkd/output-style-off`
// The marketplace's plugins now: handoff, orch and tldr are gone (they live in junkd); statusline is off.
const ALL_ON = { 'ctx-tokens@junk-drawer': true, 'ctx-limit@junk-drawer': true, 'junk-drawer@junk-drawer': true, 'other@x': true }
const OTHERS = ['statusline', 'ctx-tokens', 'ctx-limit', 'junk-drawer'] // every plugin row but junkd's own

const entry = (name: string, description: string) => ({ name, source: `./plugins/${name}`, description })
const fixture = (enabledPlugins: Record<string, boolean> = ALL_ON): Record<string, string> => ({
  [MARKETPLACE_JSON]: JSON.stringify({
    name: 'junk-drawer',
    plugins: [entry('statusline', 'Status line'), entry('ctx-tokens', 'Tokens'), entry('ctx-limit', 'Limit'), entry('junk-drawer', 'Cheatsheet'), entry('junkd', 'The frame')],
  }),
  [SETTINGS]: JSON.stringify({ theme: 'dark', enabledPlugins }),
})

// The host's rule for a plugin's own write: `$.config.set` goes through the other plugins' hooks, the caller's own
// skipped. The kit runs junkd's own config.set hooks on junkd's own write, so this managed plugin above every tier
// sends junkd's writes on past the user tier (junkd's hooks) to the world beneath, as the host does.
const HOST: Plugin = {
  name: 'host',
  tier: 'prepend',
  register(on) {
    on('config.set', (_$, e, next) => (next.origin.plugin === 'junkd' ? next.to(e, 'append') : next(e)))
  },
}
// The /config menu's own write path: `/cfg <json>` calls `$.config.set` from another plugin, so it passes junkd's
// config.set hooks, and carries the answer out as text.
const MENU: Plugin = {
  name: 'menu',
  register(on) {
    on('command.run', { command: 'cfg' }, async ($, e) => {
      try {
        return { text: JSON.stringify({ ok: await $.config.set(JSON.parse(e.args)) }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
  },
}
// Another mod calling `$.junkd.<method>(input)`: `/call <method> [json]`, the answer (or the refusal) as text.
const CALLER: Plugin = {
  name: 'caller',
  register(on) {
    on('command.run', { command: 'call' }, async ($, e) => {
      const [method = '', ...rest] = e.args.trim().split(/\s+/)
      const input = rest.length ? JSON.parse(rest.join(' ')) : undefined
      try {
        let ok: unknown
        if (method === 'schema') ok = await $.junkd.schema()
        else if (method === 'config') ok = await $.junkd.config()
        else if (method === 'get') ok = await $.junkd.get(input)
        else if (method === 'set') ok = await $.junkd.set(input)
        else if (method === 'open') ok = await $.junkd.open(input)
        else return { text: JSON.stringify({ error: `no method ${method}` }) }
        return { text: JSON.stringify({ ok: ok ?? null }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
  },
}
// A close of a pane from outside the module, as the person's q or × (the tab's close) is to it: `/shut <id>`
// closes it through another plugin's `$.ui.close`, which the module's own ui.close hooks see.
const SHUTTER: Plugin = {
  name: 'shutter',
  register(on) {
    on('command.run', { command: 'shut' }, async ($, e) => {
      await $.ui.close({ id: e.args.trim() || 'junkd' })
      return {}
    })
  },
}
const PLUGINS = [HOST, MENU, CALLER, SHUTTER]
const W = { plugins: PLUGINS }
const withOptions = (options: Record<string, string | number | boolean>) => ({ plugins: PLUGINS, options })

const composer = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
async function asText($: Engine, command: string, args: string): Promise<{ ok?: unknown; error?: string }> {
  const r = (await $.command.run({ command, args, ...composer })) as { text?: string }
  return JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
}
// `$.config.set` answers `{ value }` or `{ deny }` (it does not throw); a thrown error is the engine's own.
async function menuSet($: Engine, key: string, value: unknown): Promise<{ value?: unknown; deny?: string }> {
  const out = await asText($, 'cfg', JSON.stringify({ key, value }))
  if (out.error !== undefined) throw new Error(out.error)
  return (out.ok ?? {}) as { value?: unknown; deny?: string }
}
// `$.junkd.<method>(input)`: resolves to the answer, rejects with the refusal.
async function call($: Engine, method: string, input?: unknown): Promise<unknown> {
  const out = await asText($, 'call', input === undefined ? method : `${method} ${JSON.stringify(input)}`)
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}
async function refusal($: Engine, method: string, input?: unknown): Promise<string> {
  const out = await asText($, 'call', input === undefined ? method : `${method} ${JSON.stringify(input)}`)
  expect(out.error, `${method} ${JSON.stringify(input)} was not refused`).toBeDefined()
  return out.error!
}

type Open = { id: string; title?: string; focus?: true }
// The world's knobs: `env` replaces the config-dir variables; `checkout` answers the checkout's marketplace.json
// (whatever the engine resolves `<root>/../..` to); `panes` is what session.start finds open; `mvExit`/`mvErr` fail
// the rename; `realPath` resolves a symlinked path; `listThrows` and `hintThrows` fail $.command.list and the prompt
// hint beneath; `registerThrows` and `panesThrows` fail $.command.register and $.ui.panes; `existsThrows` fails fs.exists on the paths it matches; `shHome` is what `sh -c 'echo $HOME'` prints
// (default /fake/h2); `sha` is what `git rev-parse --short HEAD` prints (absent: git exits 128, no checkout),
// `gitThrows` fails the run itself (no git binary); `render` draws a Pane the module passes on.
type Opts = {
  shHome?: string
  env?: Record<string, string>
  checkout?: string
  panes?: { id: string }[]
  mvExit?: number
  mvErr?: string
  realPath?: Record<string, string>
  listThrows?: boolean
  hintThrows?: boolean
  registerThrows?: boolean
  panesThrows?: boolean
  existsThrows?: RegExp
  sha?: string
  gitThrows?: boolean
  render?: (els: Els, requestId: string | undefined) => unknown
}
function world(on: On, files: Record<string, string>, o: Opts = {}) {
  const env = o.env ?? { CLAUDE_CONFIG_DIR: CFG, HOME: '/fake/home' }
  mock.store(on)
  const rec = {
    files, reads: [] as string[], writes: [] as string[], mvs: [] as string[][], rms: [] as string[][], runs: [] as string[][],
    config: [] as { key: string; value: unknown }[], toasts: [] as string[], opens: [] as Open[], closed: [] as string[],
    registered: [] as string[], started: 0, // started: session.start reached the engine's own handler (no start step threw)
    commands: [] as { name: string; description: string; source: 'builtin' | 'plugin' | 'user' | 'mcp'; plugin?: string }[], beneath: '', merged: '',
    // `log`: every pane open and close, one line each (`ui.open <id>[ focus]`, `ui.close <id>`), in the order they came.
    log: [] as string[], gits: [] as string[][],
    // `denyOpen.<id>` refuses that pane's every open with the reason, `denyFocusedOpen.<id>` only one asking for focus.
    denyOpen: {} as Record<string, string>, denyFocusedOpen: {} as Record<string, string>,
    held: undefined as Promise<void> | undefined, release: () => {}, readGate: undefined as Promise<void> | undefined,
    tabs: [] as string[], // the open panes in open order, as the engine draws their tabs
  }
  const done = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('fs.exists', (_$, e) => {
    if (o.existsThrows?.test(e.path)) throw new Error(`EACCES ${e.path}`)
    return { value: e.path in files }
  })
  on('fs.read', async (_$, e) => {
    rec.reads.push(e.path)
    await rec.held // every read waits while a test holds them, so a refresh stays in flight
    if (o.checkout && e.path !== MARKETPLACE_JSON && /\/\.claude-plugin\/marketplace\.json$/.test(e.path)) return { value: o.checkout }
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path]! }
  })
  on('fs.stat', (_$, e) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, realPath: o.realPath?.[e.path] ?? e.path } }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_$, e) => { rec.writes.push(e.path); files[e.path] = e.text; return { value: undefined } })
  on('process.run', (_$, e) => {
    const [bin, , from, to] = e.argv
    if (bin === 'sh') return done(`${o.shHome ?? '/fake/h2'}\n`)
    if (bin === 'git') {
      rec.gits.push([...e.argv])
      if (o.gitThrows) throw new Error('spawn git ENOENT')
      const ok = o.sha !== undefined
      return { value: { exitCode: ok ? 0 : 128, stdout: ok ? `${o.sha}\n` : 'garbage\n', stderr: ok ? '' : 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    // A flag file's removal (`rm -f -- <flag>`), recorded and applied.
    if (bin === 'rm') {
      rec.rms.push([...e.argv])
      delete files[e.argv.at(-1)!]
      return done()
    }
    if (bin === '/bin/mv') {
      rec.mvs.push([from!, to!])
      if (o.mvExit) return { value: { exitCode: o.mvExit, stdout: '', stderr: o.mvErr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
      files[to!] = files[from!]!
      delete files[from!]
      return done()
    }
    rec.runs.push([...e.argv])
    return done()
  })
  // What the engine merged (user, project, local...): the user file alone unless `merged` says otherwise.
  // `readGate`: the next read answers what the settings were when it was asked, once the gate opens.
  on('settings.read', async () => {
    const value = JSON.parse(rec.merged || files[SETTINGS] || '{}')
    const gate = rec.readGate
    rec.readGate = undefined
    await gate
    return { value }
  })
  on('ui.open', (_$, e) => {
    rec.opens.push({ id: e.id, title: e.title, focus: e.focus })
    rec.log.push(`ui.open ${e.id}${e.focus ? ' focus' : ''}`)
    const deny = rec.denyOpen[e.id] ?? (e.focus ? rec.denyFocusedOpen[e.id] : undefined)
    if (deny) return { deny }
    if (!rec.tabs.includes(e.id)) rec.tabs.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => { rec.closed.push(e.id); rec.log.push(`ui.close ${e.id}`); rec.tabs = rec.tabs.filter(t => t !== e.id); return { value: undefined } })
  on('ui.focus', () => ({}))
  on('ui.panes', () => { if (o.panesThrows) throw new Error('panes broke'); return { value: (o.panes ?? []) as never } })
  on('command.register', (_$, e) => { rec.registered.push(e.name); if (o.registerThrows) throw new Error('the engine refuses the name'); return { value: { command: e.name } } })
  on('command.list', () => { if (o.listThrows) throw new Error('list broke'); return { value: rec.commands } })
  on('session.start', (_$, e) => { rec.started++; return { cwd: e.cwd } })
  // The engine's own drawing where the mod passes; under the prompt, another plugin's hint when `beneath` names one.
  on('ui.render', ($, e) => {
    if (e.component === 'PromptHint' && o.hintThrows) throw new Error('no hint beneath')
    const els = $.ui.resolve(e)
    if (e.component === 'Pane' && o.render) return o.render(els as Els, e.requestId) as never
    const { Box, Text } = els
    return e.component === 'PromptHint' && rec.beneath ? <Text>{rec.beneath}</Text> : <Box key="engine" />
  })
  return rec
}

const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const
const paneOf = (requestId: string, title: string) =>
  ({ component: 'Pane', requestId, props: { title, isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } }) as const
const PANE = paneOf('junkd', 'junkd')
const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const run = ($: Engine, command: string, args = '') => $.command.run({ command, args, ...composer })
// Opens the set through the ✚ junkd click (which loads the pane's data) and mounts the junkd pane.
async function openPane($: Engine) {
  const hint = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  await hint.press({ key: 'junkd-toggle' })
  return $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
}
type Mounted = Awaited<ReturnType<typeof openPane>>
const keysOf = async (pane: Mounted, prefix: string) => (await pane.findAll({ type: 'Box' })).map(b => b.key).filter(k => k?.startsWith(prefix))
const opened = (rec: { opens: Open[] }, id: string) => rec.opens.filter(o => o.id === id)
const closes = (rec: { closed: string[] }, id: string) => rec.closed.filter(c => c === id)
// The rows junkd wrote (the world beneath records every row, another plugin's included).
const junkdRows = (rec: { config: { key: string; value: unknown }[] }) => rec.config.filter(c => c.key.startsWith('junkd.'))

// Every group's `main` rows, in settings.ts order with `enabled` first, as the pane draws them.
const MAIN_ROWS = [
  'setting:core:output_style', 'setting:core:cache_check_sessions',
  'setting:handoff:enabled', 'setting:handoff:threshold', 'setting:handoff:autoOn', 'setting:handoff:resumeAfterLimit', 'setting:handoff:segment',
  'setting:orch:enabled', 'setting:orch:guard', 'setting:orch:allow_fable_agents', 'setting:orch:implementer_ctx_k', 'setting:orch:claude_md',
  'setting:tldr:enabled', 'setting:tldr:terse', 'setting:tldr:sentences',
  'setting:ctx:enabled', 'setting:ctx:threshold', 'setting:ctx:action',
  'setting:statusline:enabled',
  'setting:tools:enabled',
]
const GROUP_BOXES = ['group:core', 'group:handoff', 'group:orch', 'group:tldr', 'group:ctx', 'group:statusline', 'group:tools']

test('paths: CLAUDE_CONFIG_DIR and HOME unset -> `sh -c echo $HOME`, trimmed, then /.claude', W, async ($, on) => {
  const files: Record<string, string> = {
    ['/fake/h2/.claude/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json']: JSON.stringify({ name: 'junk-drawer', plugins: [entry('p1', 'x')] }),
    ['/fake/h2/.claude/settings.json']: JSON.stringify({ enabledPlugins: {} }),
  }
  const rec = world(on, files, { env: {} })
  const pane = await openPane($)
  expect(rec.reads[1]).toBe('/fake/h2/.claude/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json')
  expect(rec.reads[2]).toBe('/fake/h2/.claude/settings.json')
  expect(await pane.find({ type: 'Box', key: 'plugin-row:p1' })).toBeDefined()
  expect((await pane.find({ type: 'Text', text: /^user scope/ }))?.text).toBe('user scope, ~/.claude/settings.json') // HOME from sh
})

test('paths: CLAUDE_CONFIG_DIR unset -> $HOME/.claude for the reads and the flip write', W, async ($, on) => {
  const H = '/fake/home/.claude'
  const files: Record<string, string> = {
    [`${H}/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json`]: JSON.stringify({ name: 'junk-drawer', plugins: [entry('p1', 'x')] }),
    [`${H}/settings.json`]: JSON.stringify({ enabledPlugins: {} }),
  }
  const rec = world(on, files, { env: { HOME: '/fake/home' } })
  const pane = await openPane($)
  expect(rec.reads[1]).toBe(`${H}/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json`)
  expect(rec.reads[2]).toBe(`${H}/settings.json`)
  expect((await pane.find({ type: 'Text', text: /^user scope/ }))?.text).toBe('user scope, ~/.claude/settings.json')
  await pane.press({ key: 'plugin:p1' })
  expect(rec.mvs).toEqual([[`${H}/settings.json.junkd-tmp`, `${H}/settings.json`]])
  expect(JSON.parse(files[`${H}/settings.json`]!)).toEqual({ enabledPlugins: { 'p1@junk-drawer': true } })
})

test("AC6: ✚ junkd is drawn under the prompt, alone or beside what is beneath (handoff's segment off); a click opens the set, the next closes it", withOptions({ handoff_segment: false }), async ($, on) => {
  const rec = world(on, fixture())
  for (const surface of ['terminal', 'desktop'] as const) {
    rec.beneath = ''
    const alone = await $.ui.mount({ plugin: 'junkd', surface, ...HINT })
    expect((await alone.find({ type: 'Button', key: 'junkd-toggle' }))?.text, surface).toBe('✚ junkd')
    expect(await alone.find({ type: 'Text', text: 'other hint' })).toBeUndefined()
    expect(await alone.find({ type: 'Button', key: 'handoff-segment' })).toBeUndefined()
    await alone.unmount()
    rec.beneath = 'other hint'
    const both = await $.ui.mount({ plugin: 'junkd', surface, ...HINT })
    expect((await both.find({ type: 'Button', key: 'junkd-toggle' }))?.text, surface).toBe('✚ junkd')
    expect((await both.find({ type: 'Text', text: 'other hint' }))?.text).toBe('other hint')
    await both.unmount()
  }
  const hint = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  await hint.press({ key: 'junkd-toggle' })
  expect(rec.opens).toEqual([
    { id: 'junkd', title: 'junkd', focus: true },
    { id: 'ahandoff', title: 'handoff', focus: undefined },
    { id: 'orch', title: 'orch', focus: undefined },
    { id: 'statusline', title: 'statusline', focus: undefined },
    { id: 'junkd-tools', title: 'tools', focus: undefined },
  ])
  expect(closes(rec, 'junkd')).toEqual([])
  await hint.press({ key: 'junkd-toggle' })
  expect(rec.opens).toHaveLength(5)
  expect(closes(rec, 'junkd')).toEqual(['junkd'])
  expect(rec.tabs).toEqual([])
})

test('AC6: the prompt hint line is what is beneath, then 🪃 (handoff), then ✚ junkd', W, async ($, on) => {
  const rec = world(on, fixture())
  rec.beneath = 'other hint'
  const hint = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  const shown = (await hint.findAll({})).map(n => n.key === 'junkd-toggle' ? 'junkd' : n.key === 'handoff-segment' ? 'segment' : n.text === 'other hint' && n.type === 'Text' ? 'beneath' : '').filter(Boolean)
  expect(shown).toEqual(['beneath', 'segment', 'junkd'])
  expect((await hint.find({ type: 'Button', key: 'handoff-segment' }))?.text).toMatch(/^🪃/)
})

test('AC6: /junkd and /junkd:junkd toggle the pane; q closes it; a close by the person is seen, so the next toggle opens', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd')
  expect(opened(rec, 'junkd')).toEqual([{ id: 'junkd', title: 'junkd', focus: true }])
  await run($, 'junkd')
  expect(closes(rec, 'junkd')).toEqual(['junkd'])
  await run($, 'junkd:junkd')
  expect(opened(rec, 'junkd')).toHaveLength(2)
  await run($, 'junkd:junkd')
  expect(closes(rec, 'junkd')).toEqual(['junkd', 'junkd'])

  const pane = await openPane($)
  expect(opened(rec, 'junkd')).toHaveLength(3)
  expect((await pane.find({ type: 'Button', key: 'close' }))?.props.hotkey).toBe('q')
  await pane.press({ key: 'close' })
  expect(closes(rec, 'junkd')).toHaveLength(3)
  await pane.unmount()

  await run($, 'junkd')
  expect(opened(rec, 'junkd')).toHaveLength(4)
  await run($, 'shut', 'junkd') // the person's q or ×: the engine's close reaches the hook
  expect(closes(rec, 'junkd')).toHaveLength(4)
  await run($, 'junkd')
  expect(opened(rec, 'junkd')).toHaveLength(5) // opened again, not closed
  expect(closes(rec, 'junkd')).toHaveLength(4)
})

// The set's calls as they arrive: junkd's own open first (before any await), then each feature pane closed (one
// open on its own would keep its tab ahead of junkd's), then each opened in tab order, marked as the set's; closing
// closes junkd and each feature pane only while it is still the set's. handoff's pane is `ahandoff`.
const OPEN_SET = ['ui.open junkd focus', 'ui.close ahandoff', 'ui.close orch', 'ui.close statusline', 'ui.close junkd-tools', 'ui.open ahandoff', 'ui.open orch', 'ui.open statusline', 'ui.open junkd-tools']
const CLOSE_SET = ['ui.close junkd', 'ui.close ahandoff', 'ui.close orch', 'ui.close statusline', 'ui.close junkd-tools']

test('AC1: /junkd, /junkd:junkd, ✚ junkd and q open the set (junkd focused, then handoff, orch, statusline, tools) and close all five', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  for (const command of ['junkd', 'junkd:junkd']) {
    rec.log.length = 0
    await run($, command)
    expect(rec.log, command).toEqual(OPEN_SET)
    expect(rec.tabs, command).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools'])
    rec.log.length = 0
    await run($, command)
    expect(rec.log, command).toEqual(CLOSE_SET)
    expect(rec.tabs, command).toEqual([])
  }
  rec.log.length = 0
  const hint = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  await hint.press({ key: 'junkd-toggle' })
  expect(rec.log).toEqual(OPEN_SET)
  rec.log.length = 0
  await hint.press({ key: 'junkd-toggle' })
  expect(rec.log).toEqual(CLOSE_SET)
  rec.log.length = 0
  await hint.press({ key: 'junkd-toggle' })
  const pane = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  rec.log.length = 0
  await pane.press({ key: 'close' }) // q
  expect(rec.log).toEqual(CLOSE_SET)
  expect(rec.toasts).toEqual([])
})

test('AC1: the tabs are junkd, handoff, orch, statusline, tools; only junkd asks for the keys; a second /junkd closes all five', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd')
  expect(rec.tabs).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools'])
  expect(rec.opens).toEqual([
    { id: 'junkd', title: 'junkd', focus: true },
    { id: 'ahandoff', title: 'handoff', focus: undefined },
    { id: 'orch', title: 'orch', focus: undefined },
    { id: 'statusline', title: 'statusline', focus: undefined },
    { id: 'junkd-tools', title: 'tools', focus: undefined },
  ])
  await run($, 'junkd')
  expect(rec.tabs).toEqual([])
})

test('AC2: a feature pane open on its own is closed and reopened behind junkd; one opened on its own after the set is up stays when the set closes', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd:handoff', 'panel') // handoff's own toggle
  expect(rec.tabs).toEqual(['ahandoff'])
  await run($, 'junkd')
  expect(rec.tabs).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools']) // never ahead of junkd
  await run($, 'junkd')
  expect(rec.tabs).toEqual([]) // reopened in the set: the set's now

  await run($, 'junkd')
  await run($, 'junkd:handoff', 'panel') // the person closes handoff ...
  expect(rec.tabs).toEqual(['junkd', 'orch', 'statusline', 'junkd-tools'])
  await run($, 'junkd:handoff', 'panel') // ... and opens it on its own
  expect(rec.tabs).toEqual(['junkd', 'orch', 'statusline', 'junkd-tools', 'ahandoff'])
  await run($, 'junkd')
  expect(rec.tabs).toEqual(['ahandoff']) // the set closes without it

  await run($, 'junkd:orch', 'panel')
  expect(rec.tabs).toEqual(['ahandoff', 'orch'])
  await run($, 'junkd') // both up on their own: both go behind junkd
  expect(rec.tabs).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools'])
})

test('AC1: the set opens and closes the junkd, ahandoff, orch, statusline and junkd-tools panes and nothing else (tldr and ctx have no pane)', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd')
  await run($, 'junkd')
  expect(rec.log).toEqual([...OPEN_SET, ...CLOSE_SET])
  expect(rec.opens.map(o => o.id)).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools'])
})

test('AC1: junkd opens and every feature pane goes out before the pane data is read (a held read does not delay them)', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  rec.held = new Promise<void>(r => { rec.release = r })
  const reads = rec.reads.length
  const done = run($, 'junkd')
  await new Promise(r => setTimeout(r, 50))
  expect(rec.reads.length, 'a read is in flight').toBeGreaterThan(reads)
  expect(rec.log).toEqual(OPEN_SET) // while the read is still held
  rec.release()
  rec.held = undefined
  await done
})

test('AC2: a set pane the person closes by hand loses the mark: closing the set does not close it again', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd')
  const before = rec.closed.length
  await run($, 'shut', 'ahandoff') // the person's close mark on handoff's tab
  expect(rec.tabs).toEqual(['junkd', 'orch', 'statusline', 'junkd-tools'])
  await run($, 'junkd')
  expect(rec.tabs).toEqual([])
  // handoff closed exactly once from here: the person's close; the set's close leaves it alone
  expect(rec.closed.slice(before)).toEqual(['ahandoff', 'junkd', 'orch', 'statusline', 'junkd-tools'])
})

test("AC2: the person's close of junkd (×, the tab's close) closes the set's feature panes too; one opened on its own stays", W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd')
  expect(rec.tabs).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools'])
  await run($, 'shut', 'junkd')
  expect(rec.tabs).toEqual([])
  await run($, 'junkd') // the next toggle opens the set again
  expect(rec.tabs).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools'])
  await run($, 'junkd:handoff', 'panel') // the person closes handoff ...
  await run($, 'junkd:handoff', 'panel') // ... and opens it on its own
  await run($, 'shut', 'junkd')
  expect(rec.tabs).toEqual(['ahandoff'])
})

test("AC3: settings ▸ leaves that pane alone in the tab row (handoff on its Settings tab): junkd and the set's other pane close", W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd')
  let pane = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  await pane.press({ key: 'pane:handoff' })
  expect(rec.tabs).toEqual(['ahandoff'])
  const handoff = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...paneOf('ahandoff', 'handoff') })
  expect(await handoff.find({ type: 'Box', key: 'tab-box-settings' })).toBeUndefined() // the active tab
  expect(await handoff.find({ type: 'Box', key: 'tab-box-auto' })).toBeDefined()
  await handoff.unmount()
  await pane.unmount()
  await run($, 'junkd:handoff', 'panel') // handoff closed by hand
  await run($, 'junkd')
  pane = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  await pane.press({ key: 'pane:orch' })
  expect(rec.tabs).toEqual(['orch'])
  await run($, 'junkd') // orch is the person's now: the set opens behind junkd, and closes with orch
  await run($, 'junkd')
  expect(rec.tabs).toEqual([])
})

test("AC3: settings ▸ on statusline opens the statusline pane unfocused, closes junkd and the set's other panes, then asks for the keys; the pane is the person's from then on", W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd')
  expect(rec.tabs).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools'])
  const pane = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  expect((await pane.find({ type: 'Button', key: 'pane:statusline' }))?.text).toBe('settings ▸')
  const at = rec.log.length
  await pane.press({ key: 'pane:statusline' })
  // statuslineShow: the first open without focus (junkd still holds the keys), the second with it.
  expect(rec.log.slice(at)).toEqual(['ui.open statusline', 'ui.close junkd', 'ui.close ahandoff', 'ui.close orch', 'ui.close junkd-tools', 'ui.open statusline focus'])
  expect(rec.opens.filter(o => o.id === 'statusline').slice(-2)).toEqual([
    { id: 'statusline', title: 'statusline', focus: undefined },
    { id: 'statusline', title: 'statusline', focus: true },
  ])
  expect(rec.tabs).toEqual(['statusline'])
  expect(rec.toasts).toEqual([])
  await pane.unmount()
  await run($, 'junkd') // statusline is the person's now: the set opens behind junkd ...
  expect(rec.tabs).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools'])
  await run($, 'junkd') // ... and, reopened in the set, closes with it
  expect(rec.tabs).toEqual([])
})

test('AC3: settings ▸ whose focused open is refused: open, junkd closes, the focused open, one toast with the reason', W, async ($, on) => {
  const rec = world(on, fixture())
  const pane = await openPane($)
  rec.denyFocusedOpen.orch = 'orch: keys refused'
  const at = rec.log.length
  await pane.press({ key: 'pane:orch' })
  expect(rec.log.slice(at)).toEqual(['ui.open orch', 'ui.close junkd', 'ui.close ahandoff', 'ui.close statusline', 'ui.close junkd-tools', 'ui.open orch focus'])
  expect(rec.toasts).toHaveLength(1)
  expect(rec.toasts[0]).toMatch(/^✗ .*orch: keys refused$/)
})

test('AC5: the header is ✚ junkd, the marketplace and the short sha of its checkout; the section titles in the accent', W, async ($, on) => {
  const rec = world(on, fixture(), { sha: 'abc1234' })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^✚ junkd/ }))?.text).toBe('✚ junkd  junk-drawer abc1234')
  expect(rec.gits).toEqual([['git', '-C', MKT, 'rev-parse', '--short', 'HEAD']]) // where the marketplace was found
  for (const heading of ['Plugins', 'Settings', 'Commands']) {
    const t = (await pane.findAll({ type: 'Text' })).find(x => x.text === heading)
    expect(t?.props.color, heading).toBe('claude')
    expect(t?.props.bold, heading).toBe(true)
    // its own box that never shrinks, so a long subtitle cannot wrap it ("Plugin" / "s")
    expect((await pane.find({ type: 'Box', key: `title:${heading}` }))?.props.flexShrink, heading).toBe(0)
  }
  expect((await pane.find({ type: 'Text', text: /^the main settings of/ }))?.text).toBe('the main settings of core, handoff, orch, tldr, ctx, statusline, tools')
  const mark = (await pane.findAll({ type: 'Text' })).find(t => t.text === '✚ junkd')
  expect(mark?.props.color).toBe('claude')
  expect(mark?.props.bold).toBe(true)
})

test('AC5: the sha comes from the checkout two levels up when that is where the marketplace is', W, async ($, on) => {
  const rec = world(on, fixture(), { sha: 'def5678', checkout: JSON.stringify({ name: 'junk-drawer', plugins: [entry('junkd', 'self')] }) })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^✚ junkd/ }))?.text).toBe('✚ junkd  junk-drawer def5678')
  expect(rec.gits[0]?.[2]).toMatch(/\/plugins\/junkd\/\.\.\/\.\.$/) // `<root>/../..`, as the marketplace was read
  expect(rec.reads).not.toContain(MARKETPLACE_JSON)
})

test('AC5: no git checkout (git exits non-zero) -> no sha', W, async ($, on) => {
  const rec = world(on, fixture())
  const pane = await openPane($)
  expect(rec.gits).toHaveLength(1)
  expect((await pane.find({ type: 'Text', text: /^✚ junkd/ }))?.text).toBe('✚ junkd  junk-drawer')
})

test('AC5: git missing (the run throws) -> no sha, no note', W, async ($, on) => {
  world(on, fixture(), { gitThrows: true })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^✚ junkd/ }))?.text).toBe('✚ junkd  junk-drawer')
  expect((await pane.find({ key: 'note' }))?.text).toBe('')
})

test('AC5: the Plugins title names the settings file: ~ for a CLAUDE_CONFIG_DIR under HOME, the full path for one beside it', W, async ($, on) => {
  const at = (cfg: string): Record<string, string> => ({
    [`${cfg}/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json`]: JSON.stringify({ name: 'junk-drawer', plugins: [entry('p1', 'x')] }),
    [`${cfg}/settings.json`]: JSON.stringify({ enabledPlugins: {} }),
  })
  world(on, { ...at('/fake/home/cc'), ...at('/fake/homeX/cc') }, { env: { HOME: '/fake/home', CLAUDE_CONFIG_DIR: '/fake/home/cc' } })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^user scope/ }))?.text).toBe('user scope, ~/cc/settings.json')
})

test('AC5: no HOME at all (sh prints nothing) -> the config dir is /.claude, named in full, no ~', W, async ($, on) => {
  world(on, {
    ['/.claude/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json']: JSON.stringify({ name: 'junk-drawer', plugins: [entry('p1', 'x')] }),
    ['/.claude/settings.json']: JSON.stringify({ enabledPlugins: {} }),
  }, { env: {}, shHome: '' })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^user scope/ }))?.text).toBe('user scope, /.claude/settings.json')
})

test('AC5: a CLAUDE_CONFIG_DIR whose name only starts like HOME keeps its full path', W, async ($, on) => {
  const cfg = '/fake/homeX/cc'
  world(on, {
    [`${cfg}/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json`]: JSON.stringify({ name: 'junk-drawer', plugins: [entry('p1', 'x')] }),
    [`${cfg}/settings.json`]: JSON.stringify({ enabledPlugins: {} }),
  }, { env: { HOME: '/fake/home', CLAUDE_CONFIG_DIR: cfg } })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^user scope/ }))?.text).toBe('user scope, /fake/homeX/cc/settings.json')
})

test('AC2: Plugins lists every marketplace plugin, on/off from user-scope settings.json; 1-9 flip one and the pane says to reload', W, async ($, on) => {
  const rec = world(on, fixture())
  const pane = await openPane($)
  for (const heading of ['Plugins', 'Settings', 'Commands']) expect((await pane.find({ type: 'Text', text: heading }))?.text, heading).toBe(heading)
  // The settings file the flips write, named as it is: CLAUDE_CONFIG_DIR's here (outside HOME, so no ~).
  expect((await pane.find({ type: 'Text', text: /^user scope/ }))?.text).toBe('user scope, /fake/claude/settings.json')
  // The files, by their exact spelling: the checkout's marketplace two levels up (asked first, absent here), then
  // the plugin cache's copy under the config dir; the user-scope settings.json beside it.
  expect(rec.reads[0]).toMatch(/\/\.claude-plugin\/marketplace\.json$/)
  expect(rec.reads[0]).not.toBe(MARKETPLACE_JSON) // the engine resolves `<root>/../..`: this checkout's own root
  expect(rec.reads[0]).not.toMatch(/\/plugins\//) // two levels up from plugins/junkd, not one
  expect(rec.reads[1]).toBe(MARKETPLACE_JSON)
  expect(rec.reads[2]).toBe(SETTINGS)

  // The marketplace's plugins and nothing else: handoff, orch and tldr are groups of junkd (Settings), no rows here.
  expect(await keysOf(pane, 'plugin-row:')).toEqual([...OTHERS, 'junkd'].map(n => `plugin-row:${n}`))
  const hotkeys = async () => Promise.all(OTHERS.map(async n => (await pane.find({ type: 'Button', key: `plugin:${n}` }))?.props.hotkey))
  expect(await hotkeys()).toEqual(['1', '2', '3', '4'])
  expect(await pane.find({ type: 'Button', key: 'plugin:junkd' })).toBeUndefined() // this pane: no switch
  expect((await pane.find({ type: 'Text', text: 'this pane' }))?.text).toBe('this pane')
  const pills = async () => Promise.all(OTHERS.map(async n => (await pane.find({ type: 'Box', key: `plugin:${n}-pill` }))?.text))
  expect(await pills()).toEqual([' off ', ' on ', ' on ', ' on ']) // statusline off, the rest on
  expect((await pane.find({ type: 'Button', key: 'plugin:statusline' }))?.text).toBe('on')
  expect((await pane.find({ type: 'Button', key: 'plugin:ctx-tokens' }))?.text).toBe('off')
  expect(await pane.find({ type: 'Text', text: /reload-plugins/ })).toBeUndefined()

  await pane.press({ key: 'plugin:statusline' })
  let settings = JSON.parse(rec.files[SETTINGS]!)
  expect(settings.enabledPlugins).toEqual({ ...ALL_ON, 'statusline@junk-drawer': true })
  expect(settings.theme).toBe('dark')
  expect(Object.keys(rec.files).filter(k => k.endsWith('.junkd-tmp'))).toEqual([])
  expect((await pane.find({ type: 'Text', text: 'run /reload-plugins to apply' }))?.text).toBe('run /reload-plugins to apply')
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ statusline on: run /reload-plugins')
  expect(await pills()).toEqual([' on ', ' on ', ' on ', ' on '])

  await pane.press({ key: 'plugin:ctx-tokens' })
  settings = JSON.parse(rec.files[SETTINGS]!)
  expect(settings.enabledPlugins).toEqual({ ...ALL_ON, 'statusline@junk-drawer': true, 'ctx-tokens@junk-drawer': false })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ ctx-tokens off: run /reload-plugins')
  expect(await pills()).toEqual([' on ', ' off ', ' on ', ' on '])

  // A settings.json that does not parse is never overwritten.
  rec.files[SETTINGS] = '{ broken'
  await pane.press({ key: 'plugin:ctx-limit' })
  expect(rec.files[SETTINGS]).toBe('{ broken')
  expect((await pane.find({ key: 'note' }))?.text).toMatch(/^✗ /)
})

test('AC2: a tenth plugin has no hotkey; 1-9 stay with the first nine; the pane is counted out', W, async ($, on) => {
  const files = fixture()
  const names = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']
  files[MARKETPLACE_JSON] = JSON.stringify({ name: 'junk-drawer', plugins: [entry('junkd', 'self'), ...names.map(n => entry(n, n))] })
  world(on, files)
  const pane = await openPane($)
  for (const [i, n] of names.entries()) expect((await pane.find({ type: 'Button', key: `plugin:${n}` }))?.props.hotkey, n).toBe(i < 9 ? String(i + 1) : undefined)
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys 1-9 plugin  a-l setting  tab move  q close')
})

// Values away from the defaults where a default drawn in a value's place would show.
const AWAY = { core_cache_check_sessions: 7, handoff_threshold: 70, orch_allow_fable_agents: true, tldr_sentences: 4 }

test("AC3: Settings draws every group's main rows (enabled first) with their values; a letter flips a boolean through its group's set; enter saves a number, a press a choice; settings ▸ opens the pane", withOptions(AWAY), async ($, on) => {
  const rec = world(on, fixture())
  const pane = await openPane($)

  // Each group: a blank row (marginTop), a dim rule, its name bold in the accent colour; handoff, orch,
  // statusline and tools have `settings ▸`, core, tldr and ctx have no pane.
  expect(await keysOf(pane, 'group:')).toEqual(GROUP_BOXES)
  for (const group of ['core', 'handoff', 'orch', 'tldr', 'ctx', 'statusline', 'tools']) {
    expect((await pane.find({ type: 'Box', key: `group:${group}` }))?.props.marginTop, group).toBe(1)
    const nodes = await pane.findAll({ type: 'Text' })
    const at = nodes.findLastIndex(t => t.text === group)
    expect(nodes[at]?.props.bold, group).toBe(true)
    expect(nodes[at]?.props.color, group).toBe('claude')
    expect(nodes[at - 1]?.text, `rule above ${group}`).toMatch(/^─{20,}$/)
  }
  expect((await pane.find({ type: 'Button', key: 'pane:handoff' }))?.text).toBe('settings ▸')
  expect((await pane.find({ type: 'Button', key: 'pane:orch' }))?.text).toBe('settings ▸')
  expect((await pane.find({ type: 'Button', key: 'pane:tools' }))?.text).toBe('settings ▸')
  expect(await pane.find({ type: 'Button', key: 'pane:core' })).toBeUndefined()
  expect((await pane.find({ type: 'Button', key: 'pane:statusline' }))?.text).toBe('settings ▸')
  expect(await pane.find({ type: 'Button', key: 'pane:tldr' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'pane:ctx' })).toBeUndefined()
  expect(await pane.find({ key: 'no-settings' })).toBeUndefined()

  // The main rows only, in settings.ts order (`enabled` first in each feature group), named by field, titled as
  // the manifest says.
  expect(await keysOf(pane, 'setting:')).toEqual(MAIN_ROWS)
  for (const f of SCHEMA.filter(f => f.main)) {
    const row = await pane.find({ type: 'Box', key: `setting:${f.group}:${f.field}` })
    expect(row?.text, f.key).toContain(f.field)
    expect(row?.text, f.key).toContain(f.title)
  }
  // The switches, a-l in drawn order, each showing the value its group answers.
  const switches = ['handoff:enabled', 'handoff:autoOn', 'handoff:resumeAfterLimit', 'handoff:segment', 'orch:enabled', 'orch:allow_fable_agents', 'orch:claude_md', 'tldr:enabled', 'tldr:terse', 'ctx:enabled', 'statusline:enabled', 'tools:enabled']
  for (const [i, k] of switches.entries()) expect((await pane.find({ type: 'Button', key: `set:${k}` }))?.props.hotkey, k).toBe('abcdefghijkl'[i])
  expect((await pane.find({ type: 'Button', key: 'set:ctx:enabled' }))?.text).toBe('on') // off by default
  expect((await pane.find({ type: 'Button', key: 'set:statusline:enabled' }))?.text).toBe('off') // on by default
  expect((await pane.find({ type: 'Input', key: 'set:ctx:threshold' }))?.props.value).toBe('300000')
  expect((await pane.find({ key: 'set:ctx:action=block' }))?.text).toBe(' block ')
  expect((await pane.find({ type: 'Button', key: 'set:handoff:enabled' }))?.text).toBe('off') // on now: the button turns it off
  expect((await pane.find({ type: 'Button', key: 'set:handoff:autoOn' }))?.text).toBe('on') // off now: the button turns it on
  expect((await pane.find({ type: 'Button', key: 'set:handoff:segment' }))?.text).toBe('off')
  expect((await pane.find({ type: 'Button', key: 'set:tldr:terse' }))?.text).toBe('on')
  expect((await pane.find({ type: 'Input', key: 'set:handoff:threshold' }))?.props.value).toBe('70') // the value, not the default 85
  expect((await pane.find({ type: 'Input', key: 'set:orch:implementer_ctx_k' }))?.props.value).toBe('400')
  expect((await pane.find({ type: 'Input', key: 'set:tldr:sentences' }))?.props.value).toBe('4') // not the default 3
  expect((await pane.find({ type: 'Input', key: 'set:core:cache_check_sessions' }))?.props.value).toBe('7') // not the default 10
  expect((await pane.find({ type: 'Button', key: 'set:orch:allow_fable_agents' }))?.text).toBe('off') // on by the option, off by default
  // A choice: the current option an inverse block, the others Buttons; no engine Select.
  expect(await pane.find({ type: 'Select' })).toBeUndefined()
  expect((await pane.find({ key: 'set:orch:guard=fable' }))?.text).toBe(' fable ')
  expect(await pane.find({ type: 'Button', key: 'set:orch:guard=fable' })).toBeUndefined()
  expect((await pane.find({ type: 'Button', key: 'set:orch:guard=always' }))?.text).toBe('always')
  expect((await pane.find({ key: 'set:core:output_style=ste' }))?.text).toBe(' ste ')
  expect((await pane.find({ type: 'Button', key: 'set:core:output_style=off' }))?.text).toBe('off')
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys 1-4 plugin  a-l setting  tab move  q close')

  // Each write goes to its group's row through the group's set: a flip sends the other state, a number as typed
  // (the group coerces and validates it), a choice its option.
  await pane.press({ key: 'set:handoff:enabled' })
  await pane.press({ key: 'set:handoff:autoOn' })
  await pane.press({ key: 'set:handoff:segment' })
  await pane.press({ key: 'set:orch:allow_fable_agents' })
  await pane.press({ key: 'set:orch:enabled' })
  await pane.press({ key: 'set:tldr:enabled' })
  await pane.press({ key: 'set:tldr:terse' })
  await pane.input({ key: 'set:handoff:threshold', text: '90' })
  await pane.input({ key: 'set:tldr:sentences', text: '5' })
  await pane.input({ key: 'set:core:cache_check_sessions', text: '12' })
  await pane.press({ key: 'set:orch:guard=always' })
  await pane.press({ key: 'set:core:output_style=off' })
  expect(junkdRows(rec)).toEqual([
    { key: 'junkd.handoff_enabled', value: false },
    { key: 'junkd.handoff_autoOn', value: true },
    { key: 'junkd.handoff_segment', value: false },
    { key: 'junkd.orch_allow_fable_agents', value: false },
    { key: 'junkd.orch_enabled', value: false },
    { key: 'junkd.tldr_enabled', value: false },
    { key: 'junkd.tldr_terse', value: true },
    { key: 'junkd.handoff_threshold', value: 90 },
    { key: 'junkd.tldr_sentences', value: 5 },
    { key: 'junkd.core_cache_check_sessions', value: 12 },
    { key: 'junkd.orch_guard', value: 'always' },
    { key: 'junkd.core_output_style', value: 'off' },
  ])
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ core.output_style = "off"')
  // Redrawn with what each group answers now.
  expect((await pane.find({ type: 'Button', key: 'set:handoff:autoOn' }))?.text).toBe('off')
  expect((await pane.find({ type: 'Button', key: 'set:tldr:terse' }))?.text).toBe('off')
  expect((await pane.find({ key: 'set:core:output_style=off' }))?.text).toBe(' off ')
  expect(await call($, 'config')).toMatchObject({ handoff_threshold: 90, tldr_sentences: 5, orch_guard: 'always', orch_enabled: false, tldr_enabled: false, core_output_style: 'off', core_cache_check_sessions: 12 })
  // ctx and statusline: their main rows through their groups' sets (ctx's files, statusline-setup off).
  await pane.press({ key: 'set:ctx:enabled' })
  await pane.input({ key: 'set:ctx:threshold', text: '250k' })
  await pane.press({ key: 'set:ctx:action=warn' })
  await pane.press({ key: 'set:statusline:enabled' })
  expect(junkdRows(rec).slice(-4)).toEqual([
    { key: 'junkd.ctx_enabled', value: true },
    { key: 'junkd.ctx_threshold', value: 250000 },
    { key: 'junkd.ctx_action', value: 'warn' },
    { key: 'junkd.statusline_enabled', value: false },
  ])
  expect(rec.files[`${CFG}/junkd/ctx-limit-threshold`]).toBe('250000\n')
  expect(rec.files[`${CFG}/junkd/ctx-limit-action`]).toBe('warn\n')
  expect(rec.runs.filter(r => r[0]!.endsWith('/bin/statusline-setup')).map(r => r[1])).toEqual(['off'])
  expect((await pane.find({ type: 'Button', key: 'set:ctx:enabled' }))?.text).toBe('off')
  expect((await pane.find({ type: 'Button', key: 'set:statusline:enabled' }))?.text).toBe('on')
  expect((await pane.findAll({ type: 'Input' })).find(i => i.key?.startsWith('set:ctx:threshold'))?.props.value).toBe('250000')
  // A refused set is the note, nothing else; the field is redrawn under its next key (fieldKey).
  const rows = junkdRows(rec).length
  await pane.input({ key: 'set:orch:implementer_ctx_k', text: '0' })
  expect(junkdRows(rec)).toHaveLength(rows)
  const why = await refusal($, 'set', { key: 'orch_implementer_ctx_k', value: '0' })
  expect(why).toMatch(/implementer_ctx_k/)
  expect((await pane.find({ key: 'note' }))?.text).toMatch(/^✗ .*0 is not a valid implementer_ctx_k/)
  expect(why).toContain(((await pane.find({ key: 'note' }))?.text ?? '').slice(2))
  expect((await pane.find({ type: 'Input', key: 'set:orch:implementer_ctx_k~1' }))?.props.value).toBe('400')
  expect(rec.toasts).toEqual([])

  // settings ▸, in this order: the feature pane opens (handoff on its Settings tab), junkd closes with the set's
  // other feature pane (only while still the set's), the feature pane opens again asking for the keys; no owner, so
  // it is the person's pane from then on.
  let at = rec.log.length
  await pane.press({ key: 'pane:handoff' })
  expect(rec.log.slice(at)).toEqual(['ui.open ahandoff', 'ui.close junkd', 'ui.close orch', 'ui.close statusline', 'ui.close junkd-tools', 'ui.open ahandoff focus'])
  at = rec.log.length
  await pane.press({ key: 'pane:orch' })
  expect(rec.log.slice(at)).toEqual(['ui.open orch', 'ui.close junkd', 'ui.open orch focus']) // handoff is the person's now
  expect(rec.toasts).toEqual([])
  expect(opened(rec, 'junkd')).toHaveLength(1) // junkd is not opened again
})

test("AC3: Settings draws every group whatever the marketplace's entries say; a plugin on in the merged settings is marked when off at user scope; a refused open is a toast", W, async ($, on) => {
  const rec = world(on, fixture({ 'handoff@junk-drawer': false, 'orch@junk-drawer': false, 'tldr@junk-drawer': false, 'ctx-tokens@junk-drawer': false }))
  rec.merged = JSON.stringify({ enabledPlugins: { 'ctx-tokens@junk-drawer': true, 'statusline@junk-drawer': false } })
  const pane = await openPane($)
  expect(await keysOf(pane, 'group:')).toEqual(GROUP_BOXES) // the old plugin entries switch nothing
  expect((await pane.find({ type: 'Text', text: /on in this project/ }))?.text).toBe('(on in this project) Tokens')
  expect((await pane.find({ type: 'Button', key: 'plugin:ctx-tokens' }))?.text).toBe('on') // the user-scope switch still says off

  rec.merged = ''
  await pane.press({ key: 'plugin:ctx-tokens' }) // on at user scope too: the marker goes
  expect(await pane.find({ type: 'Text', text: /on in this project/ })).toBeUndefined()
  expect(await keysOf(pane, 'group:')).toEqual(GROUP_BOXES)
  // junkd closes before the refusal comes back, so the reason is a toast; the focused open is never sent.
  rec.denyOpen.orch = 'orch: no room'
  const at = rec.log.length
  await pane.press({ key: 'pane:orch' })
  expect(rec.log.slice(at)).toEqual(['ui.open orch', 'ui.close junkd', 'ui.close ahandoff', 'ui.close statusline', 'ui.close junkd-tools'])
  expect(rec.toasts).toHaveLength(1)
  expect(rec.toasts[0]).toMatch(/^✗ .*orch: no room$/)
})

test("AC4: Commands lists the enabled plugins' slash commands, junkd's own /junkd:* among them, from $.command.list()", W, async ($, on) => {
  const rec = world(on, fixture())
  rec.commands = [
    { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
    { name: 'junkd:tldr', description: 'TL;DR of the last message', source: 'plugin', plugin: 'junkd' },
    { name: 'junkd:handoff', description: 'Save a handoff', source: 'plugin', plugin: 'junkd' },
    { name: 'junkd:orch-init', description: 'Write .orch/config.md', source: 'plugin' }, // the engine named no plugin: the prefix tells
    { name: 'ctx-limit:ctx-limit', description: 'Context limit', source: 'plugin', plugin: 'ctx-limit' },
    { name: 'statusline:init', description: 'Install the status line', source: 'plugin', plugin: 'statusline' }, // off
    { name: 'tldr:tldr', description: 'The old plugin', source: 'plugin', plugin: 'tldr' }, // no marketplace plugin any more
    { name: 'junkd', description: 'Toggle the junkd pane', source: 'plugin', plugin: 'junkd' },
    { name: 'mine', description: 'A user command', source: 'user' },
    { name: 'junkd:mine', description: "A user command wearing a plugin's prefix", source: 'user' }, // not the plugin's
    { name: 'mcp__x__prompt', description: 'An MCP prompt', source: 'mcp' },
  ]
  const pane = await openPane($)
  expect(await keysOf(pane, 'cmd:')).toEqual(['cmd:junkd:tldr', 'cmd:junkd:handoff', 'cmd:junkd:orch-init', 'cmd:ctx-limit:ctx-limit', 'cmd:junkd'])
  expect((await pane.find({ type: 'Text', text: '/junkd:handoff' }))?.text).toBe('/junkd:handoff')
  expect((await pane.find({ type: 'Text', text: 'Save a handoff' }))?.text).toBe('Save a handoff')
  expect((await pane.find({ type: 'Text', text: 'Write .orch/config.md' }))?.text).toBe('Write .orch/config.md')
  expect(await pane.find({ type: 'Text', text: 'Install the status line' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '/tldr:tldr' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '/junkd:mine' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'No commands.' })).toBeUndefined()
})

// There is no absent noun any more (handoff, orch and tldr are this module), so the case "none of them loaded"
// is now: with no plugin but junkd on, /junkd draws every group from the module itself.
test('AC5: with no other plugin on, /junkd opens the set with Plugins, every settings group and Commands', W, async ($, on) => {
  const rec = world(on, fixture({}))
  rec.commands = [{ name: 'junkd', description: 'Toggle the junkd pane', source: 'plugin', plugin: 'junkd' }]
  const pane = await openPane($)
  expect(rec.opens.map(o => o.id)).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools'])
  for (const heading of ['Plugins', 'Settings', 'Commands']) expect((await pane.find({ type: 'Text', text: heading }))?.text, heading).toBe(heading)
  expect(await keysOf(pane, 'group:')).toEqual(GROUP_BOXES)
  expect(await keysOf(pane, 'setting:')).toEqual(MAIN_ROWS)
  expect(await pane.find({ key: 'no-settings' })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: '/junkd' }))?.text).toBe('/junkd')
  expect((await pane.find({ key: 'note' }))?.text).toBe('')
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys 1-4 plugin  a-l setting  tab move  q close')
})

test('AC6: PromptHint with nothing beneath (next throws) -> the toggle alone, and it still opens', withOptions({ handoff_segment: false }), async ($, on) => {
  const rec = world(on, fixture(), { hintThrows: true })
  const hint = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  expect((await hint.find({ type: 'Button', key: 'junkd-toggle' }))?.text).toBe('✚ junkd')
  expect(await hint.find({ type: 'Box', key: 'engine' })).toBeUndefined()
  await hint.press({ key: 'junkd-toggle' })
  expect(opened(rec, 'junkd')).toHaveLength(1)
})

test('AC6: session.start with the pane already placed -> it is refreshed, and the first /junkd closes it', W, async ($, on) => {
  const rec = world(on, fixture(), { panes: [{ id: 'junkd' }] })
  await start($)
  await run($, 'junkd')
  expect(rec.closed).toEqual(['junkd']) // the feature panes are no set's: left alone
  expect(rec.opens).toEqual([])
  await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE }) // flushes the start's refresh
  expect(rec.reads.filter(r => !r.endsWith('/statusline.sh'))[1]).toBe(MARKETPLACE_JSON) // statusline's start reads its copies
  expect(rec.reads).toContain(SETTINGS)
})

test('T27: session.start never registers the bare junkd command (the engine refuses it)', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  expect(rec.registered).not.toContain('junkd')
})

test('T27: a refusing command.register or a failing ui.panes leaves session.start resolved and the segment drawn', W, async ($, on) => {
  const rec = world(on, fixture(), { registerThrows: true, panesThrows: true })
  await start($)
  expect(rec.started).toBe(1)
  // The engine swallows a throwing hook, so the start step itself is called with the same failures.
  const failing = { ui: { panes: () => Promise.reject(new Error('panes broke')) }, command: { register: () => Promise.reject(new Error('refused')) } }
  await expect(panelStart(failing as never)).resolves.toBeUndefined()
  const hint = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  expect((await hint.find({ type: 'Button', key: 'junkd-toggle' }))?.text).toBe('✚ junkd')
})

test('T27: /junkd:junkd toggles the pane', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd:junkd')
  expect(opened(rec, 'junkd')).toHaveLength(1)
  await run($, 'junkd:junkd')
  expect(closes(rec, 'junkd')).toHaveLength(1)
})

test('the mobile surface gets the engine pane, not ours', W, async ($, on) => {
  world(on, fixture())
  const pane = await $.ui.mount({ plugin: 'junkd', surface: 'mobile' as never, ...PANE })
  expect(await pane.find({ key: 'engine' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Plugins' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'close' })).toBeUndefined()
})

test('AC2: a checkout marketplace two levels up wins; the cache copy is never read', W, async ($, on) => {
  const files = fixture()
  const rec = world(on, files, { checkout: JSON.stringify({ name: 'checkout-mk', plugins: [entry('onlyme', 'x'), entry('junkd', 'self')] }) })
  const pane = await openPane($)
  expect(await pane.find({ type: 'Box', key: 'plugin-row:onlyme' })).toBeDefined()
  expect(await pane.find({ type: 'Box', key: 'plugin-row:statusline' })).toBeUndefined()
  expect(rec.reads).not.toContain(MARKETPLACE_JSON)
  expect((await pane.find({ type: 'Text', text: /checkout-mk$/ }))?.text).toBe('✚ junkd  checkout-mk')
})

test('AC2: no marketplace.json anywhere -> the error note and no plugin rows; Settings is drawn all the same', W, async ($, on) => {
  const files = fixture()
  delete files[MARKETPLACE_JSON]
  const rec = world(on, files)
  const pane = await openPane($)
  expect(opened(rec, 'junkd')).toHaveLength(1)
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ Error: junk-drawer marketplace.json not found')
  expect(await keysOf(pane, 'plugin-row:')).toEqual([])
  expect(await keysOf(pane, 'setting:')).toEqual(MAIN_ROWS)
  expect(await pane.find({ key: 'no-settings' })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: 'No commands.' }))?.text).toBe('No commands.')
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys a-l setting  tab move  q close')
})

test('AC2: a broken marketplace.json is the note; an empty object draws no rows and the default name', W, async ($, on) => {
  const files = fixture()
  files[MARKETPLACE_JSON] = '{ nope'
  world(on, files)
  const pane = await openPane($)
  expect((await pane.find({ key: 'note' }))?.text).toMatch(/^✗ /)
  expect(await keysOf(pane, 'plugin-row:')).toEqual([])
  expect(await keysOf(pane, 'group:')).toEqual(GROUP_BOXES)
  await pane.unmount()
  files[MARKETPLACE_JSON] = '{}'
  const pane2 = await openPane($) // closes, then
  await pane2.unmount()
  const pane3 = await openPane($)
  expect((await pane3.find({ key: 'note' }))?.text).toBe('')
  expect(await keysOf(pane3, 'plugin-row:')).toEqual([])
  expect((await pane3.find({ type: 'Text', text: /junk-drawer$/ }))?.text).toBe('✚ junkd  junk-drawer')
  expect((await pane3.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys a-l setting  tab move  q close')
})

test('AC2: no settings.json yet -> created with enabledPlugins only, the temp file gone', W, async ($, on) => {
  const files = fixture()
  delete files[SETTINGS]
  const rec = world(on, files)
  const pane = await openPane($)
  expect((await pane.find({ type: 'Button', key: 'plugin:statusline' }))?.text).toBe('on')
  await pane.press({ key: 'plugin:statusline' })
  expect(files[SETTINGS]).toBe(`${JSON.stringify({ enabledPlugins: { 'statusline@junk-drawer': true } }, null, 2)}\n`)
  expect(Object.keys(files).filter(k => k.endsWith('.junkd-tmp'))).toEqual([])
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ statusline on: run /reload-plugins')
  expect(rec.writes).toEqual([`${SETTINGS}.junkd-tmp`])
})

test('AC2: settings.json is a symlink -> written beside the real file, through the link', W, async ($, on) => {
  const files = fixture()
  files['/fake/real/settings.json'] = files[SETTINGS]!
  const rec = world(on, files, { realPath: { [SETTINGS]: '/fake/real/settings.json' } })
  const pane = await openPane($)
  await pane.press({ key: 'plugin:statusline' })
  expect(rec.writes).toEqual(['/fake/real/settings.json.junkd-tmp'])
  expect(rec.mvs).toEqual([['/fake/real/settings.json.junkd-tmp', '/fake/real/settings.json']])
  expect(JSON.parse(files['/fake/real/settings.json']!).enabledPlugins['statusline@junk-drawer']).toBe(true)
  expect(JSON.parse(files[SETTINGS]!).enabledPlugins['statusline@junk-drawer']).toBeUndefined()
})

test('AC2: mv fails -> the note names stderr, the file stays, no reload row', W, async ($, on) => {
  const files = fixture()
  const before = files[SETTINGS]
  world(on, files, { mvExit: 1, mvErr: 'mv: denied' })
  const pane = await openPane($)
  await pane.press({ key: 'plugin:statusline' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ Error: mv: denied')
  expect(files[SETTINGS]).toBe(before)
  expect(await pane.find({ type: 'Text', text: 'run /reload-plugins to apply' })).toBeUndefined()
})

test('AC2: mv fails with empty stderr -> `mv exited N`', W, async ($, on) => {
  world(on, fixture(), { mvExit: 3 })
  const pane = await openPane($)
  await pane.press({ key: 'plugin:statusline' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ Error: mv exited 3')
})

// The old "only tldr loaded" case has no counterpart (every group is the module's); its second half stands: a read
// that throws draws the row's default and the rest of the pane.
test("AC3: a group's read that throws draws the row's default, no note, every other row as it is", withOptions({ tldr_sentences: 4 }), async ($, on) => {
  const files = fixture()
  files[`${CFG}/junkd/tldr-on`] = ''
  files[`${CFG}/tldr-on`] = ''
  world(on, files, { existsThrows: /tldr-on$/ })
  const pane = await openPane($)
  expect(await keysOf(pane, 'setting:')).toEqual(MAIN_ROWS)
  expect((await pane.find({ type: 'Box', key: 'set:tldr:terse-pill' }))?.text).toBe(' off ') // the default: the read threw
  expect((await pane.find({ type: 'Input', key: 'set:tldr:sentences' }))?.props.value).toBe('4') // read as it is
  expect((await pane.find({ key: 'note' }))?.text).toBe('')
})

// The real groups have 8 booleans, a choice, numbers: the view's own edges (more booleans than letters, a type it
// does not draw, a number with no value) are drawn by panelView itself, through a Pane the module passes on.
test('AC3: the view: 26 booleans -> q skipped, the 25th z, the 26th none; an unsupported type is named; no value -> empty input', W, async ($, on) => {
  world(on, fixture(), {
    render: (els, requestId) =>
      requestId === 'edges'
        ? panelView(els, paneOf('edges', 'edges').props as never, {
            marketplace: 'junk-drawer', version: '', settingsPath: '~/.claude/settings.json', plugins: [], commands: [], groups: ['wide'], note: '', isChanged: false,
            sections: [{
              group: 'wide',
              hasPane: false,
              fields: [
                ...Array.from({ length: 26 }, (_, i) => ({ key: `b${i}`, type: 'boolean', title: `bool ${i}`, value: false })),
                { key: 'blob', type: 'object', title: 'An object', value: {} },
                { key: 'num', type: 'number', title: 'No value', value: undefined },
              ],
            }],
          }, { close: () => {}, togglePlugin: () => {}, set: () => {}, openPane: () => {} })
        : undefined,
  })
  const pane = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...paneOf('edges', 'edges') })
  const hk = async (i: number) => (await pane.find({ type: 'Button', key: `set:wide:b${i}` }))?.props.hotkey
  expect(await hk(0)).toBe('a')
  expect(await hk(15)).toBe('p')
  expect(await hk(16)).toBe('r')
  expect(await hk(24)).toBe('z')
  expect(await hk(25)).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys a-z setting  tab move  q close')
  expect((await pane.find({ type: 'Text', text: 'unsupported type object' }))?.props.color).toBe('error')
  expect(await pane.find({ type: 'Input', key: 'set:wide:blob' })).toBeUndefined()
  expect((await pane.find({ type: 'Input', key: 'set:wide:num' }))?.props.value).toBe('')
})

test('AC3: before the first read the Settings section says it is reading', W, async ($, on) => {
  world(on, fixture())
  const pane = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE }) // drawn, never opened: no read yet
  expect((await pane.find({ key: 'no-settings' }))?.text).toBe('reading…')
  expect(await keysOf(pane, 'group:')).toEqual([])
})

// Two presses at once: each press refreshes, so two refreshes run side by side. Each must draw every section once
// (a section drawn twice is two Inputs under one key, which the engine refuses to draw), and two plugin flips at
// once must both land in settings.json (one read-modify-write after the other, never two over one temp file).
test('AC3: two setting presses at once draw each section once, with no render error', W, async ($, on) => {
  const rec = world(on, fixture())
  const pane = await openPane($)
  await Promise.all([pane.press({ key: 'set:handoff:autoOn' }), pane.press({ key: 'set:tldr:terse' })])
  expect(await keysOf(pane, 'group:')).toEqual(GROUP_BOXES)
  expect(await keysOf(pane, 'setting:')).toEqual(MAIN_ROWS)
  expect(junkdRows(rec).map(r => r.key).sort()).toEqual(['junkd.handoff_autoOn', 'junkd.tldr_terse'])
})

test('AC3: a refresh that ends after a newer one is dropped: the pane keeps the newer rows', W, async ($, on) => {
  // The next settings.read after the gate is set answers the merged settings of that moment, but only once the gate
  // opens: that refresh ends last, with rows older than the one started after it.
  let open = () => {}
  const rec = world(on, fixture())
  const pane = await openPane($)
  expect(await pane.find({ type: 'Text', text: /on in this project/ })).toBeUndefined()
  rec.readGate = new Promise<void>(r => { open = r })
  const older = pane.press({ key: 'set:tldr:terse' }) // reads statusline off, then waits
  await new Promise(r => setTimeout(r, 50))
  rec.merged = JSON.stringify({ enabledPlugins: { ...ALL_ON, 'statusline@junk-drawer': true } })
  await pane.press({ key: 'set:handoff:autoOn' }) // reads statusline on in this project, ends first
  expect((await pane.find({ type: 'Text', text: /on in this project/ }))?.text).toBe('(on in this project) Status line')
  open()
  await older
  await new Promise(r => setTimeout(r, 50))
  expect((await pane.find({ type: 'Text', text: /on in this project/ }))?.text).toBe('(on in this project) Status line')
  expect((await pane.find({ type: 'Button', key: 'set:handoff:autoOn' }))?.text).toBe('off') // the newer read: autoOn on
})

test('AC2: two plugin flips at once both land in settings.json, the temp file gone', W, async ($, on) => {
  const rec = world(on, fixture())
  const pane = await openPane($)
  await Promise.all([pane.press({ key: 'plugin:statusline' }), pane.press({ key: 'plugin:ctx-tokens' })])
  expect(JSON.parse(rec.files[SETTINGS]!).enabledPlugins).toEqual({ ...ALL_ON, 'statusline@junk-drawer': true, 'ctx-tokens@junk-drawer': false })
  expect(Object.keys(rec.files).filter(k => k.endsWith('.junkd-tmp'))).toEqual([])
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ ctx-tokens off: run /reload-plugins')
})

test('AC3: after settings ▸ the next /junkd opens again; a reopen clears the note', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  const pane = await openPane($)
  await pane.press({ key: 'set:orch:guard=off' })
  expect(junkdRows(rec)).toEqual([{ key: 'junkd.orch_guard', value: 'off' }])
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ orch.guard = "off"')
  const at = rec.log.length
  await pane.press({ key: 'pane:orch' })
  expect(rec.log.slice(at)).toEqual(['ui.open orch', 'ui.close junkd', 'ui.close ahandoff', 'ui.close statusline', 'ui.close junkd-tools', 'ui.open orch focus'])
  expect(closes(rec, 'junkd')).toEqual(['junkd'])
  await pane.unmount()
  await run($, 'junkd')
  expect(opened(rec, 'junkd')).toHaveLength(2)
  expect(closes(rec, 'junkd')).toEqual(['junkd'])
  const pane2 = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  expect((await pane2.find({ key: 'note' }))?.text).toBe('')
})

test('AC4: command.list throws -> No commands., no note, the rest drawn', W, async ($, on) => {
  world(on, fixture(), { listThrows: true })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: 'No commands.' }))?.text).toBe('No commands.')
  expect((await pane.find({ key: 'note' }))?.text).toBe('')
  expect(await pane.find({ type: 'Box', key: 'plugin-row:ctx-limit' })).toBeDefined()
})

// ------------------------------------------------------------------ core_output_style (the flag scripts/setup.sh reads)

const styleWrites = (rec: { writes: string[] }) => rec.writes.filter(w => w === STYLE_FLAG)
const styleRms = (rec: { rms: string[][] }) => rec.rms.filter(r => r.at(-1) === STYLE_FLAG)

test('AC3: core_output_style ste (the default) at load removes the flag file at session start', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  expect(styleRms(rec)).toEqual([['rm', '-f', '--', STYLE_FLAG]])
  expect(styleWrites(rec)).toEqual([])
  expect(STYLE_FLAG in rec.files).toBe(false)
})

test('AC3: core_output_style off at load: the flag file is written at session start, nothing removed', withOptions({ core_output_style: 'off' }), async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  expect(styleWrites(rec)).toEqual([STYLE_FLAG])
  expect(rec.files[STYLE_FLAG]).toBe('')
  expect(styleRms(rec)).toEqual([])
  expect(await call($, 'get', { key: 'core_output_style' })).toBe('off')
})

// The engine holds a stored option to the manifest's `options` before register sees it: ' OFF ' (not spelled
// `off`) or `blue` reads as the default, ste, and the module's own guard agrees.
for (const stored of [' OFF ', 'blue']) {
  test(`AC3: a stored value the options do not name (${JSON.stringify(stored)}) is the default ste: the flag is removed`, withOptions({ core_output_style: stored }), async ($, on) => {
    const rec = world(on, fixture())
    await start($)
    expect(styleWrites(rec)).toEqual([])
    expect(styleRms(rec)).toEqual([['rm', '-f', '--', STYLE_FLAG]])
    expect(await call($, 'get', { key: 'core_output_style' })).toBe('ste')
  })
}

// Every accepted spelling, through each write path: the noun's set (junkd's own write: the host skips junkd's
// config.set hook, so set applies the flag itself) and the /config menu's row (another plugin's write: the hook).
const SPELLINGS: [raw: string, value: 'ste' | 'off'][] = [['off', 'off'], ['ste', 'ste'], [' Off ', 'off'], ['STE', 'ste'], ['OFF', 'off'], [' ste ', 'ste']]

test('AC3: set core_output_style takes ste and off in any case and spacing: the row, the flag file and get follow', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  for (const [raw, value] of SPELLINGS) {
    expect(await call($, 'set', { key: 'core_output_style', value: raw }), raw).toBe(value)
    expect(rec.config.at(-1), raw).toEqual({ key: 'junkd.core_output_style', value })
    expect(STYLE_FLAG in rec.files, raw).toBe(value === 'off')
    expect(await call($, 'get', { key: 'core_output_style' }), raw).toBe(value)
  }
  expect(await call($, 'set', { key: 'core_output_style', value: 'off', scope: 'user' })).toBe('off') // the one scope there is
})

test('AC3: a write to the junkd.core_output_style row by the /config menu mirrors into the flag file, each spelling normalised', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  for (const [raw, value] of SPELLINGS) {
    expect(await menuSet($, 'junkd.core_output_style', raw), raw).toEqual({ value })
    expect(rec.config.at(-1), raw).toEqual({ key: 'junkd.core_output_style', value }) // the row takes the normalised value
    expect(STYLE_FLAG in rec.files, raw).toBe(value === 'off')
    expect(await call($, 'get', { key: 'core_output_style' }), raw).toBe(value)
  }
  expect(styleRms(rec).at(-1)).toEqual(['rm', '-f', '--', STYLE_FLAG])
  // the next session start writes what the row holds last
  await menuSet($, 'junkd.core_output_style', 'off')
  rec.writes.length = 0
  await start($)
  expect(styleWrites(rec)).toEqual([STYLE_FLAG])
})

test('AC3: a value the options do not name is refused on both paths, the row and the flag file untouched; another row passes the core hook', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  for (const bad of ['blue', '', 'ste off', true, 1]) {
    const why = `junkd: ${String(bad)} is not a valid output_style (ste or off)`
    expect(await menuSet($, 'junkd.core_output_style', bad), String(bad)).toEqual({ deny: why })
    expect(await refusal($, 'set', { key: 'core_output_style', value: bad }), String(bad)).toContain(why)
  }
  expect(rec.config).toEqual([])
  expect(STYLE_FLAG in rec.files).toBe(false)
  expect(styleWrites(rec)).toEqual([])
  expect(await call($, 'get', { key: 'core_output_style' })).toBe('ste')
  expect(await menuSet($, 'junkd.core_x', 'blue')).toEqual({ value: 'blue' }) // no core row: the hook lets it by
  expect(await menuSet($, 'other.output_style', 'blue')).toEqual({ value: 'blue' }) // not junkd's row
  expect(rec.config).toEqual([{ key: 'junkd.core_x', value: 'blue' }, { key: 'other.output_style', value: 'blue' }])
  expect(styleWrites(rec)).toEqual([])
})

test('AC3: a write another hook refuses leaves the flag file alone, on both paths, and the next session start keeps the old value', W, async ($, on) => {
  on('config.set', { key: 'junkd.core_output_style' }, () => ({ deny: 'locked' }))
  const rec = world(on, fixture())
  await start($)
  expect(await menuSet($, 'junkd.core_output_style', 'off')).toEqual({ deny: 'locked' })
  expect(await refusal($, 'set', { key: 'core_output_style', value: 'off' })).toContain('locked')
  expect(STYLE_FLAG in rec.files).toBe(false)
  expect(styleWrites(rec)).toEqual([])
  expect(await call($, 'get', { key: 'core_output_style' })).toBe('ste')
  await start($)
  expect(styleWrites(rec)).toEqual([])
  expect(styleRms(rec)).toHaveLength(2)
})

// ------------------------------------------------------------------ core_cache_check_sessions (the cache check's N)

const CACHE_ROW = 'junkd.core_cache_check_sessions'
const cacheWhy = (raw: unknown) => `junkd: ${String(raw)} is not a valid cache_check_sessions (a whole number 0–30)`

test('AC3: set core_cache_check_sessions takes a whole number 0-30 (the bounds included), a numeric string too; get and config follow', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  expect(await call($, 'get', { key: 'core_cache_check_sessions' })).toBe(10) // the manifest default
  for (const [raw, value] of [[0, 0], [30, 30], [1, 1], [29, 29], ['7', 7], [' 12 ', 12], [10, 10]] as const) {
    expect(await call($, 'set', { key: 'core_cache_check_sessions', value: raw }), String(raw)).toBe(value)
    expect(rec.config.at(-1), String(raw)).toEqual({ key: CACHE_ROW, value })
    expect(await call($, 'get', { key: 'core_cache_check_sessions' }), String(raw)).toBe(value)
  }
  await call($, 'set', { key: 'core_cache_check_sessions', value: 0 })
  expect(await call($, 'config')).toMatchObject({ core_cache_check_sessions: 0 })
})

test('AC3: set core_cache_check_sessions refuses 31, -1, 2.5 and what is no number; the row and get untouched', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await call($, 'set', { key: 'core_cache_check_sessions', value: 5 })
  const rows = rec.config.length
  for (const bad of [31, -1, 2.5, 29.5, '31', '-1', '2.5', 'x', '', ' ', true, false, null]) {
    expect(await refusal($, 'set', { key: 'core_cache_check_sessions', value: bad }), String(bad)).toContain(cacheWhy(bad))
    expect(await call($, 'get', { key: 'core_cache_check_sessions' }), String(bad)).toBe(5)
  }
  expect(rec.config).toHaveLength(rows)
})

test('AC3: the /config menu writes to junkd.core_cache_check_sessions as set does: 0 and 30 stored as numbers, 31, -1 and 2.5 denied', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  for (const [raw, value] of [[0, 0], ['30', 30], [30, 30], [' 4 ', 4]] as const) {
    expect(await menuSet($, CACHE_ROW, raw), String(raw)).toEqual({ value })
    expect(rec.config.at(-1), String(raw)).toEqual({ key: CACHE_ROW, value })
    expect(await call($, 'get', { key: 'core_cache_check_sessions' }), String(raw)).toBe(value)
  }
  const rows = rec.config.length
  for (const bad of [31, -1, 2.5, 'x', true]) {
    expect(await menuSet($, CACHE_ROW, bad), String(bad)).toEqual({ deny: cacheWhy(bad) })
    expect(await call($, 'get', { key: 'core_cache_check_sessions' }), String(bad)).toBe(4)
  }
  expect(rec.config).toHaveLength(rows)
  // the output_style row still has its own check beside it
  expect(await menuSet($, 'junkd.core_output_style', 7)).toEqual({ deny: 'junkd: 7 is not a valid output_style (ste or off)' })
})

test('AC3: a write another hook refuses keeps the old value, on both paths', W, async ($, on) => {
  on('config.set', { key: CACHE_ROW }, () => ({ deny: 'locked' }))
  world(on, fixture())
  await start($)
  expect(await menuSet($, CACHE_ROW, 3)).toEqual({ deny: 'locked' })
  expect(await refusal($, 'set', { key: 'core_cache_check_sessions', value: 3 })).toContain('locked')
  expect(await call($, 'get', { key: 'core_cache_check_sessions' })).toBe(10)
})

// The option at load is no write: rounded, out of range clamped (the manifest row has no min or max, so the host
// lets 31 and -1 through to register). The host still holds an option to the manifest's type: a string fails the
// load of the whole module, so its reading is applyCacheSettings' own (below).
for (const [stored, value] of [[0, 0], [30, 30], [31, 30], [-1, 0], [1000, 30], [2.5, 3], [2.4, 2], [29.6, 30]] as const) {
  test(`AC3: a core_cache_check_sessions option of ${JSON.stringify(stored)} at load reads as ${value}`, withOptions({ core_cache_check_sessions: stored }), async ($, on) => {
    world(on, fixture())
    await start($)
    expect(await call($, 'get', { key: 'core_cache_check_sessions' })).toBe(value)
  })
}

test('AC3: applyCacheSettings: out of range clamped to the bound, a numeric string taken, anything else the default', () => {
  for (const [stored, value] of [[0, 0], [30, 30], [31, 30], [-1, 0], [1000, 30], [-0.4, 0], [2.5, 3], ['12', 12], [' 7 ', 7], ['31', 30], ['x', 10], ['', 10], [' ', 10], [true, 10], [null, 10], [undefined, 10], [Number.NaN, 10], [Infinity, 10]] as const) {
    C.sessions = -99
    applyCacheSettings(stored)
    expect(C.sessions, String(stored)).toBe(value)
  }
  C.sessions = 10
})

// ------------------------------------------------------------------ the `$.junkd` noun (index.tsx)

// The manifest's userConfig rows, in order (tests/smoke.sh holds settings.ts to plugin.json row for row).
const MANIFEST_KEYS = [
  'core_output_style', 'core_cache_check_sessions',
  'handoff_enabled', 'handoff_threshold', 'handoff_checkEvery', 'handoff_autoOn', 'handoff_resumeAfterLimit', 'handoff_staleDays', 'handoff_segment',
  'orch_enabled', 'orch_guard', 'orch_allow_fable_agents', 'orch_implementer_ctx_k', 'orch_ui_review', 'orch_inject_rules', 'orch_rounds', 'orch_claude_md',
  'tldr_enabled', 'tldr_terse', 'tldr_sentences',
  'ctx_enabled', 'ctx_threshold', 'ctx_action', 'ctx_cmd',
  'statusline_enabled', 'statusline_ctx', 'statusline_branch', 'statusline_worktree', 'statusline_model', 'statusline_effort', 'statusline_limits',
  'tools_enabled', 'tools_refresh', 'tools_agents_only',
]

test('$.junkd.schema() is the manifest rows: keys, groups and fields, in order, each feature group led by enabled', W, async ($, on) => {
  world(on, fixture())
  const schema = (await call($, 'schema')) as { key: string; group: string; field: string; type: string; title: string; default: unknown; main: boolean; options?: string[] }[]
  expect(schema.map(f => f.key)).toEqual(MANIFEST_KEYS)
  expect(schema).toEqual(SCHEMA.map(f => ({ ...f, ...(f.options ? { options: [...f.options] } : {}) })))
  for (const f of schema) {
    expect(f.key, f.key).toBe(`${f.group}_${f.field}`)
    expect(typeof f.default, f.key).toBe(f.type)
    expect(f.title, f.key).toMatch(/\S/)
  }
  expect([...new Set(schema.map(f => f.group))]).toEqual(['core', 'handoff', 'orch', 'tldr', 'ctx', 'statusline', 'tools'])
  for (const g of ['handoff', 'orch', 'tldr', 'ctx', 'statusline', 'tools']) expect(schema.find(f => f.group === g)?.field, g).toBe('enabled')
  expect(schema.find(f => f.key === 'core_output_style')).toMatchObject({ type: 'string', default: 'ste', options: ['ste', 'off'], main: true })
  expect(schema.find(f => f.key === 'core_cache_check_sessions')).toEqual({ key: 'core_cache_check_sessions', group: 'core', field: 'cache_check_sessions', type: 'number', title: 'Cache check: sessions read', default: 10, main: true })
})

test('$.junkd.config() answers every row: the defaults, then the values the options and the writes gave', withOptions(AWAY), async ($, on) => {
  world(on, fixture())
  await start($)
  const expected = Object.fromEntries(SCHEMA.map(f => [f.key, f.default])) as Record<string, unknown>
  Object.assign(expected, AWAY)
  const config = (await call($, 'config')) as Record<string, unknown>
  expect(Object.keys(config)).toEqual(MANIFEST_KEYS)
  expect(config).toEqual(expected)
  for (const key of MANIFEST_KEYS) expect(await call($, 'get', { key }), key).toBe(expected[key])
  await call($, 'set', { key: 'core_output_style', value: 'off' })
  await call($, 'set', { key: 'handoff_threshold', value: 60 })
  expect(await call($, 'config')).toEqual({ ...expected, core_output_style: 'off', handoff_threshold: 60 })
})

test('$.junkd refusals: an unknown setting, a scope not yet supported, an unknown pane or tab', W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  for (const key of ['x', 'core_x', 'output_style', 'handoff.threshold']) {
    expect(await refusal($, 'get', { key }), key).toContain(`junkd: no setting ${key}`)
    expect(await refusal($, 'set', { key, value: 'off' }), key).toContain(`junkd: no setting ${key}`)
  }
  expect(await refusal($, 'set', { key: 'core_output_style', value: 'off', scope: 'project' })).toContain('junkd: scope project is not supported yet')
  expect(await refusal($, 'open', { pane: 'x' })).toContain('junkd: no pane x')
  expect(await refusal($, 'open', { pane: 'handoff', route: 'nope' })).toContain('junkd: no tab nope')
  expect(await refusal($, 'open', { pane: 'junkd', route: 'settings' })).toContain('junkd: the junkd pane has no tab settings')
  expect(rec.config).toEqual([]) // nothing written
  expect(rec.opens).toEqual([]) // nothing opened
})

test("$.junkd.open({ pane: 'junkd' }) toggles the set as /junkd does", W, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  expect(await call($, 'open', { pane: 'junkd' })).toBe(null)
  expect(rec.log).toEqual(OPEN_SET)
  rec.log.length = 0
  await call($, 'open', { pane: 'junkd' })
  expect(rec.log).toEqual(CLOSE_SET)
  rec.log.length = 0
  await run($, 'junkd') // the same toggle: opens again
  expect(rec.log).toEqual(OPEN_SET)
})
