// The orch dashboard: the `$`-free half (dashboard.ts: the task store's parsers, the phases, the merge, the status),
// then the whole module over a world in memory: /junkd:dashboard and /junkd:orch dashboard, the status.js they write
// (atomically, beside a copy of the page), the cadence while the `open` flag is there, the phases each spawn opens and
// its end closes, the history kept across a reload, the two settings rows and the orch pane's `dashboard: open ▸`.
// Nothing touches a real home: every fs, process and session call is answered by `world`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { AgentInfo, Args, On } from 'claude-code'
import {
  HOUR, MAX_EVENTS, buildStatus, columnOf, ctxText, isTaskFile, kindOf, mergePhases, openArgv, orchRoot, parseLessons, parseTask,
  parseVerification, readStatusJs, relTo, roleOf, shortModel, stateOf, statusJs, stepOf, taskOf, tasksDirOf,
  type Phase, type Status,
} from './dashboard.ts'
import { DASH_OFF } from './dashboard.tsx'

const CFG = '/fake/cfg'
const HOME = '/home/u'
const REPO = '/repo'
const HASH = 'abcd1234'
const DIR = `${CFG}/junkd/orch/dashboard/${HASH}`
const STATUS = `${DIR}/status.js`
const FLAG = `${DIR}/open`
const PAGE = `${DIR}/index.html`
const TASKS = `${REPO}/.orch/tasks`
const SID = 'sess-1'
const RECORDS = `${CFG}/junkd/orch/_agents/${SID}`
const T0 = 1_700_000_000_000
const SEC = 1000
// The plugin's root as the module sees it ($.plugin.root): this file's folder is its hooks/.
const ROOT = String((import.meta as unknown as { dir: string }).dir).replace(/\/hooks\/?$/, '')
const PAGE_SRC = `${ROOT}/skills/orch/dashboard`

const phase = (p: Partial<Phase> = {}): Phase => ({ agent: 'impl', model: 'opus', kind: 'implement', start: 100, end: 200, ctx: '—', ...p })

// the pure parts ----------------------------------------------------------------------------------------------------

test('parseTask: the frontmatter of a task file, CRLF as LF; no frontmatter or an unclosed one is no task', () => {
  const crlf = ['---', 'id: T3', 'title: "the CRLF one"', 'status: in_progress # a comment', 'deps: [T1, "T2"]', '---', 'body'].join('\r\n')
  expect(parseTask('T3.md', crlf)).toEqual({ id: 'T3', title: 'the CRLF one', status: 'in_progress', deps: ['T1', 'T2'] })
  // a block list, a missing id (the file's name) and a missing status (todo)
  expect(parseTask('T9.md', '---\ntitle: nine\ndeps:\n  - T1\n  - T4\n---\n')).toEqual({ id: 'T9', title: 'nine', status: 'todo', deps: ['T1', 'T4'] })
  expect(parseTask('T5.md', '---\nid: T5\ndeps: []\n---\n')).toEqual({ id: 'T5', title: '', status: 'todo', deps: [] })
  expect(parseTask('x.md', '# no frontmatter\nid: X\n')).toBe(undefined)
  expect(parseTask('x.md', '---\nid: X\nno close\n')).toBe(undefined)
  expect(parseTask('x.md', '')).toBe(undefined)
})

test('isTaskFile: *.md not starting with _; tasksDirOf: the config\'s tasks_dir under .orch/, else .orch/tasks', () => {
  expect(['T1.md', 'T10.MD', '_lessons.md', '_notes-T1.md', 'T1.template.html', 'README'].filter(isTaskFile)).toEqual(['T1.md', 'T10.MD'])
  expect(tasksDirOf('---\ntasks_dir: .orch/backlog/\n---')).toBe('.orch/backlog')
  expect(tasksDirOf('tasks_dir: ".orch/b" # mine\r\n')).toBe('.orch/b')
  for (const bad of ['tasks_dir: /etc', 'tasks_dir: .orch/../x', 'tasks_dir: tasks', '', undefined]) expect(tasksDirOf(bad), String(bad)).toBe('.orch/tasks')
})

const TABLE = (round: number, rows: string[]) =>
  [`## Verification round ${round}`, '', '| Criterion | Evidence | Verdict |', '|---|:--:|---|', ...rows, ''].join('\n')

test('parseVerification: the last round\'s table: AC and ACX counted apart, PASS passes, FAIL and PM-REVIEW named', () => {
  const text = [
    '# T17', '',
    TABLE(1, ['| AC1 gates | x | FAIL |', '| AC2 page | x | FAIL |']),
    TABLE(2, [
      '| AC1 gates green | log | PASS |',
      '| AC2 the page | shot | PASS (with note) |',
      '| AC3 live | — | PM-REVIEW |',
      '| AC4 zoom | test | FAIL: viewport |',
      '| ACX1 mutants | 5/5 | PASS |',
      '| ACX2 crlf | run | FAIL |',
      '| Standing: lint | run | PASS |', // neither AC nor ACX: not counted
    ]),
    '## Notes', '| Criterion | Verdict |', '| AC9 | FAIL |', // another section's table: not this round's
  ].join('\n')
  expect(parseVerification(text)).toEqual({ round: 2, ac: [2, 4], acx: [1, 2], note: 'round 2: FAIL: AC4, ACX2 · PM-REVIEW: AC3' })
  // CRLF, an Item header, the verdict column found by name, all passing: no note
  const crlf = ['## Verification round 3', '| Item | Verdict | Evidence |', '|-|-|-|', '| AC1 | PASS | a |', '| ACX1 | PASS | b |'].join('\r\n')
  expect(parseVerification(crlf)).toEqual({ round: 3, ac: [1, 1], acx: [1, 1] })
  // a round with no table: the round alone
  expect(parseVerification('## Verification round 1\nnothing yet\n')).toEqual({ round: 1 })
  expect(parseVerification('# no verification\n| Criterion | Verdict |\n| AC1 | PASS |\n')).toBe(undefined)
})

test('parseLessons: one lesson per `## T<n>` heading, its first sentence, newest first', () => {
  const text = '# Lessons\n\n## T1 (2026-10-01)\nFirst lesson. More text.\n\n## T2 (2026-10-02)\nA lesson\nover two lines! Then.\n\n## T3\n\n'
  expect(parseLessons(text)).toEqual([{ task: 'T2', text: 'A lesson over two lines!' }, { task: 'T1', text: 'First lesson.' }])
  expect(parseLessons('\r\n## T4 (d)\r\nNo period at all\r\n')).toEqual([{ task: 'T4', text: 'No period at all' }])
  expect(parseLessons('')).toEqual([])
})

test('orchRoot climbs out of a task worktree to the checkout with .orch; relTo draws a path inside the root relative', () => {
  const has = (d: string) => d === '/r'
  expect(orchRoot('/r/.worktrees/T1', has)).toBe('/r')
  expect(orchRoot('/r/.worktrees/orch/.worktrees/T1', has)).toBe('/r')
  expect(orchRoot('/x/.worktrees/T1', has)).toBe('/x/.worktrees/T1') // none has one: the toplevel itself
  expect(orchRoot('/r', has)).toBe('/r')
  expect(relTo('/r', '/r/.worktrees/T1')).toBe('.worktrees/T1')
  expect(relTo('/r/', '/r/a')).toBe('a')
  expect(relTo('/r', '/rr/a')).toBe('/rr/a')
  expect(relTo('', '/a')).toBe('/a')
})

test('kindOf: implementer implements, then fixes after a verify; reviewers verify; others by their words', () => {
  expect(kindOf('junkd:implementer', 'impl-T1', false)).toBe('implement')
  expect(kindOf('junkd:implementer', 'impl-T1 verify', true)).toBe('fix')
  expect(kindOf('junkd:lead-implementer', '', true)).toBe('fix')
  for (const r of ['verify-coordinator', 'ui-reviewer', 'test-planner', 'test-reviewer']) expect(kindOf(`junkd:${r}`, '', false), r).toBe('verify')
  expect(kindOf('general-purpose', 'review the diff', false)).toBe('verify')
  expect(kindOf('junkd:orch-ops', 'git push the branch', false)).toBe('done')
  expect(kindOf('junkd:orch-ops', 'open the PR', false)).toBe('done')
  expect(kindOf('general-purpose', 'write code', false)).toBe('implement')
  expect(kindOf('general-purpose', 'write code', true)).toBe('fix')
  expect(roleOf('junkd:implementer')).toBe('implementer')
  expect(roleOf('implementer')).toBe('implementer')
})

test('taskOf: a .worktrees/<id> folder first, then the earliest whole-word id in name, description, prompt', () => {
  const ids = ['T1', 'T12', 'T2']
  expect(taskOf(ids, { cwd: '/r/.worktrees/T2', name: 'impl-T1' })).toBe('T2')
  expect(taskOf(ids, { cwd: '/r/.worktrees/T2/', name: 'x' })).toBe('T2')
  expect(taskOf(ids, { cwd: '/r/.worktrees/T9', name: 'impl-T12' })).toBe('T12') // T12, not its prefix T1
  expect(taskOf(ids, { name: 'fix T2 then T1' })).toBe('T2')
  expect(taskOf(ids, { name: 'none', description: 'verify T1' })).toBe('T1')
  expect(taskOf(ids, { prompt: 'see T12a and T2' })).toBe('T2') // T12a is no whole word
  expect(taskOf(ids, { name: 'T3', prompt: '' })).toBe(undefined)
})

test('stateOf, shortModel, ctxText, stepOf', () => {
  expect((['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed', undefined] as const).map(stateOf)).toEqual(
    ['queued', 'running', 'waiting', 'waiting', 'done', 'dead', 'dead', 'running'])
  expect(['claude-opus-5-5', 'claude-haiku-5-5', 'Sonnet', 'gpt', ''].map(shortModel)).toEqual(['opus', 'haiku', 'sonnet', 'gpt', '—'])
  expect([undefined, NaN, 0, 999.6, 1000, 148_400].map(ctxText)).toEqual(['—', '—', '0', '1000', '1k', '148k'])
  expect(stepOf('Read', { file_path: '/a/b/c.ts' })).toBe('Read c.ts')
  expect(stepOf('Bash', { command: 'git   status\n-s' })).toBe('Bash git status -s')
  expect(stepOf('TodoWrite', {})).toBe('TodoWrite')
  expect(stepOf('Bash', { command: '  ', description: 'list' })).toBe('Bash list')
  const long = stepOf('Bash', { command: 'x'.repeat(200) })
  expect(long.length).toBe(80)
  expect(long.endsWith('…')).toBe(true)
})

test('mergePhases: the ones in memory win by agent and start, the ones read back are kept, start order', () => {
  const old1 = phase({ id: 'a1', start: 100, end: 150, open: true })
  const old2 = phase({ id: 'a0', agent: 'earlier', start: 50, end: 90 })
  const mine1 = phase({ id: 'a1', start: 100, end: 300, open: false })
  const mine2 = phase({ id: 'a2', start: 400 })
  expect(mergePhases([mine1, mine2], [old1, old2])).toEqual([old2, mine1, mine2])
  expect(mergePhases([], [old1])).toEqual([old1])
  // no id: keyed by agent name
  expect(mergePhases([phase({ agent: 'x', start: 1, end: 9 })], [phase({ agent: 'x', start: 1, end: 2 })])).toEqual([phase({ agent: 'x', start: 1, end: 9 })])
})

test('readStatusJs reads back what statusJs writes; anything else is undefined', () => {
  const s = buildStatus({ now: 5 * HOUR, windowH: 2, repo: 'r', branch: 'b', root: '', tasks: [], phases: {}, agents: [], events: [], lessons: [], usage: [] })
  expect(readStatusJs(statusJs(s))).toEqual(s)
  expect(statusJs(s).startsWith('window.ORCH = {')).toBe(true)
  expect(statusJs(s).endsWith('};\n')).toBe(true)
  for (const bad of [undefined, '', 'window.ORCH = {broken', 'var x = 1', 'window.ORCH = [1];', 'window.ORCH = null;']) expect(readStatusJs(bad), String(bad)).toBe(undefined)
  expect(readStatusJs('  window.ORCH = {"a":1}  ')).toEqual({ a: 1 } as never)
})

test('columnOf: the store\'s status; in_progress is verify while its last phase verifies', () => {
  expect(columnOf('done', [])).toBe('done')
  expect(columnOf(' Blocked ', [])).toBe('blocked')
  expect(columnOf('todo', [phase({ kind: 'verify' })])).toBe('todo')
  expect(columnOf('in_progress', [])).toBe('in_progress')
  expect(columnOf('in_progress', [phase({ kind: 'verify', start: 2 }), phase({ kind: 'fix', start: 3 })])).toBe('in_progress')
  expect(columnOf('in_progress', [phase({ kind: 'fix', start: 3 }), phase({ kind: 'verify', start: 4 })])).toBe('verify')
  expect(columnOf('verify', [])).toBe('verify')
  expect(columnOf('whatever', [])).toBe('todo')
})

test('buildStatus: the window ends now, open phases end now, implementer and verifier the latest of each, usage by kind', () => {
  const now = 100 * HOUR
  const s = buildStatus({
    now, windowH: 24, repo: 'r', branch: 'main', root: '/r',
    tasks: [
      { head: { id: 'T1', title: 'one', status: 'in_progress', deps: ['T0'] }, verdicts: { round: 2, ac: [3, 4], acx: [1, 2], note: 'round 2: FAIL: AC4' } },
      { head: { id: 'T2', title: 'two', status: 'todo', deps: [] } },
    ],
    phases: {
      T1: [
        phase({ agent: 'imp-a', kind: 'implement', start: 10, end: 20 }),
        phase({ agent: 'ver-a', kind: 'verify', start: 30, end: 40 }),
        phase({ agent: 'imp-b', kind: 'fix', start: 50, end: 50, open: true, id: 'x' }),
      ],
    },
    agents: [{ name: 'imp-b', role: 'implementer', model: 'opus', status: 'running', lastCallSec: 1, ctx: '1k', worktree: '.worktrees/T1' }],
    events: Array.from({ length: MAX_EVENTS + 5 }, (_, i) => ({ t: i, text: `e${i}`, kind: 'info' as const })),
    lessons: [{ task: 'T1', text: 'l.' }],
    usage: [{ kind: 'five_hour', percentUsed: 41.6 }, { kind: 'seven_day', percentUsed: 12.4 }, { kind: 'spend_limit', percentUsed: 99 }],
  })
  expect(s.window).toEqual({ start: now - 24 * HOUR, end: now })
  expect(s.generatedAt).toBe(now)
  expect(s.mock).toBe(false)
  expect(s.usage).toEqual({ fiveHour: 42, week: 12 })
  expect(s.events.length).toBe(MAX_EVENTS)
  const [t1, t2] = s.tasks
  expect(t1).toMatchObject({ id: 'T1', column: 'in_progress', round: 2, ac: [3, 4], acx: [1, 2], note: 'round 2: FAIL: AC4', deps: ['T0'], implementer: 'imp-b', verifier: 'ver-a', worktree: '.worktrees/T1', lastActivity: now })
  expect(t1!.phases!.at(-1)!.end).toBe(now)
  expect(t2).toEqual({ id: 'T2', title: 'two', column: 'todo' })
})

test('openArgv: open on macOS, xdg-open elsewhere', () => {
  expect(openArgv('Darwin\n', '/p/index.html')).toEqual(['open', '/p/index.html'])
  expect(openArgv('Linux', '/p/index.html')).toEqual(['xdg-open', '/p/index.html'])
  expect(openArgv('', '/p/index.html')).toEqual(['xdg-open', '/p/index.html'])
})

// the module --------------------------------------------------------------------------------------------------------

type Opts = { os?: string; cwd?: string; top?: Record<string, string> }
type Fail = { mv?: boolean; open?: 'exit' | 'deny'; hash?: boolean; list?: boolean }
type Rec = ReturnType<typeof world>
const TASK = (id: string, status: string, more = '') => `---\nid: ${id}\ntitle: task ${id}\nstatus: ${status}\ndeps: []\n---\n${more}`

function world(on: On, o: Opts = {}) {
  mock.store(on)
  mock.env(on, { CLAUDE_CONFIG_DIR: CFG, HOME })
  const clock = mock.clock(on, { now: T0 })
  const files: Record<string, string> = {
    [`${PAGE_SRC}/orch-dashboard.html`]: '<html>the page</html>',
    [`${PAGE_SRC}/scale.js`]: '// the scale',
    [`${REPO}/.orch/config.md`]: '---\ntasks_dir: .orch/tasks\n---\n',
    [`${TASKS}/T1.md`]: TASK('T1', 'done'),
    [`${TASKS}/T2.md`]: TASK('T2', 'in_progress', TABLE(2, ['| AC1 a | x | PASS |', '| AC2 b | x | PM-REVIEW |', '| ACX1 c | x | FAIL |'])).replace(/\n/g, '\r\n'),
    [`${TASKS}/T3.md`]: TASK('T3', 'todo'),
    [`${TASKS}/T10.md`]: TASK('T10', 'blocked'),
    [`${TASKS}/notes.md`]: '# no frontmatter here\n',
    [`${TASKS}/_notes-T2.md`]: TASK('NOTE', 'todo'),
    [`${TASKS}/_lessons.md`]: '## T1 (2026-10-01)\nAlways pin the model. More.\n',
  }
  const rec = {
    clock,
    files,
    writes: [] as string[], // fs.write paths in order
    runs: [] as string[][],
    toasts: [] as string[],
    opened: [] as string[], // ui.open ids
    config: [] as { key: string; value: unknown }[],
    agents: [] as AgentInfo[],
    cwd: o.cwd ?? REPO,
    top: o.top ?? { [REPO]: REPO } as Record<string, string>,
    branch: 'task/T19-dashboard',
    nextAgent: 'a1',
    spawnModel: 'claude-haiku-5-5',
    rateLimits: [{ kind: 'five_hour', percentUsed: 41.6 }, { kind: 'seven_day', percentUsed: 12 }],
    fail: {} as Fail,
  }
  const done = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  const isDir = (p: string) => Object.keys(files).some(f => f.startsWith(`${p.replace(/\/+$/, '')}/`))
  on('fs.read', (_$, e) => {
    if (!(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: files[e.path]! }
  })
  on('fs.write', (_$, e) => {
    rec.writes.push(e.path)
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: e.path in files || isDir(e.path) }))
  on('fs.stat', (_$, e) => ({ value: { kind: isDir(e.path) ? ('dir' as const) : ('file' as const), size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.list', (_$, e) => {
    if (rec.fail.list && e.path === TASKS) throw new Error('EACCES')
    const base = `${e.path.replace(/\/+$/, '')}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const f of Object.keys(files)) {
      if (!f.startsWith(base)) continue
      const rest = f.slice(base.length)
      const [head, ...more] = rest.split('/')
      names.set(head!, more.length ? 'dir' : 'file')
    }
    if (!names.size && !(e.path in files)) throw new Error(`ENOENT ${e.path}`)
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, isLink: false, mtimeMs: 0 })) }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    rec.runs.push(argv)
    if (argv[0] === 'bash' && argv[2]?.includes('jd_hash8')) return rec.fail.hash ? done('', 1) : done(`${HASH}\n`)
    if (argv[0] === 'git' && argv.includes('--show-toplevel')) {
      const top = rec.top[argv[2]!]
      return top === undefined ? done('', 128) : done(`${top}\n`)
    }
    if (argv[0] === 'git' && argv.includes('--abbrev-ref')) return done(`${rec.branch}\n`)
    if (argv[0] === 'git') return done('', 128)
    if (argv[0] === 'uname') return done(`${o.os ?? 'Darwin'}\n`)
    if (argv[0] === 'sh') return done('\n')
    if (argv[0] === 'mv') {
      if (rec.fail.mv) return done('', 1)
      const [from, to] = argv.slice(-2) as [string, string]
      files[to] = files[from]!
      delete files[from]
      return done()
    }
    if (argv[0] === 'rm') {
      delete files[argv.at(-1)!]
      return done()
    }
    if (argv[0] === 'open' || argv[0] === 'xdg-open') {
      if (rec.fail.open === 'deny') return { deny: 'spawn failed' } as never
      return done('', rec.fail.open === 'exit' ? 1 : 0)
    }
    return done()
  })
  on('ui.open', (_$, e) => {
    rec.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] as never }))
  on('ui.focus', () => ({}))
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] as never }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, ev) => ({ sessionId: ev.sessionId }))
  on('session.cwd', () => ({ value: rec.cwd }))
  on('session.id', () => ({ value: SID }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { breakdown: { mcpTools: [] } }, rateLimits: rec.rateLimits } as never }))
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('agent.list', () => ({ value: rec.agents }))
  on('agent.spawn', (_$, e) => ({ model: e.model ?? rec.spawnModel, agentId: rec.nextAgent }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('command.run', (_$, e) => ({ text: `ran ${e.command}` }))
  on('classic.SubagentStop', () => ({}))
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  return rec
}

const start = ($: Engine, cwd = REPO) => $.session.start({ cwd, surface: 'terminal', isInteractive: true })
const composer = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
const run = ($: Engine, command: string, args = '') => $.command.run({ command, args, ...composer }) as Promise<{ text?: string }>
const dash = ($: Engine, args = '') => run($, 'junkd:dashboard', args)
const turnEnd = ($: Engine) => $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const spawn = ($: Engine, e: Partial<Args<'agent.spawn'>> = {}) =>
  $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'd', subagentType: 'junkd:implementer', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: true, fork: false, ...e })
const stop = ($: Engine, id: string, type = 'junkd:implementer') =>
  $.classic.SubagentStop({ agent_id: id, agent_type: type, agent_transcript_path: `/t/${id}.jsonl`, stop_hook_active: false })
const status = (rec: Rec): Status => {
  const s = readStatusJs(rec.files[STATUS])
  expect(s, 'status.js parses').toBeDefined()
  return s as Status
}
const task = (rec: Rec, id: string) => status(rec).tasks.find(t => t.id === id)
const statusWrites = (rec: Rec) => rec.runs.filter(r => r[0] === 'mv' && r.at(-1) === STATUS).length
const record = (tokens: number) => `${JSON.stringify({ type: 'junkd:implementer', tokens })}\n`

test('/junkd:dashboard: the flag, the page copied, status.js from the task store, `open` on macOS, the path toasted', async ($, on) => {
  const rec = world(on)
  await start($)
  expect(rec.files[STATUS]).toBe(undefined) // nothing before an open
  expect(await dash($)).toEqual({})
  expect(FLAG in rec.files).toBe(true)
  expect(rec.files[PAGE]).toBe('<html>the page</html>')
  expect(rec.files[`${DIR}/scale.js`]).toBe('// the scale')
  const s = status(rec)
  expect(s).toMatchObject({ mock: false, generatedAt: T0, repo: 'repo', branch: 'task/T19-dashboard', window: { start: T0 - 24 * HOUR, end: T0 }, usage: { fiveHour: 42, week: 12 } })
  // T1..T10 in id order; the file without frontmatter and the _notes file are no tasks
  expect(s.tasks.map(t => [t.id, t.column])).toEqual([['T1', 'done'], ['T2', 'in_progress'], ['T3', 'todo'], ['T10', 'blocked']])
  // the CRLF file's last table: round 2, AC 1 of 2, ACX 0 of 1, FAIL and PM-REVIEW named
  expect(task(rec, 'T2')).toMatchObject({ round: 2, ac: [1, 2], acx: [0, 1], note: 'round 2: FAIL: ACX1 · PM-REVIEW: AC2' })
  expect(task(rec, 'T3')!.round).toBe(undefined)
  expect(s.lessons).toEqual([{ task: 'T1', text: 'Always pin the model.' }])
  expect(rec.runs.find(r => r[0] === 'open')).toEqual(['open', PAGE])
  expect(rec.runs.some(r => r[0] === 'xdg-open')).toBe(false)
  expect(rec.toasts).toEqual([`✓ dashboard: ${PAGE}`])
  // this is no pane: nothing opened through ui.open
  expect(rec.opened).toEqual([])
})

test('the write is atomic: status.js.tmp then mv, no .tmp left; a refused mv writes the file whole and removes the .tmp', async ($, on) => {
  const rec = world(on)
  await start($)
  await dash($)
  expect(rec.writes.filter(p => p.startsWith(`${STATUS}`))).toEqual([`${STATUS}.tmp`]) // never status.js itself
  expect(rec.runs.find(r => r[0] === 'mv')).toEqual(['mv', '-f', `${STATUS}.tmp`, STATUS])
  expect(`${STATUS}.tmp` in rec.files).toBe(false)
  expect(status(rec).generatedAt).toBe(T0)
  rec.fail.mv = true
  await rec.clock.advance(30 * SEC)
  await rec.clock.settle()
  expect(rec.writes.slice(-2)).toEqual([`${STATUS}.tmp`, STATUS])
  expect(rec.runs.at(-1)).toEqual(['rm', '-f', `${STATUS}.tmp`])
  expect(`${STATUS}.tmp` in rec.files).toBe(false)
  expect(status(rec).generatedAt).toBe(T0 + 30 * SEC)
})

test('xdg-open off macOS; an open that fails or is refused toasts the path to open by hand', async ($, on) => {
  const rec = world(on, { os: 'Linux' })
  await start($)
  await dash($)
  expect(rec.runs.find(r => r[0] === 'xdg-open')).toEqual(['xdg-open', PAGE])
  expect(rec.runs.some(r => r[0] === 'open')).toBe(false)
  expect(rec.toasts).toEqual([`✓ dashboard: ${PAGE}`])
  rec.fail.open = 'exit'
  await dash($, 'open')
  expect(rec.toasts.at(-1)).toBe(`dashboard: open ${PAGE} in a browser`)
  rec.fail.open = 'deny'
  await dash($)
  expect(rec.toasts.at(-1)).toBe(`dashboard: open ${PAGE} in a browser`)
  expect(status(rec).tasks.length).toBe(4) // status.js written all the same
})

test('a session in no repo uses _none, with no hash asked for', async ($, on) => {
  const rec = world(on, { top: {} })
  await start($)
  expect(await dash($)).toEqual({})
  const none = `${CFG}/junkd/orch/dashboard/_none`
  expect(`${none}/open` in rec.files).toBe(true)
  const s = readStatusJs(rec.files[`${none}/status.js`])!
  expect(s.tasks).toEqual([])
  expect(s.branch).toBe('')
  expect(rec.runs.some(r => r[0] === 'bash')).toBe(false) // no hash asked for _none
})

test('a hash that cannot be made: the answer says so, nothing written', async ($, on) => {
  const rec = world(on)
  rec.fail.hash = true
  await start($)
  expect((await dash($)).text).toMatch(/could not be hashed/)
  expect(Object.keys(rec.files).some(f => f.startsWith(`${CFG}/junkd/orch/dashboard`))).toBe(false)
})

test('in a task worktree: the store is the enclosing checkout\'s, the folder is the worktree\'s own hash', async ($, on) => {
  const WT = `${REPO}/.worktrees/T2`
  const rec = world(on, { cwd: WT, top: { [WT]: WT } })
  await start($, WT)
  await dash($)
  expect(rec.runs.find(r => r[0] === 'bash')!.at(-1)).toBe(WT)
  expect(status(rec).tasks.map(t => t.id)).toEqual(['T1', 'T2', 'T3', 'T10'])
  expect(status(rec).repo).toBe('repo')
})

test('a task store that cannot be listed is an empty board, still written', async ($, on) => {
  const rec = world(on)
  rec.fail.list = true
  await start($)
  await dash($)
  expect(status(rec).tasks).toEqual([])
  expect(status(rec).lessons).toEqual([{ task: 'T1', text: 'Always pin the model.' }])
})

test('the cadence: every 30 s while open, a turn\'s end writes too; close removes the flag and stops both', async ($, on) => {
  const rec = world(on)
  await start($)
  await turnEnd($)
  expect(statusWrites(rec)).toBe(0) // not open: a turn end writes nothing
  await dash($)
  expect(statusWrites(rec)).toBe(1)
  await rec.clock.advance(30 * SEC - 1)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(1)
  await rec.clock.advance(1)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(2)
  expect(status(rec).generatedAt).toBe(T0 + 30 * SEC)
  await turnEnd($)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(3)
  expect(await dash($, 'close')).toEqual({})
  expect(FLAG in rec.files).toBe(false)
  expect(rec.toasts.at(-1)).toBe('dashboard: closed, status.js is no longer written')
  await rec.clock.advance(10 * 60 * SEC)
  await rec.clock.settle()
  await turnEnd($)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(3)
  expect(STATUS in rec.files).toBe(true) // the page keeps its last data
})

test('a flag left by an earlier session starts the cadence at session start; session.end stops the timer, a turn end restarts it', async ($, on) => {
  const rec = world(on)
  rec.files[FLAG] = ''
  await start($)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(1)
  await rec.clock.advance(30 * SEC)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(2)
  await $.session.end({ sessionId: SID, reason: 'other' } as never)
  await rec.clock.advance(60 * SEC)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(2)
  await turnEnd($)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(3)
  await rec.clock.advance(30 * SEC)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(4)
})

test('the flag removed by hand (bin/orch-status, another session): the next tick writes nothing and stops', async ($, on) => {
  const rec = world(on)
  await start($)
  await dash($)
  delete rec.files[FLAG]
  await rec.clock.advance(30 * SEC)
  await rec.clock.settle()
  rec.files[FLAG] = '' // back: the stopped timer does not see it
  await rec.clock.advance(5 * 60 * SEC)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(1)
})

for (const [raw, ms] of [[1, 5], [5, 5], [6, 6], [600, 600], [601, 600], [12.4, 12]] as const)
  test(`orch_dashboard_refresh ${raw} in the options: a write every ${ms} s`, { options: { orch_dashboard_refresh: raw } }, async ($, on) => {
    const rec = world(on)
    await start($)
    await dash($)
    await rec.clock.advance(ms * SEC - 1)
    await rec.clock.settle()
    expect(statusWrites(rec)).toBe(1)
    await rec.clock.advance(1)
    await rec.clock.settle()
    expect(statusWrites(rec)).toBe(2)
  })

// (a string in the options is the engine's to refuse at load: userConfig types the row a number)
for (const [raw, h] of [[-3, 1], [0, 1], [1, 1], [2, 2], [2.6, 3], [168, 168], [500, 168]] as const)
  test(`orch_dashboard_window_h ${raw} in the options: the window is the last ${h} h`, { options: { orch_dashboard_window_h: raw } }, async ($, on) => {
    const rec = world(on)
    await start($)
    await dash($)
    expect(status(rec).window).toEqual({ start: T0 - h * HOUR, end: T0 })
  })

// Another plugin beside junkd: `/frame config <json>` is the /config menu's own path ($.config.set), `/frame set` and
// `/frame get` $.junkd's.
const FRAME: Plugin = {
  name: 'frame',
  register(on) {
    on('command.run', { command: 'frame' }, async ($, e) => {
      const [method = '', ...rest] = e.args.trim().split(/\s+/)
      const input = rest.length ? JSON.parse(rest.join(' ')) : undefined
      try {
        if (method === 'config') return { text: JSON.stringify({ ok: await $.config.set(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.junkd.set(input) }) }
        if (method === 'get') return { text: JSON.stringify({ ok: await $.junkd.get(input) }) }
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
async function frame($: Engine, method: string, input?: unknown): Promise<unknown> {
  const r = await run($, 'frame', input === undefined ? method : `${method} ${JSON.stringify(input)}`)
  const out = JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}

test('the /config menu, one assertion per spelling: refresh and window clamped and rounded, a non-number refused', W, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const [raw, stored] of [[4, 5], [5, 5], ['30', 30], [' 45 ', 45], [600, 600], [601, 600], [9.6, 10]] as const) {
    const r = (await frame($, 'config', { key: 'junkd.orch_dashboard_refresh', value: raw })) as { value?: unknown }
    expect(r.value, JSON.stringify(raw)).toBe(stored)
    expect(rec.config.at(-1), JSON.stringify(raw)).toEqual({ key: 'junkd.orch_dashboard_refresh', value: stored })
    expect(await frame($, 'get', { key: 'orch_dashboard_refresh' }), JSON.stringify(raw)).toBe(stored)
  }
  for (const [raw, stored] of [[0, 1], [1, 1], ['12', 12], [168, 168], [169, 168]] as const) {
    const r = (await frame($, 'config', { key: 'junkd.orch_dashboard_window_h', value: raw })) as { value?: unknown }
    expect(r.value, JSON.stringify(raw)).toBe(stored)
    expect(await frame($, 'get', { key: 'orch_dashboard_window_h' }), JSON.stringify(raw)).toBe(stored)
  }
  for (const bad of ['soon', '', true]) {
    const r = (await frame($, 'config', { key: 'junkd.orch_dashboard_refresh', value: bad })) as { deny?: string }
    expect(r.deny, JSON.stringify(bad)).toMatch(/is not a valid dashboard_refresh \(a number, 5–600\)/)
  }
  expect(await frame($, 'get', { key: 'orch_dashboard_refresh' })).toBe(10)
  // $.junkd.set takes the same values
  expect(await frame($, 'set', { key: 'orch_dashboard_window_h', value: 1000 })).toBe(168)
})

test('a new refresh through the /config menu retimes the running timer', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await dash($)
  await frame($, 'config', { key: 'junkd.orch_dashboard_refresh', value: 5 })
  await rec.clock.advance(5 * SEC)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(2)
  await rec.clock.advance(5 * SEC)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(3)
})

test('the window through the /config menu reaches the next write', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await dash($)
  await frame($, 'config', { key: 'junkd.orch_dashboard_window_h', value: 2 })
  await turnEnd($)
  await rec.clock.settle()
  expect(status(rec).window).toEqual({ start: T0 - 2 * HOUR, end: T0 })
})

test('orch_enabled off: /junkd:dashboard says so and writes nothing; spawns and turns write nothing either', { options: { orch_enabled: false } }, async ($, on) => {
  const rec = world(on)
  rec.files[FLAG] = '' // even with a flag left on disk
  await start($)
  expect(await dash($)).toEqual({ text: DASH_OFF })
  expect(await run($, 'junkd:orch', 'dashboard')).toEqual({ text: DASH_OFF })
  await spawn($, { name: 'impl-T3' })
  await turnEnd($)
  await rec.clock.advance(10 * 60 * SEC)
  await rec.clock.settle()
  expect(STATUS in rec.files).toBe(false)
  expect(rec.writes.filter(p => p.startsWith(DIR))).toEqual([])
  expect(rec.runs.some(r => r[0] === 'open')).toBe(false)
})

test('orch_enabled turned off through the /config menu stops the writes at the next tick', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await dash($)
  await frame($, 'config', { key: 'junkd.orch_enabled', value: false })
  await rec.clock.advance(5 * 60 * SEC)
  await rec.clock.settle()
  await turnEnd($)
  await rec.clock.settle()
  expect(statusWrites(rec)).toBe(1)
})

test('/junkd:orch dashboard and dashboard close take /junkd:dashboard\'s path; a bad argument is the usage', async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await run($, 'junkd:orch', ' Dashboard ')).toEqual({})
  expect(FLAG in rec.files).toBe(true)
  expect(rec.runs.filter(r => r[0] === 'open').length).toBe(1)
  expect(await run($, 'junkd:orch', 'dashboard open')).toEqual({})
  expect(rec.runs.filter(r => r[0] === 'open').length).toBe(2)
  expect(await run($, 'junkd:orch', 'dashboard close')).toEqual({})
  expect(FLAG in rec.files).toBe(false)
  expect((await run($, 'junkd:orch', 'dashboards')).text).toBe('ran junkd:orch') // no mode of the module's: the skill
  expect(await dash($, 'nope')).toEqual({ text: 'junkd: /junkd:dashboard takes nothing (open) or close' })
  expect(await dash($, 'CLOSE')).toEqual({})
})

test('phases: a spawn opens one on its task (implement), a SubagentStop closes it with the context; a verifier verifies, the next implementer fixes', async ($, on) => {
  const rec = world(on)
  await start($)
  await dash($)
  rec.nextAgent = 'imp1'
  rec.agents = [{ id: 'imp1', type: 'junkd:implementer', name: 'impl-T3', description: 'T3', status: 'running' }]
  await spawn($, { name: 'impl-T3', description: 'implement T3', model: 'opus' })
  let t3 = task(rec, 'T3')!
  expect(t3.phases).toEqual([{ agent: 'impl-T3', model: 'opus', kind: 'implement', start: T0, end: T0, ctx: '—', id: 'imp1', open: true }])
  expect(t3.implementer).toBe('impl-T3')
  expect(status(rec).events[0]).toEqual({ t: T0, text: 'impl-T3 started', kind: 'info' })
  // drawn live: an open phase ends at each write's time
  await rec.clock.advance(30 * SEC)
  await rec.clock.settle()
  expect(task(rec, 'T3')!.phases![0]!.end).toBe(T0 + 30 * SEC)
  // the SubagentStop record's tokens close it
  await rec.clock.advance(10 * SEC)
  rec.files['/t/imp1.jsonl'] = `${JSON.stringify({ message: { usage: { input_tokens: 148_400 } } })}\n` // orch.tsx reads the tokens there
  await stop($, 'imp1')
  t3 = task(rec, 'T3')!
  expect(t3.phases![0]).toMatchObject({ open: false, end: T0 + 40 * SEC, ctx: '148k' })
  expect(t3.phases![0]!.killed).toBe(undefined)
  expect(status(rec).events[0]).toEqual({ t: T0 + 40 * SEC, text: 'impl-T3 done', kind: 'info' })
  // a verify-coordinator on T3 verifies, and T3 in progress draws as verify while it does
  await rec.clock.advance(SEC)
  rec.nextAgent = 'ver1'
  rec.agents = [...rec.agents.map(a => ({ ...a, status: 'completed' as const })), { id: 'ver1', type: 'junkd:verify-coordinator', name: 'verify-T3', description: 'verify T3', status: 'running' }]
  await spawn($, { name: 'verify-T3', description: 'verify T3', subagentType: 'junkd:verify-coordinator' })
  t3 = task(rec, 'T3')!
  expect(t3.phases!.map(p => p.kind)).toEqual(['implement', 'verify'])
  expect(t3.verifier).toBe('verify-T3')
  // the agent list's `completed` ends it
  await rec.clock.advance(SEC)
  rec.agents = rec.agents.map(a => ({ ...a, status: 'completed' as const }))
  await turnEnd($)
  await rec.clock.settle()
  expect(task(rec, 'T3')!.phases![1]).toMatchObject({ open: false, end: T0 + 42 * SEC })
  // the next implementer on T3 fixes
  await rec.clock.advance(SEC)
  rec.nextAgent = 'imp2'
  rec.agents = [...rec.agents, { id: 'imp2', type: 'junkd:implementer', name: 'impl-T3-r2', description: 'fix T3', status: 'running' }]
  await spawn($, { name: 'impl-T3-r2', description: 'fix T3' })
  t3 = task(rec, 'T3')!
  expect(t3.phases!.map(p => [p.agent, p.kind, p.open])).toEqual([['impl-T3', 'implement', false], ['verify-T3', 'verify', false], ['impl-T3-r2', 'fix', true]])
  expect(t3.implementer).toBe('impl-T3-r2')
  expect(t3.lastActivity).toBe(T0 + 43 * SEC)
})

test('a killed agent: failed or killed in the list, or gone from it with no SubagentStop record, ends killed', async ($, on) => {
  const rec = world(on)
  await start($)
  await dash($)
  for (const [id, name] of [['k1', 'impl-T1'], ['k2', 'impl-T2'], ['k3', 'impl-T3'], ['k4', 'impl-T10']] as const) {
    rec.nextAgent = id
    rec.agents = [...rec.agents, { id, type: 'junkd:implementer', name, description: name, status: 'running' }]
    await spawn($, { name, description: name })
  }
  await rec.clock.advance(SEC)
  rec.files[`${RECORDS}/k4.json`] = record(10)
  rec.agents = [
    { id: 'k1', type: 'junkd:implementer', name: 'impl-T1', description: '', status: 'failed' },
    { id: 'k2', type: 'junkd:implementer', name: 'impl-T2', description: '', status: 'killed' },
    // k3 and k4 gone; k4 left its record
  ]
  await turnEnd($)
  await rec.clock.settle()
  const p = (id: string) => task(rec, id)!.phases![0]!
  expect(p('T1')).toMatchObject({ open: false, killed: true, note: 'killed', end: T0 + SEC })
  expect(p('T2')).toMatchObject({ open: false, killed: true, note: 'killed' })
  expect(p('T3')).toMatchObject({ open: false, killed: true, note: 'killed' })
  expect(p('T10')).toMatchObject({ open: false })
  expect(p('T10').killed).toBe(undefined)
  const agents = status(rec).agents
  expect(agents.find(a => a.name === 'impl-T3')).toMatchObject({ status: 'dead', deadNote: 'no SubagentStop record' })
  expect(agents.find(a => a.name === 'impl-T10')).toMatchObject({ status: 'done' })
  expect(agents.find(a => a.name === 'impl-T1')!.status).toBe('dead')
  const texts = status(rec).events.map(e => `${e.kind} ${e.text}`)
  expect(texts).toContain('fail impl-T1 failed')
  expect(texts).toContain('fail impl-T2 killed')
  expect(texts).toContain('fail impl-T3 dead: no SubagentStop record')
  expect(texts).toContain('info impl-T10 done')
})

test('a spawn before the dashboard opened is placed at the open, closed where it already ended; one naming no task is no phase', async ($, on) => {
  const rec = world(on)
  await start($)
  rec.nextAgent = 'early'
  rec.agents = [{ id: 'early', type: 'junkd:implementer', name: 'impl-T2', description: '', status: 'running' }]
  await spawn($, { name: 'impl-T2', cwd: `${REPO}/.worktrees/T2` })
  rec.nextAgent = 'loose'
  rec.agents = [...rec.agents, { id: 'loose', type: 'general-purpose', name: 'scout', description: '', status: 'running' }]
  await spawn($, { name: 'scout', description: 'look around', subagentType: 'general-purpose', model: 'haiku' })
  await rec.clock.advance(5 * SEC)
  await stop($, 'early')
  expect(STATUS in rec.files).toBe(false)
  await rec.clock.advance(5 * SEC)
  await dash($)
  expect(task(rec, 'T2')!.phases).toEqual([{ agent: 'impl-T2', model: 'haiku', kind: 'implement', start: T0, end: T0 + 5 * SEC, ctx: '—', id: 'early', open: false }])
  expect(status(rec).tasks.flatMap(t => t.phases ?? []).map(p => p.agent)).toEqual(['impl-T2'])
  const scout = status(rec).agents.find(a => a.name === 'scout')!
  expect(scout).toMatchObject({ role: 'general-purpose', model: 'haiku', status: 'running', lastCallSec: null, ctx: '—' })
  expect(scout.task).toBe(undefined)
  const early = status(rec).agents.find(a => a.name === 'impl-T2')!
  expect(early).toMatchObject({ task: 'T2', round: 2, worktree: '.worktrees/T2' })
})

test('history across a reload: the phases, events and agents of the status.js on disk are kept and merged', async ($, on) => {
  const rec = world(on)
  const before: Partial<Status> = {
    tasks: [
      { id: 'T1', title: 'old', column: 'done', phases: [phase({ agent: 'impl-T1', id: 'old1', start: T0 - HOUR, end: T0 - HOUR / 2 })] },
      { id: 'T3', title: 'old', column: 'in_progress', phases: [phase({ agent: 'impl-T3', id: 'gone1', start: T0 - 600 * SEC, end: T0 - 300 * SEC, open: true })] },
      { id: 'T99', title: 'removed from the store', column: 'todo', phases: [phase({ start: 1 })] },
    ] as never,
    events: [{ t: T0 - HOUR, text: 'impl-T1 done', kind: 'info' }],
    agents: [
      { id: 'old1', name: 'impl-T1', role: 'implementer', model: 'opus', status: 'done', lastCallSec: 5, ctx: '90k' },
      { id: 'gone1', name: 'impl-T3', role: 'implementer', model: 'opus', status: 'running', lastCallSec: 1, ctx: '12k' },
      { id: 'rec1', name: 'ver-T1', role: 'verify-coordinator', model: 'opus', status: 'running', lastCallSec: 1, ctx: '3k' },
    ],
  }
  rec.files[STATUS] = `window.ORCH = ${JSON.stringify(before)};\n`
  rec.files[`${RECORDS}/rec1.json`] = record(3000)
  await start($)
  await dash($)
  expect(task(rec, 'T1')!.phases).toEqual([phase({ agent: 'impl-T1', id: 'old1', start: T0 - HOUR, end: T0 - HOUR / 2 })])
  // the open phase of an agent this module never saw, and the list does not have: closed, killed (no record)
  expect(task(rec, 'T3')!.phases![0]).toMatchObject({ open: false, killed: true, end: T0 })
  expect(status(rec).tasks.some(t => t.id === 'T99')).toBe(false)
  expect(status(rec).events).toContainEqual({ t: T0 - HOUR, text: 'impl-T1 done', kind: 'info' })
  const agents = status(rec).agents
  expect(agents.find(a => a.name === 'impl-T1')).toMatchObject({ status: 'done', ctx: '90k' })
  expect(agents.find(a => a.name === 'impl-T3')).toMatchObject({ status: 'dead', deadNote: 'gone across a reload, no SubagentStop record' })
  expect(agents.find(a => a.name === 'ver-T1')!.status).toBe('done')
  // a new spawn adds to the kept history
  rec.nextAgent = 'n1'
  rec.agents = [{ id: 'n1', type: 'junkd:implementer', name: 'impl-T1-r2', description: '', status: 'running' }]
  await spawn($, { name: 'impl-T1-r2' })
  expect(task(rec, 'T1')!.phases!.map(p => p.agent)).toEqual(['impl-T1', 'impl-T1-r2'])
  expect(task(rec, 'T1')!.phases![1]!.kind).toBe('implement')
})

test('a status.js that does not parse is no history: the board is rebuilt', async ($, on) => {
  const rec = world(on)
  rec.files[STATUS] = 'window.ORCH = {broken'
  await start($)
  await dash($)
  expect(status(rec).tasks.length).toBe(4)
  expect(status(rec).tasks.every(t => t.phases === undefined)).toBe(true)
})

test('a subagent\'s tool calls: its last step, its last call\'s age and its events; the main loop\'s calls are no agent\'s', async ($, on) => {
  const rec = world(on)
  await start($)
  await dash($)
  rec.nextAgent = 's1'
  rec.agents = [{ id: 's1', type: 'junkd:implementer', name: 'impl-T3', description: '', status: 'running' }]
  await spawn($, { name: 'impl-T3', cwd: `${REPO}/.worktrees/T3` })
  await $.tool.call({ tool: 'Read', file_path: '/x/y/plan.md', agentId: 's1' } as never)
  await rec.clock.advance(7 * SEC)
  await $.tool.call({ tool: 'Bash', command: 'bun test', agentId: 's1' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'main-loop' } as never)
  await rec.clock.advance(3 * SEC)
  await turnEnd($)
  await rec.clock.settle()
  const a = status(rec).agents.find(x => x.id === 's1')!
  expect(a).toMatchObject({ lastStep: 'Bash bun test', lastCallSec: 3, task: 'T3', branch: 'task/T19-dashboard', worktree: '.worktrees/T3' })
  expect(a.events).toEqual([{ t: T0 + 7 * SEC, text: 'Bash bun test', kind: 'info' }, { t: T0, text: 'Read plan.md', kind: 'info' }])
  expect(status(rec).agents.length).toBe(1)
})

test('the orch pane\'s `dashboard: open ▸` takes the same open path', async ($, on) => {
  const rec = world(on)
  await start($)
  await run($, 'junkd:orch', 'panel')
  const ui = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', component: 'Pane', requestId: 'orch', props: { title: 'orch', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as never)
  try {
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('dashboard:')
    const b = await ui.find({ type: 'Button', key: 'orch:dashboard' })
    expect(b?.props.label).toBe('open ▸')
    await ui.press({ key: 'orch:dashboard' })
    await rec.clock.settle()
  } finally {
    await ui.unmount()
  }
  expect(FLAG in rec.files).toBe(true)
  expect(rec.runs.find(r => r[0] === 'open')).toEqual(['open', PAGE])
  expect(rec.toasts).toContain(`✓ dashboard: ${PAGE}`)
  expect(status(rec).tasks.length).toBe(4)
})
