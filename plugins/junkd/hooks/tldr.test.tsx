// junkd's tldr group: `$.junkd` (schema, get, set) on the tldr_* rows, the /config menu's writes to them, and the two
// flag files bin/tldr-hook reads (tldr-on: terse, tldr-off: enabled off). The whole module loads, so the world also
// answers what every feature's session start touches. Everything beneath the plugin is answered from memory by
// `world`; nothing touches a real home.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/u'
// What bin/tldr-flag writes and bin/tldr-hook reads with no CLAUDE_CONFIG_DIR.
const FLAG = `${HOME}/.claude/junkd/tldr-on`
// What the module writes while tldr_enabled is off, and bin/tldr-hook reads where settings.json names no value.
const OFF = `${HOME}/.claude/junkd/tldr-off`
const MANIFEST_KEYS = ['tldr_enabled', 'tldr_terse', 'tldr_sentences'] as const
// Every spelling the boolean rows take, and what each is read as.
const TRUE_SPELLINGS = [true, 'true', 'on'] as const
const FALSE_SPELLINGS = [false, 'false', 'off', 'maybe', 1, 0] as const

// `fail.write`: no fs.write answers, so the bottom hook throws as a failed write does; `fail.rm`: rm's exit code.
// `files`: what is on "disk" at the start.
function world(on: On, env: Record<string, string> = { HOME }, fail: { write?: boolean; rm?: number } = {}, files: string[] = []) {
  mock.store(on)
  mock.env(on, env)
  const rec = {
    files: new Set<string>(files), // the files on "disk": the flag files the module writes
    config: [] as { key: string; value: unknown }[],
    runs: [] as string[][],
    writes: [] as string[],
  }
  // What the other features' session starts touch (panel, handoff, core, orch), so none of them rejects.
  on('ui.panes', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', (_$, e) => ({ value: { kind: rec.files.has(e.path) ? 'file' : 'other', size: 0, mtimeMs: 0 } as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  if (!fail.write) on('fs.write', (_$, e) => { rec.writes.push(e.path); rec.files.add(e.path); return { value: undefined } })
  on('fs.exists', (_$, e) => ({ value: rec.files.has(e.path) }))
  on('process.run', (_$, e) => {
    rec.runs.push([...e.argv])
    const exitCode = e.argv[0] === 'rm' ? (fail.rm ?? 0) : 0
    if (e.argv[0] === 'rm' && exitCode === 0) rec.files.delete(e.argv.at(-1)!)
    const stderr = exitCode === 0 ? '' : 'rm: Permission denied'
    return { value: { exitCode, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return rec
}
// The tldr flag files on "disk" (the other features keep theirs beside them).
const tldrFiles = (rec: { files: Set<string> }) => [...rec.files].filter(f => /\/junkd\/tldr-/.test(f))

const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

// A caller plugin beside junkd: `/frame <method> [json]` calls `$.junkd.<method>` (or `$.config.set` for `config`,
// the /config menu's own path) and answers what came back (an inline plugin closes over nothing, so the command
// carries the result out as text).
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
          if (Array.isArray(await $.junkd.schema())) answered.push('schema')
          if (typeof (await $.junkd.get({ key: 'tldr_sentences' })) === 'number') answered.push('get')
          if (typeof (await $.junkd.set({ key: 'tldr_sentences', value: await $.junkd.get({ key: 'tldr_sentences' }) })) === 'number') answered.push('set')
          return { text: JSON.stringify({ ok: answered }) }
        }
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
// The host's rule for a plugin's own write: `$.config.set` goes through the other plugins' hooks, the caller's own
// skipped. The kit runs junkd's own config.set hooks on junkd's write, so this managed plugin above every tier sends
// junkd's writes on past the user tier (junkd's hooks and the frame's) to the world beneath, as the host does.
const HOST: Plugin = {
  name: 'host',
  tier: 'prepend',
  register(on) {
    on('config.set', (_$, e, next) => (next.origin.plugin === 'junkd' ? next.to(e, 'append') : next(e)))
  },
}
const WITH_FRAME = { plugins: [HOST, FRAME] }
// `frame <method> [input]` through the engine; resolves to the method's answer, rejects with its refusal.
async function frame($: Engine, method: string, input?: unknown): Promise<unknown> {
  const args = input === undefined ? method : `${method} ${JSON.stringify(input)}`
  const r = (await $.command.run({ command: 'frame', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })) as { text?: string }
  const out = JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}

test('$.junkd: the three calls exist; the tldr rows mirror the manifest, all main; get answers the defaults', WITH_FRAME, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'members')).toEqual(['schema', 'get', 'set'])

  const all = (await frame($, 'schema')) as { key: string; group: string; field: string; type: string; title: string; default: unknown; main: boolean }[]
  const schema = all.filter(f => f.group === 'tldr')
  expect(schema.map(f => f.key)).toEqual([...MANIFEST_KEYS])
  expect(schema.map(f => f.field)).toEqual(['enabled', 'terse', 'sentences'])
  expect(all.filter(f => f.key.startsWith('tldr_')).length, 'no tldr_ row outside the group').toBe(3)
  for (const f of schema) {
    expect(typeof f.default, f.key).toBe(f.type)
    expect(f.title, f.key).toMatch(/\S/)
    expect(f.main, f.key).toBe(true)
    expect(await frame($, 'get', { key: f.key }), `get(${f.key}) is the manifest default`).toBe(f.default)
  }
})

test('the sentences option the engine fills in from the manifest is what get answers at load', { ...WITH_FRAME, options: { tldr_sentences: 5 } }, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'get', { key: 'tldr_sentences' })).toBe(5)
})

test('set terse writes the junkd.tldr_terse row and the flag file; get reads the file; off removes it', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(false)

  expect(await frame($, 'set', { key: 'tldr_terse', value: true })).toBe(true)
  expect(rec.config).toEqual([{ key: 'junkd.tldr_terse', value: true }])
  expect(rec.files.has(FLAG), 'the flag file bin/tldr-hook reads is there').toBe(true)
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(true)

  expect(await frame($, 'set', { key: 'tldr_terse', value: 'off', scope: 'user' })).toBe(false)
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.tldr_terse', value: false })
  expect(rec.runs.at(-1)).toEqual(['rm', '-f', '--', FLAG])
  expect(rec.files.has(FLAG)).toBe(false)
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(false)

  expect(await frame($, 'set', { key: 'tldr_terse', value: 'on' })).toBe(true) // the shell spelling is a true
  expect(rec.files.has(FLAG)).toBe(true)

  // the string spellings: 'true' is a true, 'false', 'maybe' and 1 are a false
  expect(await frame($, 'set', { key: 'tldr_terse', value: 'false' })).toBe(false)
  expect(rec.files.has(FLAG)).toBe(false)
  expect(await frame($, 'set', { key: 'tldr_terse', value: 'true' })).toBe(true)
  expect(rec.files.has(FLAG)).toBe(true)
  expect(await frame($, 'set', { key: 'tldr_terse', value: 'maybe' })).toBe(false)
  expect(await frame($, 'set', { key: 'tldr_terse', value: 1 })).toBe(false)
  expect(rec.files.has(FLAG)).toBe(false)
  expect(rec.config.map(c => c.value)).toEqual([true, false, true, false, true, false, false])
  expect(rec.files.has(OFF), 'terse never touches the enabled flag').toBe(false)
})

for (const sentences of [0, 2.5]) {
  test(`a sentences option of ${sentences} the engine hands at load falls back to 3`, { ...WITH_FRAME, options: { tldr_sentences: sentences } }, async ($, on) => {
    world(on)
    await start($)
    expect(await frame($, 'get', { key: 'tldr_sentences' })).toBe(3)
  })
}

test('the flag files follow CLAUDE_CONFIG_DIR, under its junkd/ folder, as the shell side does', WITH_FRAME, async ($, on) => {
  const rec = world(on, { HOME, CLAUDE_CONFIG_DIR: '/cfg' })
  await start($)
  await frame($, 'set', { key: 'tldr_terse', value: true })
  expect(tldrFiles(rec)).toEqual(['/cfg/junkd/tldr-on'])
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(true)
  await frame($, 'set', { key: 'tldr_enabled', value: false })
  expect(tldrFiles(rec).sort()).toEqual(['/cfg/junkd/tldr-off', '/cfg/junkd/tldr-on'])
  expect([...rec.files].some(f => f.startsWith(HOME)), 'nothing under HOME').toBe(false)
})

test('/junkd:tldr on|off (the shell side) and $.junkd agree: the flag file is the truth, not the row', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  rec.files.add(FLAG) // what `/junkd:tldr on` does: bin/tldr-flag creates the file, no $.config row is written
  expect(rec.config).toEqual([])
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(true)
  rec.files.delete(FLAG) // `/junkd:tldr off`
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(false)
  // the flag's old place (before junkd) is no terse mode
  rec.files.add(`${HOME}/.claude/tldr-on`)
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(false)

  // the row and the file disagree after a shell flip: the file wins, until the next set puts both back in step
  await frame($, 'set', { key: 'tldr_terse', value: true })
  rec.files.delete(FLAG) // `/junkd:tldr off` again
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.tldr_terse', value: true })
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(false)
  await frame($, 'set', { key: 'tldr_terse', value: false })
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(false)
})

test('a write to the junkd.tldr_terse row by the /config menu, not $.junkd.set, writes the flag file too', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'config', { key: 'junkd.tldr_terse', value: true })
  expect(rec.files.has(FLAG)).toBe(true)
  await frame($, 'config', { key: 'junkd.tldr_terse', value: false })
  expect(rec.files.has(FLAG)).toBe(false)
  await frame($, 'config', { key: 'junkd.tldr_sentences', value: 7 })
  expect(await frame($, 'get', { key: 'tldr_sentences' })).toBe(7)

  // the menu's write of a value set would refuse is refused the same way: the row stays, get stays
  const rows = rec.config.length
  for (const value of [0, 2.5, 'abc']) {
    const r = (await frame($, 'config', { key: 'junkd.tldr_sentences', value })) as { deny?: string }
    expect(r.deny, String(value)).toMatch(/not a valid sentences/)
  }
  expect(rec.config.length).toBe(rows)
  expect(await frame($, 'get', { key: 'tldr_sentences' })).toBe(7)
})

test('set sentences: a whole number of 1 or more; a bad value, scope, key or a denied row is refused', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'junkd.tldr_sentences', value: 9 }, () => ({ deny: 'locked' })) // one write a hook refuses
  const rec = world(on)
  await start($)
  const flagsAtStart = tldrFiles(rec)
  // exact bounds: 1 is in; 0, -5 and 2.5 are out; a numeric string is a number
  expect(await frame($, 'set', { key: 'tldr_sentences', value: 1 })).toBe(1)
  expect(await frame($, 'set', { key: 'tldr_sentences', value: '4' })).toBe(4)
  expect(rec.config).toEqual([{ key: 'junkd.tldr_sentences', value: 1 }, { key: 'junkd.tldr_sentences', value: 4 }])
  expect(await frame($, 'get', { key: 'tldr_sentences' })).toBe(4)

  const writes = rec.config.length
  for (const value of [0, -5, 2.5, 'abc', '']) {
    await expect(frame($, 'set', { key: 'tldr_sentences', value }), String(value)).rejects.toThrow(/not a valid sentences/)
  }
  await expect(frame($, 'set', { key: 'tldr_sentences', value: 2, scope: 'project' })).rejects.toThrow(/scope project/)
  await expect(frame($, 'set', { key: 'tldr_nope', value: 1 })).rejects.toThrow(/no setting tldr_nope/)
  await expect(frame($, 'set', { key: 'sentences', value: 1 }), 'the old bare key is no row').rejects.toThrow(/no setting sentences/)
  await expect(frame($, 'get', { key: 'tldr_nope' })).rejects.toThrow(/no setting tldr_nope/)
  expect(rec.config.length).toBe(writes) // none of the refusals reached $.config
  expect(tldrFiles(rec)).toEqual(flagsAtStart) // and none touched a flag file
  expect(await frame($, 'get', { key: 'tldr_sentences' })).toBe(4)

  // a config.set hook's deny comes back as the refusal and the value stays
  await expect(frame($, 'set', { key: 'tldr_sentences', value: 9 })).rejects.toThrow(/locked/)
  expect(await frame($, 'get', { key: 'tldr_sentences' })).toBe(4)
})

test('a denied junkd.tldr_terse write leaves the flag file as it was, by set and by the menu', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'junkd.tldr_terse' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await expect(frame($, 'set', { key: 'tldr_terse', value: true })).rejects.toThrow(/locked/)
  expect(rec.files.has(FLAG)).toBe(false)
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(false)
  expect(((await frame($, 'config', { key: 'junkd.tldr_terse', value: true })) as { deny?: string }).deny).toBe('locked')
  expect(rec.files.has(FLAG), 'menu: the flag written first is taken back').toBe(false)

  rec.files.add(FLAG) // on, then a refused off: the flag removed first is put back
  await expect(frame($, 'set', { key: 'tldr_terse', value: false })).rejects.toThrow(/locked/)
  expect(rec.files.has(FLAG)).toBe(true)
  expect(((await frame($, 'config', { key: 'junkd.tldr_terse', value: false })) as { deny?: string }).deny).toBe('locked')
  expect(rec.files.has(FLAG), 'menu: the flag removed first is put back').toBe(true)
  expect(rec.config).toEqual([])
})

test('a flag file that cannot be written is a refusal and no row: set rejects, the menu is denied', WITH_FRAME, async ($, on) => {
  const rec = world(on, { HOME }, { write: true })
  await start($)
  await expect(frame($, 'set', { key: 'tldr_terse', value: true })).rejects.toThrow(/could not write .*junkd\/tldr-on/)
  expect(((await frame($, 'config', { key: 'junkd.tldr_terse', value: true })) as { deny?: string }).deny).toMatch(/could not write .*junkd\/tldr-on/)
  expect(rec.config, 'no row was written').toEqual([])
  expect(rec.files.has(FLAG)).toBe(false)
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(false)
})

test('an rm that exits non-zero is a refusal and no row: the flag stays, by set and by the menu', WITH_FRAME, async ($, on) => {
  const rec = world(on, { HOME }, { rm: 1 })
  await start($)
  rec.files.add(FLAG)
  await expect(frame($, 'set', { key: 'tldr_terse', value: false })).rejects.toThrow(/could not remove .*junkd\/tldr-on: rm: Permission denied/)
  expect(((await frame($, 'config', { key: 'junkd.tldr_terse', value: false })) as { deny?: string }).deny).toMatch(/could not remove .*junkd\/tldr-on/)
  expect(rec.config, 'no row was written').toEqual([])
  expect(rec.files.has(FLAG)).toBe(true)
  expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(true)
})

// One case per spelling the menu may hand: each is read as `set` reads it, the row stores the boolean.
for (const value of TRUE_SPELLINGS) {
  test(`the /config menu's ${JSON.stringify(value)} for terse writes the flag and stores true`, WITH_FRAME, async ($, on) => {
    const rec = world(on)
    await start($)
    await frame($, 'config', { key: 'junkd.tldr_terse', value })
    expect(rec.files.has(FLAG)).toBe(true)
    expect(rec.config).toEqual([{ key: 'junkd.tldr_terse', value: true }])
    expect(await frame($, 'get', { key: 'tldr_terse' })).toBe(true)
  })
}

test('on the host junkd never sees its own config.set: set terse writes and removes the flag, set sentences is what get answers', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await frame($, 'set', { key: 'tldr_terse', value: true })).toBe(true)
  expect(rec.config).toEqual([{ key: 'junkd.tldr_terse', value: true }])
  expect(rec.files.has(FLAG), 'set terse true writes the flag').toBe(true)
  expect(await frame($, 'set', { key: 'tldr_terse', value: false })).toBe(false)
  expect(rec.files.has(FLAG), 'set terse false removes it').toBe(false)
  expect(await frame($, 'set', { key: 'tldr_sentences', value: 5 })).toBe(5)
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.tldr_sentences', value: 5 })
  expect(await frame($, 'get', { key: 'tldr_sentences' })).toBe(5)
  expect(await frame($, 'set', { key: 'tldr_enabled', value: false })).toBe(false)
  expect(rec.files.has(OFF), 'set enabled false writes tldr-off').toBe(true)
  expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(false)
})

// `/junkd:tldr <args>` as the person types it; the world beneath answers what args the command itself received.
async function tldr($: Engine, args: string): Promise<string | undefined> {
  const r = (await $.command.run({ command: 'junkd:tldr', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })) as { text?: string }
  return r.text
}

test('/junkd:tldr with no argument reaches the command with the sentences setting; a number, on, off, status pass as typed', WITH_FRAME, async ($, on) => {
  world(on)
  on('command.run', { command: 'junkd:tldr' }, (_$, e) => ({ text: `args=${JSON.stringify(e.args)}` }))
  await start($)
  expect(await tldr($, '')).toBe('args="3"') // the default
  await frame($, 'set', { key: 'tldr_sentences', value: 5 })
  expect(await tldr($, '')).toBe('args="5"')
  expect(await tldr($, '   '), 'whitespace only is no argument').toBe('args="5"')
  for (const args of ['2', 'on', 'off', 'status']) expect(await tldr($, args), args).toBe(`args=${JSON.stringify(args)}`)
  await frame($, 'config', { key: 'junkd.tldr_sentences', value: 7 }) // the menu's write too
  expect(await tldr($, '')).toBe('args="7"')
})

// ---------------------------------------------------------------- tldr_enabled and its flag, tldr-off

// $.junkd.set, one case per spelling: from the other state, so the flag must move both ways.
for (const value of TRUE_SPELLINGS) {
  test(`set tldr_enabled ${JSON.stringify(value)}: stores true, removes tldr-off, get answers true`, { ...WITH_FRAME, options: { tldr_enabled: false } }, async ($, on) => {
    const rec = world(on)
    await start($)
    expect(rec.files.has(OFF), 'off at load: the start wrote tldr-off').toBe(true)
    expect(await frame($, 'set', { key: 'tldr_enabled', value })).toBe(true)
    expect(rec.config).toEqual([{ key: 'junkd.tldr_enabled', value: true }])
    expect(rec.runs.at(-1)).toEqual(['rm', '-f', '--', OFF])
    expect(rec.files.has(OFF)).toBe(false)
    expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(true)
  })
}
for (const value of FALSE_SPELLINGS) {
  test(`set tldr_enabled ${JSON.stringify(value)}: stores false, writes tldr-off, get answers false`, WITH_FRAME, async ($, on) => {
    const rec = world(on)
    await start($)
    expect(rec.files.has(OFF)).toBe(false)
    expect(await frame($, 'set', { key: 'tldr_enabled', value })).toBe(false)
    expect(rec.config).toEqual([{ key: 'junkd.tldr_enabled', value: false }])
    expect(rec.files.has(OFF)).toBe(true)
    expect(rec.files.has(FLAG), 'enabled never touches the terse flag').toBe(false)
    expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(false)
  })
}

// The /config menu's write (through the host-mimicking frame), one case per spelling.
for (const value of TRUE_SPELLINGS) {
  test(`the /config menu's ${JSON.stringify(value)} for tldr_enabled removes tldr-off and stores true`, { ...WITH_FRAME, options: { tldr_enabled: false } }, async ($, on) => {
    const rec = world(on)
    await start($)
    expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(false)
    expect(((await frame($, 'config', { key: 'junkd.tldr_enabled', value })) as { deny?: string }).deny).toBeUndefined()
    expect(rec.config).toEqual([{ key: 'junkd.tldr_enabled', value: true }])
    expect(rec.files.has(OFF)).toBe(false)
    expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(true)
  })
}
for (const value of FALSE_SPELLINGS) {
  test(`the /config menu's ${JSON.stringify(value)} for tldr_enabled writes tldr-off and stores false`, WITH_FRAME, async ($, on) => {
    const rec = world(on)
    await start($)
    expect(((await frame($, 'config', { key: 'junkd.tldr_enabled', value })) as { deny?: string }).deny).toBeUndefined()
    expect(rec.config).toEqual([{ key: 'junkd.tldr_enabled', value: false }])
    expect(rec.files.has(OFF)).toBe(true)
    expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(false)
  })
}

// The option at load, mirrored at session start. The engine checks options against the manifest before the module
// loads and refuses any type but a boolean ("TL;DR: enabled must be a boolean"), so true and false are the spellings.
for (const value of [true]) {
  test(`a tldr_enabled option of ${JSON.stringify(value)} at load is on: the start removes a stale tldr-off`, { ...WITH_FRAME, options: { tldr_enabled: value } }, async ($, on) => {
    const rec = world(on, { HOME }, {}, [OFF])
    await start($)
    expect(rec.runs).toContainEqual(['rm', '-f', '--', OFF])
    expect(rec.files.has(OFF)).toBe(false)
    expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(true)
    expect(rec.config, 'the start writes no row').toEqual([])
  })
}
for (const value of [false]) {
  test(`a tldr_enabled option of ${JSON.stringify(value)} at load is off: the start writes tldr-off`, { ...WITH_FRAME, options: { tldr_enabled: value } }, async ($, on) => {
    const rec = world(on)
    await start($)
    expect(rec.writes).toContain(OFF)
    expect(rec.files.has(OFF)).toBe(true)
    expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(false)
    expect(rec.config, 'the start writes no row').toEqual([])
  })
}
test('no tldr_enabled option at load is the default, on: the start removes a stale tldr-off', WITH_FRAME, async ($, on) => {
  const rec = world(on, { HOME }, {}, [OFF])
  await start($)
  expect(rec.files.has(OFF)).toBe(false)
  expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(true)
})
test('the start mirrors the last write, not the option at load', { ...WITH_FRAME, options: { tldr_enabled: true } }, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'set', { key: 'tldr_enabled', value: false })
  rec.files.delete(OFF) // lost between sessions
  await start($)
  expect(rec.files.has(OFF), 'the next start puts it back').toBe(true)
})

test('a tldr-off that cannot be written or removed at session start fails neither the start nor the other features', { ...WITH_FRAME, options: { tldr_enabled: false } }, async ($, on) => {
  const rec = world(on, { HOME }, { write: true })
  await start($) // resolves: the failure is not raised
  expect(rec.files.has(OFF)).toBe(false)
  expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(false)
  expect(await frame($, 'get', { key: 'tldr_sentences' }), 'the rest of the module runs').toBe(3)
})
test('an rm of tldr-off that exits non-zero at session start does not fail the start', WITH_FRAME, async ($, on) => {
  const rec = world(on, { HOME }, { rm: 1 }, [OFF])
  await start($)
  expect(rec.files.has(OFF)).toBe(true)
  expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(true)
})

test('a tldr-off that cannot be written is a refusal and no row: set rejects, the menu is denied, enabled stays on', WITH_FRAME, async ($, on) => {
  const rec = world(on, { HOME }, { write: true })
  await start($)
  await expect(frame($, 'set', { key: 'tldr_enabled', value: false })).rejects.toThrow(/could not write .*junkd\/tldr-off/)
  expect(((await frame($, 'config', { key: 'junkd.tldr_enabled', value: false })) as { deny?: string }).deny).toMatch(/could not write .*junkd\/tldr-off/)
  expect(rec.config, 'no row was written').toEqual([])
  expect(rec.files.has(OFF)).toBe(false)
  expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(true)
})

test('an rm of tldr-off that exits non-zero is a refusal and no row: the flag stays, enabled stays off', { ...WITH_FRAME, options: { tldr_enabled: false } }, async ($, on) => {
  const rec = world(on, { HOME }, { rm: 1 })
  await start($)
  expect(rec.files.has(OFF)).toBe(true)
  await expect(frame($, 'set', { key: 'tldr_enabled', value: true })).rejects.toThrow(/could not remove .*junkd\/tldr-off: rm: Permission denied/)
  expect(((await frame($, 'config', { key: 'junkd.tldr_enabled', value: true })) as { deny?: string }).deny).toMatch(/could not remove .*junkd\/tldr-off/)
  expect(rec.config, 'no row was written').toEqual([])
  expect(rec.files.has(OFF)).toBe(true)
  expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(false)
})

test('a denied junkd.tldr_enabled write puts tldr-off back as it was and keeps the value, by set and by the menu', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'junkd.tldr_enabled' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await expect(frame($, 'set', { key: 'tldr_enabled', value: false })).rejects.toThrow(/locked/)
  expect(rec.files.has(OFF), 'set: the flag written first is taken back').toBe(false)
  expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(true)
  expect(((await frame($, 'config', { key: 'junkd.tldr_enabled', value: false })) as { deny?: string }).deny).toBe('locked')
  expect(rec.files.has(OFF), 'menu: the flag written first is taken back').toBe(false)
  expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(true)
  expect(rec.config).toEqual([])
})
test('a denied junkd.tldr_enabled write while off puts the removed tldr-off back, by set and by the menu', { ...WITH_FRAME, options: { tldr_enabled: false } }, async ($, on) => {
  on('config.set', { key: 'junkd.tldr_enabled' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await expect(frame($, 'set', { key: 'tldr_enabled', value: true })).rejects.toThrow(/locked/)
  expect(rec.files.has(OFF)).toBe(true)
  expect(((await frame($, 'config', { key: 'junkd.tldr_enabled', value: true })) as { deny?: string }).deny).toBe('locked')
  expect(rec.files.has(OFF)).toBe(true)
  expect(await frame($, 'get', { key: 'tldr_enabled' })).toBe(false)
})
