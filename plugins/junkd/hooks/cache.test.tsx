// junkd's prompt-cache check (cache.tsx): scripts/cache-check.sh run at the main session's start (not an agent's,
// not after a compaction) over the transcript's project folder, its line in a band above the prompt with a dismiss
// button, a failure in the debug log alone. The whole module loads, so the world also answers what every feature's
// session start touches. Everything beneath the plugin is answered from memory; no script really runs.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

// The plugin's root as the module sees it ($.plugin.root): this file's folder is its hooks/.
const ROOT = String((import.meta as unknown as { dir: string }).dir).replace(/\/hooks\/?$/, '')
const SCRIPT = `${ROOT}/scripts/cache-check.sh`
const PROJECT = '/home/u/.claude/projects/-work-repo'
const TRANSCRIPT = `${PROJECT}/sess-1.jsonl`
const LINE = 'cache, last 10 sessions: 40% of main requests came 5–60 min after the previous one → a 1h cache TTL would pay off'

type Run = { exitCode: number; stdout: string; stderr: string }
// `answer`: what the next cache-check.sh run answers (a Run, or an Error it throws); `hold`: runs wait on it.
function world(on: On) {
  mock.store(on)
  mock.env(on, { HOME: '/home/u' })
  const rec = {
    checks: [] as { argv: string[]; timeoutMs?: number }[],
    logs: [] as { text: string; to: string }[],
    config: [] as { key: string; value: unknown }[],
    answer: { exitCode: 0, stdout: `${LINE}\n`, stderr: '' } as Run | Error,
    hold: undefined as Promise<void> | undefined,
    beneath: '', // another plugin's band beneath ours, drawn by the engine's bottom
  }
  // What the other features' session starts touch (panel, handoff, core, orch, tldr), so none of them rejects.
  on('ui.panes', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('fs.stat', () => ({ value: { kind: 'other', size: 0, mtimeMs: 0 } as never }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('ui.log', (_$, e) => { rec.logs.push({ text: e.text, to: e.to }); return { value: undefined } })
  on('process.run', async (_$, e) => {
    const done = (r: Run) => ({ value: { ...r, isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] !== SCRIPT) return done({ exitCode: 0, stdout: '', stderr: '' })
    rec.checks.push({ argv: [...e.argv], timeoutMs: e.init?.timeoutMs })
    await rec.hold
    if (rec.answer instanceof Error) throw rec.answer
    return done(rec.answer)
  })
  on('classic.SessionStart', () => ({})) // no settings hook beneath
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return e.component === 'AbovePrompt' && rec.beneath ? <Text key="beneath">{rec.beneath}</Text> : <Box key="engine" />
  })
  return rec
}

// The host's rule for a plugin's own write: `$.config.set` passes the other plugins' hooks, the caller's own skipped.
const HOST: Plugin = {
  name: 'host',
  tier: 'prepend',
  register(on) {
    on('config.set', (_$, e, next) => (next.origin.plugin === 'junkd' ? next.to(e, 'append') : next(e)))
  },
}
// Another mod setting a junkd row: `/setn <n>` is `$.junkd.set({ key: 'core_cache_check_sessions', value: n })`.
const SETTER: Plugin = {
  name: 'setter',
  register(on) {
    on('command.run', { command: 'setn' }, async ($, e) => {
      await $.junkd.set({ key: 'core_cache_check_sessions', value: Number(e.args) })
      return {}
    })
  },
}
const W = { plugins: [HOST, SETTER] }
const withOptions = (options: Record<string, number>) => ({ plugins: [HOST, SETTER], options })

const sessionStart = ($: Engine, e: { source: 'startup' | 'resume' | 'clear' | 'compact' | 'fork'; agent_id?: string }) =>
  $.classic.SessionStart({ transcript_path: TRANSCRIPT, ...e })
// The check runs detached from the hook: a few turns of the event loop let it finish.
const settle = () => new Promise(r => setTimeout(r, 20))
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const
const band = ($: Engine, hasSurvey = false) => $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey } })
const setn = ($: Engine, n: number) =>
  $.command.run({ command: 'setn', args: String(n), origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

test('AC2: a main session start runs cache-check.sh with the setting and the transcript\'s project folder, then draws the band', W, async ($, on) => {
  const rec = world(on)
  await sessionStart($, { source: 'startup' })
  await settle()
  expect(rec.checks).toEqual([{ argv: [SCRIPT, '10', PROJECT], timeoutMs: 5000 }])
  const ui = await band($)
  const box = await ui.find({ type: 'Box', key: 'cache-check' })
  expect(box?.props.borderColor).toBe('warning')
  expect(box?.props.borderStyle).toBe('round')
  const text = await ui.find({ type: 'Text', text: new RegExp(LINE.slice(0, 20)) })
  expect(text?.text).toBe(`⚠️ ${LINE}`)
  expect(text?.props.color).toBe('warning')
  expect(text?.props.bold).toBe(true)
  const dismiss = await ui.find({ type: 'Button', key: 'cache-dismiss' })
  expect(dismiss?.props.label).toBe('dismiss')
  expect(rec.logs).toEqual([])
})

for (const source of ['startup', 'resume', 'clear', 'fork'] as const) {
  test(`AC2: source ${source} runs the check`, W, async ($, on) => {
    const rec = world(on)
    await sessionStart($, { source })
    await settle()
    expect(rec.checks).toHaveLength(1)
  })
}

test('AC2: a compaction runs no check and keeps the line already drawn', W, async ($, on) => {
  const rec = world(on)
  await sessionStart($, { source: 'compact' })
  await settle()
  expect(rec.checks).toEqual([])
  expect(await (await band($)).find({ key: 'cache-check' })).toBeUndefined()
  await sessionStart($, { source: 'startup' })
  await settle()
  rec.answer = new Error('must not run')
  await sessionStart($, { source: 'compact' })
  await settle()
  expect(rec.checks).toHaveLength(1)
  expect(await (await band($)).find({ key: 'cache-check' })).toBeDefined()
})

test("AC2: an agent's session start runs no check, whatever its source", W, async ($, on) => {
  const rec = world(on)
  for (const source of ['startup', 'resume', 'clear'] as const) await sessionStart($, { source, agent_id: 'a1' })
  await settle()
  expect(rec.checks).toEqual([])
  expect(await (await band($)).find({ key: 'cache-check' })).toBeUndefined()
})

test('AC2: dismiss clears the band; the next check draws it again', W, async ($, on) => {
  world(on)
  await sessionStart($, { source: 'startup' })
  await settle()
  const ui = await band($)
  await ui.press({ key: 'cache-dismiss' })
  expect(await ui.find({ key: 'cache-check' })).toBeUndefined()
  expect(await ui.find({ type: 'Box', key: 'engine' })).toBeDefined() // the engine's own drawing again
  await sessionStart($, { source: 'clear' })
  await settle()
  expect(await (await band($)).find({ key: 'cache-check' })).toBeDefined()
})

test('AC2: no line (the script printed nothing, or only blanks) draws nothing', W, async ($, on) => {
  const rec = world(on)
  rec.answer = { exitCode: 0, stdout: '\n  \n', stderr: '' }
  await sessionStart($, { source: 'startup' })
  await settle()
  expect(rec.checks).toHaveLength(1)
  expect(await (await band($)).find({ key: 'cache-check' })).toBeUndefined()
  expect(rec.logs).toEqual([])
})

test('AC2: a script that exits non-zero logs its exit and stderr to debug and draws nothing, even a line it printed', W, async ($, on) => {
  const rec = world(on)
  rec.answer = { exitCode: 1, stdout: `${LINE}\n`, stderr: 'jq: error\n' }
  await sessionStart($, { source: 'startup' })
  await settle()
  expect(rec.logs).toEqual([{ text: 'junkd cache check: exit 1: jq: error', to: 'debug' }])
  expect(await (await band($)).find({ key: 'cache-check' })).toBeUndefined()
})

test('AC2: a capped run (exit 142) and a run that cannot start are logged to debug alone', W, async ($, on) => {
  const rec = world(on)
  rec.answer = { exitCode: 142, stdout: '', stderr: '' }
  await sessionStart($, { source: 'startup' })
  await settle()
  rec.answer = new Error('EACCES')
  await sessionStart($, { source: 'resume' })
  await settle()
  // a thrown run: the kit reports the bottom hook skipped as no implementation, the host would carry its error
  expect(rec.logs).toEqual([
    { text: 'junkd cache check: exit 142: ', to: 'debug' },
    { text: expect.stringMatching(/^junkd cache check: \S/), to: 'debug' },
  ])
  expect(await (await band($)).find({ key: 'cache-check' })).toBeUndefined()
})

test("AC2: a new session's check replaces the last line: a failing one or an empty one clears it", W, async ($, on) => {
  const rec = world(on)
  await sessionStart($, { source: 'startup' })
  await settle()
  expect(await (await band($)).find({ key: 'cache-check' })).toBeDefined()
  rec.answer = { exitCode: 1, stdout: '', stderr: 'broken' }
  await sessionStart($, { source: 'clear' })
  await settle()
  expect(await (await band($)).find({ key: 'cache-check' })).toBeUndefined()
  rec.answer = { exitCode: 0, stdout: `${LINE}\n`, stderr: '' }
  await sessionStart($, { source: 'clear' })
  await settle()
  expect(await (await band($)).find({ key: 'cache-check' })).toBeDefined()
  rec.answer = { exitCode: 0, stdout: '', stderr: '' }
  await sessionStart($, { source: 'clear' })
  await settle()
  expect(await (await band($)).find({ key: 'cache-check' })).toBeUndefined()
})

test('AC2: the session start does not wait for the check; the band comes once the script answers', W, async ($, on) => {
  const rec = world(on)
  let release = () => {}
  rec.hold = new Promise<void>(r => { release = r })
  await sessionStart($, { source: 'startup' }) // resolves while the run is held
  await settle()
  expect(rec.checks).toHaveLength(1)
  const ui = await band($)
  expect(await ui.find({ key: 'cache-check' })).toBeUndefined()
  release()
  await settle()
  expect(await ui.find({ key: 'cache-check' }), 'the band mounted before is drawn again').toBeDefined()
})

test('AC2: a line on screen goes at the next session start with the check off, and at once', W, async ($, on) => {
  const rec = world(on)
  await sessionStart($, { source: 'startup' })
  await settle()
  const ui = await band($)
  expect(await ui.find({ key: 'cache-check' })).toBeDefined()
  await setn($, 0)
  await sessionStart($, { source: 'clear' })
  await settle()
  expect(rec.checks).toHaveLength(1)
  expect(await ui.find({ key: 'cache-check' }), 'the band mounted before is cleared').toBeUndefined()
})

test('AC2: core_cache_check_sessions 0 runs no check; another value is the N the script gets', W, async ($, on) => {
  const rec = world(on)
  await setn($, 0)
  await sessionStart($, { source: 'startup' })
  await settle()
  expect(rec.checks).toEqual([])
  await setn($, 30)
  await sessionStart($, { source: 'startup' })
  await settle()
  expect(rec.checks.map(c => c.argv[1])).toEqual(['30'])
})

test('AC2: the option at load is the N (1 is checked, 0 is off)', withOptions({ core_cache_check_sessions: 1 }), async ($, on) => {
  const rec = world(on)
  await sessionStart($, { source: 'startup' })
  await settle()
  expect(rec.checks.map(c => c.argv[1])).toEqual(['1'])
})

// The manifest row has no min or max, so an out-of-range hand edit loads, and the module's clamp is what holds it:
// 31 runs with N 30, -1 is 0 (off: no run). The host still refuses a string at load ("must be a number"), min/max
// or not, so a string never reaches the module there.
for (const [stored, argv] of [[31, ['30']], [-1, []], [7.4, ['7']]] as const) {
  test(`AC3: an option of ${stored} at load loads the module; the check runs with N ${argv[0] ?? 'none (off)'}`, { plugins: [HOST, SETTER], options: { core_cache_check_sessions: stored } }, async ($, on) => {
    const rec = world(on)
    await sessionStart($, { source: 'startup' })
    await settle()
    expect(rec.checks.map(c => c.argv[1])).toEqual([...argv])
  })
}

test('AC2: an option of 0 at load runs no check', withOptions({ core_cache_check_sessions: 0 }), async ($, on) => {
  const rec = world(on)
  await sessionStart($, { source: 'startup' })
  await settle()
  expect(rec.checks).toEqual([])
})

test('AC2: a survey has the band alone; another plugin\'s band beneath stays above ours', W, async ($, on) => {
  const rec = world(on)
  await sessionStart($, { source: 'startup' })
  await settle()
  expect(await (await band($, true)).find({ key: 'cache-check' })).toBeUndefined()
  rec.beneath = 'another band'
  const ui = await band($)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts[0]).toBe('another band')
  expect(texts[1]).toBe(`⚠️ ${LINE}`)
})
