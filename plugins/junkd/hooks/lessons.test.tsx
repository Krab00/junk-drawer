// junkd's lessons loop: lessons.ts's reader, stack filter, pending rule and texts over fixed inputs, then the module
// (lessons.tsx) over a world in memory: the stores read at session start, the dialog of an orch session, the 📒
// segment, the tab's keys calling the CLI (process.run stubbed), the confirm line, the context line, /junkd:lessons,
// the BACKLOG: answer and /junkd:orch, the orch_lessons row (by $.junkd.set, the /config menu and the ⚙ pane) and its
// flag file. Nothing touches a real home: every fs, process and session call is answered by `world`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'
import {
  argvOf, confirmText, contextLine, detectStacks, findLesson, isPending, meets, moveSelection, needsConfirm, parseCommand, parseLessons,
  pendingOf, segmentText, topLine, L, type Lesson,
} from './lessons.ts'
import { rowText } from './lessons-views'
import { coerce } from './orch-lib'
import parity from './lessons-parity.ts'

const head = (id: string, scope: string, to: string, more = '') => `## ${id} (2026-10-20) scope: ${scope} · stack: shell · to: ${to}${more}`

// the reader ----------------------------------------------------------------------------------------------------------

test('parseLessons: one lesson per L<n> heading, its fields and body; CRLF as LF; other headings are no lesson', () => {
  const text = `# Lessons\r\n\r\n${head('L1', 'local', 'smoke', ' · from: T7')}\r\nWhat failed.\r\nWhy it did.\r\n\r\n## T8 (2026-10-18)\r\nOld diary.\r\n## L3 (2026-10-19) scope: local · stack: node, python · from: T9\r\nNo target.\r\n`
  const ls = parseLessons(text, 'local')
  expect(ls.map(l => l.ref)).toEqual(['local:L1', 'local:L3'])
  expect(ls[0]).toEqual({ ref: 'local:L1', id: 'L1', scope: 'local', date: '2026-10-20', stack: ['shell'], to: 'smoke', from: 'T7', text: 'What failed. Why it did.', pending: true })
  expect(ls[1]).toMatchObject({ to: '', from: 'T9', stack: ['node', 'python'], text: 'No target.', pending: true }) // a block without `to`
  expect(parseLessons('', 'global')).toEqual([]) // a missing or empty store
  expect(parseLessons('## L2 (2026-10-20)\nBare.\n', 'repo')[0]).toMatchObject({ stack: ['any'], to: '', from: '' })
  expect(parseLessons('## L2 (20261020) scope: repo\nx\n', 'repo')).toEqual([]) // not the heading's shape
  // a handed test keeps its whole target (· inside a field is no separator)
  expect(parseLessons(`${head('L4', 'local', 'test·handed', ' · from: T1')}\nx\n`, 'local')[0]!.to).toBe('test·handed')
})

// The same store text and the same expected lessons as tests/lessons.sh feeds bin/orch-state (`lesson list --json`): the
// two parsers cannot drift apart without one of the two tests failing. The text has CRLF, a blank line and a tab and
// double blanks inside a body, a lone CR (also in front of a `## `), headings of another shape, a bad date, an empty
// stack, a block without `to` and a body line with colons.
test('parseLessons gives the shared fixture\'s lessons, the very JSON bin/orch-state lesson list --json gives (tests/lessons.sh)', () => {
  expect(parseLessons(parity.store, parity.scope as 'repo')).toEqual(parity.lessons)
})

test('isPending: resting where `to` points is not pending; below it, any other target, a handed test or no `to` is', () => {
  expect(isPending('repo', 'repo')).toBe(false)
  expect(isPending('global', 'repo')).toBe(false)
  expect(isPending('global', 'global')).toBe(false)
  expect(isPending('local', 'repo')).toBe(true)
  expect(isPending('repo', 'global')).toBe(true)
  expect(isPending('local', 'global')).toBe(true)
  for (const to of ['test', 'smoke', 'check', 'role', 'drop', 'test·handed', '']) expect(isPending('global', to), to).toBe(true)
})

test('the stack filter: a shared tag or `any`; a repo with no stack (any) takes only `any` lessons', () => {
  expect(meets(['python', 'shell'], ['shell', 'tsx-mods'])).toBe(true)
  expect(meets(['python'], ['shell', 'tsx-mods'])).toBe(false)
  expect(meets(['any'], ['shell'])).toBe(true)
  expect(meets(['node'], ['any'])).toBe(false)
  expect(meets(['any'], ['any'])).toBe(true)
  expect(meets([], ['shell'])).toBe(false)
})

test('detectStacks: the repo files to tags in the CLI\'s order; a bin/ file counts as shell only with a bash shebang; none is any', () => {
  const first = (m: Record<string, string>) => (p: string) => m[p]
  expect(detectStacks([], first({}))).toEqual(['any'])
  expect(detectStacks(['web/package.json', 'requirements-dev.txt', 'plugins/x/hooks/a.tsx', 'go.mod', 'Cargo.toml', 'bin/t'], first({ 'bin/t': '#!/usr/bin/env bash' })))
    .toEqual(['node', 'python', 'shell', 'tsx-mods', 'go', 'rust'])
  expect(detectStacks(['pyproject.toml'], first({}))).toEqual(['python'])
  expect(detectStacks(['bin/t'], first({ 'bin/t': '#!/bin/sh' }))).toEqual(['any'])
  expect(detectStacks(['bin/t'], first({ 'bin/t': '#!/bin/bash -e' }))).toEqual(['shell'])
  expect(detectStacks(['bin/t'], first({}))).toEqual(['any']) // unreadable
  expect(detectStacks(['x.tsx', 'hooks/sub/a.tsx', 'binx/t'], first({ 'binx/t': '#!/bin/bash' }))).toEqual(['any'])
})

test('the texts: the segment, the top line, the context line; the confirm line of a check and of a role', () => {
  expect(segmentText(0)).toBe('')
  expect(segmentText(1)).toBe('📒 1')
  expect(segmentText(3)).toBe('📒 3')
  expect(topLine(1)).toBe('1 lesson pending — resolve them to finish the run')
  expect(topLine(3)).toBe('3 lessons pending — resolve them to finish the run')
  expect(contextLine(3)).toBe('lessons: 3 pending, open /junkd lessons; the run is not finished')
  const [chk, role, smoke] = parseLessons(`${head('L1', 'local', 'check')}\na\n${head('L2', 'local', 'role')}\nb\n${head('L3', 'local', 'smoke')}\nc\n`, 'local')
  expect([chk, role, smoke].map(l => needsConfirm(l!))).toEqual([true, true, false])
  expect(confirmText(chk!)).toBe('promote local:L1 into standing_checks_extra of .orch/config.md?')
  expect(confirmText(role!)).toBe("promote local:L2 into a role task (junk-drawer's backlog; elsewhere the text to paste)?")
})

test('argvOf, parseCommand, findLesson', () => {
  const [chk, smoke] = parseLessons(`${head('L1', 'repo', 'check')}\na\n${head('L2', 'repo', 'smoke')}\nb\n`, 'repo')
  expect(argvOf('promote', chk!)).toEqual(['lesson', 'promote', 'repo:L1'])
  expect(argvOf('promote', chk!, true)).toEqual(['lesson', 'promote', 'repo:L1', '--yes'])
  expect(argvOf('promote', smoke!, true)).toEqual(['lesson', 'promote', 'repo:L2']) // --yes is for a check only
  expect(argvOf('drop', chk!)).toEqual(['lesson', 'drop', 'repo:L1'])
  expect(argvOf('up', chk!)).toEqual(['lesson', 'up', 'repo:L1'])
  expect(parseCommand('')).toEqual({ kind: 'toggle' })
  expect(parseCommand(' list ')).toEqual({ kind: 'list' })
  expect(parseCommand('promote L3')).toEqual({ kind: 'promote', id: 'L3' })
  expect(parseCommand('DROP repo:L3')).toEqual({ kind: 'drop', id: 'repo:L3' })
  expect(parseCommand('up global:L1')).toEqual({ kind: 'up', id: 'global:L1' })
  for (const bad of ['promote', 'promote L3 x', 'promote x', 'promote team:L3', 'list x', 'frob L3']) expect(parseCommand(bad).kind, bad).toBe('error')
  const two = [...parseLessons(`${head('L1', 'local', 'smoke')}\na\n`, 'local'), ...parseLessons(`${head('L1', 'repo', 'smoke')}\nb\n${head('L2', 'repo', 'smoke')}\nc\n`, 'repo')]
  expect((findLesson(two, 'L2') as Lesson).ref).toBe('repo:L2')
  expect((findLesson(two, 'local:L1') as Lesson).ref).toBe('local:L1')
  expect(findLesson(two, 'L1')).toBe('junkd: L1 is in more than one store: local:L1, repo:L1')
  expect(findLesson(two, 'L9')).toBe('junkd: no lesson L9')
})

test('rowText: the cells cut to the pane, never wider; moveSelection stays in the rows', () => {
  const [l] = parseLessons(`${head('L12', 'global', 'smoke', ' · from: T26')}\nA long text that the pane cuts at its width.\n`, 'global')
  for (const cols of [6, 8, 30, 60, 120]) expect([...rowText(l!, cols)].length, String(cols)).toBeLessThanOrEqual(cols)
  expect(rowText(l!, 120)).toBe('L12   global  shell        smoke         T26    A long text that the pane cuts at its width.')
  expect(rowText(l!, 60).endsWith('…')).toBe(true)
  const rows = parseLessons(`${head('L1', 'local', 'smoke')}\na\n${head('L2', 'local', 'smoke')}\nb\n`, 'local')
  L.selected = ''
  moveSelection(rows, 1)
  expect(L.selected).toBe('local:L2')
  moveSelection(rows, 5)
  expect(L.selected).toBe('local:L2')
  moveSelection(rows, -9)
  expect(L.selected).toBe('local:L1')
  moveSelection([], 1)
  expect(L.selected).toBe('local:L1')
})

test('the orch_lessons row coerces as every switch does: true, "true" and "on" are on', () => {
  for (const v of [true, 'true', 'on']) expect(coerce('lessons', v).value, String(v)).toBe(true)
  for (const v of [false, 'false', 'off', 'yes', 1, '', null]) expect(coerce('lessons', v).value, String(v)).toBe(false)
})

// the module ----------------------------------------------------------------------------------------------------------

const CFG = '/fake/cfg'
const HOME = '/home/u'
const REPO = '/repo'
const LOCAL = `${REPO}/.orch/tasks/_lessons.md`
const REPO_STORE = `${REPO}/lessons.md`
const GLOBAL = `${CFG}/junkd/lessons.md`
const CONFIG = `${REPO}/.orch/config.md`
const FLAG = `${CFG}/junkd/orch-lessons-off`
const TWO = `${head('L1', 'local', 'smoke', ' · from: T7')}\nSmoke the origin word.\n\n${head('L2', 'local', 'check', ' · from: T8')}\nGrep the manifest.\n`

type Opts = { cwd?: string }
type Cli = { argv: string[]; cwd: string }
function world(on: On, o: Opts = {}) {
  const rec = {
    toasts: [] as string[],
    config: [] as { key: string; value: unknown }[],
    prompts: [] as { text: string; context?: readonly string[] }[],
    opened: [] as { id: string; focus?: boolean }[],
    closed: [] as string[],
    files: {} as Record<string, string>,
    unreadable: new Set<string>(),
    cli: [] as Cli[],
    // what the stubbed CLI answers, and what it does to the files (the real one's effect, by hand)
    answer: { exitCode: 0, stdout: 'ok', stderr: '' },
    effect: undefined as ((argv: string[]) => void) | undefined,
    lsFiles: 'plugins/junkd/hooks/a.tsx\nbin/t\n',
    noRepo: false,
    cwd: o.cwd ?? `${REPO}/src`,
  }
  mock.store(on)
  mock.env(on, { CLAUDE_CONFIG_DIR: CFG, HOME })
  mock.clock(on, { now: 1_000_000 })
  const done = (stdout = '', exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', (_$, e) => { rec.opened.push({ id: e.id, ...(e.focus ? { focus: true } : {}) }); return { value: { isPlaced: true as const } } })
  on('ui.close', (_$, e) => { rec.closed.push(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [] }))
  on('ui.focus', () => ({}))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('command.run', (_$, e) => ({ text: `downstream ${e.command} ${e.args}` }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, ev) => ({ sessionId: ev.sessionId }))
  on('session.cwd', () => ({ value: rec.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { breakdown: { mcpTools: [] } } } as never }))
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('prompt.submit', (_$, e) => {
    rec.prompts.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context }
  })
  on('agent.list', () => ({ value: [] }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('fs.exists', (_$, e) => ({ value: Object.keys(rec.files).some(f => f === e.path || f.startsWith(`${e.path}/`)) }))
  on('fs.stat', (_$, e) => {
    if (!(e.path in rec.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }
  })
  on('fs.read', (_$, e) => {
    if (rec.unreadable.has(e.path)) throw new Error(`EACCES ${e.path}`)
    if (!(e.path in rec.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: rec.files[e.path]! }
  })
  on('fs.write', (_$, e) => { rec.files[e.path] = e.text; return { value: undefined } })
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    if (argv[0] === 'git' && argv.includes('--show-toplevel')) return rec.noRepo ? done('', 128) : done(`${/\/\.worktrees\/T26/.test(argv[2]!) ? `${REPO}/.worktrees/T26` : REPO}\n`)
    if (argv[0] === 'git' && argv.includes('ls-files')) return done(rec.lsFiles)
    if (argv[0] === 'git') return done('', 128)
    if (argv[0] === 'rm') delete rec.files[argv.at(-1)!]
    if (argv[0] === 'sh' && argv[1] === '-c' && /orch-state$/.test(argv[5] ?? '')) {
      rec.cli.push({ argv: argv.slice(6), cwd: argv[4]! })
      rec.effect?.(argv.slice(6))
      return done(rec.answer.stdout, rec.answer.exitCode, rec.answer.stderr)
    }
    return done()
  })
  on('classic.SubagentStop', () => ({}))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  rec.files[`${REPO}/bin/t`] = '#!/usr/bin/env bash\necho\n'
  return rec
}
type World = ReturnType<typeof world>
// The orch project: a config, the local store with two pending lessons.
const orchProject = (w: World, local = TWO) => {
  w.files[CONFIG] = '---\ntasks_dir: .orch/tasks\n---\n'
  w.files[LOCAL] = local
}
// The stubbed CLI's drop: the block of that ref goes from the local store.
const dropEffect = (w: World) => (argv: string[]) => {
  const id = argv.at(-1)!.replace(/^local:/, '')
  w.files[LOCAL] = w.files[LOCAL]!.split(/\n(?=## )/).filter(b => !b.startsWith(`## ${id} `)).join('\n')
}

const start = ($: Engine) => $.session.start({ cwd: `${REPO}/src`, surface: 'terminal', isInteractive: true })
const composer = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
const run$ = ($: Engine, command: string, args = '') => $.command.run({ command, args, ...composer }) as Promise<{ text?: string }>
const submit = ($: Engine, text = 'go') => $.prompt.submit({ text } as never)
const turnEnd = ($: Engine, answer = 'a', agentId?: string) => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', ...(agentId ? { agentId } : {}) } as never)
const lessonsOpened = (w: World) => w.opened.filter(o => o.id === 'junkd-lessons')
const lastContext = (w: World) => w.prompts.at(-1)?.context ?? []

const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '' } } as const
async function hintText($: Engine) {
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  try {
    return (await ui.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
  } finally {
    await ui.unmount()
  }
}
const PANE = { component: 'Pane', requestId: 'junkd-lessons', props: { title: 'lessons', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const mountTab = ($: Engine) => $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...PANE } as never)
type Mounted = Awaited<ReturnType<typeof mountTab>>
const texts = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

// The caller plugin: `/frame <method> [json]` calls $.junkd.<method>, `config` the /config menu.
const FRAME: Plugin = {
  name: 'frame',
  register(on) {
    on('command.run', { command: 'frame' }, async ($, e) => {
      const [method = '', ...rest] = e.args.trim().split(/\s+/)
      const input = rest.length ? JSON.parse(rest.join(' ')) : undefined
      try {
        if (method === 'get') return { text: JSON.stringify({ ok: await $.junkd.get(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.junkd.set(input) }) }
        if (method === 'open') return { text: JSON.stringify({ ok: await $.junkd.open(input) ?? null }) }
        if (method === 'config') return { text: JSON.stringify({ ok: await $.config.set(input) }) }
        return { text: JSON.stringify({ error: `no method ${method}` }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
  },
}
// The host's rule for a plugin's own write: `$.config.set` skips the caller's own config.set hooks.
const HOST: Plugin = {
  name: 'host',
  tier: 'prepend',
  register(on) {
    on('config.set', (_$, e, next) => (next.origin.plugin === 'junkd' ? next.to(e, 'append') : next(e)))
  },
}
const W_ = { plugins: [HOST, FRAME] }
async function frame($: Engine, method: string, input?: unknown): Promise<unknown> {
  const r = await run$($, 'frame', input === undefined ? method : `${method} ${JSON.stringify(input)}`)
  const out = JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}

test('session start of an orch session with lessons pending: the tab opens focused with its top line; the 📒 segment', async ($, on) => {
  const w = world(on)
  orchProject(w)
  w.files[GLOBAL] = `${head('L1', 'global', 'global')}\nResting.\n`
  await start($)
  expect(lessonsOpened(w)).toEqual([{ id: 'junkd-lessons', focus: true }])
  expect(await hintText($)).toContain('📒 2')
  const ui = await mountTab($)
  const t = await texts(ui)
  expect(t).toContain('2 lessons pending — resolve them to finish the run')
  expect(t).toContain('L1    local   shell        smoke         T7     Smoke the origin word.')
  expect(t).toContain('L2    local   shell        check         T8     Grep the manifest.')
  expect(t).not.toContain('Resting.') // a resting lesson is no row
  expect(t).toContain("this repo's stack: shell,tsx-mods")
  await ui.unmount()
})

test('the dialog does not open at 0 pending, nor outside an orch project; the segment is gone at 0', async ($, on) => {
  const w = world(on)
  orchProject(w, `${head('L1', 'local', 'repo')}\nx\n`.replace('scope: local', 'scope: local')) // local, to repo: pending
  delete w.files[LOCAL]
  w.files[REPO_STORE] = `${head('L1', 'repo', 'repo')}\nResting in the repo.\n`
  await start($)
  expect(lessonsOpened(w)).toEqual([])
  expect(await hintText($)).not.toContain('📒')
  // no .orch/config.md: lessons pending in the repo store show the segment, but open no dialog
  const w2 = w
  delete w2.files[CONFIG]
  w2.files[REPO_STORE] = `${head('L1', 'repo', 'smoke')}\nPending in the repo.\n`
  await start($)
  expect(lessonsOpened(w)).toEqual([])
  expect(await hintText($)).toContain('📒 1')
})

test('the stores: local from the config\'s tasks_dir, repo at the orch root above a task worktree, global under CLAUDE_CONFIG_DIR; a missing global is empty', async ($, on) => {
  const w = world(on, { cwd: `${REPO}/.worktrees/T26/src` })
  w.files[CONFIG] = '---\ntasks_dir: ".orch/backlog"  # moved\n---\n'
  w.files[`${REPO}/.orch/backlog/_lessons.md`] = `${head('L1', 'local', 'smoke')}\nLocal one.\n`
  w.files[REPO_STORE] = `${head('L1', 'repo', 'global')}\nRepo one.\n`
  await start($)
  const rows = async () => {
    const ui = await mountTab($)
    try {
      return { refs: (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('lesson:')), text: await texts(ui) }
    } finally {
      await ui.unmount()
    }
  }
  expect((await rows()).refs).toEqual(['lesson:local:L1', 'lesson:repo:L1'])
  w.files[GLOBAL] = `${head('L1', 'global', 'smoke')}\nGlobal one.\n`
  await turnEnd($)
  expect((await rows()).refs).toEqual(['lesson:local:L1', 'lesson:repo:L1', 'lesson:global:L1'])
  expect(await hintText($)).toContain('📒 3')
  // a store that cannot be read keeps what was read of it, and says so
  w.unreadable.add(GLOBAL)
  await turnEnd($)
  const kept = await rows()
  expect(kept.refs).toEqual(['lesson:local:L1', 'lesson:repo:L1', 'lesson:global:L1'])
  expect(kept.text).toContain(`✗ could not read ${GLOBAL}`)
  // no repo: the global store alone
  w.unreadable.clear()
  w.noRepo = true
  await turnEnd($)
  expect((await rows()).refs).toEqual(['lesson:global:L1'])
})

test('the tab\'s keys: d and u call the CLI with the ref, in the session\'s directory; r reads again; q closes', async ($, on) => {
  const w = world(on)
  orchProject(w)
  w.effect = dropEffect(w)
  await start($)
  const ui = await mountTab($)
  await ui.press({ key: 'lessons:drop' })
  expect(w.cli).toEqual([{ argv: ['lesson', 'drop', 'local:L1'], cwd: `${REPO}/src` }])
  expect(await hintText($)).toContain('📒 1') // read again after the write
  expect(await texts(ui)).toContain('✓ ok')
  await ui.press({ key: 'lessons:move-up' })
  expect(w.cli.at(-1)!.argv).toEqual(['lesson', 'up', 'local:L2'])
  w.files[LOCAL] += `\n${head('L5', 'local', 'smoke')}\nAdded by hand.\n`
  await ui.press({ key: 'lessons:reload' })
  expect(await texts(ui)).toContain('Added by hand.')
  await ui.press({ key: 'lessons:close' })
  expect(w.closed).toContain('junkd-lessons')
  await ui.unmount()
})

test('p promotes the selected lesson to its `to`; j and k move the selection; a refusal of the CLI is the ✗ note', async ($, on) => {
  const w = world(on)
  orchProject(w)
  await start($)
  const ui = await mountTab($)
  await ui.press({ key: 'lessons:promote' }) // L1, to smoke: no confirm
  expect(w.cli.map(c => c.argv)).toEqual([['lesson', 'promote', 'local:L1']])
  await ui.press({ key: 'lessons:down' })
  await ui.press({ key: 'lessons:up-sel' })
  w.answer = { exitCode: 1, stdout: '', stderr: 'orch: lesson: local:L1 is handed already' }
  await ui.press({ key: 'lessons:promote' })
  expect(w.cli.at(-1)!.argv).toEqual(['lesson', 'promote', 'local:L1'])
  expect(await texts(ui)).toContain('✗ orch: lesson: local:L1 is handed already')
  await ui.unmount()
})

test('a check asks in the confirm line: n sends nothing, y sends promote --yes; a role asks too and sends no --yes', async ($, on) => {
  const w = world(on)
  orchProject(w, `${head('L1', 'local', 'check')}\nGrep it.\n\n${head('L2', 'local', 'role')}\nAgents pwd -P.\n`)
  await start($)
  const ui = await mountTab($)
  await ui.press({ key: 'lessons:promote' })
  expect(w.cli).toEqual([])
  expect(await texts(ui)).toContain('promote local:L1 into standing_checks_extra of .orch/config.md? y/n')
  expect(await ui.find({ key: 'lessons:drop' })).toBeUndefined() // only y and n while it asks
  await ui.press({ key: 'lessons:no' })
  expect(w.cli).toEqual([])
  expect(await texts(ui)).not.toContain('y/n')
  await ui.press({ key: 'lessons:promote' })
  await ui.press({ key: 'lessons:yes' })
  expect(w.cli.map(c => c.argv)).toEqual([['lesson', 'promote', 'local:L1', '--yes']])
  await ui.press({ key: 'lessons:select' }).catch(() => undefined)
  await ui.press({ key: 'lesson:local:L2' })
  await ui.press({ key: 'lessons:promote' })
  expect(await texts(ui)).toContain("promote local:L2 into a role task (junk-drawer's backlog; elsewhere the text to paste)? y/n")
  await ui.press({ key: 'lessons:yes' })
  expect(w.cli.at(-1)!.argv).toEqual(['lesson', 'promote', 'local:L2'])
  await ui.unmount()
})

test('the tab with nothing pending says so, and has no p, d or u', async ($, on) => {
  const w = world(on)
  orchProject(w, '')
  await start($)
  const ui = await mountTab($)
  expect(await texts(ui)).toContain('no pending lesson')
  for (const key of ['lessons:promote', 'lessons:drop', 'lessons:move-up']) expect(await ui.find({ key }), key).toBeUndefined()
  await ui.unmount()
})

test('a global lesson has no u (there is no store above)', async ($, on) => {
  const w = world(on)
  orchProject(w, '')
  w.files[GLOBAL] = `${head('L1', 'global', 'smoke')}\nx\n`
  await start($)
  const ui = await mountTab($)
  expect(await ui.find({ key: 'lessons:promote' })).toBeDefined()
  expect(await ui.find({ key: 'lessons:move-up' })).toBeUndefined()
  await ui.unmount()
})

test('the context line: once per turn while the dialog stands and lessons are pending; gone at 0', async ($, on) => {
  const w = world(on)
  orchProject(w)
  w.effect = dropEffect(w)
  await start($)
  await submit($)
  expect(lastContext(w)).toEqual(['lessons: 2 pending, open /junkd lessons; the run is not finished'])
  await submit($)
  expect(lastContext(w)).toEqual(['lessons: 2 pending, open /junkd lessons; the run is not finished']) // one line a turn, not two
  await run$($, 'junkd:lessons', 'drop L1')
  await submit($)
  expect(lastContext(w)).toEqual(['lessons: 1 pending, open /junkd lessons; the run is not finished'])
  await run$($, 'junkd:lessons', 'drop L2')
  await submit($)
  expect(lastContext(w)).toEqual([])
  w.files[LOCAL] = TWO // pending again, but the dialog was resolved: no line until it opens again
  await submit($)
  expect(lastContext(w)).toEqual([])
})

test('no line when no dialog opened: a session outside an orch project with lessons pending', async ($, on) => {
  const w = world(on)
  w.files[REPO_STORE] = `${head('L1', 'repo', 'smoke')}\nx\n`
  await start($)
  await submit($)
  expect(lastContext(w)).toEqual([])
})

test('a main-loop answer that prints BACKLOG: with lessons pending opens the dialog; an agent\'s answer or no BACKLOG: does not', async ($, on) => {
  const w = world(on)
  w.files[CONFIG] = '---\n---\n'
  await start($) // nothing pending yet: no dialog
  expect(lessonsOpened(w)).toEqual([])
  w.files[LOCAL] = TWO // the orchestrator's lesson add, through Bash
  await turnEnd($, 'done.\nBACKLOG: DRAINED — no `todo` tasks remain', 'agent-1')
  expect(lessonsOpened(w)).toEqual([])
  await turnEnd($, 'still working')
  expect(lessonsOpened(w)).toEqual([])
  expect(await hintText($)).toContain('📒 2') // read again at the turn's end
  await turnEnd($, 'Summary.\nBACKLOG: DRAINED — no `todo` tasks remain')
  expect(lessonsOpened(w)).toEqual([{ id: 'junkd-lessons', focus: true }])
  await submit($)
  expect(lastContext(w)).toEqual(['lessons: 2 pending, open /junkd lessons; the run is not finished'])
})

test('/junkd:orch starting a run with lessons pending opens the dialog, then falls through to the skill; panel does not', async ($, on) => {
  const w = world(on)
  w.files[CONFIG] = '---\n---\n'
  await start($)
  w.files[LOCAL] = TWO
  expect((await run$($, 'junkd:orch', 'panel')).text).toBeUndefined()
  expect(lessonsOpened(w)).toEqual([])
  expect((await run$($, 'junkd:orch', 'all')).text).toBe('downstream junkd:orch all')
  expect(lessonsOpened(w)).toEqual([{ id: 'junkd-lessons', focus: true }])
})

test('/junkd:lessons: toggles the tab; list opens it; promote L3 calls the CLI and answers with it; a bad id or verb says why', async ($, on) => {
  const w = world(on)
  orchProject(w, `${head('L3', 'local', 'smoke', ' · from: T9')}\nThree.\n`)
  w.files[REPO_STORE] = `${head('L1', 'repo', 'smoke')}\nOne.\n`
  await start($)
  w.opened.length = 0
  await run$($, 'junkd:lessons') // open at start (the dialog): the toggle closes it
  expect(w.closed).toContain('junkd-lessons')
  await run$($, 'junkd:lessons')
  expect(lessonsOpened(w)).toEqual([{ id: 'junkd-lessons', focus: true }])
  await run$($, 'junkd:lessons', 'list') // open already: stays
  expect(lessonsOpened(w)).toHaveLength(1)
  w.answer = { exitCode: 0, stdout: 'hand to the implementer of T9 as a fix round: add a check in tests/smoke.sh: Three.\nthen: …', stderr: '' }
  expect((await run$($, 'junkd:lessons', 'promote L3')).text).toBe('✓ hand to the implementer of T9 as a fix round: add a check in tests/smoke.sh: Three.')
  expect(w.cli.map(c => c.argv)).toEqual([['lesson', 'promote', 'local:L3']])
  expect((await run$($, 'junkd:lessons', 'up repo:L1')).text).toBe('✓ hand to the implementer of T9 as a fix round: add a check in tests/smoke.sh: Three.')
  expect(w.cli.at(-1)!.argv).toEqual(['lesson', 'up', 'repo:L1'])
  expect((await run$($, 'junkd:lessons', 'drop L9')).text).toBe('junkd: no lesson L9')
  expect((await run$($, 'junkd:lessons', 'promote')).text).toBe('junkd: /junkd:lessons [list | promote <id> | drop <id> | up <id>]')
  expect(w.cli).toHaveLength(2)
})

test('/junkd:lessons promote on a check sends the plain promote: the CLI asks (exit 3) and its line is the answer', async ($, on) => {
  const w = world(on)
  orchProject(w, `${head('L1', 'local', 'check')}\nGrep.\n`)
  await start($)
  w.answer = { exitCode: 3, stdout: 'proposed: standing_checks_extra += "Grep."\nin …', stderr: '' }
  expect((await run$($, 'junkd:lessons', 'promote L1')).text).toBe('✗ proposed: standing_checks_extra += "Grep."')
  expect(w.cli.map(c => c.argv)).toEqual([['lesson', 'promote', 'local:L1']])
})

test('the /junkd set has the lessons tab after tools; $.junkd.open({ pane: "lessons" }) toggles it and refuses a route', W_, async ($, on) => {
  const w = world(on)
  orchProject(w, '')
  await start($)
  await run$($, 'junkd')
  expect(w.opened.map(o => o.id).filter(id => id !== 'junkd')).toEqual(['ahandoff', 'orch', 'statusline', 'junkd-tools', 'junkd-lessons'])
  await run$($, 'junkd')
  expect(w.closed.at(-1)).toBe('junkd-lessons')
  w.opened.length = 0
  await frame($, 'open', { pane: 'lessons' })
  expect(lessonsOpened(w)).toEqual([{ id: 'junkd-lessons', focus: true }])
  await frame($, 'open', { pane: 'lessons' })
  expect(w.closed.at(-1)).toBe('junkd-lessons')
  await expect(frame($, 'open', { pane: 'lessons', route: 'auto' })).rejects.toThrow(/the lessons pane has no tab auto/)
})

test('the segment\'s press opens the tab focused', async ($, on) => {
  const w = world(on)
  w.files[REPO_STORE] = `${head('L1', 'repo', 'smoke')}\nx\n`
  await start($)
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...HINT })
  await ui.press({ key: 'junkd-lessons' })
  expect(lessonsOpened(w)).toEqual([{ id: 'junkd-lessons', focus: true }])
  await ui.unmount()
})

for (const options of [{ orch_lessons: false }, { orch_enabled: false }]) {
  test(`off (${JSON.stringify(options)}): no segment, no dialog, no line, no tab; /junkd:lessons says so; the stores untouched`, { ...W_, options }, async ($, on) => {
    const w = world(on)
    orchProject(w)
    const before = { ...w.files }
    await start($)
    expect(lessonsOpened(w)).toEqual([])
    expect(await hintText($)).not.toContain('📒')
    await turnEnd($, 'BACKLOG: DRAINED — no `todo` tasks remain')
    expect(lessonsOpened(w)).toEqual([])
    await submit($)
    expect(lastContext(w)).toEqual([])
    expect((await run$($, 'junkd:lessons', 'promote L1')).text).toBe('junkd: the lessons loop is off: /junkd → orch → Lessons loop')
    await run$($, 'junkd')
    expect(w.opened.map(o => o.id)).not.toContain('junkd-lessons')
    expect(w.closed).not.toContain('junkd-lessons') // the set leaves the tab out: not even closed first
    await expect(frame($, 'open', { pane: 'lessons' })).rejects.toThrow(/lessons loop is off/)
    expect(w.cli).toEqual([])
    for (const [k, v] of Object.entries(before)) expect(w.files[k], k).toBe(v)
  })
}

test('the row by $.junkd.set: off closes the tab, drops the dialog and the segment, writes the flag file; on reads again and removes it', W_, async ($, on) => {
  const w = world(on)
  orchProject(w)
  await start($)
  expect(FLAG in w.files).toBe(false) // on: no flag (orchStart wrote none)
  expect(await frame($, 'set', { key: 'orch_lessons', value: 'off' })).toBe(false)
  expect(w.config.at(-1)).toEqual({ key: 'junkd.orch_lessons', value: false })
  expect(w.files[FLAG]).toBe('') // the flag file scripts/orch-context.sh reads while off
  expect(w.closed).toContain('junkd-lessons')
  expect(await hintText($)).not.toContain('📒')
  await submit($)
  expect(lastContext(w)).toEqual([])
  expect(await frame($, 'set', { key: 'orch_lessons', value: 'on' })).toBe(true)
  expect(FLAG in w.files).toBe(false)
  expect(await hintText($)).toContain('📒 2')
  expect(await frame($, 'get', { key: 'orch_lessons' })).toBe(true)
})

test('the row by the /config menu: each spelling of on and off, then applied', W_, async ($, on) => {
  const w = world(on)
  orchProject(w)
  await start($)
  for (const [value, want] of [[false, false], [true, true], ['off', false], ['true', true], ['no', false], ['on', true]] as const) {
    await frame($, 'config', { key: 'junkd.orch_lessons', value })
    expect(w.config.at(-1), String(value)).toEqual({ key: 'junkd.orch_lessons', value: want })
    expect(await frame($, 'get', { key: 'orch_lessons' }), String(value)).toBe(want)
    expect(FLAG in w.files, String(value)).toBe(!want)
    expect((await hintText($)).includes('📒 2'), String(value)).toBe(want)
  }
})

test('session start writes the flag file of a row stored off (the shell hook\'s fallback), and removes a stale one when on', { options: { orch_lessons: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.files[FLAG]).toBe('')
})
test('session start removes a stale flag file while the row is on', async ($, on) => {
  const w = world(on)
  w.files[FLAG] = ''
  await start($)
  expect(FLAG in w.files).toBe(false)
})

test('the ⚙ orch pane: the Lessons loop row on n flips orch_lessons', W_, async ($, on) => {
  const w = world(on)
  orchProject(w)
  await start($)
  await run$($, 'junkd:orch', 'panel')
  const ORCH = { component: 'Pane', requestId: 'orch', props: { title: 'orch', isFocused: true, bodyColumns: 140, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} } } as const
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', ...ORCH } as never)
  expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toContain('Lessons loop')
  const row = (await ui.findAll({ type: 'Button' })).find(b => b.key === 'orch:lessons')!
  expect(row.props.hotkey).toBe('n')
  await ui.press({ key: 'orch:lessons' })
  expect(w.config.at(-1)).toEqual({ key: 'junkd.orch_lessons', value: false })
  expect(await frame($, 'get', { key: 'orch_lessons' })).toBe(false)
  await ui.press({ key: 'orch:lessons' })
  expect(w.config.at(-1)).toEqual({ key: 'junkd.orch_lessons', value: true })
  await ui.unmount()
})
