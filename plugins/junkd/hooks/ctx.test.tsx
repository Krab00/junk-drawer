// junkd's ctx group: `$.junkd` (schema, get, set) on the ctx_* rows, the /config menu's writes to them, the three
// files bin/ctx-limit-hook reads (ctx-limit-threshold, -action, -cmd under <config dir>/junkd/), /junkd:ctx-limit, and
// the move of the old plugin's files at session start. The whole module loads, so the world also answers what every
// feature's session start touches. Everything beneath the plugin is answered from memory by `world`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'
import { coerce, parseTokens } from './ctx'

const HOME = '/home/u'
const CFG = `${HOME}/.claude`
// What bin/ctx-limit writes and bin/ctx-limit-hook reads with no CLAUDE_CONFIG_DIR.
const THR = `${CFG}/junkd/ctx-limit-threshold`
const ACT = `${CFG}/junkd/ctx-limit-action`
const CMD = `${CFG}/junkd/ctx-limit-cmd`
const KEYS = ['ctx_enabled', 'ctx_threshold', 'ctx_action', 'ctx_cmd'] as const
const TRUE_SPELLINGS = [true, 'true', 'on'] as const
const FALSE_SPELLINGS = [false, 'false', 'off', 'maybe', 1, 0] as const

// `fail.write`: fs.write throws; `fail.rm`: rm's exit code. `files`: what is on "disk" at the start, by path.
type Fail = { write?: boolean; rm?: number }
function world(on: On, env: Record<string, string> = { HOME }, fail: Fail = {}, files: Record<string, string> = {}) {
  mock.store(on)
  mock.env(on, env)
  const rec = {
    files: new Map<string, string>(Object.entries(files)),
    config: [] as { key: string; value: unknown }[],
    runs: [] as string[][],
    toasts: [] as string[],
    fail,
  }
  on('ui.panes', () => ({ value: [] }))
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', (_$, e) => ({ value: { kind: rec.files.has(e.path) ? 'file' : 'other', size: 0, mtimeMs: 0 } as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('fs.write', (_$, e) => {
    if (rec.fail.write) throw new Error(`EACCES ${e.path}`)
    rec.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: rec.files.has(e.path) }))
  on('fs.read', (_$, e) => {
    if (!rec.files.has(e.path)) throw new Error(`ENOENT ${e.path}`)
    return { value: rec.files.get(e.path)! }
  })
  on('process.run', (_$, e) => {
    rec.runs.push([...e.argv])
    const exitCode = e.argv[0] === 'rm' ? (rec.fail.rm ?? 0) : 0
    if (e.argv[0] === 'rm' && exitCode === 0) rec.files.delete(e.argv.at(-1)!)
    const stderr = exitCode === 0 ? '' : 'rm: Permission denied'
    return { value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return rec
}
const ctxFiles = (rec: { files: Map<string, string> }) => Object.fromEntries([...rec.files].filter(([p]) => /\/ctx-limit-/.test(p)))
const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

// A caller plugin beside junkd: `/frame <method> [json]` calls `$.junkd.<method>` (or `$.config.set` for `config`,
// the /config menu's own path) and carries the answer out as text.
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
        if (method === 'config') return { text: JSON.stringify({ ok: await $.config.set(input) }) }
        return { text: JSON.stringify({ error: `no method ${method}` }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
  },
}
// The host's rule for a plugin's own write: `$.config.set` passes the other plugins' hooks, the caller's own skipped.
const HOST: Plugin = {
  name: 'host',
  tier: 'prepend',
  register(on) {
    on('config.set', (_$, e, next) => (next.origin.plugin === 'junkd' ? next.to(e, 'append') : next(e)))
  },
}
const W = { plugins: [HOST, FRAME] }
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
const ctxLimit = ($: Engine, args: string) => $.command.run({ command: 'junkd:ctx-limit', args, ...composer })

// ------------------------------------------------------------------ schema and defaults

test('the ctx rows mirror the manifest: enabled, threshold, action, cmd; get answers the defaults with no file', W, async ($, on) => {
  const rec = world(on)
  await start($)
  const schema = ((await frame($, 'schema')) as { key: string; group: string; field: string; type: string; default: unknown; main: boolean; options?: string[] }[]).filter(f => f.group === 'ctx')
  expect(schema.map(f => f.key)).toEqual([...KEYS])
  expect(schema.map(f => f.main)).toEqual([true, true, true, false])
  expect(schema.map(f => f.default)).toEqual([false, 300000, 'block', ''])
  expect(schema.find(f => f.key === 'ctx_action')?.options).toEqual(['block', 'warn', 'cmd'])
  for (const f of schema) expect(typeof f.default, f.key).toBe(f.type)
  expect(await get($, 'ctx_enabled')).toBe(false)
  expect(await get($, 'ctx_threshold')).toBe(300000)
  expect(await get($, 'ctx_action')).toBe('block')
  expect(await get($, 'ctx_cmd')).toBe('')
  expect(ctxFiles(rec), 'the start writes no file').toEqual({})
  expect(rec.config, 'the start writes no row').toEqual([])
})

test('the threshold option at load is what enabled writes; one below 1000 is the default', { ...W, options: { ctx_threshold: 250000 } }, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await get($, 'ctx_threshold')).toBe(250000)
  await set($, 'ctx_enabled', true)
  expect(rec.files.get(THR)).toBe('250000\n')
})
for (const threshold of [999, 0, 2.5]) {
  test(`a threshold option of ${threshold} at load falls back to 300000`, { ...W, options: { ctx_threshold: threshold } }, async ($, on) => {
    world(on)
    await start($)
    expect(await get($, 'ctx_threshold')).toBe(300000)
  })
}
test('a threshold option of 1000 at load (the bound) is taken', { ...W, options: { ctx_threshold: 1000 } }, async ($, on) => {
  world(on)
  await start($)
  expect(await get($, 'ctx_threshold')).toBe(1000)
})

// ------------------------------------------------------------------ the pure parts

test('parseTokens: a whole number with an optional k or m (any case); anything else undefined', () => {
  expect(parseTokens('300000')).toBe(300000)
  expect(parseTokens(' 300k ')).toBe(300000)
  expect(parseTokens('2K')).toBe(2000)
  expect(parseTokens('1m')).toBe(1000000)
  expect(parseTokens('3M')).toBe(3000000)
  expect(parseTokens(4000)).toBe(4000)
  for (const junk of ['', 'k', '1.5k', '-5', '12x', '3kk', 'abc', '1e5', 2.5, NaN, Infinity, '99999999999999999999']) expect(parseTokens(junk), String(junk)).toBeUndefined()
})
test('coerce: threshold 1000 or more only; action block|warn|cmd in any case; cmd trimmed; enabled true, "true", "on"', () => {
  expect(coerce('threshold', 1000)).toEqual({ value: 1000 })
  expect(coerce('threshold', '1k')).toEqual({ value: 1000 })
  expect(coerce('threshold', 999).error).toMatch(/999 is not a valid ctx_threshold/)
  expect(coerce('threshold', '0').error).toMatch(/not a valid ctx_threshold/)
  expect(coerce('action', ' WARN ')).toEqual({ value: 'warn' })
  expect(coerce('action', 'stop').error).toMatch(/stop is not a valid ctx_action \(block, warn or cmd\)/)
  expect(coerce('cmd', '  say hi ')).toEqual({ value: 'say hi' })
  expect(coerce('cmd', undefined)).toEqual({ value: '' })
  for (const v of TRUE_SPELLINGS) expect(coerce('enabled', v), String(v)).toEqual({ value: true })
  for (const v of FALSE_SPELLINGS) expect(coerce('enabled', v), String(v)).toEqual({ value: false })
})

// ------------------------------------------------------------------ set: the row and its file

test('set enabled writes junkd.ctx_enabled and the threshold file; off removes the file; every spelling', W, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const v of TRUE_SPELLINGS) {
    expect(await set($, 'ctx_enabled', v), String(v)).toBe(true)
    expect(rec.files.get(THR), String(v)).toBe('300000\n')
    expect(await get($, 'ctx_enabled')).toBe(true)
    expect(await set($, 'ctx_enabled', false)).toBe(false)
    expect(rec.files.has(THR), 'off removes the file').toBe(false)
    expect(rec.runs.at(-1)).toEqual(['rm', '-f', '--', THR])
    expect(await get($, 'ctx_enabled')).toBe(false)
  }
  for (const v of FALSE_SPELLINGS) {
    await set($, 'ctx_enabled', true)
    expect(await set($, 'ctx_enabled', v), String(v)).toBe(false)
    expect(rec.files.has(THR), String(v)).toBe(false)
  }
  expect(rec.config.every(c => c.key === 'junkd.ctx_enabled')).toBe(true)
  expect(rec.config.map(c => c.value)).toEqual([true, false, true, false, true, false, ...FALSE_SPELLINGS.flatMap(() => [true, false])])
})

test('set threshold: the integer stored; the file follows only while the guard is on; enable writes the last threshold', W, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await set($, 'ctx_threshold', '250k')).toBe(250000)
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.ctx_threshold', value: 250000 })
  expect(rec.files.has(THR), 'off: no file').toBe(false)
  expect(await get($, 'ctx_threshold')).toBe(250000)
  await set($, 'ctx_enabled', true)
  expect(rec.files.get(THR)).toBe('250000\n')
  expect(await set($, 'ctx_threshold', '1m')).toBe(1000000)
  expect(rec.files.get(THR), 'on: the file follows').toBe('1000000\n')
  expect(await set($, 'ctx_threshold', 1000)).toBe(1000) // the bound
  expect(rec.files.get(THR)).toBe('1000\n')
  expect(await set($, 'ctx_threshold', '300000')).toBe(300000)
  expect(await get($, 'ctx_threshold')).toBe(300000)
})

for (const bad of [999, '999', 0, -5, 'abc', '1.5k', 2.5, '', 'k']) {
  test(`set threshold ${JSON.stringify(bad)} is refused by set and by the menu: no row, the file as it was`, W, async ($, on) => {
    const rec = world(on, { HOME }, {}, { [THR]: '400000\n' })
    await start($)
    await expect(set($, 'ctx_threshold', bad)).rejects.toThrow(/is not a valid ctx_threshold/)
    expect((await menu($, 'ctx_threshold', bad)).deny).toMatch(/is not a valid ctx_threshold/)
    expect(rec.config).toEqual([])
    expect(rec.files.get(THR)).toBe('400000\n')
    expect(await get($, 'ctx_threshold')).toBe(400000)
  })
}

test('set action: block, warn, cmd in any case into the action file; another word is refused, the file as it was', W, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const [raw, want] of [['warn', 'warn'], [' CMD ', 'cmd'], ['Block', 'block']] as const) {
    expect(await set($, 'ctx_action', raw)).toBe(want)
    expect(rec.files.get(ACT)).toBe(`${want}\n`)
    expect(await get($, 'ctx_action')).toBe(want)
  }
  await set($, 'ctx_action', 'warn')
  const rows = rec.config.length
  await expect(set($, 'ctx_action', 'stop')).rejects.toThrow(/stop is not a valid ctx_action/)
  expect((await menu($, 'ctx_action', 'stop')).deny).toMatch(/not a valid ctx_action/)
  expect(rec.config).toHaveLength(rows)
  expect(rec.files.get(ACT)).toBe('warn\n')
})

test('set cmd: the command into the cmd file, trimmed; empty removes the file', W, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await set($, 'ctx_cmd', '  terminal-notifier -message hit ')).toBe('terminal-notifier -message hit')
  expect(rec.files.get(CMD)).toBe('terminal-notifier -message hit\n')
  expect(await get($, 'ctx_cmd')).toBe('terminal-notifier -message hit')
  expect(await set($, 'ctx_cmd', '')).toBe('')
  expect(rec.files.has(CMD)).toBe(false)
  expect(rec.runs.at(-1)).toEqual(['rm', '-f', '--', CMD])
  expect(await get($, 'ctx_cmd')).toBe('')
  expect(rec.config.map(c => c.value)).toEqual(['terminal-notifier -message hit', ''])
})

test('get reads the files as the hook does: the CLI wrote them, the rows say otherwise; junk is off and block', W, async ($, on) => {
  const rec = world(on)
  await start($)
  rec.files.set(THR, '123456\n') // `ctx-limit 123456` from the CLI: no row is written
  rec.files.set(ACT, 'warn\n')
  rec.files.set(CMD, 'say hi\n')
  expect(await get($, 'ctx_enabled')).toBe(true)
  expect(await get($, 'ctx_threshold')).toBe(123456)
  expect(await get($, 'ctx_action')).toBe('warn')
  expect(await get($, 'ctx_cmd')).toBe('say hi')
  rec.files.set(THR, 'abc\n')
  rec.files.set(ACT, 'stop\n')
  expect(await get($, 'ctx_enabled'), 'a threshold the hook cannot read is off').toBe(false)
  expect(await get($, 'ctx_threshold'), 'and the row is the threshold').toBe(300000)
  expect(await get($, 'ctx_action'), 'an action the hook does not know is block').toBe('block')
  // the old plugin's place is no limit of junkd's
  rec.files.delete(THR)
  rec.files.set(`${CFG}/ctx-limit-threshold`, '5000\n')
  expect(await get($, 'ctx_enabled')).toBe(false)
  expect(rec.config).toEqual([])
})

test('the files follow CLAUDE_CONFIG_DIR, under its junkd/ folder, as the shell side does', W, async ($, on) => {
  const rec = world(on, { HOME, CLAUDE_CONFIG_DIR: '/cfg' })
  await start($)
  await set($, 'ctx_enabled', true)
  await set($, 'ctx_action', 'warn')
  await set($, 'ctx_cmd', 'x')
  expect(Object.keys(ctxFiles(rec)).sort()).toEqual(['/cfg/junkd/ctx-limit-action', '/cfg/junkd/ctx-limit-cmd', '/cfg/junkd/ctx-limit-threshold'])
  expect([...rec.files.keys()].some(f => f.startsWith(HOME)), 'nothing under HOME').toBe(false)
})

// ------------------------------------------------------------------ the /config menu

for (const v of TRUE_SPELLINGS) {
  test(`the /config menu's junkd.ctx_enabled ${JSON.stringify(v)} is on: the row true and the threshold file written`, W, async ($, on) => {
    const rec = world(on)
    await start($)
    expect(await menu($, 'ctx_enabled', v)).toEqual({ value: true })
    expect(rec.config).toEqual([{ key: 'junkd.ctx_enabled', value: true }])
    expect(rec.files.get(THR)).toBe('300000\n')
  })
}
for (const v of FALSE_SPELLINGS) {
  test(`the /config menu's junkd.ctx_enabled ${JSON.stringify(v)} is off: the row false and the file removed`, W, async ($, on) => {
    const rec = world(on, { HOME }, {}, { [THR]: '300000\n' })
    await start($)
    expect(await menu($, 'ctx_enabled', v)).toEqual({ value: false })
    expect(rec.config).toEqual([{ key: 'junkd.ctx_enabled', value: false }])
    expect(rec.files.has(THR)).toBe(false)
  })
}
test('the /config menu writes threshold, action and cmd as set does: coerced rows and their files', W, async ($, on) => {
  const rec = world(on, { HOME }, {}, { [THR]: '300000\n' })
  await start($)
  expect(await menu($, 'ctx_threshold', '400k')).toEqual({ value: 400000 })
  expect(rec.files.get(THR)).toBe('400000\n')
  expect(await menu($, 'ctx_action', 'WARN')).toEqual({ value: 'warn' })
  expect(rec.files.get(ACT)).toBe('warn\n')
  expect(await menu($, 'ctx_cmd', ' notify ')).toEqual({ value: 'notify' })
  expect(rec.files.get(CMD)).toBe('notify\n')
  expect(await menu($, 'ctx_cmd', '')).toEqual({ value: '' })
  expect(rec.files.has(CMD)).toBe(false)
  expect(rec.config).toEqual([
    { key: 'junkd.ctx_threshold', value: 400000 },
    { key: 'junkd.ctx_action', value: 'warn' },
    { key: 'junkd.ctx_cmd', value: 'notify' },
    { key: 'junkd.ctx_cmd', value: '' },
  ])
  expect(await get($, 'ctx_threshold')).toBe(400000)
})
test('the /config menu hook of ctx passes a key that is no ctx row', W, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await frame($, 'config', { key: 'junkd.ctx_nope', value: 1 })).toEqual({ value: 1 })
  expect(rec.config).toEqual([{ key: 'junkd.ctx_nope', value: 1 }])
  expect(ctxFiles(rec)).toEqual({})
})

// ------------------------------------------------------------------ refusals put the file back

test('a threshold file that cannot be written is a refusal and no row, by set and by the menu', W, async ($, on) => {
  const rec = world(on, { HOME }, { write: true })
  await start($)
  await expect(set($, 'ctx_enabled', true)).rejects.toThrow(/could not write .*junkd\/ctx-limit-threshold/)
  expect((await menu($, 'ctx_enabled', true)).deny).toMatch(/could not write .*junkd\/ctx-limit-threshold/)
  expect(rec.config).toEqual([])
  expect(await get($, 'ctx_enabled')).toBe(false)
})
test('an rm of the threshold file that exits non-zero is a refusal and no row: the guard stays on', W, async ($, on) => {
  const rec = world(on, { HOME }, { rm: 1 }, { [THR]: '300000\n' })
  await start($)
  await expect(set($, 'ctx_enabled', false)).rejects.toThrow(/could not remove .*ctx-limit-threshold: rm: Permission denied/)
  expect((await menu($, 'ctx_enabled', false)).deny).toMatch(/could not remove/)
  expect(rec.config).toEqual([])
  expect(rec.files.get(THR)).toBe('300000\n')
  expect(await get($, 'ctx_enabled')).toBe(true)
})
test('a denied ctx write puts each file back as it was, by set and by the menu', W, async ($, on) => {
  on('config.set', { key: /^junkd\.ctx_/ }, () => ({ deny: 'locked' }))
  const rec = world(on, { HOME }, {}, { [THR]: '400000\n', [ACT]: 'warn\n' })
  await start($)
  await expect(set($, 'ctx_enabled', false)).rejects.toThrow(/locked/)
  expect(rec.files.get(THR), 'the removed threshold is back').toBe('400000\n')
  expect((await menu($, 'ctx_threshold', 500000)).deny).toBe('locked')
  expect(rec.files.get(THR), 'the threshold as it was').toBe('400000\n')
  await expect(set($, 'ctx_action', 'cmd')).rejects.toThrow(/locked/)
  expect(rec.files.get(ACT)).toBe('warn\n')
  expect((await menu($, 'ctx_cmd', 'x')).deny).toBe('locked')
  expect(rec.files.has(CMD), 'a file that was not there is not there').toBe(false)
  rec.files.delete(THR)
  await expect(set($, 'ctx_enabled', true)).rejects.toThrow(/locked/)
  expect(rec.files.has(THR), 'a threshold written first is taken back').toBe(false)
  expect(rec.config).toEqual([])
})

// ------------------------------------------------------------------ /junkd:ctx-limit

test('/junkd:ctx-limit 250k sets the row and the file and turns the guard on; status toasts; off removes the file', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await ctxLimit($, '250k')
  expect(rec.config).toEqual([{ key: 'junkd.ctx_threshold', value: 250000 }, { key: 'junkd.ctx_enabled', value: true }])
  expect(rec.files.get(THR)).toBe('250000\n')
  expect(rec.toasts.at(-1)).toBe('✓ ctx-limit: ON @ 250000 tokens, action: block')
  await ctxLimit($, 'status')
  expect(rec.toasts.at(-1)).toBe('ctx-limit: ON @ 250000 tokens, action: block')
  await ctxLimit($, '')
  expect(rec.toasts.at(-1), 'no argument is status').toBe('ctx-limit: ON @ 250000 tokens, action: block')
  await ctxLimit($, 'off')
  expect(rec.files.has(THR)).toBe(false)
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.ctx_enabled', value: false })
  expect(rec.toasts.at(-1)).toBe('✓ ctx-limit: OFF, action: block')
  await ctxLimit($, 'on')
  expect(rec.files.get(THR), 'on writes the last threshold').toBe('250000\n')
  await ctxLimit($, 'reset')
  expect(rec.files.has(THR)).toBe(false)
})
test('/junkd:ctx-limit action and cmd: through the rows; cmd also switches the action to cmd; status names the command', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await ctxLimit($, 'action warn')
  expect(rec.files.get(ACT)).toBe('warn\n')
  await ctxLimit($, 'cmd terminal-notifier -message "ctx limit hit"')
  expect(rec.files.get(CMD)).toBe('terminal-notifier -message "ctx limit hit"\n')
  expect(rec.files.get(ACT)).toBe('cmd\n')
  expect(rec.config.slice(-2)).toEqual([
    { key: 'junkd.ctx_cmd', value: 'terminal-notifier -message "ctx limit hit"' },
    { key: 'junkd.ctx_action', value: 'cmd' },
  ])
  await ctxLimit($, 'status')
  expect(rec.toasts.at(-1)).toBe('ctx-limit: OFF, action: cmd, cmd: terminal-notifier -message "ctx limit hit"')
})
for (const [args, why] of [['500', /500 is not a valid ctx_threshold/], ['action stop', /stop is not a valid ctx_action/], ['cmd', /usage: \/junkd:ctx-limit cmd/], ['bogus', /usage: \/junkd:ctx-limit \[/], ['250k extra', /usage/]] as const) {
  test(`/junkd:ctx-limit ${args}: a ✗ toast with the reason, nothing written`, W, async ($, on) => {
    const rec = world(on)
    await start($)
    await ctxLimit($, args)
    expect(rec.toasts.at(-1)).toMatch(/^✗ /)
    expect(rec.toasts.at(-1)).toMatch(why)
    expect(rec.config).toEqual([])
    expect(ctxFiles(rec)).toEqual({})
  })
}

// ------------------------------------------------------------------ session start: the old plugin's files

test('session start moves the old ~/.claude/ctx-limit-* files into junkd/ where junkd/ has none', W, async ($, on) => {
  const rec = world(on, { HOME }, {}, { [`${CFG}/ctx-limit-threshold`]: '200000\n', [`${CFG}/ctx-limit-action`]: 'warn\n', [`${CFG}/ctx-limit-cmd`]: 'say hi\n' })
  await start($)
  expect(ctxFiles(rec)).toEqual({ [THR]: '200000\n', [ACT]: 'warn\n', [CMD]: 'say hi\n' })
  expect(await get($, 'ctx_enabled')).toBe(true)
  expect(await get($, 'ctx_threshold')).toBe(200000)
  expect(rec.config, 'no row is written').toEqual([])
})
test('session start leaves junkd/ files that are there, and the old ones beside them', W, async ($, on) => {
  const rec = world(on, { HOME }, {}, { [`${CFG}/ctx-limit-threshold`]: '200000\n', [THR]: '500000\n' })
  await start($)
  expect(ctxFiles(rec)).toEqual({ [`${CFG}/ctx-limit-threshold`]: '200000\n', [THR]: '500000\n' })
})
test('session start follows CLAUDE_CONFIG_DIR for the old files too', W, async ($, on) => {
  const rec = world(on, { HOME, CLAUDE_CONFIG_DIR: '/cfg' }, {}, { '/cfg/ctx-limit-action': 'cmd\n', [`${CFG}/ctx-limit-threshold`]: '1\n' })
  await start($)
  expect(ctxFiles(rec)).toEqual({ '/cfg/junkd/ctx-limit-action': 'cmd\n', [`${CFG}/ctx-limit-threshold`]: '1\n' })
})
test('a move that cannot be written keeps the old file and fails neither the start nor the module', W, async ($, on) => {
  const rec = world(on, { HOME }, { write: true }, { [`${CFG}/ctx-limit-threshold`]: '200000\n' })
  await start($)
  expect(ctxFiles(rec)).toEqual({ [`${CFG}/ctx-limit-threshold`]: '200000\n' })
  expect(await get($, 'ctx_threshold')).toBe(300000)
})
