// The junkd mod: the pane's three sections over a fake config tree and fake handoff/orch/tldr plugins (inline, each
// adding its noun to `$` as the real one does), the toggles (/junkd, /junkd:junkd, ✚ junkd, q). Nothing touches a
// real home: every fs/process/settings call is answered from memory by `world`.
import { expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

const CFG = '/fake/claude'
const MKT = `${CFG}/plugins/marketplaces/junk-drawer`
const MARKETPLACE_JSON = `${MKT}/.claude-plugin/marketplace.json`
const SETTINGS = `${CFG}/settings.json`
const ALL_ON = { 'handoff@junk-drawer': true, 'orch@junk-drawer': true, 'tldr@junk-drawer': true, 'other@x': true }

const entry = (name: string, description: string) => ({ name, source: `./plugins/${name}`, description })
const fixture = (enabledPlugins: Record<string, boolean> = ALL_ON): Record<string, string> => ({
  [MARKETPLACE_JSON]: JSON.stringify({
    name: 'junk-drawer',
    plugins: [entry('statusline', 'Status line'), entry('tldr', 'Summarize'), entry('handoff', 'Handoffs'), entry('orch', 'Orchestrate'), entry('junkd', 'The frame')],
  }),
  [SETTINGS]: JSON.stringify({ theme: 'dark', enabledPlugins }),
})

// The three nouns as the real plugins declare them (their SCHEMA, `main` included); get answers fixed values (one
// per noun away from its default, so a default drawn in a value's place shows), set
// and open throw unless a hook answers (the test's own hooks beneath record the calls). An inline plugin closes
// over nothing of this file, so each spells its own throw.
const FAKE_HANDOFF: Plugin = {
  name: 'handoff',
  register(on) {
    on('engine.create', async (_$, e, next) => ({
      ...(await next(e)),
      handoff: {
        schema: async () => [
          { key: 'threshold', type: 'number', title: 'Auto handoff: context threshold (%)', default: 85, main: true },
          { key: 'checkEvery', type: 'number', title: 'Auto handoff: check every N tool calls', default: 5, main: false },
          { key: 'autoOn', type: 'boolean', title: 'Auto handoff: armed at session start', default: false, main: true },
          { key: 'resumeAfterLimit', type: 'boolean', title: 'Auto handoff: resume after the 5h rate limit', default: true, main: true },
          { key: 'staleDays', type: 'number', title: 'Handoffs: mark stale after N days', default: 30, main: false },
          { key: 'segment', type: 'boolean', title: 'Status line: show the 🪃 segment', default: true, main: true },
        ],
        get: async (key: string) => ({ threshold: 70, checkEvery: 5, autoOn: false, resumeAfterLimit: true, staleDays: 30, segment: true } as Record<string, number | boolean>)[key]!,
        set: async () => { throw new Error('handoff: the hooks module did not answer') },
        open: async () => { throw new Error('handoff: the hooks module did not answer') },
        status: async () => ({ armed: false, percent: 0, phase: 'idle' }),
      },
    }))
  },
}
const FAKE_ORCH: Plugin = {
  name: 'orch',
  register(on) {
    on('engine.create', async (_$, e, next) => ({
      ...(await next(e)),
      orch: {
        schema: async () => [
          { key: 'guard', type: 'string', title: 'Main-loop guard', default: 'fable', main: true, options: ['fable', 'always', 'off'] },
          { key: 'allow_fable_agents', type: 'boolean', title: 'Allow Fable subagents', default: false, main: true },
          { key: 'implementer_ctx_k', type: 'number', title: 'Implementer context cap (k tokens)', default: 400, main: true },
          { key: 'ui_review', type: 'boolean', title: 'UI review', default: true, main: false },
          { key: 'inject_rules', type: 'boolean', title: 'Inject orchestrator rules', default: true, main: false },
          { key: 'rounds', type: 'number', title: 'Fix rounds', default: 3, main: false },
        ],
        get: async (input: { key: string }) => ({ guard: 'fable', allow_fable_agents: true, implementer_ctx_k: 400, ui_review: true, inject_rules: true, rounds: 3 } as Record<string, string | number | boolean>)[input.key]!,
        set: async () => { throw new Error('orch: the hooks module did not answer') },
        open: async () => { throw new Error('orch: the hooks module did not answer') },
        guardState: async () => ({ active: false, model: 'x' }),
      },
    }))
  },
}
const FAKE_TLDR: Plugin = {
  name: 'tldr',
  register(on) {
    on('engine.create', async (_$, e, next) => ({
      ...(await next(e)),
      tldr: {
        schema: async () => [
          { key: 'terse', type: 'boolean', title: 'Terse mode', default: false, main: true },
          { key: 'sentences', type: 'number', title: 'Sentences in a summary', default: 3, main: true },
        ],
        get: async (input: { key: string }) => ({ terse: false, sentences: 4 } as Record<string, number | boolean>)[input.key]!,
        set: async () => { throw new Error('tldr: the hooks module did not answer') },
      },
    }))
  },
}
const WITH_NOUNS = { plugins: [FAKE_HANDOFF, FAKE_ORCH, FAKE_TLDR] }
// A close of the junkd pane from outside the module, as the person's q or × is to it (the test's own `$` has no
// ui.close): `/shut` closes it through another plugin's `$.ui.close`.
const SHUTTER: Plugin = {
  name: 'shutter',
  register(on) {
    on('command.run', { command: 'shut' }, async $ => { await $.ui.close({ id: 'junkd' }); return {} })
  },
}

type Open = { id: string; title?: string; focus?: true }
type Call = { noun: string; method: string; input: unknown }
// `nouns`: the fake plugins are loaded (WITH_NOUNS), so their events can be hooked; a hook on a noun no plugin
// provides fails the load.
function world(on: On, files: Record<string, string>, nouns = false) {
  const rec = { files, reads: [] as string[], toasts: [] as string[], opens: [] as Open[], closed: [] as string[], calls: [] as Call[],
    commands: [] as { name: string; description: string; source: 'builtin' | 'plugin' | 'user' | 'mcp'; plugin?: string }[], denyOrchOpen: '', beneath: '', merged: '' }
  on('env.get', (_$, e) => ({ value: ({ CLAUDE_CONFIG_DIR: CFG, HOME: '/fake/home' } as Record<string, string>)[e.name] }))
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  on('fs.read', (_$, e) => {
    rec.reads.push(e.path)
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path]! }
  })
  on('fs.stat', (_$, e) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
  })
  on('fs.write', (_$, e) => { files[e.path] = e.text; return { value: undefined } })
  on('process.run', (_$, e) => {
    const [bin, , from, to] = e.argv
    expect(bin).toBe('/bin/mv')
    files[to!] = files[from!]!
    delete files[from!]
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // What the engine merged (user, project, local...): the user file alone unless `merged` says otherwise.
  on('settings.read', () => ({ value: JSON.parse(rec.merged || files[SETTINGS] || '{}') }))
  on('ui.open', (_$, e) => { rec.opens.push({ id: e.id, title: e.title, focus: e.focus }); return { value: { isPlaced: true as const } } })
  on('ui.close', (_$, e) => { rec.closed.push(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: rec.commands }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // The engine's own drawing where the mod passes; under the prompt, another plugin's hint when `beneath` names one.
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return e.component === 'PromptHint' && rec.beneath ? <Text>{rec.beneath}</Text> : <Box key="engine" />
  })
  if (!nouns) return rec
  // Each noun's set and open, answered beneath the fake plugins: recorded, and answered as the real one would.
  on('handoff.set', (_$, e) => { rec.calls.push({ noun: 'handoff', method: 'set', input: e }); return { value: e.value as number | boolean } })
  on('handoff.open', (_$, e) => { rec.calls.push({ noun: 'handoff', method: 'open', input: e }); return { value: undefined } })
  on('orch.set', (_$, e) => {
    rec.calls.push({ noun: 'orch', method: 'set', input: e })
    return e.key === 'implementer_ctx_k' && e.value === '0' ? { deny: `orch: 0 is not a valid implementer_ctx_k` } : { value: e.value }
  })
  on('orch.open', (_$, e) => {
    rec.calls.push({ noun: 'orch', method: 'open', input: e })
    return rec.denyOrchOpen ? { deny: rec.denyOrchOpen } : { value: undefined }
  })
  on('tldr.set', (_$, e) => { rec.calls.push({ noun: 'tldr', method: 'set', input: e }); return { value: e.value as number | boolean } })
  return rec
}

const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const
const PANE = {
  component: 'Pane',
  requestId: 'junkd',
  props: { title: 'junkd', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
const run = ($: Engine, command: string) => $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
// Opens the pane through the ✚ junkd click (which loads its data) and mounts it.
async function openPane($: Engine) {
  const hint = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  await hint.press({ key: 'junkd-toggle' })
  return $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
}

test('AC6: ✚ junkd is drawn under the prompt, alone or beside what is beneath; a click opens, the next closes', async ($, on) => {
  const rec = world(on, fixture())
  for (const surface of ['terminal', 'desktop'] as const) {
    rec.beneath = ''
    const alone = await $.ui.mount({ plugin: 'junkd', surface, ...HINT })
    expect((await alone.find({ type: 'Button', key: 'junkd-toggle' }))?.text, surface).toBe('✚ junkd')
    expect(await alone.find({ type: 'Text', text: 'other hint' })).toBeUndefined()
    await alone.unmount()
    rec.beneath = 'other hint'
    const both = await $.ui.mount({ plugin: 'junkd', surface, ...HINT })
    expect((await both.find({ type: 'Button', key: 'junkd-toggle' }))?.text, surface).toBe('✚ junkd')
    expect((await both.find({ type: 'Text', text: 'other hint' }))?.text).toBe('other hint')
    await both.unmount()
  }
  const hint = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  await hint.press({ key: 'junkd-toggle' })
  expect(rec.opens).toEqual([{ id: 'junkd', title: 'junkd', focus: true }])
  expect(rec.closed).toEqual([])
  await hint.press({ key: 'junkd-toggle' })
  expect(rec.opens).toHaveLength(1)
  expect(rec.closed).toEqual(['junkd'])
})

test('AC6: /junkd and /junkd:junkd toggle the pane; q closes it; a close by the person is seen, so the next toggle opens', { plugins: [SHUTTER] }, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd')
  expect(rec.opens).toEqual([{ id: 'junkd', title: 'junkd', focus: true }])
  await run($, 'junkd')
  expect(rec.closed).toEqual(['junkd'])
  await run($, 'junkd:junkd')
  expect(rec.opens).toHaveLength(2)
  await run($, 'junkd:junkd')
  expect(rec.closed).toEqual(['junkd', 'junkd'])

  const pane = await openPane($)
  expect(rec.opens).toHaveLength(3)
  expect((await pane.find({ type: 'Button', key: 'close' }))?.props.hotkey).toBe('q')
  await pane.press({ key: 'close' })
  expect(rec.closed).toEqual(['junkd', 'junkd', 'junkd'])
  await pane.unmount()

  await run($, 'junkd')
  expect(rec.opens).toHaveLength(4)
  await run($, 'shut') // the person's q or ×: the engine's close reaches the hook
  expect(rec.closed).toHaveLength(4)
  await run($, 'junkd')
  expect(rec.opens).toHaveLength(5) // opened again, not closed
  expect(rec.closed).toHaveLength(4)
})

test('AC2: Plugins lists every marketplace plugin, on/off from user-scope settings.json; 1-9 flip one and the pane says to reload', async ($, on) => {
  const rec = world(on, fixture())
  const pane = await openPane($)
  for (const heading of ['Plugins', 'Settings', 'Commands']) expect((await pane.find({ type: 'Text', text: heading }))?.text, heading).toBe(heading)
  expect((await pane.find({ type: 'Text', text: 'user scope, ~/.claude/settings.json' }))?.text).toBe('user scope, ~/.claude/settings.json')
  // The files, by their exact spelling: the checkout's marketplace two levels up (asked first, absent here), then
  // the plugin cache's copy under the config dir; the user-scope settings.json beside it.
  expect(rec.reads[0]).toMatch(/\/\.claude-plugin\/marketplace\.json$/)
  expect(rec.reads[0]).not.toBe(MARKETPLACE_JSON) // the engine resolves `<root>/../..`: this checkout's own root
  expect(rec.reads[0]).not.toMatch(/\/plugins\//) // two levels up from plugins/junkd, not one
  expect(rec.reads[1]).toBe(MARKETPLACE_JSON)
  expect(rec.reads[2]).toBe(SETTINGS)

  for (const name of ['statusline', 'tldr', 'handoff', 'orch', 'junkd']) expect(await pane.find({ type: 'Box', key: `plugin-row:${name}` }), name).toBeDefined()
  const hotkeys = async () => Promise.all(['statusline', 'tldr', 'handoff', 'orch'].map(async n => (await pane.find({ type: 'Button', key: `plugin:${n}` }))?.props.hotkey))
  expect(await hotkeys()).toEqual(['1', '2', '3', '4'])
  expect(await pane.find({ type: 'Button', key: 'plugin:junkd' })).toBeUndefined() // this pane: no switch
  expect((await pane.find({ type: 'Text', text: 'this pane' }))?.text).toBe('this pane')
  const pills = async () => (await pane.findAll({ type: 'Text' })).filter(t => t.text === ' on ' || t.text === ' off ').map(t => t.text)
  expect(await pills()).toEqual([' off ', ' on ', ' on ', ' on ']) // statusline off, tldr, handoff, orch on
  expect((await pane.find({ type: 'Button', key: 'plugin:statusline' }))?.text).toBe('on')
  expect((await pane.find({ type: 'Button', key: 'plugin:tldr' }))?.text).toBe('off')
  expect(await pane.find({ type: 'Text', text: /reload-plugins/ })).toBeUndefined()

  await pane.press({ key: 'plugin:statusline' })
  let settings = JSON.parse(rec.files[SETTINGS]!)
  expect(settings.enabledPlugins).toEqual({ ...ALL_ON, 'statusline@junk-drawer': true })
  expect(settings.theme).toBe('dark')
  expect(Object.keys(rec.files).filter(k => k.endsWith('.junkd-tmp'))).toEqual([])
  expect((await pane.find({ type: 'Text', text: 'run /reload-plugins to apply' }))?.text).toBe('run /reload-plugins to apply')
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ statusline on: run /reload-plugins')
  expect(await pills()).toEqual([' on ', ' on ', ' on ', ' on '])

  await pane.press({ key: 'plugin:tldr' })
  settings = JSON.parse(rec.files[SETTINGS]!)
  expect(settings.enabledPlugins).toEqual({ ...ALL_ON, 'statusline@junk-drawer': true, 'tldr@junk-drawer': false })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ tldr off: run /reload-plugins')
  expect(await pills()).toEqual([' on ', ' off ', ' on ', ' on '])

  // A settings.json that does not parse is never overwritten.
  rec.files[SETTINGS] = '{ broken'
  await pane.press({ key: 'plugin:orch' })
  expect(rec.files[SETTINGS]).toBe('{ broken')
  expect((await pane.find({ key: 'note' }))?.text).toMatch(/^✗ /)
})

test('AC2: a tenth plugin has no hotkey; 1-9 stay with the first nine; the pane is counted out', async ($, on) => {
  const files = fixture()
  const names = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10']
  files[MARKETPLACE_JSON] = JSON.stringify({ name: 'junk-drawer', plugins: [entry('junkd', 'self'), ...names.map(n => entry(n, n))] })
  world(on, files)
  const pane = await openPane($)
  for (const [i, n] of names.entries()) expect((await pane.find({ type: 'Button', key: `plugin:${n}` }))?.props.hotkey, n).toBe(i < 9 ? String(i + 1) : undefined)
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys 1-9 plugin  tab move  q close')
})

test("AC3: Settings shows each loaded, enabled noun's main fields; a letter flips a boolean through that plugin's set; enter saves a number or a choice; settings ▸ calls open", WITH_NOUNS, async ($, on) => {
  const rec = world(on, fixture(), true)
  const pane = await openPane($)

  // Each section: a blank row (marginTop), a dim rule, its name bold in the accent colour; handoff and orch have
  // `settings ▸`, tldr has no pane.
  for (const noun of ['tldr', 'handoff', 'orch']) {
    expect((await pane.find({ type: 'Box', key: `group:${noun}` }))?.props.marginTop, noun).toBe(1)
    const nodes = await pane.findAll({ type: 'Text' })
    const at = nodes.findLastIndex(t => t.text === noun) // the plugin row names it too, above
    expect(nodes[at]?.props.bold, noun).toBe(true)
    expect(nodes[at]?.props.color, noun).toBe('claude')
    expect(nodes[at - 1]?.text, `rule above ${noun}`).toMatch(/^─{20,}$/)
  }
  expect((await pane.find({ type: 'Button', key: 'pane:handoff' }))?.text).toBe('settings ▸')
  expect((await pane.find({ type: 'Button', key: 'pane:orch' }))?.text).toBe('settings ▸')
  expect(await pane.find({ type: 'Button', key: 'pane:tldr' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^no settings/ })).toBeUndefined()

  // The sections in marketplace order (as the Plugins section lists them), the main fields only, in schema order,
  // titled as the schema says.
  const rows = (await pane.findAll({ type: 'Box' })).map(b => b.key).filter(k => k?.startsWith('setting:'))
  expect(rows).toEqual([
    'setting:tldr:terse', 'setting:tldr:sentences',
    'setting:handoff:threshold', 'setting:handoff:autoOn', 'setting:handoff:resumeAfterLimit', 'setting:handoff:segment',
    'setting:orch:guard', 'setting:orch:allow_fable_agents', 'setting:orch:implementer_ctx_k',
  ])
  expect((await pane.find({ type: 'Text', text: 'Auto handoff: context threshold (%)' }))?.text).toBe('Auto handoff: context threshold (%)')
  expect((await pane.find({ type: 'Text', text: 'Sentences in a summary' }))?.text).toBe('Sentences in a summary')
  // The switches, a-e in drawn order, each showing the value get answered.
  const switches = ['tldr:terse', 'handoff:autoOn', 'handoff:resumeAfterLimit', 'handoff:segment', 'orch:allow_fable_agents']
  for (const [i, k] of switches.entries()) expect((await pane.find({ type: 'Button', key: `set:${k}` }))?.props.hotkey, k).toBe('abcde'[i])
  expect((await pane.find({ type: 'Button', key: 'set:handoff:autoOn' }))?.text).toBe('on') // off now: the button turns it on
  expect((await pane.find({ type: 'Button', key: 'set:handoff:segment' }))?.text).toBe('off')
  expect((await pane.find({ type: 'Input', key: 'set:handoff:threshold' }))?.props.value).toBe('70') // get's value, not the default 85
  expect((await pane.find({ type: 'Input', key: 'set:orch:implementer_ctx_k' }))?.props.value).toBe('400')
  expect((await pane.find({ type: 'Input', key: 'set:tldr:sentences' }))?.props.value).toBe('4') // not the default 3
  expect((await pane.find({ type: 'Button', key: 'set:orch:allow_fable_agents' }))?.text).toBe('off') // on by get, off by default
  // The choice: the current option an inverse block, the others Buttons; no engine Select.
  expect(await pane.find({ type: 'Select' })).toBeUndefined()
  expect((await pane.find({ key: 'set:orch:guard=fable' }))?.text).toBe(' fable ')
  expect(await pane.find({ type: 'Button', key: 'set:orch:guard=fable' })).toBeUndefined()
  expect((await pane.find({ type: 'Button', key: 'set:orch:guard=always' }))?.text).toBe('always')
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys 1-4 plugin  a-e setting  tab move  q close')

  // Each write goes to the right plugin's set with the right key: a flip sends the other state, a number as typed
  // (the plugin coerces and validates), a choice its option.
  await pane.press({ key: 'set:handoff:autoOn' })
  await pane.press({ key: 'set:handoff:segment' })
  await pane.press({ key: 'set:orch:allow_fable_agents' })
  await pane.press({ key: 'set:tldr:terse' })
  await pane.input({ key: 'set:handoff:threshold', text: '90' })
  await pane.input({ key: 'set:tldr:sentences', text: '5' })
  await pane.press({ key: 'set:orch:guard=always' })
  expect(rec.calls).toEqual([
    { noun: 'handoff', method: 'set', input: { key: 'autoOn', value: true } },
    { noun: 'handoff', method: 'set', input: { key: 'segment', value: false } },
    { noun: 'orch', method: 'set', input: { key: 'allow_fable_agents', value: false } },
    { noun: 'tldr', method: 'set', input: { key: 'terse', value: true } },
    { noun: 'handoff', method: 'set', input: { key: 'threshold', value: '90' } },
    { noun: 'tldr', method: 'set', input: { key: 'sentences', value: '5' } },
    { noun: 'orch', method: 'set', input: { key: 'guard', value: 'always' } },
  ])
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ orch.guard = "always"')
  // A refused set is the note, nothing else; the field is redrawn under its next key (fieldKey).
  await pane.input({ key: 'set:orch:implementer_ctx_k', text: '0' })
  expect(rec.calls.at(-1)).toEqual({ noun: 'orch', method: 'set', input: { key: 'implementer_ctx_k', value: '0' } })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ orch: 0 is not a valid implementer_ctx_k')
  expect((await pane.find({ type: 'Input', key: 'set:orch:implementer_ctx_k~1' }))?.props.value).toBe('400')
  expect(rec.toasts).toEqual([])

  // settings ▸: handoff opens on its Settings tab, orch its pane; this pane closes so the other can take the keys.
  const calls = rec.calls.length
  await pane.press({ key: 'pane:handoff' })
  expect(rec.calls.slice(calls)).toEqual([{ noun: 'handoff', method: 'open', input: { route: 'settings' } }])
  expect(rec.closed).toEqual(['junkd'])
  await pane.press({ key: 'pane:orch' })
  expect(rec.calls.slice(calls + 1)).toEqual([{ noun: 'orch', method: 'open', input: {} }])
  expect(rec.closed).toEqual(['junkd', 'junkd'])
})

test('AC3: a plugin on in the merged settings shows its section and is marked when off at user scope; one off in the merged settings shows none, even while its hooks are loaded; a refused open keeps the pane', WITH_NOUNS, async ($, on) => {
  const rec = world(on, fixture({ 'handoff@junk-drawer': true, 'orch@junk-drawer': true, 'tldr@junk-drawer': false }), true)
  rec.merged = JSON.stringify({ enabledPlugins: { 'handoff@junk-drawer': true, 'orch@junk-drawer': false, 'tldr@junk-drawer': true } })
  rec.denyOrchOpen = 'orch: no room'
  const pane = await openPane($)
  expect(await pane.find({ type: 'Box', key: 'group:tldr' })).toBeDefined() // on in this project
  expect(await pane.find({ type: 'Box', key: 'group:handoff' })).toBeDefined()
  expect(await pane.find({ type: 'Box', key: 'group:orch' })).toBeUndefined() // off where it counts
  expect(await pane.find({ key: 'set:orch:guard=fable' })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /on in this project/ }))?.text).toBe('(on in this project) Summarize')
  expect((await pane.find({ type: 'Button', key: 'plugin:tldr' }))?.text).toBe('on') // the user-scope switch still says off
  expect((await pane.find({ type: 'Button', key: 'plugin:orch' }))?.text).toBe('off')

  rec.merged = ''
  await pane.press({ key: 'plugin:tldr' }) // on at user scope too: the marker goes, the section stays
  expect(await pane.find({ type: 'Text', text: /on in this project/ })).toBeUndefined()
  expect(await pane.find({ type: 'Box', key: 'group:tldr' })).toBeDefined()
  expect(await pane.find({ type: 'Box', key: 'group:orch' })).toBeDefined()
  await pane.press({ key: 'pane:orch' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ orch: no room')
  expect(rec.closed).toEqual([])
})

test("AC4: Commands lists the enabled plugins' slash commands with their one-line descriptions, from $.command.list()", WITH_NOUNS, async ($, on) => {
  const rec = world(on, fixture(), true)
  rec.commands = [
    { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
    { name: 'tldr:tldr', description: 'TL;DR of the last message', source: 'plugin', plugin: 'tldr' },
    { name: 'handoff:handoff', description: 'Save a handoff', source: 'plugin', plugin: 'handoff' },
    { name: 'ahandoff', description: 'Auto handoff', source: 'plugin', plugin: 'handoff' },
    { name: 'orch:init', description: 'Write .orch/config.md', source: 'plugin' }, // the engine named no plugin: the prefix tells
    { name: 'statusline:init', description: 'Install the status line', source: 'plugin', plugin: 'statusline' }, // off
    { name: 'junkd', description: 'Toggle the junkd pane', source: 'plugin', plugin: 'junkd' },
    { name: 'mine', description: 'A user command', source: 'user' },
    { name: 'handoff:mine', description: "A user command wearing a plugin's prefix", source: 'user' }, // not the plugin's
    { name: 'mcp__x__prompt', description: 'An MCP prompt', source: 'mcp' },
  ]
  const pane = await openPane($)
  const rows = (await pane.findAll({ type: 'Box' })).map(b => b.key).filter(k => k?.startsWith('cmd:'))
  expect(rows).toEqual(['cmd:tldr:tldr', 'cmd:handoff:handoff', 'cmd:ahandoff', 'cmd:orch:init', 'cmd:junkd'])
  expect((await pane.find({ type: 'Text', text: '/handoff:handoff' }))?.text).toBe('/handoff:handoff')
  expect((await pane.find({ type: 'Text', text: 'Save a handoff' }))?.text).toBe('Save a handoff')
  expect((await pane.find({ type: 'Text', text: 'Write .orch/config.md' }))?.text).toBe('Write .orch/config.md')
  expect(await pane.find({ type: 'Text', text: 'Install the status line' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '/handoff:mine' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'No commands.' })).toBeUndefined()
})

test('AC5: with none of handoff, orch and tldr loaded, /junkd opens with Plugins and Commands and an empty-settings note', async ($, on) => {
  const rec = world(on, fixture())
  rec.commands = [{ name: 'junkd', description: 'Toggle the junkd pane', source: 'plugin', plugin: 'junkd' }]
  const pane = await openPane($)
  expect(rec.opens).toEqual([{ id: 'junkd', title: 'junkd', focus: true }])
  for (const heading of ['Plugins', 'Settings', 'Commands']) expect((await pane.find({ type: 'Text', text: heading }))?.text, heading).toBe(heading)
  expect(await pane.find({ type: 'Box', key: 'plugin-row:handoff' })).toBeDefined()
  expect((await pane.find({ key: 'no-settings' }))?.text).toBe('no settings: none of handoff, orch, tldr is loaded')
  expect((await pane.findAll({ type: 'Box' })).map(b => b.key).filter(k => k?.startsWith('group:') || k?.startsWith('setting:'))).toEqual([])
  expect(await pane.find({ type: 'Button', key: 'pane:handoff' })).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: '/junkd' }))?.text).toBe('/junkd')
  expect((await pane.find({ key: 'note' }))?.text).toBe('')
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys 1-4 plugin  tab move  q close')
})
