// The tldr mod: `$.tldr` (schema, get, set) and the flag file it keeps in step with the `tldr.terse` row.
// Everything beneath the plugin is answered from memory by `world`; nothing touches a real home.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/u'
const FLAG = `${HOME}/.claude/tldr-on` // what bin/tldr-flag writes and bin/tldr-hook reads with no CLAUDE_CONFIG_DIR
const MANIFEST_KEYS = ['terse', 'sentences'] as const

function world(on: On, env: Record<string, string> = { HOME }) {
  mock.store(on)
  mock.env(on, env)
  const rec = {
    files: new Set<string>(), // the files on "disk": the flag file is the only one the mod touches
    config: [] as { key: string; value: unknown }[],
    runs: [] as string[][],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('fs.write', (_$, e) => { rec.files.add(e.path); return { value: undefined } })
  on('fs.exists', (_$, e) => ({ value: rec.files.has(e.path) }))
  on('process.run', (_$, e) => {
    rec.runs.push(e.argv)
    if (e.argv[0] === 'rm') rec.files.delete(e.argv.at(-1)!)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return rec
}

const start = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

// A frame plugin beside tldr, as T5 will be: `/frame <method> [json]` calls `$.tldr.<method>` (or `$.config.set`
// for `config`, the /config menu's own path) and answers what came back (an inline plugin closes over nothing,
// so the command carries the result out as text).
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
          if (Array.isArray(await $.tldr.schema())) answered.push('schema')
          if (typeof (await $.tldr.get({ key: 'sentences' })) === 'number') answered.push('get')
          if (typeof (await $.tldr.set({ key: 'sentences', value: await $.tldr.get({ key: 'sentences' }) })) === 'number') answered.push('set')
          return { text: JSON.stringify({ ok: answered }) }
        }
        if (method === 'schema') return { text: JSON.stringify({ ok: await $.tldr.schema() }) }
        if (method === 'get') return { text: JSON.stringify({ ok: await $.tldr.get(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.tldr.set(input) }) }
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

test('$.tldr: the three calls exist; schema mirrors the manifest, both fields main; get answers the defaults', WITH_FRAME, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'members')).toEqual(['schema', 'get', 'set'])

  const schema = (await frame($, 'schema')) as { key: string; type: string; title: string; default: unknown; main: boolean }[]
  expect(schema.map(f => f.key)).toEqual([...MANIFEST_KEYS])
  for (const f of schema) {
    expect(typeof f.default, f.key).toBe(f.type)
    expect(f.title, f.key).toMatch(/\S/)
    expect(f.main, f.key).toBe(true)
    expect(await frame($, 'get', { key: f.key }), `get(${f.key}) is the manifest default`).toBe(f.default)
  }
})

test('the sentences option the engine fills in from the manifest is what get answers at load', { ...WITH_FRAME, options: { sentences: 5 } }, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'get', { key: 'sentences' })).toBe(5)
})

test('set terse writes the tldr.terse row and the flag file; get reads the file; off removes it', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await frame($, 'get', { key: 'terse' })).toBe(false)

  expect(await frame($, 'set', { key: 'terse', value: true })).toBe(true)
  expect(rec.config).toEqual([{ key: 'tldr.terse', value: true }])
  expect(rec.files.has(FLAG), 'the flag file bin/tldr-hook reads is there').toBe(true)
  expect(await frame($, 'get', { key: 'terse' })).toBe(true)

  expect(await frame($, 'set', { key: 'terse', value: 'off', scope: 'user' })).toBe(false)
  expect(rec.config.at(-1)).toEqual({ key: 'tldr.terse', value: false })
  expect(rec.runs.at(-1)).toEqual(['rm', '-f', '--', FLAG])
  expect(rec.files.has(FLAG)).toBe(false)
  expect(await frame($, 'get', { key: 'terse' })).toBe(false)

  expect(await frame($, 'set', { key: 'terse', value: 'on' })).toBe(true) // the shell spelling is a true
  expect(rec.files.has(FLAG)).toBe(true)

  // the string spellings: 'true' is a true, 'false', 'maybe' and 1 are a false
  expect(await frame($, 'set', { key: 'terse', value: 'false' })).toBe(false)
  expect(rec.files.has(FLAG)).toBe(false)
  expect(await frame($, 'set', { key: 'terse', value: 'true' })).toBe(true)
  expect(rec.files.has(FLAG)).toBe(true)
  expect(await frame($, 'set', { key: 'terse', value: 'maybe' })).toBe(false)
  expect(await frame($, 'set', { key: 'terse', value: 1 })).toBe(false)
  expect(rec.files.has(FLAG)).toBe(false)
  expect(rec.config.map(c => c.value)).toEqual([true, false, true, false, true, false, false])
})

for (const sentences of [0, 2.5]) {
  test(`a sentences option of ${sentences} the engine hands at load falls back to 3`, { ...WITH_FRAME, options: { sentences } }, async ($, on) => {
    world(on)
    await start($)
    expect(await frame($, 'get', { key: 'sentences' })).toBe(3)
  })
}

test('the flag file follows CLAUDE_CONFIG_DIR, as the shell side does', WITH_FRAME, async ($, on) => {
  const rec = world(on, { HOME, CLAUDE_CONFIG_DIR: '/cfg' })
  await start($)
  await frame($, 'set', { key: 'terse', value: true })
  expect([...rec.files]).toEqual(['/cfg/tldr-on'])
  expect(await frame($, 'get', { key: 'terse' })).toBe(true)
})

test('/tldr on|off (the shell side) and $.tldr agree: the flag file is the truth, not the row', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  rec.files.add(FLAG) // what `/tldr on` does: bin/tldr-flag creates the file, no $.config row is written
  expect(rec.config).toEqual([])
  expect(await frame($, 'get', { key: 'terse' })).toBe(true)
  rec.files.delete(FLAG) // `/tldr off`
  expect(await frame($, 'get', { key: 'terse' })).toBe(false)

  // the row and the file disagree after a shell flip: the file wins, until the next set puts both back in step
  await frame($, 'set', { key: 'terse', value: true })
  rec.files.delete(FLAG) // `/tldr off` again
  expect(rec.config.at(-1)).toEqual({ key: 'tldr.terse', value: true })
  expect(await frame($, 'get', { key: 'terse' })).toBe(false)
  await frame($, 'set', { key: 'terse', value: false })
  expect(await frame($, 'get', { key: 'terse' })).toBe(false)
})

test('a write to the tldr.terse row by the /config menu, not $.tldr.set, writes the flag file too', WITH_FRAME, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'config', { key: 'tldr.terse', value: true })
  expect(rec.files.has(FLAG)).toBe(true)
  await frame($, 'config', { key: 'tldr.terse', value: false })
  expect(rec.files.has(FLAG)).toBe(false)
  await frame($, 'config', { key: 'tldr.sentences', value: 7 })
  expect(await frame($, 'get', { key: 'sentences' })).toBe(7)

  // the menu's write of a value set would refuse is refused the same way: the row stays, get stays
  const rows = rec.config.length
  for (const value of [0, 2.5, 'abc']) {
    const r = (await frame($, 'config', { key: 'tldr.sentences', value })) as { deny?: string }
    expect(r.deny, String(value)).toMatch(/not a valid sentences/)
  }
  expect(rec.config.length).toBe(rows)
  expect(await frame($, 'get', { key: 'sentences' })).toBe(7)
})

test('set sentences: a whole number of 1 or more; a bad value, scope, key or a denied row is refused', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'tldr.sentences', value: 9 }, () => ({ deny: 'locked' })) // one write a hook refuses
  const rec = world(on)
  await start($)
  // exact bounds: 1 is in; 0, -5 and 2.5 are out; a numeric string is a number
  expect(await frame($, 'set', { key: 'sentences', value: 1 })).toBe(1)
  expect(await frame($, 'set', { key: 'sentences', value: '4' })).toBe(4)
  expect(rec.config).toEqual([{ key: 'tldr.sentences', value: 1 }, { key: 'tldr.sentences', value: 4 }])
  expect(await frame($, 'get', { key: 'sentences' })).toBe(4)

  const writes = rec.config.length
  for (const value of [0, -5, 2.5, 'abc', '']) {
    await expect(frame($, 'set', { key: 'sentences', value }), String(value)).rejects.toThrow(/not a valid sentences/)
  }
  await expect(frame($, 'set', { key: 'sentences', value: 2, scope: 'project' })).rejects.toThrow(/scope project/)
  await expect(frame($, 'set', { key: 'nope', value: 1 })).rejects.toThrow(/no setting nope/)
  await expect(frame($, 'get', { key: 'nope' })).rejects.toThrow(/no setting nope/)
  expect(rec.config.length).toBe(writes) // none of the refusals reached $.config
  expect(rec.files.size).toBe(0) // and none touched the flag file
  expect(await frame($, 'get', { key: 'sentences' })).toBe(4)

  // a config.set hook's deny comes back as the refusal and the value stays
  await expect(frame($, 'set', { key: 'sentences', value: 9 })).rejects.toThrow(/locked/)
  expect(await frame($, 'get', { key: 'sentences' })).toBe(4)
})

test('a denied tldr.terse write leaves the flag file alone', WITH_FRAME, async ($, on) => {
  on('config.set', { key: 'tldr.terse' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await expect(frame($, 'set', { key: 'terse', value: true })).rejects.toThrow(/locked/)
  expect(rec.files.size).toBe(0)
  expect(await frame($, 'get', { key: 'terse' })).toBe(false)
})
