// junkd's egm group and egm tab: the pure parts of egm.ts (validation, file parse, sort, duplicates, labels), then the
// whole module over a world in memory: the egm_enabled and egm_models rows through the /junkd pane (n, o) and the /config
// menu, the tab in the /junkd set, and the registry ${CLAUDE_CONFIG_DIR}/junkd/models.json the tab seeds, adds to (form
// and pasted JSON), edits and deletes. Nothing touches a real home: CLAUDE_CONFIG_DIR is /fake/home/.claude and every
// fs and process call is answered by `world`.
import { expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'
import { ANSWERS, CLASSES, EFFORTS, HARNESSES, LEVELS, PASSES, SEED, coerce, coerceAnswers, isDuplicate, parseEntry, parseFile, serialize, sortEntries, thinkingLabel, effortLabel, type Entry } from './egm'

const HOME = '/fake/home'
const CFG = `${HOME}/.claude`
const DIR = `${CFG}/junkd`
const FILE = `${DIR}/models.json`
const SHOWN = '~/.claude/junkd/models.json'
const MKT = `${CFG}/plugins/marketplaces/junk-drawer`
const MARKETPLACE_JSON = `${MKT}/.claude-plugin/marketplace.json`
const SETTINGS = `${CFG}/settings.json`
const EGM = 'junkd-egm'
const DENY = 'egm.models działa dopiero przy egm.enabled = on'
const FIX = 'popraw plik ręcznie'
const SET_TABS = ['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-tools']

const e = (cls: string, id: string, more: Partial<Entry> = {}): Entry => ({ class: cls, id, harness: 'claude', effort: 'default', thinking: { level: '-', pass: 'suffix' }, ...more })
// The engine's own parser message for a text, on one line: the expected text is computed, never copied.
const parserMessage = (text: string) => {
  try {
    JSON.parse(text)
  } catch (err) {
    return String((err as Error).message).replace(/\s+/g, ' ').trim()
  }
  throw new Error(`${text} parses`)
}

// the pure parts ----------------------------------------------------------------------------------------------------

test('parseEntry: every row of the validation table, in order, as the note text without its ✗', () => {
  const bad: [unknown, string][] = [
    ['{"class":', `JSON: ${parserMessage('{"class":')}`],
    ['[{"class":"A","id":"x","harness":"omp"}]', 'JSON: oczekiwany jeden obiekt {…}'],
    ['"text"', 'JSON: oczekiwany jeden obiekt {…}'],
    ['null', 'JSON: oczekiwany jeden obiekt {…}'],
    [42, 'JSON: oczekiwany jeden obiekt {…}'],
    ['{"id":"x","harness":"omp"}', 'JSON: brak pola class'],
    ['{"class":"  ","id":"x","harness":"omp"}', 'JSON: brak pola class'],
    ['{"class":"A","harness":"omp"}', 'JSON: brak pola id'],
    ['{"class":"A","id":"   ","harness":"omp"}', 'JSON: brak pola id'],
    ['{"class":"A","id":null,"harness":"omp"}', 'JSON: brak pola id'],
    ['{"class":"A","id":"x"}', 'JSON: brak pola harness'],
    ['{"class":"A","id":"x","harness":""}', 'JSON: brak pola harness'],
    ['{"class":"D","id":"x","harness":"omp"}', 'JSON: class D to rezerwa, użyj A, B, C albo F'],
    ['{"class":"E","id":"x","harness":"omp"}', 'JSON: class E to rezerwa, użyj A, B, C albo F'],
    ['{"class":"G","id":"x","harness":"omp"}', 'JSON: class musi być A, B, C albo F, jest "G"'],
    ['{"class":"a","id":"x","harness":"omp"}', 'JSON: class musi być A, B, C albo F, jest "a"'],
    ['{"class":5,"id":"x","harness":"omp"}', 'JSON: class musi być A, B, C albo F, jest 5'],
    ['{"class":"A","id":7,"harness":"omp"}', 'JSON: id musi być tekstem'],
    ['{"class":"A","id":"x","harness":"ollama"}', 'JSON: harness spoza listy: claude, omp, opencode, codex, kimi'],
    ['{"class":"A","id":"x","harness":"omp","effort":"huge"}', 'JSON: effort spoza listy: default, none, low, medium, high, xhigh, max'],
    ['{"class":"A","id":"x","harness":"omp","effort":null}', 'JSON: effort spoza listy: default, none, low, medium, high, xhigh, max'],
    ['{"class":"A","id":"x","harness":"omp","thinking":"adaptive"}', 'JSON: thinking.level spoza listy: -, off, on, low, medium, high'],
    ['{"class":"A","id":"x","harness":"omp","thinking":{"level":"max"}}', 'JSON: thinking.level spoza listy: -, off, on, low, medium, high'],
    ['{"class":"A","id":"x","harness":"omp","thinking":{"pass":"param"}}', 'JSON: thinking.level spoza listy: -, off, on, low, medium, high'],
    ['{"class":"A","id":"x","harness":"omp","thinking":3}', 'JSON: thinking.level spoza listy: -, off, on, low, medium, high'],
    ['{"class":"A","id":"x","harness":"omp","thinking":{"level":"on","pass":"body"}}', 'JSON: thinking.pass musi być suffix albo param'],
    ['{"class":"A","id":"x","harness":"omp","thinking":{"level":"-","pass":""}}', 'JSON: thinking.pass musi być suffix albo param'],
    // the first failing check wins: a reserved class is named before a bad harness, a bad effort before a bad level
    ['{"class":"D","id":"x","harness":"nope"}', 'JSON: class D to rezerwa, użyj A, B, C albo F'],
    ['{"class":"A","id":"x","harness":"omp","effort":"huge","thinking":"nope"}', 'JSON: effort spoza listy: default, none, low, medium, high, xhigh, max'],
  ]
  for (const [raw, error] of bad) expect(parseEntry(raw), String(raw)).toEqual({ error })
})

test('parseEntry: the defaults, a bare thinking string, the trimmed id, extra keys dropped, a multi-line text and an object', () => {
  expect(parseEntry('{"class":"B","id":"m","harness":"omp"}')).toEqual({ entry: e('B', 'm', { harness: 'omp' }) })
  expect(parseEntry('{"class":"F","id":"  kimi/k2  ","harness":"kimi","thinking":"high"}')).toEqual({ entry: e('F', 'kimi/k2', { harness: 'kimi', thinking: { level: 'high', pass: 'suffix' } }) })
  expect(parseEntry('{"class":"C","id":"o","harness":"codex","effort":"xhigh","thinking":{"level":"on","pass":"param"},"cost":1}')).toEqual({
    entry: e('C', 'o', { harness: 'codex', effort: 'xhigh', thinking: { level: 'on', pass: 'param' } }),
  })
  expect(parseEntry('{"class":"A","id":"x","harness":"omp","thinking":{"level":"off"}}')).toEqual({ entry: e('A', 'x', { harness: 'omp', thinking: { level: 'off', pass: 'suffix' } }) })
  expect(parseEntry('{\r\n  "class": "A",\n  "id": "x",\n\t"harness": "opencode"\n}')).toEqual({ entry: e('A', 'x', { harness: 'opencode' }) })
  // the join is one space per line break and the blanks around it, even where a break cut a value in two
  expect(parseEntry('{"class":"A","id":"long  \r\n   name","harness":"omp"}')).toEqual({ entry: e('A', 'long name', { harness: 'omp' }) })
  expect(parseEntry('{"class":"A","id":"a\n\nb","harness":"omp"}')).toEqual({ entry: e('A', 'a b', { harness: 'omp' }) })
  expect(parseEntry({ class: 'A', id: ' y ', harness: 'claude', effort: 'none', thinking: { level: 'low', pass: 'suffix' } })).toEqual({
    entry: e('A', 'y', { effort: 'none', thinking: { level: 'low', pass: 'suffix' } }),
  })
  // every key in a fixed order, as the file holds it
  const r = parseEntry('{"thinking":{"pass":"param","level":"high"},"harness":"omp","id":"z","effort":"low","class":"B"}')
  expect(JSON.stringify(r)).toBe('{"entry":{"class":"B","id":"z","harness":"omp","effort":"low","thinking":{"level":"high","pass":"param"}}}')
})

test('parseFile: a flat array of entries; a parser message, a non-array and an entry error with its 1-based place', () => {
  expect(parseFile(serialize(SEED))).toEqual({ list: [...SEED] })
  expect(parseFile('[]')).toEqual({ list: [] })
  expect(parseFile('{ broken')).toEqual({ error: `models.json: ${parserMessage('{ broken')}` })
  expect(parseFile('{"models":[]}')).toEqual({ error: 'models.json: oczekiwana tablica [...]' })
  expect(parseFile('[{"class":"A","id":"a","harness":"omp"},{"class":"B","harness":"omp"}]')).toEqual({ error: 'models.json: entry 2: JSON: brak pola id' })
  expect(parseFile('[{"class":"E","id":"a","harness":"omp"}]')).toEqual({ error: 'models.json: entry 1: JSON: class E to rezerwa, użyj A, B, C albo F' })
  // a string in the array is a value, never JSON text parsed again
  expect(parseFile(JSON.stringify(['{"class":"A","id":"a","harness":"omp"}']))).toEqual({ error: 'models.json: entry 1: JSON: oczekiwany jeden obiekt {…}' })
})

test('sortEntries: class A B C F, then id in code-point order; the input stays; isDuplicate needs class, id and harness', () => {
  const list = [e('F', 'k'), e('B', 'b'), e('A', 'z'), e('B', 'B'), e('A', 'a'), e('C', 'c'), e('B', 'b2')]
  const before = JSON.stringify(list)
  expect(sortEntries(list).map(x => `${x.class}${x.id}`)).toEqual(['Aa', 'Az', 'BB', 'Bb', 'Bb2', 'Cc', 'Fk'])
  expect(JSON.stringify(list)).toBe(before)
  expect(isDuplicate(list, e('B', 'b'))).toBe(true)
  expect(isDuplicate(list, e('B', 'b', { harness: 'omp' }))).toBe(false)
  expect(isDuplicate(list, e('C', 'b'))).toBe(false)
  expect(isDuplicate(list, e('B', 'b'), 1)).toBe(false) // the edited row itself
  expect(isDuplicate(list, e('B', 'b'), 0)).toBe(true)
  expect(isDuplicate([], e('A', 'a'))).toBe(false)
})

test('the list cells: thinking - is a dash, off itself, a level with (:level) or (param); effort none a dash; coerce', () => {
  expect(thinkingLabel(e('A', 'x'))).toBe('—')
  expect(thinkingLabel(e('A', 'x', { thinking: { level: 'off', pass: 'param' } }))).toBe('off')
  expect(thinkingLabel(e('A', 'x', { thinking: { level: 'high', pass: 'suffix' } }))).toBe('high (:level)')
  expect(thinkingLabel(e('A', 'x', { thinking: { level: 'on', pass: 'param' } }))).toBe('on (param)')
  expect(effortLabel(e('A', 'x', { effort: 'none' }))).toBe('—')
  expect(effortLabel(e('A', 'x', { effort: 'max' }))).toBe('max')
  for (const on of [true, 'true', 'on']) expect(coerce(on), String(on)).toBe(true)
  for (const off of [false, 'false', 'off', 'yes', 1, undefined, null, 'TRUE']) expect(coerce(off), String(off)).toBe(false)
  expect([CLASSES, HARNESSES, EFFORTS, LEVELS, PASSES].map(l => l.join(' '))).toEqual(['A B C F', 'claude omp opencode codex kimi', 'default none low medium high xhigh max', '- off on low medium high', 'suffix param'])
})

// the module --------------------------------------------------------------------------------------------------------

// The host's rule for a plugin's own write: `$.config.set` skips the caller's own config.set hooks.
const HOST: Plugin = {
  name: 'host',
  tier: 'prepend',
  register(on) {
    on('config.set', (_$, ev, next) => (next.origin.plugin === 'junkd' ? next.to(ev, 'append') : next(ev)))
  },
}
// The /config menu's own write path: `/cfg <json>` calls `$.config.set` from another plugin; `/call open <json>` calls
// `$.junkd.open`; `/panes` answers `$.ui.panes()` as another plugin sees it.
const MENU: Plugin = {
  name: 'menu',
  register(on) {
    on('command.run', { command: 'cfg' }, async ($, ev) => {
      try {
        return { text: JSON.stringify({ ok: await $.config.set(JSON.parse(ev.args)) }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
    on('command.run', { command: 'call' }, async ($, ev) => {
      try {
        return { text: JSON.stringify({ ok: (await $.junkd.open(JSON.parse(ev.args))) ?? null }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
    on('command.run', { command: 'panes' }, async $ => ({ text: JSON.stringify((await $.ui.panes()).map(p => p.id)) }))
  },
}
const PLUGINS = [HOST, MENU]
const W = { plugins: PLUGINS }
const withOptions = (options: Record<string, boolean | string>) => ({ plugins: PLUGINS, options })
const ON = withOptions({ egm_enabled: true })

type Opts = {
  links?: Record<string, string> // a path to where it resolves (a symlink, or a symlinked folder)
  mvExit?: number
  mvErr?: string
}
type Rec = ReturnType<typeof world>
function world(on: On, files: Record<string, string> = {}, o: Opts = {}) {
  mock.store(on)
  const links = o.links ?? {}
  const rec = {
    files: { ...marketplace(), ...files },
    dirs: new Set([HOME, CFG, ...Object.values(links).map(p => p.replace(/\/[^/]*$/, ''))]),
    writes: [] as string[],
    runs: [] as string[][],
    config: [] as { key: string; value: unknown }[],
    opens: [] as { id: string; focus?: boolean }[],
    log: [] as string[],
    tabs: [] as string[],
    toasts: [] as string[],
    mvExit: o.mvExit,
  }
  const real = (p: string) => links[p] ?? p
  const done = (stdout = '', exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('env.get', (_$, ev) => ({ value: ({ CLAUDE_CONFIG_DIR: CFG, HOME } as Record<string, string>)[ev.name] }))
  on('config.set', (_$, ev) => { rec.config.push({ key: ev.key, value: ev.value }); return { value: ev.value } })
  on('ui.toast', (_$, ev) => { rec.toasts.push(ev.text); return { value: undefined } })
  on('fs.exists', (_$, ev) => ({ value: real(ev.path) in rec.files }))
  on('fs.read', (_$, ev) => {
    if (!(real(ev.path) in rec.files)) throw new Error(`ENOENT ${ev.path}`)
    return { value: rec.files[real(ev.path)]! }
  })
  on('fs.stat', (_$, ev) => {
    const r = real(ev.path)
    if (rec.dirs.has(r) || rec.dirs.has(ev.path)) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: r !== ev.path, realPath: r } }
    if (!(r in rec.files)) throw new Error(`ENOENT ${ev.path}`)
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: r !== ev.path, realPath: r } }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.write', (_$, ev) => { rec.writes.push(ev.path); rec.files[ev.path] = ev.text; return { value: undefined } })
  on('process.run', (_$, ev) => {
    const argv = [...ev.argv]
    if (argv[0] === 'sh') return done(`${HOME}\n`)
    if (argv[0] === 'git') return done('', 128, 'fatal: not a git repository')
    // the registry's own runs only (the other features' starts run theirs, an rm of a flag file, say)
    if (argv[0] === 'mkdir' || argv[0] === '/bin/cp' || argv[0] === '/bin/mv') rec.runs.push(argv)
    if (argv[0] === 'mkdir') {
      rec.dirs.add(real(argv.at(-1)!))
      return done()
    }
    if (argv[0] === '/bin/cp') {
      rec.files[argv.at(-1)!] = rec.files[argv.at(-2)!]!
      return done()
    }
    if (argv[0] === '/bin/mv') {
      if (rec.mvExit) return done('', rec.mvExit, o.mvErr ?? '')
      const [from, to] = argv.slice(-2) as [string, string]
      rec.files[to] = rec.files[from]!
      delete rec.files[from]
      return done()
    }
    return done()
  })
  on('settings.read', () => ({ value: JSON.parse(rec.files[SETTINGS] ?? '{}') }))
  on('ui.open', (_$, ev) => {
    rec.opens.push({ id: ev.id, focus: ev.focus })
    rec.log.push(`ui.open ${ev.id}${ev.focus ? ' focus' : ''}`)
    if (!rec.tabs.includes(ev.id)) rec.tabs.push(ev.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, ev) => {
    rec.log.push(`ui.close ${ev.id}`)
    rec.tabs = rec.tabs.filter(t => t !== ev.id)
    return { value: undefined }
  })
  on('ui.focus', () => ({}))
  on('ui.panes', () => ({ value: rec.tabs.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) as never }))
  on('command.register', (_$, ev) => ({ value: { command: ev.name } }))
  on('command.list', () => ({ value: [] }))
  on('session.start', (_$, ev) => ({ cwd: ev.cwd }))
  on('ui.render', ($, ev) => $.ui.resolve(ev).Box({ key: 'engine' }))
  return rec
}
const entry = (name: string) => ({ name, source: `./plugins/${name}`, description: name })
function marketplace(): Record<string, string> {
  return {
    [MARKETPLACE_JSON]: JSON.stringify({ name: 'junk-drawer', plugins: [entry('junkd'), entry('statusline')] }),
    [SETTINGS]: JSON.stringify({ enabledPlugins: { 'statusline@junk-drawer': true } }),
  }
}

const composer = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
const run = ($: Engine, command: string, args = '') => $.command.run({ command, args, ...composer }) as Promise<{ text?: string }>
const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
async function menuSet($: Engine, key: string, value: unknown): Promise<{ value?: unknown; deny?: string }> {
  const out = JSON.parse((await run($, 'cfg', JSON.stringify({ key, value }))).text ?? '{}') as { ok?: { value?: unknown; deny?: string }; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok ?? {}
}
const panes = async ($: Engine) => JSON.parse((await run($, 'panes')).text ?? '[]') as string[]
const paneOf = (requestId: string, title: string) =>
  ({ component: 'Pane', requestId, props: { title, isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } }) as const
// The set through /junkd, and the junkd pane drawn.
async function openSet($: Engine) {
  await run($, 'junkd')
  return $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...paneOf('junkd', 'junkd') })
}
// The egm tab on its own ($.junkd.open), drawn.
async function openEgm($: Engine) {
  const out = JSON.parse((await run($, 'call', JSON.stringify({ pane: 'egm' }))).text ?? '{}') as { error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return mountEgm($)
}
const mountEgm = ($: Engine) => $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...paneOf(EGM, 'egm') })
type Mounted = Awaited<ReturnType<typeof mountEgm>>
const noteOf = async (ui: Mounted) => (await ui.find({ type: 'Box', key: 'note' }))?.text
const texts = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).map(t => t.text)
// The ids of the list's rows, in drawn order.
const ids = async (ui: Mounted) => (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('egm-row-btn:')).map(b => b.text)
const selected = async (ui: Mounted) => (await ui.findAll({ type: 'Box' })).filter(b => b.key?.startsWith('egm-row:') && b.props.backgroundColor === 'userMessageBackground').map(b => b.key)
const fileList = (rec: Rec, path = FILE) => JSON.parse(rec.files[path]!) as Entry[]
const titleOf = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).find(t => t.props.bold && /^(Dodaj|Edytuj) model$/.test(t.text))?.text
async function pasteJson(ui: Mounted, text: string) {
  await ui.press({ key: 'egm-choice:mode=wklej JSON' })
  await ui.input({ key: 'egm-field:json', text, kind: 'change' })
  await ui.press({ key: 'egm-save' })
}
const SEED_TEXT = serialize(SEED)
const seeded = () => ({ [FILE]: SEED_TEXT })

// the rows and the tab in the set -------------------------------------------------------------------------------------

test('egm tab is hidden while egm_enabled is off and the set opens without junkd-egm', W, async ($, on) => {
  const rec = world(on)
  await start($)
  const pane = await openSet($)
  expect(rec.tabs).toEqual(SET_TABS)
  expect(await panes($)).toEqual(SET_TABS)
  expect(rec.log.filter(l => l.includes(EGM))).toEqual([])
  expect(await pane.find({ type: 'Button', key: 'pane:egm' })).toBeUndefined() // no settings ▸ while off
  expect((await pane.find({ type: 'Box', key: 'group:egm' }))?.text).toMatch(/^─+egm/)
  // the egm tab refuses to open on its own while off, and its file is never touched
  const out = JSON.parse((await run($, 'call', JSON.stringify({ pane: 'egm' }))).text ?? '{}') as { error?: string }
  expect(out.error).toMatch(/junkd: the egm tab is off: \/junkd → egm → enabled$/)
  expect(rec.runs).toEqual([])
  expect(rec.files[FILE]).toBeUndefined()
  // the set closes as before, without a close of the tab it never opened
  await run($, 'junkd')
  expect(rec.log.filter(l => l.includes(EGM))).toEqual([])
})

test('m turns egm_enabled on: the note is ✓ egm.enabled = true, junkd-egm is in ui.panes(), settings ▸ shows on the egm header', W, async ($, on) => {
  const rec = world(on)
  await start($)
  const pane = await openSet($)
  const enabled = await pane.find({ type: 'Button', key: 'set:egm:enabled' })
  expect(enabled?.props.hotkey).toBe('m')
  expect((await pane.find({ type: 'Button', key: 'set:egm:models' }))?.props.hotkey).toBe('n')
  const at = rec.log.length
  await pane.press({ key: 'set:egm:enabled' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ egm.enabled = true')
  expect(rec.config).toContainEqual({ key: 'junkd.egm_enabled', value: true })
  expect(await panes($)).toEqual([...SET_TABS, EGM]) // last in the tab line
  expect(rec.log.slice(at)).toEqual([`ui.open ${EGM}`]) // without focus: junkd keeps the keys
  expect((await pane.find({ type: 'Button', key: 'pane:egm' }))?.text).toBe('settings ▸')
  // o flips egm.models now
  await pane.press({ key: 'set:egm:models' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ egm.models = true')
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.egm_models', value: true })
  // the tab is the set's: closing the set closes it too
  await run($, 'junkd')
  expect(await panes($)).toEqual([])
})

test('egm_enabled off closes junkd-egm and junkd keeps the keys', ON, async ($, on) => {
  const rec = world(on)
  await start($)
  const pane = await openSet($)
  expect(rec.tabs).toEqual([...SET_TABS, EGM])
  expect(rec.opens.find(o => o.id === EGM)?.focus).toBeUndefined()
  const at = rec.log.length
  await pane.press({ key: 'set:egm:enabled' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ egm.enabled = false')
  expect(await panes($)).toEqual(SET_TABS)
  expect(rec.log.slice(at)).toEqual([`ui.close ${EGM}`]) // no other pane asked for the keys
  expect(await pane.find({ type: 'Button', key: 'pane:egm' })).toBeUndefined()
  // the next open of the set leaves it out
  await run($, 'junkd')
  await run($, 'junkd')
  expect(rec.tabs).toEqual(SET_TABS)
})

test('config.set junkd.egm_enabled true from /config opens junkd-egm while the set is open; false closes it', W, async ($, on) => {
  const rec = world(on)
  await start($)
  // with the set closed, on opens nothing
  for (const spelling of [true, 'true', 'on']) {
    expect(await menuSet($, 'junkd.egm_enabled', spelling), String(spelling)).toEqual({ value: true })
    expect(await panes($), String(spelling)).toEqual([])
    expect(await menuSet($, 'junkd.egm_enabled', false)).toEqual({ value: false })
  }
  expect(rec.config.filter(c => c.key === 'junkd.egm_enabled').map(c => c.value)).toEqual([true, false, true, false, true, false])
  await openSet($)
  expect(rec.tabs).toEqual(SET_TABS)
  const at = rec.log.length
  expect(await menuSet($, 'junkd.egm_enabled', 'on')).toEqual({ value: true })
  expect(await panes($)).toEqual([...SET_TABS, EGM])
  expect(rec.log.slice(at)).toEqual([`ui.open ${EGM}`])
  expect(rec.files[FILE]).toBe(SEED_TEXT) // the show read (here: seeded) the file
  expect(await menuSet($, 'junkd.egm_enabled', 'off')).toEqual({ value: false })
  expect(await panes($)).toEqual(SET_TABS)
})

test('config.set junkd.egm_models true while egm_enabled is off is denied', W, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const spelling of [true, 'true', 'on']) expect(await menuSet($, 'junkd.egm_models', spelling), String(spelling)).toEqual({ deny: DENY })
  expect(rec.config.filter(c => c.key === 'junkd.egm_models')).toEqual([])
  expect(await menuSet($, 'junkd.egm_models', false)).toEqual({ value: false }) // off is always allowed
  await menuSet($, 'junkd.egm_enabled', true)
  expect(await menuSet($, 'junkd.egm_models', 'on')).toEqual({ value: true })
  // off again: the stored models value stays
  await menuSet($, 'junkd.egm_enabled', false)
  expect(rec.config.filter(c => c.key === 'junkd.egm_models').map(c => c.value)).toEqual([false, true])
})

test('o while egm_enabled is off is refused with ✗ egm.models działa dopiero przy egm.enabled = on and the row is dim with · wymaga enabled', W, async ($, on) => {
  const rec = world(on)
  await start($)
  const pane = await openSet($)
  const row = await pane.find({ type: 'Box', key: 'setting:egm:models' })
  expect(row?.text).toContain('EGM bierze pod uwagę modele (pętla rozumienia) · wymaga enabled')
  const title = (await pane.findAll({ type: 'Text' })).find(t => t.text === 'EGM bierze pod uwagę modele (pętla rozumienia) · wymaga enabled')
  expect(title?.props.dimColor).toBe(true)
  expect((await pane.findAll({ type: 'Text' })).find(t => t.text === 'models')?.props.dimColor).toBe(true)
  // the enabled row is not dim and has no suffix
  const enabledTitle = (await pane.findAll({ type: 'Text' })).find(t => t.text === 'EGM przy pisaniu tasków')
  expect(enabledTitle?.props.dimColor).toBeUndefined()
  await pane.press({ key: 'set:egm:models' })
  expect((await pane.find({ key: 'note' }))?.text).toBe(`✗ ${DENY}`)
  expect(rec.config.filter(c => c.key === 'junkd.egm_models')).toEqual([])
  // with enabled on, the row is no longer dim
  await pane.press({ key: 'set:egm:enabled' })
  expect((await pane.find({ type: 'Box', key: 'setting:egm:models' }))?.text).not.toContain('wymaga enabled')
  expect((await pane.findAll({ type: 'Text' })).find(t => t.text === 'EGM bierze pod uwagę modele (pętla rozumienia)')?.props.dimColor).toBeUndefined()
})

test('the dim egm.models pill shows the stored value and the egm footer shows the effective value', withOptions({ egm_models: true }), async ($, on) => {
  world(on, seeded())
  await start($)
  const pane = await openSet($)
  const pills = async () => (await pane.findAll({ type: 'Text' })).filter(t => t.props.inverse && /^ (on|off) $/.test(t.text))
  const last = async () => (await pills()).at(-1)
  expect((await last())?.text).toBe(' on ') // stored on, though it does nothing while enabled is off
  expect((await last())?.props.color).toBe('subtle')
  await pane.press({ key: 'set:egm:enabled' })
  expect((await last())?.text).toBe(' on ')
  expect((await last())?.props.color).toBe('success')
  const tab = await mountEgm($)
  expect((await tab.find({ type: 'Box', key: 'egm-footer' }))?.text).toBe('egm.models = true: pętla rozumienia bierze modele z tej listy')
  await pane.press({ key: 'set:egm:models' })
  expect((await tab.find({ type: 'Box', key: 'egm-footer' }))?.text).toBe('egm.models = false: EGM pisze taski bez modeli z tej listy')
})

test('coerceAnswers: manual and auto in any case and blanks; anything else is no value', () => {
  expect(ANSWERS).toEqual(['manual', 'auto'])
  for (const [raw, v] of [['manual', 'manual'], ['auto', 'auto'], ['AUTO', 'auto'], [' Manual ', 'manual']] as const) expect(coerceAnswers(raw), raw).toBe(v)
  for (const bad of ['bogus', '', 'on', true, 1, undefined, null]) expect(coerceAnswers(bad), String(bad)).toBeUndefined()
})

test('egm.answers: the row draws manual by default; a press picks auto then manual, each written to junkd.egm_answers', W, async ($, on) => {
  const rec = world(on)
  await start($)
  const pane = await openSet($)
  expect((await pane.find({ type: 'Box', key: 'setting:egm:answers' }))?.text).toContain('Questions')
  expect((await pane.find({ key: 'set:egm:answers=manual' }))?.text).toBe(' manual ')
  expect(await pane.find({ type: 'Button', key: 'set:egm:answers=manual' })).toBeUndefined()
  expect((await pane.find({ type: 'Button', key: 'set:egm:answers=auto' }))?.text).toBe('auto')
  // works while egm_enabled is off too: it only says who answers once task-draft runs
  await pane.press({ key: 'set:egm:answers=auto' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ egm.answers = "auto"')
  expect((await pane.find({ key: 'set:egm:answers=auto' }))?.text).toBe(' auto ')
  await pane.press({ key: 'set:egm:answers=manual' })
  expect((await pane.find({ key: 'note' }))?.text).toBe('✓ egm.answers = "manual"')
  expect((await pane.find({ key: 'set:egm:answers=manual' }))?.text).toBe(' manual ')
  expect(rec.config.filter(c => c.key === 'junkd.egm_answers').map(c => c.value)).toEqual(['auto', 'manual'])
  expect(await panes($)).toEqual(SET_TABS) // the tab stays shut
})

test('egm.answers: the option auto is read at start; config.set takes auto in any case, refuses bogus', withOptions({ egm_answers: 'auto' }), async ($, on) => {
  const rec = world(on)
  await start($)
  const pane = await openSet($)
  expect((await pane.find({ key: 'set:egm:answers=auto' }))?.text).toBe(' auto ')
  expect(await menuSet($, 'junkd.egm_answers', 'manual')).toEqual({ value: 'manual' })
  expect(await menuSet($, 'junkd.egm_answers', 'Auto')).toEqual({ value: 'auto' })
  expect(await menuSet($, 'junkd.egm_answers', 'bogus')).toEqual({ deny: 'junkd: bogus is not a valid egm_answers (manual or auto)' })
  expect(rec.config.filter(c => c.key === 'junkd.egm_answers').map(c => c.value)).toEqual(['manual', 'auto'])
})

// the seed --------------------------------------------------------------------------------------------------------

test('first open with no models.json creates the folder and seeds A haiku, B sonnet, C opus (claude, default, -)', ON, async ($, on) => {
  const rec = world(on)
  await start($)
  const ui = await openEgm($)
  expect(rec.runs).toEqual([
    ['mkdir', '-p', '--', DIR],
    ['/bin/mv', '-f', `${FILE}.junkd-tmp`, FILE],
  ])
  expect(rec.writes).toEqual([`${FILE}.junkd-tmp`])
  expect(rec.files[FILE]).toBe(SEED_TEXT)
  expect(JSON.parse(rec.files[FILE]!)).toEqual([
    { class: 'A', id: 'haiku', harness: 'claude', effort: 'default', thinking: { level: '-', pass: 'suffix' } },
    { class: 'B', id: 'sonnet', harness: 'claude', effort: 'default', thinking: { level: '-', pass: 'suffix' } },
    { class: 'C', id: 'opus', harness: 'claude', effort: 'default', thinking: { level: '-', pass: 'suffix' } },
  ])
  expect(rec.files[FILE]!.endsWith(']\n')).toBe(true)
  expect(rec.files[`${FILE}.bak`]).toBeUndefined() // nothing to keep
  expect(await ids(ui)).toEqual(['haiku', 'sonnet', 'opus'])
  expect(await texts(ui)).toContain('   D, E: rezerwa · klasy: A haiku · B sonnet · C opus · F frontier (kimi, fable)')
  expect((await ui.find({ type: 'Box', key: 'egm-footer' }))?.text).toBe('egm.models = false: EGM pisze taski bez modeli z tej listy')
  // the header: egm · modele and the file, ~ for HOME
  expect((await ui.findAll({ type: 'Text' })).find(t => t.text.startsWith('egm · modele'))?.text).toBe(`egm · modele ${SHOWN}`)
  // a deleted file is seeded again on the next show
  await ui.unmount()
  await run($, 'call', JSON.stringify({ pane: 'egm' })) // closes
  delete rec.files[FILE]
  await run($, 'call', JSON.stringify({ pane: 'egm' })) // opens
  expect(rec.files[FILE]).toBe(SEED_TEXT)
  // a file that is there is read, never seeded over
  rec.files[FILE] = serialize([e('F', 'fable')])
  await run($, 'call', JSON.stringify({ pane: 'egm' }))
  await run($, 'call', JSON.stringify({ pane: 'egm' }))
  expect(await ids(await mountEgm($))).toEqual(['fable'])
  expect(rec.files[FILE]).toBe(serialize([e('F', 'fable')]))
})

// add, edit, delete -----------------------------------------------------------------------------------------------

test('the list is sorted by class then id after an add', ON, async ($, on) => {
  const rec = world(on, { [FILE]: serialize([e('C', 'opus'), e('A', 'haiku'), e('B', 'sonnet')]) })
  await start($)
  const ui = await openEgm($)
  expect(await ids(ui)).toEqual(['haiku', 'sonnet', 'opus']) // an unsorted file is drawn sorted
  for (const [cls, id] of [['B', 'aaa'], ['F', 'kimi/k2'], ['A', 'Zeta'], ['B', 'zzz'], ['A', 'haiku-2']]) {
    await ui.press({ key: 'egm-add' })
    await pasteJson(ui, JSON.stringify({ class: cls, id, harness: 'omp' }))
  }
  expect(await ids(ui)).toEqual(['Zeta', 'haiku', 'haiku-2', 'aaa', 'sonnet', 'zzz', 'opus', 'kimi/k2'])
  expect(fileList(rec).map(x => `${x.class} ${x.id}`)).toEqual(['A Zeta', 'A haiku', 'A haiku-2', 'B aaa', 'B sonnet', 'B zzz', 'C opus', 'F kimi/k2'])
  expect(await selected(ui)).toEqual(['egm-row:2']) // the saved row: A haiku-2
})

test('the Dodaj model Button carries the add hotkey and pressing it opens an empty form', ON, async ($, on) => {
  world(on, seeded())
  await start($)
  const ui = await openEgm($)
  const add = await ui.find({ type: 'Button', key: 'egm-add' })
  expect(add?.props.hotkey).toBe('n') // `+` is no hotkey: one digit or one lowercase letter
  expect(add?.props.label).toBe('Dodaj model')
  expect((await ui.find({ type: 'Button', key: 'egm-settings' }))?.props.hotkey).toBe('s')
  expect((await ui.find({ type: 'Button', key: 'egm-close' }))?.props.hotkey).toBe('q')
  expect((await ui.find({ type: 'Box', key: 'keys' }))?.text).toBe('keys  j/k select  enter edytuj  x usuń  n dodaj  s settings  q close')
  await ui.press({ key: 'egm-add' })
  expect(await titleOf(ui)).toBe('Dodaj model')
  expect((await ui.find({ type: 'Input', key: 'egm-field:id' }))?.props.value).toBe('')
  expect((await ui.find({ type: 'Input', key: 'egm-field:id' }))?.props.placeholder).toBe('wpisz id · enter zapisuje pole')
  // the new entry: class B, claude, default, no thinking control
  for (const [field, value] of [['class', 'B'], ['harness', 'claude'], ['effort', 'default'], ['thinking', '—'], ['mode', 'formularz']]) {
    const box = await ui.find({ type: 'Box', key: `egm-choice:${field}=${value}` })
    expect(box?.text, field).toBe(` ${value} `)
  }
  expect(await ui.find({ type: 'Box', key: 'egm-field:pass' })).toBeUndefined()
  expect(await noteOf(ui)).toBe('enter w polu zapisuje pole · s dopisuje model do models.json')
  expect((await ui.find({ type: 'Box', key: 'keys' }))?.text).toBe('keys  tab move  enter save field  a-f pole  ←→ wybór  s zapisz  z anuluj  q close')
  expect(await texts(ui)).toContain('sonnet-class · D, E: rezerwa')
  expect(await texts(ui)).toContain('id modelu w notacji tego harnessu')
  expect(await texts(ui)).toContain('tak junkd wywołuje inne harnessy · klucze i endpointy trzyma sam harness')
  expect(await texts(ui)).toContain('default: jak harness · none: brak')
  expect(await texts(ui)).toContain('— = nie obsługuje')
  expect(await texts(ui)).toContain(`→ ${SHOWN}`)
})

test('the Anuluj Button carries the cancel hotkey and pressing it returns to the list with anulowano', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  const cancel = await ui.find({ type: 'Button', key: 'egm-cancel' })
  expect(cancel?.props.hotkey).toBe('z') // `escape` is no hotkey: one digit or one lowercase letter
  expect(cancel?.props.label).toBe('Anuluj')
  await ui.press({ key: 'egm-cancel' })
  expect(await titleOf(ui)).toBeUndefined()
  expect(await ids(ui)).toEqual(['haiku', 'sonnet', 'opus'])
  expect(await noteOf(ui)).toBe('anulowano')
  // the second Anuluj (beside Zapisz) does the same, from the JSON view too
  await ui.press({ key: 'egm-add' })
  await ui.press({ key: 'egm-choice:mode=wklej JSON' })
  expect((await ui.find({ type: 'Button', key: 'egm-cancel' }))?.props.hotkey).toBe('z')
  await ui.press({ key: 'egm-cancel-2' })
  expect(await noteOf(ui)).toBe('anulowano')
  expect(rec.writes).toEqual([])
})

test('enter on the selected row opens Edytuj model; enter on another row selects it', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  expect(await selected(ui)).toEqual(['egm-row:0'])
  expect((await ui.find({ type: 'Box', key: 'egm-actions' }))?.text).toBe('   enter: Edytuj   x: Usuń')
  await ui.press({ key: 'egm-row-btn:2' })
  expect(await titleOf(ui)).toBeUndefined()
  expect(await selected(ui)).toEqual(['egm-row:2'])
  await ui.press({ key: 'egm-row-btn:2' })
  expect(await titleOf(ui)).toBe('Edytuj model')
  expect((await ui.find({ type: 'Input', key: 'egm-field:id' }))?.props.value).toBe('opus')
  expect((await ui.find({ type: 'Box', key: 'egm-choice:class=C' }))?.text).toBe(' C ')
  // j and k move the selection, clamped at both ends
  await ui.press({ key: 'egm-cancel' })
  await ui.press({ key: 'egm-down' })
  expect(await selected(ui)).toEqual(['egm-row:2'])
  await ui.press({ key: 'egm-up' })
  await ui.press({ key: 'egm-up' })
  await ui.press({ key: 'egm-up' })
  expect(await selected(ui)).toEqual(['egm-row:0'])
  expect((await ui.find({ type: 'Button', key: 'egm-down' }))?.props.hotkey).toBe('j')
  expect((await ui.find({ type: 'Button', key: 'egm-up' }))?.props.hotkey).toBe('k')
  // the focus ring on a row's Button selects it too
  await $.ui.focus({ component: 'Pane', requestId: EGM, plugin: 'junkd', element: 'egm-row-btn:1', origin: { kind: 'person' } } as never)
  expect(await selected(ui)).toEqual(['egm-row:1'])
  expect(rec.writes).toEqual([])
})

test('add via form: a cycles klasa, b id, s saves, note ✓ dodano <id> (klasa <c>) w ~/.claude/junkd/models.json', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  for (const [key, hotkey] of [['egm-key:a', 'a'], ['egm-key:b', 'b'], ['egm-key:c', 'c'], ['egm-key:d', 'd'], ['egm-key:e', 'e'], ['egm-save', 's']])
    expect((await ui.find({ type: 'Button', key }))?.props.hotkey, key).toBe(hotkey)
  // a: B -> C -> F -> A -> B -> C (wraps)
  const cls = async () => (await ui.findAll({ type: 'Box' })).find(b => b.key?.startsWith('egm-choice:class=') && b.text.startsWith(' '))?.text?.trim()
  const seen: (string | undefined)[] = []
  for (let i = 0; i < 5; i++) {
    await ui.press({ key: 'egm-key:a' })
    seen.push(await cls())
  }
  expect(seen).toEqual(['C', 'F', 'A', 'B', 'C'])
  expect(await texts(ui)).toContain('opus-class · D, E: rezerwa')
  // b asks the ring onto the id field (the kit raises no ui.focus to a test for a plugin's own call): no note, no write
  await ui.press({ key: 'egm-key:b' })
  expect(await noteOf(ui)).toBe('enter w polu zapisuje pole · s dopisuje model do models.json')
  await ui.input({ key: 'egm-field:id', text: '  my-model  ' })
  expect(await noteOf(ui)).toBe('✓ id = my-model')
  await ui.press({ key: 'egm-key:c' }) // claude -> omp
  await ui.press({ key: 'egm-key:d' }) // default -> none
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe(`✓ dodano my-model (klasa C) w ${SHOWN}`)
  expect(await titleOf(ui)).toBeUndefined()
  expect(fileList(rec)).toEqual([...SEED.slice(0, 2), e('C', 'my-model', { harness: 'omp', effort: 'none' }), SEED[2]])
  expect(await selected(ui)).toEqual(['egm-row:2'])
  // typed and not entered: s still takes it
  await ui.press({ key: 'egm-add' })
  await ui.input({ key: 'egm-field:id', text: 'typed', kind: 'change' })
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe(`✓ dodano typed (klasa B) w ${SHOWN}`)
  // a choice picked with the focus ring (enter on an option) works as the hotkey does
  await ui.press({ key: 'egm-add' })
  await ui.press({ key: 'egm-choice:class=F' })
  await ui.press({ key: 'egm-choice:harness=kimi' })
  await ui.press({ key: 'egm-choice:effort=max' })
  await ui.press({ key: 'egm-choice:thinking=high' })
  await ui.press({ key: 'egm-choice:pass=parametr' })
  await ui.input({ key: 'egm-field:id', text: 'kimi/k2' })
  await ui.press({ key: 'egm-save' })
  expect(fileList(rec).at(-1)).toEqual(e('F', 'kimi/k2', { harness: 'kimi', effort: 'max', thinking: { level: 'high', pass: 'param' } }))
  const row = (await ui.findAll({ type: 'Box' })).find(b => b.key === `egm-row:${fileList(rec).length - 1}`)
  expect(row?.text).toContain('high (param)')
})

test('form with an empty id is refused with ✗ id jest puste: wpisz id (b)', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe('✗ id jest puste: wpisz id (b)')
  expect(await titleOf(ui)).toBe('Dodaj model')
  // blanks only: empty after trimming
  await ui.input({ key: 'egm-field:id', text: '   ' })
  expect(await noteOf(ui)).toBe('✓ id = (puste)')
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe('✗ id jest puste: wpisz id (b)')
  expect(rec.writes).toEqual([])
  expect(rec.files[FILE]).toBe(SEED_TEXT)
})

test('f: jak przekazać shows only for thinking on, low, medium or high', ON, async ($, on) => {
  world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  const shown: [string | undefined, boolean, string | undefined][] = []
  for (let i = 0; i < 6; i++) {
    await ui.press({ key: 'egm-key:e' })
    const level = (await ui.findAll({ type: 'Box' })).find(b => b.key?.startsWith('egm-choice:thinking=') && /^ \S+ $/.test(b.text))?.text?.trim()
    const pass = await ui.find({ type: 'Box', key: 'egm-field:pass' })
    shown.push([level, pass !== undefined, (await ui.find({ type: 'Button', key: 'egm-key:f' }))?.props.hotkey])
  }
  expect(shown).toEqual([['off', false, undefined], ['on', true, 'f'], ['low', true, 'f'], ['medium', true, 'f'], ['high', true, 'f'], ['—', false, undefined]])
  // the hint follows how it is passed
  await ui.press({ key: 'egm-key:e' })
  await ui.press({ key: 'egm-key:e' })
  expect((await ui.find({ type: 'Box', key: 'egm-field:pass' }))?.text).toContain('<id>:<level>')
  expect((await ui.find({ type: 'Box', key: 'egm-choice:pass=sufiks :level' }))?.text).toBe(' sufiks :level ')
  await ui.press({ key: 'egm-key:f' })
  expect((await ui.find({ type: 'Box', key: 'egm-field:pass' }))?.text).toContain('parametr w żądaniu')
  await ui.press({ key: 'egm-key:f' })
  expect((await ui.find({ type: 'Box', key: 'egm-field:pass' }))?.text).toContain('<id>:<level>')
})

test('add via JSON: valid object appends with effort default and thinking -/suffix when omitted', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  await ui.press({ key: 'egm-choice:mode=wklej JSON' })
  // the JSON view: its line, the example, the legend, the default note and keys
  expect((await ui.find({ type: 'Input', key: 'egm-field:json' }))?.props.value).toBe(
    '{"class":"B","id":"openrouter/<vendor>/<model>","harness":"omp","effort":"default","thinking":{"level":"high","pass":"suffix"}}',
  )
  expect((await ui.find({ type: 'Input', key: 'egm-field:json' }))?.props.placeholder).toBe('wklej JSON')
  expect((await ui.find({ type: 'Box', key: 'egm-json-head' }))?.text).toBe('JSONjeden obiekt · class, id, harness wymagane · effort, thinking {level, pass}')
  expect((await ui.findAll({ type: 'Text' })).find(t => t.text === 'JSON')?.props.bold).toBe(true)
  expect(await texts(ui)).toContain('class: A B C F (D, E rezerwa) · harness: claude omp opencode codex kimi · pass: suffix | param')
  expect(await noteOf(ui)).toBe('klik albo tab w pole, wklej · esc wychodzi z pola · s parsuje JSON i dopisuje wiersz')
  expect((await ui.find({ type: 'Box', key: 'keys' }))?.text).toBe('keys  tab move  esc wyjdź z pola  s zapisz  z anuluj  q close')
  await ui.input({ key: 'egm-field:json', text: '{"class":"B","id":"openrouter/x/y-1.5","harness":"omp","thinking":{"level":"high","pass":"suffix"}}', kind: 'change' })
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe(`✓ dodano openrouter/x/y-1.5 (klasa B) z JSON w ${SHOWN}`)
  expect(fileList(rec)[1]).toEqual(e('B', 'openrouter/x/y-1.5', { harness: 'omp', thinking: { level: 'high', pass: 'suffix' } }))
  expect(rec.files[`${FILE}.bak`]).toBe(SEED_TEXT)
  // everything omitted but the three
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"A","id":"bare","harness":"codex"}')
  expect(fileList(rec).find(x => x.id === 'bare')).toEqual({ class: 'A', id: 'bare', harness: 'codex', effort: 'default', thinking: { level: '-', pass: 'suffix' } })
  // entered with enter, then s
  await ui.press({ key: 'egm-add' })
  await ui.press({ key: 'egm-choice:mode=wklej JSON' })
  await ui.input({ key: 'egm-field:json', text: '{"class":"C","id":"entered","harness":"kimi"}' })
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe(`✓ dodano entered (klasa C) z JSON w ${SHOWN}`)
})

test('add via JSON: a three-line pasted object is joined and parses', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class": "F",\r\n   "id": "fable",\n  "harness": "claude", "effort": "high"}')
  expect(await noteOf(ui)).toBe(`✓ dodano fable (klasa F) z JSON w ${SHOWN}`)
  expect(fileList(rec).at(-1)).toEqual(e('F', 'fable', { effort: 'high' }))
})

test('add via JSON: class D is refused with ✗ JSON: class D to rezerwa, użyj A, B, C albo F', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"D","id":"x","harness":"omp"}')
  expect(await noteOf(ui)).toBe('✗ JSON: class D to rezerwa, użyj A, B, C albo F')
  expect((await ui.find({ type: 'Input', key: 'egm-field:json' }))?.props.value).toBe('{"class":"D","id":"x","harness":"omp"}') // the view stays
  // every other row of the validation table, shown as its note
  const cases: [string, string][] = [
    ['[{}]', '✗ JSON: oczekiwany jeden obiekt {…}'],
    ['{"id":"x","harness":"omp"}', '✗ JSON: brak pola class'],
    ['{"class":"A","id":" ","harness":"omp"}', '✗ JSON: brak pola id'],
    ['{"class":"A","id":"x"}', '✗ JSON: brak pola harness'],
    ['{"class":"E","id":"x","harness":"omp"}', '✗ JSON: class E to rezerwa, użyj A, B, C albo F'],
    ['{"class":"Z","id":"x","harness":"omp"}', '✗ JSON: class musi być A, B, C albo F, jest "Z"'],
    ['{"class":"A","id":3,"harness":"omp"}', '✗ JSON: id musi być tekstem'],
    ['{"class":"A","id":"x","harness":"vim"}', '✗ JSON: harness spoza listy: claude, omp, opencode, codex, kimi'],
    ['{"class":"A","id":"x","harness":"omp","effort":"ultra"}', '✗ JSON: effort spoza listy: default, none, low, medium, high, xhigh, max'],
    ['{"class":"A","id":"x","harness":"omp","thinking":"adaptive"}', '✗ JSON: thinking.level spoza listy: -, off, on, low, medium, high'],
    ['{"class":"A","id":"x","harness":"omp","thinking":{"level":"on","pass":"header"}}', '✗ JSON: thinking.pass musi być suffix albo param'],
  ]
  for (const [text, note] of cases) {
    await ui.input({ key: 'egm-field:json', text, kind: 'change' })
    await ui.press({ key: 'egm-save' })
    expect(await noteOf(ui), text).toBe(note)
  }
  expect(rec.writes).toEqual([])
  expect(rec.files[FILE]).toBe(SEED_TEXT)
})

test('add via JSON: broken JSON shows one ✗ JSON: line and keeps the view', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  const text = '{"class": "A",\n  "id": '
  await pasteJson(ui, text)
  const note = await noteOf(ui)
  expect(note).toBe(`✗ JSON: ${parserMessage(text.replace(/\s*\r?\n\s*/g, ' '))}`)
  expect(note).not.toMatch(/\n|\s{2}/) // one line
  expect((await ui.find({ type: 'Input', key: 'egm-field:json' }))?.props.value).toBe(text)
  expect((await ui.find({ type: 'Box', key: 'egm-json-head' }))?.text).toMatch(/^JSONjeden obiekt/)
  expect(rec.writes).toEqual([])
})

test('add via JSON: a duplicate class+id+harness is refused', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"A","id":" haiku ","harness":"claude","effort":"max"}')
  expect(await noteOf(ui)).toBe('✗ taki model już jest: haiku (klasa A, claude)')
  expect(rec.writes).toEqual([])
  // another harness, or another class, is another model
  await ui.input({ key: 'egm-field:json', text: '{"class":"A","id":"haiku","harness":"omp"}', kind: 'change' })
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe(`✓ dodano haiku (klasa A) z JSON w ${SHOWN}`)
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"B","id":"haiku","harness":"claude"}')
  expect(fileList(rec).map(x => `${x.class} ${x.id} ${x.harness}`)).toEqual(['A haiku claude', 'A haiku omp', 'B haiku claude', 'B sonnet claude', 'C opus claude'])
})

test('edit to a duplicate of another row is refused; edit of the same row is allowed', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-row-btn:1' })
  await ui.press({ key: 'egm-row-btn:1' }) // sonnet
  await ui.press({ key: 'egm-choice:class=A' })
  await ui.input({ key: 'egm-field:id', text: 'haiku' })
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe('✗ taki model już jest: haiku (klasa A, claude)')
  expect(rec.writes).toEqual([])
  // the same row, unchanged or with only its effort changed: allowed
  await ui.press({ key: 'egm-cancel' })
  await ui.press({ key: 'egm-row-btn:1' })
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe(`✓ zapisano sonnet (klasa B) w ${SHOWN}`)
  await ui.press({ key: 'egm-row-btn:1' })
  await ui.press({ key: 'egm-choice:mode=wklej JSON' })
  expect((await ui.find({ type: 'Input', key: 'egm-field:json' }))?.props.value).toBe(JSON.stringify(SEED[1]))
  await ui.input({ key: 'egm-field:json', text: '{"class":"B","id":"sonnet","harness":"claude","effort":"low"}', kind: 'change' })
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe(`✓ zapisano sonnet (klasa B) z JSON w ${SHOWN}`)
  expect(fileList(rec)).toEqual([SEED[0], e('B', 'sonnet', { effort: 'low' }), SEED[2]])
})

test('edit opens the form prefilled and replaces the entry (✓ zapisano …)', ON, async ($, on) => {
  const rec = world(on, { [FILE]: serialize([...SEED, e('F', 'kimi/k2', { harness: 'kimi', effort: 'high', thinking: { level: 'on', pass: 'param' } })]) })
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-row-btn:3' })
  await ui.press({ key: 'egm-row-btn:3' })
  expect(await titleOf(ui)).toBe('Edytuj model')
  expect((await ui.find({ type: 'Input', key: 'egm-field:id' }))?.props.value).toBe('kimi/k2')
  for (const [field, value] of [['class', 'F'], ['harness', 'kimi'], ['effort', 'high'], ['thinking', 'on'], ['pass', 'parametr']])
    expect((await ui.find({ type: 'Box', key: `egm-choice:${field}=${value}` }))?.text, field).toBe(` ${value} `)
  await ui.input({ key: 'egm-field:id', text: 'kimi/kimi-x1' })
  await ui.press({ key: 'egm-choice:class=A' })
  await ui.press({ key: 'egm-save' })
  expect(await noteOf(ui)).toBe(`✓ zapisano kimi/kimi-x1 (klasa A) w ${SHOWN}`)
  expect(fileList(rec)).toEqual([SEED[0], e('A', 'kimi/kimi-x1', { harness: 'kimi', effort: 'high', thinking: { level: 'on', pass: 'param' } }), SEED[1], SEED[2]])
  expect(await ids(ui)).toEqual(['haiku', 'kimi/kimi-x1', 'sonnet', 'opus'])
  expect(await selected(ui)).toEqual(['egm-row:1'])
  // switching to JSON and back keeps the entry
  await ui.press({ key: 'egm-row-btn:1' })
  await ui.press({ key: 'egm-choice:mode=wklej JSON' })
  await ui.input({ key: 'egm-field:json', text: '{"class":"C","id":"via-json","harness":"omp"}', kind: 'change' })
  await ui.press({ key: 'egm-choice:mode=formularz' })
  expect((await ui.find({ type: 'Input', key: 'egm-field:id' }))?.props.value).toBe('via-json')
  expect((await ui.find({ type: 'Box', key: 'egm-choice:class=C' }))?.text).toBe(' C ')
})

test('x once shows x jeszcze raz usuwa <id>; x again removes it with ✓ usunięto <id>; another key cancels', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  expect((await ui.find({ type: 'Button', key: 'egm-x' }))?.props.hotkey).toBe('x')
  await ui.press({ key: 'egm-x' })
  expect(await noteOf(ui)).toBe('x jeszcze raz usuwa haiku')
  const confirm = (await ui.findAll({ type: 'Text' })).find(t => t.text === 'x: Usuń (potwierdź)')
  expect(confirm?.props.color).toBe('error')
  // another key cancels: j moves on, and x there starts over
  await ui.press({ key: 'egm-down' })
  expect((await ui.find({ type: 'Box', key: 'egm-actions' }))?.text).toBe('   enter: Edytuj   x: Usuń')
  await ui.press({ key: 'egm-x' })
  expect(await noteOf(ui)).toBe('x jeszcze raz usuwa sonnet')
  // the focus ring on another row cancels too
  await $.ui.focus({ component: 'Pane', requestId: EGM, plugin: 'junkd', element: 'egm-row-btn:2', origin: { kind: 'person' } } as never)
  await $.ui.focus({ component: 'Pane', requestId: EGM, plugin: 'junkd', element: 'egm-row-btn:1', origin: { kind: 'person' } } as never)
  await ui.press({ key: 'egm-x' })
  expect(await noteOf(ui)).toBe('x jeszcze raz usuwa sonnet')
  expect(rec.writes).toEqual([])
  await ui.press({ key: 'egm-x' })
  expect(await noteOf(ui)).toBe('✓ usunięto sonnet')
  expect(fileList(rec)).toEqual([SEED[0], SEED[2]])
  expect(await ids(ui)).toEqual(['haiku', 'opus'])
  expect(await selected(ui)).toEqual(['egm-row:1'])
  // the last row: the selection is clamped onto the row before
  await ui.press({ key: 'egm-x' })
  await ui.press({ key: 'egm-x' })
  expect(await ids(ui)).toEqual(['haiku'])
  expect(await selected(ui)).toEqual(['egm-row:0'])
  // the add and the edit drop a pending delete too
  await ui.press({ key: 'egm-x' })
  await ui.press({ key: 'egm-add' })
  await ui.press({ key: 'egm-cancel' })
  await ui.press({ key: 'egm-x' })
  expect(await noteOf(ui)).toBe('x jeszcze raz usuwa haiku')
  await ui.press({ key: 'egm-x' })
  expect(rec.files[FILE]).toBe('[]\n')
  expect(await texts(ui)).toContain('   brak modeli · n dodaje pierwszy')
  // x on an empty list does nothing
  await ui.press({ key: 'egm-x' })
  expect(await noteOf(ui)).toBe('✓ usunięto haiku')
})

test('every write keeps models.json.bak with the previous content', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  let before = rec.files[FILE]!
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"B","id":"m1","harness":"omp"}')
  expect(rec.files[`${FILE}.bak`]).toBe(before)
  before = rec.files[FILE]!
  await ui.press({ key: 'egm-row-btn:0' }) // selects
  await ui.press({ key: 'egm-row-btn:0' }) // edits
  await ui.input({ key: 'egm-field:id', text: 'haiku-x' })
  await ui.press({ key: 'egm-save' })
  expect(rec.files[`${FILE}.bak`]).toBe(before)
  before = rec.files[FILE]!
  await ui.press({ key: 'egm-x' })
  await ui.press({ key: 'egm-x' })
  expect(rec.files[`${FILE}.bak`]).toBe(before)
  expect(rec.runs.filter(r => r[0] === '/bin/cp')).toEqual(Array(3).fill(['/bin/cp', '-f', FILE, `${FILE}.bak`]))
  expect(rec.runs.filter(r => r[0] === '/bin/mv')).toEqual(Array(3).fill(['/bin/mv', '-f', `${FILE}.junkd-tmp`, FILE]))
  expect(`${FILE}.junkd-tmp` in rec.files).toBe(false)
  // each write: mkdir, then the copy before the move
  expect(rec.runs.slice(0, 3).map(r => r[0])).toEqual(['mkdir', '/bin/cp', '/bin/mv'])
})

test('a write that fails shows ✗ <reason> and reloads the list from disk', ON, async ($, on) => {
  const rec = world(on, seeded(), { mvErr: 'mv: cannot move: Permission denied\n' })
  await start($)
  const ui = await openEgm($)
  rec.mvExit = 1
  // the disk changed under the tab: the reload shows what is there
  rec.files[FILE] = serialize([e('C', 'disk-only')])
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"A","id":"lost","harness":"omp"}')
  expect(await noteOf(ui)).toBe('✗ mv: cannot move: Permission denied')
  expect(rec.files[FILE]).toBe(serialize([e('C', 'disk-only')]))
  // the form stays open with what was typed; the list under it is the disk's
  await ui.press({ key: 'egm-cancel' })
  expect(await ids(ui)).toEqual(['disk-only'])
  // a failing remove: the same
  rec.mvExit = 2
  const ui2 = ui
  await ui2.press({ key: 'egm-x' })
  await ui2.press({ key: 'egm-x' })
  expect(await noteOf(ui2)).toBe('✗ mv: cannot move: Permission denied')
  expect(rec.files[FILE]).toBe(serialize([e('C', 'disk-only')]))
  expect(await ids(ui2)).toEqual(['disk-only'])
})

// a broken file, a link outside -----------------------------------------------------------------------------------

test('a models.json that does not parse is never overwritten and +, enter and x are refused with its note', ON, async ($, on) => {
  const broken = '[{ "class": "A", broken'
  const rec = world(on, { [FILE]: broken })
  await start($)
  const ui = await openEgm($)
  const line = `✗ models.json: ${parserMessage(broken)} · ${FIX}`
  expect((await ui.find({ type: 'Button', key: 'egm-file-error-btn' }))?.text).toBe(line)
  expect((await ui.find({ type: 'Button', key: 'egm-file-error-btn' }))?.props.dimColor).toBe(true)
  expect(await ids(ui)).toEqual([])
  for (const key of ['egm-add', 'egm-file-error-btn', 'egm-x']) {
    await ui.press({ key: 'egm-down' }) // clears the note
    expect(await noteOf(ui), key).toBe('')
    await ui.press({ key })
    expect(await noteOf(ui), key).toBe(line)
    expect(await titleOf(ui), key).toBeUndefined()
  }
  expect(rec.files[FILE]).toBe(broken)
  expect(rec.writes).toEqual([])
  expect(rec.runs).toEqual([])
  // a top-level object is a file error too; a show reads it again
  rec.files[FILE] = '{"models":[]}'
  await ui.unmount()
  await run($, 'call', JSON.stringify({ pane: 'egm' }))
  await run($, 'call', JSON.stringify({ pane: 'egm' }))
  const ui2 = await mountEgm($)
  expect((await ui2.find({ type: 'Button', key: 'egm-file-error-btn' }))?.text).toBe(`✗ models.json: oczekiwana tablica [...] · ${FIX}`)
  expect(rec.files[FILE]).toBe('{"models":[]}')
  expect(rec.writes).toEqual([])
})

test('a models.json that breaks after the tab read it is never overwritten: a save and a second x are refused with its note', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  expect(await ids(ui)).toEqual(['haiku', 'sonnet', 'opus'])
  const broken = '[{ "class": "A", broken'
  const line = `✗ models.json: ${parserMessage(broken)} · ${FIX}`
  // a save from the JSON view
  rec.files[FILE] = broken
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"B","id":"late","harness":"omp"}')
  expect(await noteOf(ui)).toBe(line)
  expect(rec.files[FILE]).toBe(broken)
  expect(rec.writes).toEqual([])
  expect(rec.runs).toEqual([])
  // a remove, on a file that broke between the first x and the second
  await ui.press({ key: 'egm-cancel' })
  rec.files[FILE] = SEED_TEXT
  await ui.unmount()
  await run($, 'call', JSON.stringify({ pane: 'egm' }))
  await run($, 'call', JSON.stringify({ pane: 'egm' }))
  const ui2 = await mountEgm($)
  expect(await ids(ui2)).toEqual(['haiku', 'sonnet', 'opus'])
  await ui2.press({ key: 'egm-x' })
  rec.files[FILE] = broken
  await ui2.press({ key: 'egm-x' })
  expect(await noteOf(ui2)).toBe(line)
  expect(rec.files[FILE]).toBe(broken)
  expect(rec.writes).toEqual([])
  expect(rec.runs).toEqual([])
})

test('a models.json whose second entry has no id shows ✗ models.json: entry 2: JSON: brak pola id · popraw plik ręcznie', ON, async ($, on) => {
  const text = JSON.stringify([e('A', 'haiku'), { class: 'B', harness: 'claude' }], null, 2)
  const rec = world(on, { [FILE]: text })
  await start($)
  const ui = await openEgm($)
  expect((await ui.find({ type: 'Button', key: 'egm-file-error-btn' }))?.text).toBe('✗ models.json: entry 2: JSON: brak pola id · popraw plik ręcznie')
  await ui.press({ key: 'egm-x' })
  expect(await noteOf(ui)).toBe('✗ models.json: entry 2: JSON: brak pola id · popraw plik ręcznie')
  expect(rec.files[FILE]).toBe(text)
  expect(rec.writes).toEqual([])
})

test('a models.json link that resolves outside ~/.claude/junkd is not written', ON, async ($, on) => {
  const outside = '/elsewhere/models.json'
  const rec = world(on, { [outside]: SEED_TEXT }, { links: { [FILE]: outside } })
  await start($)
  const ui = await openEgm($)
  expect(await ids(ui)).toEqual(['haiku', 'sonnet', 'opus']) // read through the link
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"A","id":"x","harness":"omp"}')
  expect(await noteOf(ui)).toBe(`✗ models.json wskazuje poza ${CFG}/junkd: ${outside}`)
  await ui.press({ key: 'egm-cancel' })
  await ui.press({ key: 'egm-x' })
  await ui.press({ key: 'egm-x' })
  expect(await noteOf(ui)).toBe(`✗ models.json wskazuje poza ${CFG}/junkd: ${outside}`)
  expect(rec.files[outside]).toBe(SEED_TEXT)
  expect(rec.writes).toEqual([])
  expect(rec.runs.filter(r => r[0] !== 'mkdir')).toEqual([])
})

test('the fence: a sibling folder that only starts like junkd is outside; a link inside, or a linked config dir, is written', W, async ($, on) => {
  // <cfg>/junkd2/models.json starts with <cfg>/junkd but is no file of it
  const sibling = `${CFG}/junkd2/models.json`
  const rec = world(on, { [sibling]: SEED_TEXT }, { links: { [FILE]: sibling } })
  await start($)
  await menuSet($, 'junkd.egm_enabled', true)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"A","id":"x","harness":"omp"}')
  expect(await noteOf(ui)).toBe(`✗ models.json wskazuje poza ${CFG}/junkd: ${sibling}`)
  expect(rec.writes).toEqual([])
})

test('the fence lets a link inside <cfg>/junkd through: the write lands on its target and its .bak', ON, async ($, on) => {
  const target = `${DIR}/registry/models.json`
  const rec = world(on, { [target]: SEED_TEXT }, { links: { [FILE]: target } })
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-add' })
  await pasteJson(ui, '{"class":"A","id":"x","harness":"omp"}')
  expect(await noteOf(ui)).toBe(`✓ dodano x (klasa A) z JSON w ${SHOWN}`)
  expect(rec.writes).toEqual([`${target}.junkd-tmp`])
  expect(rec.files[`${target}.bak`]).toBe(SEED_TEXT)
  expect(fileList(rec, target).map(x => x.id)).toEqual(['haiku', 'x', 'sonnet', 'opus'])
  expect(rec.files[FILE]).toBeUndefined() // the link itself is left a link
})

test('the fence follows a linked config dir: the seed goes to the resolved folder', ON, async ($, on) => {
  const data = '/data/claude'
  const rec = world(on, {}, { links: { [CFG]: data, [DIR]: `${data}/junkd` } })
  rec.dirs.add(data)
  await start($)
  await openEgm($)
  expect(rec.runs[0]).toEqual(['mkdir', '-p', '--', DIR])
  expect(rec.writes).toEqual([`${data}/junkd/models.json.junkd-tmp`])
  expect(rec.files[`${data}/junkd/models.json`]).toBe(SEED_TEXT)
})

test('esc in the form returns to the list with anulowano and writes nothing', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  const ui = await openEgm($)
  await ui.press({ key: 'egm-row-btn:0' }) // edit haiku
  await ui.input({ key: 'egm-field:id', text: 'changed' })
  await ui.press({ key: 'egm-choice:class=F' })
  await ui.press({ key: 'egm-cancel' })
  expect(await noteOf(ui)).toBe('anulowano')
  expect(await ids(ui)).toEqual(['haiku', 'sonnet', 'opus'])
  expect(rec.files[FILE]).toBe(SEED_TEXT)
  expect(rec.writes).toEqual([])
  expect(rec.runs).toEqual([])
})

// the frame of the tab ----------------------------------------------------------------------------------------------

test('q closes the set while the tab is the set\'s, else the tab alone; s focuses junkd or opens the set', ON, async ($, on) => {
  const rec = world(on, seeded())
  await start($)
  await openSet($)
  const ui = await mountEgm($)
  await ui.press({ key: 'egm-settings' }) // the set is open: junkd is asked for the keys, nothing opens or closes
  expect(rec.tabs).toEqual([...SET_TABS, EGM])
  expect(rec.toasts).toEqual([])
  await ui.press({ key: 'egm-close' })
  expect(rec.tabs).toEqual([])
  // alone: s opens the set, which takes the tab in as its own (last)
  await run($, 'call', JSON.stringify({ pane: 'egm' }))
  expect(rec.tabs).toEqual([EGM])
  await ui.press({ key: 'egm-settings' })
  expect(rec.tabs).toEqual([...SET_TABS, EGM])
  await run($, 'junkd')
  expect(rec.tabs).toEqual([])
  // alone again: q closes the tab alone
  await run($, 'junkd')
  await run($, 'call', JSON.stringify({ pane: 'egm' })) // the person's own toggle: closes the set's tab
  await run($, 'call', JSON.stringify({ pane: 'egm' })) // and opens it as the person's
  expect(rec.tabs).toEqual([...SET_TABS, EGM])
  await ui.press({ key: 'egm-close' })
  expect(rec.tabs).toEqual(SET_TABS)
})
