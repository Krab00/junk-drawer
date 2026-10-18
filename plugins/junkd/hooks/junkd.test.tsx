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
        show: async () => { throw new Error('handoff: the hooks module did not answer') },
        hide: async () => { throw new Error('handoff: the hooks module did not answer') },
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
        show: async () => { throw new Error('orch: the hooks module did not answer') },
        hide: async () => { throw new Error('orch: the hooks module did not answer') },
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
// The edges of a noun: a get that throws (the default stands in), 26 main booleans (LETTERS has 25), a type the pane
// does not draw, a number with no value and no default, a one-field orch.
const FAKE_TLDR_BROKEN_GET: Plugin = {
  name: 'tldr',
  register(on) {
    on('engine.create', async (_$, e, next) => ({
      ...(await next(e)),
      tldr: {
        schema: async () => [
          { key: 'terse', type: 'boolean', title: 'Terse mode', default: false, main: true },
          { key: 'sentences', type: 'number', title: 'Sentences in a summary', default: 3, main: true },
        ],
        get: async (input: { key: string }) => {
          if (input.key === 'sentences') throw new Error('tldr: get broke')
          return ({ terse: true } as Record<string, number | boolean>)[input.key]!
        },
        set: async () => { throw new Error('tldr: the hooks module did not answer') },
      },
    }))
  },
}
const FAKE_HANDOFF_WIDE: Plugin = {
  name: 'handoff',
  register(on) {
    on('engine.create', async (_$, e, next) => ({
      ...(await next(e)),
      handoff: {
        schema: async () => [
          ...Array.from({ length: 26 }, (_, i) => ({ key: `b${i}`, type: 'boolean', title: `bool ${i}`, default: false, main: true })),
          { key: 'blob', type: 'object', title: 'An object', default: {}, main: true },
          { key: 'num', type: 'number', title: 'No value', default: undefined, main: true },
        ],
        get: async (key: string) => (key === 'num' ? undefined : key === 'blob' ? {} : false),
        set: async () => { throw new Error('handoff: the hooks module did not answer') },
        open: async () => { throw new Error('handoff: the hooks module did not answer') },
        show: async () => { throw new Error('handoff: the hooks module did not answer') },
        hide: async () => { throw new Error('handoff: the hooks module did not answer') },
        status: async () => ({ armed: false, percent: 0, phase: 'idle' }),
      },
    }))
  },
}
const FAKE_ORCH_ONE: Plugin = {
  name: 'orch',
  register(on) {
    on('engine.create', async (_$, e, next) => ({
      ...(await next(e)),
      orch: {
        schema: async () => [{ key: 'guard', type: 'string', title: 'Main-loop guard', default: 'fable', main: true, options: ['fable', 'always', 'off'] }],
        get: async () => 'fable',
        set: async () => { throw new Error('orch: the hooks module did not answer') },
        open: async () => { throw new Error('orch: the hooks module did not answer') },
        show: async () => { throw new Error('orch: the hooks module did not answer') },
        hide: async () => { throw new Error('orch: the hooks module did not answer') },
        guardState: async () => ({ active: false, model: 'x' }),
      },
    }))
  },
}
// A close of the junkd pane from outside the module, as the person's q or × is to it (the test's own `$` has no
// ui.close): `/shut` closes it through another plugin's `$.ui.close`.
// The /config menu's own write path: `/cfg <json>` calls `$.config.set` from another plugin (junkd has no noun, so
// this is the only way a value reaches its config.set hook) and carries the answer out as text.
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
// `$.config.set` answers `{ value }` or `{ deny }` (it does not throw); a thrown error is the engine's own.
async function menuSet($: Engine, key: string, value: unknown): Promise<{ value?: unknown; deny?: string }> {
  const r = (await $.command.run({ command: 'cfg', args: JSON.stringify({ key, value }), origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })) as { text?: string }
  const out = JSON.parse(r.text ?? '{}') as { ok?: { value?: unknown; deny?: string }; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok ?? {}
}
const SHUTTER: Plugin = {
  name: 'shutter',
  register(on) {
    on('command.run', { command: 'shut' }, async $ => { await $.ui.close({ id: 'junkd' }); return {} })
  },
}

// handoff and orch with a pane of their own, as the real ones answer show and hide: show opens it (never closes) and
// marks it as `owner`'s; hide closes it, with an owner only while still that owner's; `/<name>-own` toggles it as
// its own command does, which clears the mark. Their pane calls reach the world beneath, so `rec.tabs` is the tab
// row of all three plugins. A tldr whose noun has show and hide too, which junkd must never call (no pane).
const PANED_HANDOFF: Plugin = {
  name: 'handoff',
  register(on) {
    let isUp = false
    let owner: string | undefined
    on('engine.create', async (_$, e, next) => ({
      ...(await next(e)),
      handoff: {
        schema: async () => [],
        get: async () => 0,
        set: async () => 0,
        open: async () => { throw new Error('handoff: not here') },
        show: async () => { throw new Error('handoff: the hooks module did not answer') },
        hide: async () => { throw new Error('handoff: the hooks module did not answer') },
        status: async () => ({ armed: false, percent: 0, phase: 'idle' as const }),
      },
    }))
    on('handoff.show', async ($, e) => {
      const opened = $.ui.open({ id: 'handoff', title: 'handoff', ...(e?.focus ? { focus: true as const } : {}) })
      isUp = true
      owner = e?.owner
      await opened
      return { value: undefined }
    })
    on('handoff.hide', async ($, e) => {
      if (e?.owner !== undefined && e.owner !== owner) return { value: undefined }
      isUp = false
      owner = undefined
      await $.ui.close({ id: 'handoff' })
      return { value: undefined }
    })
    on('command.run', { command: 'handoff-own' }, async $ => {
      owner = undefined
      isUp = !isUp
      await (isUp ? $.ui.open({ id: 'handoff', title: 'handoff', focus: true }) : $.ui.close({ id: 'handoff' }))
      return {}
    })
  },
}
const PANED_ORCH: Plugin = {
  name: 'orch',
  register(on) {
    let isUp = false
    let owner: string | undefined
    on('engine.create', async (_$, e, next) => ({
      ...(await next(e)),
      orch: {
        schema: async () => [],
        get: async () => 0,
        set: async () => 0,
        open: async () => { throw new Error('orch: not here') },
        show: async () => { throw new Error('orch: the hooks module did not answer') },
        hide: async () => { throw new Error('orch: the hooks module did not answer') },
        guardState: async () => ({ active: false, model: 'x' }),
      },
    }))
    on('orch.show', async ($, e) => {
      const opened = $.ui.open({ id: 'orch', title: 'orch', ...(e?.focus ? { focus: true as const } : {}) })
      isUp = true
      owner = e?.owner
      await opened
      return { value: undefined }
    })
    on('orch.hide', async ($, e) => {
      if (e?.owner !== undefined && e.owner !== owner) return { value: undefined }
      isUp = false
      owner = undefined
      await $.ui.close({ id: 'orch' })
      return { value: undefined }
    })
    on('command.run', { command: 'orch-own' }, async $ => {
      owner = undefined
      isUp = !isUp
      await (isUp ? $.ui.open({ id: 'orch', title: 'orch', focus: true }) : $.ui.close({ id: 'orch' }))
      return {}
    })
  },
}
const PANED_TLDR: Plugin = {
  name: 'tldr',
  register(on) {
    on('engine.create', async (_$, e, next) => ({
      ...(await next(e)),
      tldr: {
        schema: async () => [],
        get: async () => false,
        set: async () => false,
        show: async () => { throw new Error('tldr: the hooks module did not answer') },
        hide: async () => { throw new Error('tldr: the hooks module did not answer') },
      },
    }))
  },
}

type Open = { id: string; title?: string; focus?: true }
type Call = { noun: string; method: string; input: unknown }
// The world's knobs: `nouns` names the fake plugins loaded (true = all three; a hook on a noun no plugin provides
// fails the load); `env` replaces the config-dir variables; `checkout` answers the checkout's marketplace.json
// (whatever the engine resolves `<root>/../..` to); `panes` is what session.start finds open; `mvExit`/`mvErr`
// fail the rename; `realPath` resolves a symlinked path; `listThrows` and `hintThrows` fail $.command.list and
// the prompt hint beneath; `shHome` is what `sh -c 'echo $HOME'` prints (default /fake/h2); `sha` is what `git rev-parse --short HEAD` prints (absent: git exits 128, no checkout),
// `gitThrows` fails the run itself (no git binary).
type Opts = { shHome?: string; tldrPane?: boolean; nouns?: boolean | string[]; env?: Record<string, string>; checkout?: string; panes?: { id: string }[]; mvExit?: number; mvErr?: string; realPath?: Record<string, string>; listThrows?: boolean; hintThrows?: boolean; sha?: string; gitThrows?: boolean }
function world(on: On, files: Record<string, string>, o: Opts = {}) {
  const env = o.env ?? { CLAUDE_CONFIG_DIR: CFG, HOME: '/fake/home' }
  const rec = { files, reads: [] as string[], writes: [] as string[], mvs: [] as string[][], rms: [] as string[][], config: [] as { key: string; value: unknown }[], toasts: [] as string[], opens: [] as Open[], closed: [] as string[], calls: [] as Call[],
    commands: [] as { name: string; description: string; source: 'builtin' | 'plugin' | 'user' | 'mcp'; plugin?: string }[], beneath: '', merged: '',
    // `log`: junkd's own pane calls and the feature panes' show/hide, one line each, in the order they arrived.
    log: [] as string[], gits: [] as string[][], denyShow: {} as Record<string, string>,
    tabs: [] as string[] } // every plugin's open panes in open order, as the engine draws their tabs
  on('env.get', (_$, e) => ({ value: env[e.name] }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  on('fs.read', (_$, e) => {
    rec.reads.push(e.path)
    if (o.checkout && e.path !== MARKETPLACE_JSON && /\/\.claude-plugin\/marketplace\.json$/.test(e.path)) return { value: o.checkout }
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path]! }
  })
  on('fs.stat', (_$, e) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, realPath: o.realPath?.[e.path] ?? e.path } }
  })
  on('fs.write', (_$, e) => { rec.writes.push(e.path); files[e.path] = e.text; return { value: undefined } })
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'sh') return { value: { exitCode: 0, stdout: `${o.shHome ?? '/fake/h2'}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'git') {
      rec.gits.push([...e.argv])
      if (o.gitThrows) throw new Error('spawn git ENOENT')
      const ok = o.sha !== undefined
      return { value: { exitCode: ok ? 0 : 128, stdout: ok ? `${o.sha}\n` : '', stderr: ok ? '' : 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    // The output_style flag file's removal (`rm -f -- <flag>`), recorded and applied.
    if (e.argv[0] === 'rm') {
      rec.rms.push([...e.argv])
      delete files[e.argv.at(-1)!]
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const [bin, , from, to] = e.argv
    expect(bin).toBe('/bin/mv')
    rec.mvs.push([from!, to!])
    if (o.mvExit) return { value: { exitCode: o.mvExit, stdout: '', stderr: o.mvErr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
    files[to!] = files[from!]!
    delete files[from!]
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // What the engine merged (user, project, local...): the user file alone unless `merged` says otherwise.
  on('settings.read', () => ({ value: JSON.parse(rec.merged || files[SETTINGS] || '{}') }))
  on('ui.open', (_$, e) => { rec.opens.push({ id: e.id, title: e.title, focus: e.focus }); rec.log.push(`ui.open ${e.id}`); if (!rec.tabs.includes(e.id)) rec.tabs.push(e.id); return { value: { isPlaced: true as const } } })
  on('ui.close', (_$, e) => { rec.closed.push(e.id); rec.log.push(`ui.close ${e.id}`); rec.tabs = rec.tabs.filter(t => t !== e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: (o.panes ?? []) as never }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => { if (o.listThrows) throw new Error('list broke'); return { value: rec.commands } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // The engine's own drawing where the mod passes; under the prompt, another plugin's hint when `beneath` names one.
  on('ui.render', ($, e) => {
    if (e.component === 'PromptHint' && o.hintThrows) throw new Error('no hint beneath')
    const { Box, Text } = $.ui.resolve(e)
    return e.component === 'PromptHint' && rec.beneath ? <Text>{rec.beneath}</Text> : <Box key="engine" />
  })
  // Each loaded noun's set, show and hide, answered beneath the fake plugins: recorded, and answered as the real one
  // would; `denyShow.<noun>` refuses that noun's show with the reason.
  const nouns = o.nouns === true ? ['handoff', 'orch', 'tldr'] : o.nouns ?? []
  const pane = (noun: string, method: 'show' | 'hide', e: unknown) => {
    rec.calls.push({ noun, method, input: e })
    rec.log.push(`${noun}.${method} ${JSON.stringify(e)}`)
    const deny = method === 'show' ? rec.denyShow[noun] : undefined
    return deny ? { deny } : { value: undefined }
  }
  if (nouns.includes('handoff')) {
    on('handoff.set', (_$, e) => { rec.calls.push({ noun: 'handoff', method: 'set', input: e }); return { value: e.value as number | boolean } })
    on('handoff.show', (_$, e) => pane('handoff', 'show', e))
    on('handoff.hide', (_$, e) => pane('handoff', 'hide', e))
  }
  if (nouns.includes('orch')) {
    on('orch.set', (_$, e) => {
      rec.calls.push({ noun: 'orch', method: 'set', input: e })
      return e.key === 'implementer_ctx_k' && e.value === '0' ? { deny: `orch: 0 is not a valid implementer_ctx_k` } : { value: e.value }
    })
    on('orch.show', (_$, e) => pane('orch', 'show', e))
    on('orch.hide', (_$, e) => pane('orch', 'hide', e))
  }
  // `tldrPane`: a tldr whose noun answers show and hide too, so a call junkd should never make shows in `log`.
  if (o.tldrPane) {
    on('tldr.show', (_$, e) => pane('tldr', 'show', e))
    on('tldr.hide', (_$, e) => pane('tldr', 'hide', e))
  }
  if (nouns.includes('tldr')) on('tldr.set', (_$, e) => { rec.calls.push({ noun: 'tldr', method: 'set', input: e }); return { value: e.value as number | boolean } })
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

const keysOf = async (pane: Awaited<ReturnType<typeof openPane>>, prefix: string) => (await pane.findAll({ type: 'Box' })).map(b => b.key).filter(k => k?.startsWith(prefix))

// First in the file: the module caches `home` once HOME is read, so the case without HOME runs before any other.
test('paths: CLAUDE_CONFIG_DIR and HOME unset -> `sh -c echo $HOME`, trimmed, then /.claude', async ($, on) => {
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

test('paths: CLAUDE_CONFIG_DIR unset -> $HOME/.claude for the reads and the flip write', async ($, on) => {
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

// The set's calls as they arrive: junkd's own open first (before any await), then each feature pane closed (an open
// one on its own would keep its tab ahead of junkd's), then both shown in tab order, marked as the set's; closing
// closes junkd and each feature pane only while it is still the set's.
const OPEN_SET = ['ui.open junkd', 'handoff.hide {}', 'orch.hide {}', 'handoff.show {"owner":"junkd"}', 'orch.show {"owner":"junkd"}']
const CLOSE_SET = ['ui.close junkd', 'handoff.hide {"owner":"junkd"}', 'orch.hide {"owner":"junkd"}']

test('AC1: /junkd, /junkd:junkd, ✚ junkd and q open the set (junkd focused, then handoff, orch) and close all three', WITH_NOUNS, async ($, on) => {
  const rec = world(on, fixture(), { nouns: true })
  await start($)
  for (const command of ['junkd', 'junkd:junkd']) {
    rec.log.length = 0
    await run($, command)
    expect(rec.log, command).toEqual(OPEN_SET)
    expect(rec.opens.at(-1), command).toEqual({ id: 'junkd', title: 'junkd', focus: true })
    rec.log.length = 0
    await run($, command)
    expect(rec.log, command).toEqual(CLOSE_SET)
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

test('AC1: with real feature panes the tabs are junkd, handoff, orch; only junkd asks for the keys; a second /junkd closes all three', { plugins: [PANED_HANDOFF, PANED_ORCH] }, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'junkd')
  expect(rec.tabs).toEqual(['junkd', 'handoff', 'orch'])
  expect(rec.opens).toEqual([
    { id: 'junkd', title: 'junkd', focus: true },
    { id: 'handoff', title: 'handoff', focus: undefined },
    { id: 'orch', title: 'orch', focus: undefined },
  ])
  await run($, 'junkd')
  expect(rec.tabs).toEqual([])
})

test('AC2: a feature pane open on its own is closed and reopened behind junkd; one opened on its own after the set is up stays when the set closes', { plugins: [PANED_HANDOFF, PANED_ORCH] }, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  await run($, 'handoff-own')
  expect(rec.tabs).toEqual(['handoff'])
  await run($, 'junkd')
  expect(rec.tabs).toEqual(['junkd', 'handoff', 'orch']) // never ahead of junkd
  await run($, 'junkd')
  expect(rec.tabs).toEqual([]) // reopened in the set: the set's now

  await run($, 'junkd')
  await run($, 'handoff-own') // the person closes handoff ...
  expect(rec.tabs).toEqual(['junkd', 'orch'])
  await run($, 'handoff-own') // ... and opens it on its own
  expect(rec.tabs).toEqual(['junkd', 'orch', 'handoff'])
  await run($, 'junkd')
  expect(rec.tabs).toEqual(['handoff']) // the set closes without it

  await run($, 'orch-own')
  expect(rec.tabs).toEqual(['handoff', 'orch'])
  await run($, 'junkd') // both up on their own: both go behind junkd
  expect(rec.tabs).toEqual(['junkd', 'handoff', 'orch'])
})

test('AC1: the set never calls show or hide on tldr (no pane), even where its noun answers them', { plugins: [PANED_HANDOFF, PANED_ORCH, PANED_TLDR] }, async ($, on) => {
  const rec = world(on, fixture(), { tldrPane: true })
  await start($)
  await run($, 'junkd')
  await run($, 'junkd')
  expect(rec.log.filter(l => l.startsWith('tldr.'))).toEqual([])
  expect(rec.log).toEqual(['ui.open junkd', 'ui.close handoff', 'ui.close orch', 'ui.open handoff', 'ui.open orch', 'ui.close junkd', 'ui.close handoff', 'ui.close orch'])
})

test('AC5: the header is ✚ junkd, the marketplace and the short sha of its checkout; the section titles in the accent', async ($, on) => {
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
  const mark = (await pane.findAll({ type: 'Text' })).find(t => t.text === '✚ junkd')
  expect(mark?.props.color).toBe('claude')
  expect(mark?.props.bold).toBe(true)
})

test('AC5: the sha comes from the checkout two levels up when that is where the marketplace is', async ($, on) => {
  const rec = world(on, fixture(), { sha: 'def5678', checkout: JSON.stringify({ name: 'junk-drawer', plugins: [entry('junkd', 'self')] }) })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^✚ junkd/ }))?.text).toBe('✚ junkd  junk-drawer def5678')
  expect(rec.gits[0]?.[2]).toMatch(/\/plugins\/junkd\/\.\.\/\.\.$/) // `<root>/../..`, as the marketplace was read
  expect(rec.reads).not.toContain(MARKETPLACE_JSON)
})

test('AC5: no git checkout (git exits non-zero) or no git at all -> no sha', async ($, on) => {
  const rec = world(on, fixture())
  const pane = await openPane($)
  expect(rec.gits).toHaveLength(1)
  expect((await pane.find({ type: 'Text', text: /^✚ junkd/ }))?.text).toBe('✚ junkd  junk-drawer')
})

test('AC5: git missing (the run throws) -> no sha, no note', async ($, on) => {
  world(on, fixture(), { gitThrows: true })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^✚ junkd/ }))?.text).toBe('✚ junkd  junk-drawer')
  expect((await pane.find({ key: 'note' }))?.text).toBe('')
})

test('AC5: the Plugins title names the settings file: ~ for a CLAUDE_CONFIG_DIR under HOME, the full path for one beside it', async ($, on) => {
  const at = (cfg: string): Record<string, string> => ({
    [`${cfg}/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json`]: JSON.stringify({ name: 'junk-drawer', plugins: [entry('p1', 'x')] }),
    [`${cfg}/settings.json`]: JSON.stringify({ enabledPlugins: {} }),
  })
  world(on, { ...at('/fake/home/cc'), ...at('/fake/homeX/cc') }, { env: { HOME: '/fake/home', CLAUDE_CONFIG_DIR: '/fake/home/cc' } })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^user scope/ }))?.text).toBe('user scope, ~/cc/settings.json')
})

test('AC5: no HOME at all (sh prints nothing) -> the config dir is /.claude, named in full, no ~', async ($, on) => {
  world(on, {
    ['/.claude/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json']: JSON.stringify({ name: 'junk-drawer', plugins: [entry('p1', 'x')] }),
    ['/.claude/settings.json']: JSON.stringify({ enabledPlugins: {} }),
  }, { env: {}, shHome: '' })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^user scope/ }))?.text).toBe('user scope, /.claude/settings.json')
})

test('AC5: a CLAUDE_CONFIG_DIR whose name only starts like HOME keeps its full path', async ($, on) => {
  const cfg = '/fake/homeX/cc'
  world(on, {
    [`${cfg}/plugins/marketplaces/junk-drawer/.claude-plugin/marketplace.json`]: JSON.stringify({ name: 'junk-drawer', plugins: [entry('p1', 'x')] }),
    [`${cfg}/settings.json`]: JSON.stringify({ enabledPlugins: {} }),
  }, { env: { HOME: '/fake/home', CLAUDE_CONFIG_DIR: cfg } })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: /^user scope/ }))?.text).toBe('user scope, /fake/homeX/cc/settings.json')
})

test('AC2: Plugins lists every marketplace plugin, on/off from user-scope settings.json; 1-9 flip one and the pane says to reload', async ($, on) => {
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
  const rec = world(on, fixture(), { nouns: true })
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
  expect(rec.calls.filter(c => c.method === 'set')).toEqual([
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

  // settings ▸, in this order: the feature pane opens (handoff on its Settings tab), junkd closes, the feature pane
  // opens again asking for the keys; no owner, so it is the person's pane from then on.
  let at = rec.log.length
  await pane.press({ key: 'pane:handoff' })
  expect(rec.log.slice(at)).toEqual(['handoff.show {"route":"settings"}', 'ui.close junkd', 'handoff.show {"focus":true,"route":"settings"}'])
  at = rec.log.length
  await pane.press({ key: 'pane:orch' })
  expect(rec.log.slice(at)).toEqual(['orch.show {}', 'ui.close junkd', 'orch.show {"focus":true}'])
  expect(rec.toasts).toEqual([])
  expect(rec.opens.map(o => o.id)).toEqual(['junkd']) // junkd is not opened again
})

test('AC3: a plugin on in the merged settings shows its section and is marked when off at user scope; one off in the merged settings shows none, even while its hooks are loaded; a refused show is a toast', WITH_NOUNS, async ($, on) => {
  const rec = world(on, fixture({ 'handoff@junk-drawer': true, 'orch@junk-drawer': true, 'tldr@junk-drawer': false }), { nouns: true })
  rec.merged = JSON.stringify({ enabledPlugins: { 'handoff@junk-drawer': true, 'orch@junk-drawer': false, 'tldr@junk-drawer': true } })
  rec.denyShow.orch = 'orch: no room'
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
  // junkd closes before the refusal comes back, so the reason is a toast; the second show is never sent.
  const at = rec.log.length
  await pane.press({ key: 'pane:orch' })
  expect(rec.log.slice(at)).toEqual(['orch.show {}', 'ui.close junkd'])
  expect(rec.toasts).toEqual(['✗ orch: no room'])
})

test("AC4: Commands lists the enabled plugins' slash commands with their one-line descriptions, from $.command.list()", WITH_NOUNS, async ($, on) => {
  const rec = world(on, fixture(), { nouns: true })
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

test('AC6: PromptHint with nothing beneath (next throws) -> the toggle alone, and it still opens', async ($, on) => {
  const rec = world(on, fixture(), { hintThrows: true })
  const hint = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  expect((await hint.find({ type: 'Button', key: 'junkd-toggle' }))?.text).toBe('✚ junkd')
  await hint.press({ key: 'junkd-toggle' })
  expect(rec.opens.map(o => o.id)).toEqual(['junkd'])
})

test('AC6: session.start with the pane already placed -> it is refreshed, and the first /junkd closes it', async ($, on) => {
  const rec = world(on, fixture(), { panes: [{ id: 'junkd' }] })
  await start($)
  await run($, 'junkd')
  expect(rec.closed).toEqual(['junkd'])
  expect(rec.opens).toEqual([])
  await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE }) // flushes the start's refresh
  expect(rec.reads[1]).toBe(MARKETPLACE_JSON)
  expect(rec.reads).toContain(SETTINGS)
})

test('the mobile surface gets the engine pane, not ours', async ($, on) => {
  world(on, fixture())
  const pane = await $.ui.mount({ plugin: 'junkd', surface: 'mobile' as never, ...PANE })
  expect(await pane.find({ key: 'engine' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Plugins' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'close' })).toBeUndefined()
})

test('AC2: a checkout marketplace two levels up wins; the cache copy is never read', async ($, on) => {
  const files = fixture()
  const rec = world(on, files, { checkout: JSON.stringify({ name: 'checkout-mk', plugins: [entry('onlyme', 'x'), entry('junkd', 'self')] }) })
  const pane = await openPane($)
  expect(await pane.find({ type: 'Box', key: 'plugin-row:onlyme' })).toBeDefined()
  expect(await pane.find({ type: 'Box', key: 'plugin-row:statusline' })).toBeUndefined()
  expect(rec.reads).not.toContain(MARKETPLACE_JSON)
  expect((await pane.find({ type: 'Text', text: /checkout-mk$/ }))?.text).toBe('✚ junkd  checkout-mk')
})

test('AC2: no marketplace.json anywhere -> the pane opens with the error note and no rows', async ($, on) => {
  const files = fixture()
  delete files[MARKETPLACE_JSON]
  const rec = world(on, files)
  const pane = await openPane($)
  expect(rec.opens.map(o => o.id)).toEqual(['junkd'])
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ Error: junk-drawer marketplace.json not found')
  expect(await keysOf(pane, 'plugin-row:')).toEqual([])
  expect((await pane.find({ key: 'no-settings' }))?.text).toBe('no settings: none of handoff, orch, tldr is loaded')
  expect((await pane.find({ type: 'Text', text: 'No commands.' }))?.text).toBe('No commands.')
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys tab move  q close')
})

test('AC2: a broken marketplace.json is the note; an empty object draws no rows and the default name', async ($, on) => {
  const files = fixture()
  files[MARKETPLACE_JSON] = '{ nope'
  world(on, files)
  const pane = await openPane($)
  expect((await pane.find({ key: 'note' }))?.text).toMatch(/^✗ /)
  expect(await keysOf(pane, 'plugin-row:')).toEqual([])
  await pane.unmount()
  files[MARKETPLACE_JSON] = '{}'
  const pane2 = await openPane($) // closes, then
  await pane2.unmount()
  const pane3 = await openPane($)
  expect((await pane3.find({ key: 'note' }))?.text).toBe('')
  expect(await keysOf(pane3, 'plugin-row:')).toEqual([])
  expect((await pane3.find({ type: 'Text', text: /junk-drawer$/ }))?.text).toBe('✚ junkd  junk-drawer')
  expect((await pane3.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys tab move  q close')
})

test('AC2: no settings.json yet -> created with enabledPlugins only, the temp file gone', async ($, on) => {
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

test('AC2: settings.json is a symlink -> written beside the real file, through the link', async ($, on) => {
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

test('AC2: mv fails -> the note names stderr, the file stays, no reload row', async ($, on) => {
  const files = fixture()
  const before = files[SETTINGS]
  world(on, files, { mvExit: 1, mvErr: 'mv: denied' })
  const pane = await openPane($)
  await pane.press({ key: 'plugin:statusline' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ Error: mv: denied')
  expect(files[SETTINGS]).toBe(before)
  expect(await pane.find({ type: 'Text', text: 'run /reload-plugins to apply' })).toBeUndefined()
})

test('AC2: mv fails with empty stderr -> `mv exited N`', async ($, on) => {
  world(on, fixture(), { mvExit: 3 })
  const pane = await openPane($)
  await pane.press({ key: 'plugin:statusline' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✗ Error: mv exited 3')
})

test('AC3: only tldr loaded -> one section, no empty note, a-a; a get that throws shows the default', { plugins: [FAKE_TLDR_BROKEN_GET] }, async ($, on) => {
  world(on, fixture(), { nouns: ['tldr'] })
  const pane = await openPane($)
  expect(await keysOf(pane, 'group:')).toEqual(['group:tldr'])
  expect(await pane.find({ key: 'no-settings' })).toBeUndefined()
  expect((await pane.find({ type: 'Input', key: 'set:tldr:sentences' }))?.props.value).toBe('3') // the default: get threw
  expect((await pane.find({ type: 'Button', key: 'set:tldr:terse' }))?.text).toBe('off') // get said true
  expect((await pane.find({ key: 'note' }))?.text).toBe('')
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys 1-4 plugin  a-a setting  tab move  q close')
})

test('AC3: 26 booleans -> q skipped, the 25th z, the 26th none; an unsupported type is named; no value -> empty input', { plugins: [FAKE_HANDOFF_WIDE] }, async ($, on) => {
  world(on, fixture(), { nouns: ['handoff'] })
  const pane = await openPane($)
  const hk = async (i: number) => (await pane.find({ type: 'Button', key: `set:handoff:b${i}` }))?.props.hotkey
  expect(await hk(0)).toBe('a')
  expect(await hk(15)).toBe('p')
  expect(await hk(16)).toBe('r')
  expect(await hk(24)).toBe('z')
  expect(await hk(25)).toBeUndefined()
  expect((await pane.find({ type: 'Text', text: /^keys/ }))?.text).toBe('keys 1-4 plugin  a-z setting  tab move  q close')
  expect((await pane.find({ type: 'Text', text: 'unsupported type object' }))?.props.color).toBe('error')
  expect(await pane.find({ type: 'Input', key: 'set:handoff:blob' })).toBeUndefined()
  expect((await pane.find({ type: 'Input', key: 'set:handoff:num' }))?.props.value).toBe('')
})

test('AC3: after settings ▸ the next /junkd opens again; a reopen clears the note', { plugins: [FAKE_ORCH_ONE] }, async ($, on) => {
  const rec = world(on, fixture(), { nouns: ['orch'] })
  await start($)
  const pane = await openPane($)
  await pane.press({ key: 'set:orch:guard=off' })
  expect(rec.calls.filter(c => c.method === 'set')).toEqual([{ noun: 'orch', method: 'set', input: { key: 'guard', value: 'off' } }])
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ orch.guard = "off"')
  await pane.press({ key: 'pane:orch' })
  expect(rec.calls.filter(c => c.method === 'show').slice(-2)).toEqual([
    { noun: 'orch', method: 'show', input: {} },
    { noun: 'orch', method: 'show', input: { focus: true } },
  ])
  expect(rec.closed).toEqual(['junkd'])
  await pane.unmount()
  await run($, 'junkd')
  expect(rec.opens.map(o => o.id)).toEqual(['junkd', 'junkd'])
  expect(rec.closed).toEqual(['junkd'])
  const pane2 = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE })
  expect((await pane2.find({ key: 'note' }))?.text).toBe('')
})

test('AC4: command.list throws -> No commands., no note, the rest drawn', async ($, on) => {
  world(on, fixture(), { listThrows: true })
  const pane = await openPane($)
  expect((await pane.find({ type: 'Text', text: 'No commands.' }))?.text).toBe('No commands.')
  expect((await pane.find({ key: 'note' }))?.text).toBe('')
  expect(await pane.find({ type: 'Box', key: 'plugin-row:orch' })).toBeDefined()
})

// ------------------------------------------------------------------ output_style (the flag file scripts/setup.sh reads)

const STYLE_FLAG = `${CFG}/junkd/output-style-off`
const OFF_AT_LOAD = { plugins: [MENU], options: { output_style: 'off' } }
const WITH_MENU = { plugins: [MENU] }

test('AC3: output_style off at load writes the flag file at session start; ste (the default) removes it', async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  expect(rec.rms).toEqual([['rm', '-f', '--', STYLE_FLAG]])
  expect(rec.writes).toEqual([])
  expect(STYLE_FLAG in rec.files).toBe(false)
})

test('AC3: output_style off at load: the flag file is written at session start, nothing removed', OFF_AT_LOAD, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  expect(rec.writes).toEqual([STYLE_FLAG])
  expect(rec.files[STYLE_FLAG]).toBe('')
  expect(rec.rms).toEqual([])
})

// The engine holds a stored option to the manifest's `options` before register sees it: ' OFF ' (not spelled
// `off`) or `blue` reads as the default, ste, and the module's own guard agrees.
for (const stored of [' OFF ', 'blue']) {
  test(`AC3: a stored value the options do not name (${JSON.stringify(stored)}) is the default ste: the flag is removed`, { ...WITH_MENU, options: { output_style: stored } }, async ($, on) => {
    const rec = world(on, fixture())
    await start($)
    expect(rec.writes).toEqual([])
    expect(rec.rms).toEqual([['rm', '-f', '--', STYLE_FLAG]])
  })
}

test('AC3: a write to the junkd.output_style row by the /config menu mirrors into the flag file: off writes, ste removes, the spelling is normalised', WITH_MENU, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  expect(await menuSet($, 'junkd.output_style', 'off')).toEqual({ value: 'off' })
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.output_style', value: 'off' })
  expect(STYLE_FLAG in rec.files).toBe(true)
  expect(await menuSet($, 'junkd.output_style', 'ste')).toEqual({ value: 'ste' })
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.output_style', value: 'ste' })
  expect(STYLE_FLAG in rec.files).toBe(false)
  expect(rec.rms.at(-1)).toEqual(['rm', '-f', '--', STYLE_FLAG])
  expect(await menuSet($, 'junkd.output_style', ' Off ')).toEqual({ value: 'off' })
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.output_style', value: 'off' }) // the row takes the normalised value
  expect(STYLE_FLAG in rec.files).toBe(true)
  expect(await menuSet($, 'junkd.output_style', 'STE')).toEqual({ value: 'ste' })
  expect(STYLE_FLAG in rec.files).toBe(false)
  // the next session start writes what the row holds last
  await menuSet($, 'junkd.output_style', 'off')
  rec.writes.length = 0
  await start($)
  expect(rec.writes).toEqual([STYLE_FLAG])
})

test('AC3: a value the options do not name is refused, the row and the flag file untouched; another row passes', WITH_MENU, async ($, on) => {
  const rec = world(on, fixture())
  await start($)
  for (const bad of ['blue', '', 'ste off', true, 1]) {
    expect(await menuSet($, 'junkd.output_style', bad), String(bad)).toEqual({ deny: `junkd: ${String(bad)} is not a valid output_style (ste or off)` })
  }
  expect(rec.config).toEqual([])
  expect(STYLE_FLAG in rec.files).toBe(false)
  expect(rec.writes).toEqual([])
  expect(await menuSet($, 'tldr.terse', 'off')).toEqual({ value: 'off' }) // not junkd's row: untouched by the hook
  expect(rec.config).toEqual([{ key: 'tldr.terse', value: 'off' }])
  expect(rec.writes).toEqual([])
})

test('AC3: a write another hook refuses leaves the flag file alone, and the next session start keeps the old value', WITH_MENU, async ($, on) => {
  on('config.set', { key: 'junkd.output_style' }, () => ({ deny: 'locked' }))
  const rec = world(on, fixture())
  await start($)
  expect(await menuSet($, 'junkd.output_style', 'off')).toEqual({ deny: 'locked' })
  expect(STYLE_FLAG in rec.files).toBe(false)
  expect(rec.writes).toEqual([])
  await start($)
  expect(rec.writes).toEqual([])
  expect(rec.rms).toHaveLength(2)
})
