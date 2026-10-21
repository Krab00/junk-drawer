// junkd's tools group and pane: the pure parts of tools.ts (parser, tree, counters, MCP rows, coercion, the reveal
// command), then the whole module over a world in memory: what tool.call, command.run, agent.spawn and session.end
// count, the pane's four tabs, its poll, the settings rows (by `$.junkd.set` and by the /config menu) and the routes.
// Nothing touches a real home: every fs, process and session call is answered by `world`.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { AgentInfo, Args, ContextMcpTool, On } from 'claude-code'
import {
  activeOf, ago, approxTokens, buildTree, clampRefresh, coerce, countSkill, tallyTool, flatten, mcpRows, mcpSplitter, emptyCounters, readWorktrees, pickTranscript,
  projectFolder, revealCommand, splitMcp, tokens, toolRows,
} from './tools'

const CFG = '/fake/cfg'
const HOME = '/home/u'
const MAIN = '/repo'
const WT = '/repo/.worktrees/T17' // a worktree inside the main checkout, as the orchestrator makes them
const OTHER = '/elsewhere/feature x' // a worktree outside it, with a space in its path
const PANE_ID = 'junkd-tools'
const T0 = 1_000_000
const SURFACES = ['terminal', 'desktop'] as const

const PORCELAIN = [
  `worktree ${MAIN}`, 'HEAD aaa', 'branch refs/heads/main', '',
  `worktree ${WT}`, 'HEAD bbb', 'branch refs/heads/task/T17-tools-pane', '',
  `worktree ${OTHER}`, 'HEAD ccc', 'detached', '',
].join('\n')

const agent = (id: string, status: AgentInfo['status'], more: Partial<AgentInfo> = {}): AgentInfo => ({ id, description: `task ${id}`, type: 'general-purpose', status, ...more })
const mcpTool = (name: string, serverName: string, tokens: number, isLoaded = true): ContextMcpTool => ({ name, serverName, tokens, isLoaded })

// the pure parts ----------------------------------------------------------------------------------------------------

test('the porcelain parser: the main checkout first, a branch without refs/heads/, detached, bare, a path with spaces, CRLF', () => {
  expect(readWorktrees(PORCELAIN)).toEqual([
    { path: MAIN, branch: 'main' },
    { path: WT, branch: 'task/T17-tools-pane' },
    { path: OTHER, branch: 'detached' },
  ])
  const bare = ['worktree /srv/repo.git', 'bare', '', 'worktree /srv/wt one', 'HEAD 1', 'branch refs/heads/x', ''].join('\r\n')
  expect(readWorktrees(bare)).toEqual([{ path: '/srv/repo.git', branch: 'bare' }, { path: '/srv/wt one', branch: 'x' }])
  // a detached block whose HEAD line mentions no branch, and a block with neither: no branch word
  expect(readWorktrees('worktree /a\nHEAD 1\ndetached\n\nworktree /b\nHEAD 2\n')).toEqual([{ path: '/a', branch: 'detached' }, { path: '/b', branch: '' }])
  expect(readWorktrees('')).toEqual([])
  expect(readWorktrees('fatal: not a git repository')).toEqual([])
})

test('the tree: each agent under the deepest worktree its cwd is in, the rest under the root; agents_only hides empty worktrees', () => {
  const trees = readWorktrees(PORCELAIN)
  const agents = [agent('a1', 'running', { name: 'scout' }), agent('a2', 'completed'), agent('a3', 'waiting'), agent('a4', 'idle')]
  const spawned = {
    a1: { model: 'claude-haiku-5-5', cwd: WT },
    a2: { model: 'claude-opus-5-5', cwd: `${WT}/plugins/junkd` }, // a subfolder of the worktree
    a3: { model: 'sonnet', cwd: '/tmp/nowhere' }, // in no worktree
    // a4: spawned before the module loaded, no cwd known
  }
  const root = buildTree(trees, agents, spawned, false)
  expect(root).toMatchObject({ id: 'root', kind: 'root', label: 'repo', branch: 'main' })
  expect(root.children.map(n => n.id)).toEqual(['agent:a3', 'agent:a4', `wt:${WT}`, `wt:${OTHER}`])
  const wt = root.children[2]!
  expect(wt).toMatchObject({ kind: 'worktree', label: 'T17', branch: 'task/T17-tools-pane' })
  expect(wt.children.map(n => [n.label, n.model, n.status, n.type])).toEqual([
    ['scout', 'haiku', 'running', 'general-purpose'],
    ['task a2', 'opus', 'done', 'general-purpose'],
  ])
  expect(root.children[0]).toMatchObject({ label: 'task a3', model: 'sonnet', status: 'waiting' })
  expect(root.children[1]).toMatchObject({ label: 'task a4', model: undefined, status: 'waiting' })
  expect(root.children[3]).toMatchObject({ label: 'feature x', branch: 'detached', children: [] })
  // the worktree's own path, exactly, is in it; a sibling path that only starts alike is not
  const exact = buildTree(trees, [agent('b1', 'running'), agent('b2', 'running')], { b1: { model: 'm', cwd: WT }, b2: { model: 'm', cwd: `${WT}-2` } }, false)
  expect(exact.children.find(n => n.id === `wt:${WT}`)!.children.map(n => n.id)).toEqual(['agent:b1'])
  expect(exact.children[0]!.id).toBe('agent:b2')

  const only = buildTree(trees, agents, spawned, true)
  expect(only.children.map(n => n.id)).toEqual(['agent:a3', 'agent:a4', `wt:${WT}`])
  expect(buildTree(trees, [], {}, true).children).toEqual([]) // the root stays with nothing under it
  // no worktree listed (no repo): an empty root
  expect(buildTree([], [agent('c1', 'running')], {}, false)).toMatchObject({ label: '', children: [{ id: 'agent:c1' }] })
})

test('flatten draws the guides and leaves out a folded node\'s children', () => {
  const root = buildTree(readWorktrees(PORCELAIN), [agent('a1', 'running')], { a1: { model: 'haiku', cwd: WT } }, false)
  const rows = flatten(root, {})
  expect(rows.map(r => `${r.guide}${r.node.id}`)).toEqual(['root', `├─ wt:${WT}`, '│  └─ agent:a1', `└─ wt:${OTHER}`])
  expect(flatten(root, { [`wt:${WT}`]: true }).map(r => r.node.id)).toEqual(['root', `wt:${WT}`, `wt:${OTHER}`])
  expect(flatten(root, { root: true }).map(r => r.node.id)).toEqual(['root'])
})

test('counters: per tool, main loop and subagent apart, result chars summed; prototype-free names', () => {
  const c = emptyCounters()
  tallyTool(c, 'Read', false, 40)
  tallyTool(c, 'Read', true, 8)
  tallyTool(c, 'Read', false, 0)
  tallyTool(c, 'constructor', true, 4)
  tallyTool(c, '__proto__', false, 4)
  expect({ ...c.tools.Read }).toEqual({ main: 2, sub: 1, chars: 48 })
  expect({ ...c.tools.constructor }).toEqual({ main: 0, sub: 1, chars: 4 })
  expect(Object.keys(c.tools)).toEqual(['Read', 'constructor', '__proto__'])
  expect(Object.getPrototypeOf(c.tools)).toBe(null)
  expect(Object.getPrototypeOf(c.skills)).toBe(null)
})

test('skills: a run by slash and by the Skill tool within 2 s is one; the same way twice, or later, is two', () => {
  const c = emptyCounters()
  countSkill(c, 'junkd:tldr', 'slash', 0)
  countSkill(c, 'junkd:tldr', 'tool', 1999) // the model's Skill call of the typed run
  expect({ ...c.skills['junkd:tldr'] }).toEqual({ via: 'slash', count: 1, last: 0 })
  countSkill(c, 'junkd:tldr', 'tool', 2000) // at 2 s: another run
  expect({ ...c.skills['junkd:tldr'] }).toEqual({ via: 'tool', count: 2, last: 2000 })
  countSkill(c, 'junkd:tldr', 'tool', 2001) // the same way: always another
  expect(c.skills['junkd:tldr']!.count).toBe(3)
  countSkill(c, '__proto__', 'tool', 5)
  expect(c.skills.__proto__!.count).toBe(1)
})

test('MCP: tools fold into one row per server, split by the schemas\' wire names; servers called first', () => {
  const schema = [
    mcpTool('mcp__linear__get_issue', 'linear', 300),
    mcpTool('mcp__linear__save_issue', 'linear', 500, false),
    mcpTool('mcp__my_srv__go', 'my srv', 120), // a space on the wire is `_`
    mcpTool('mcp__my__x', 'my', 50), // a shorter server whose wire name the other starts with
    mcpTool('mcp__quiet__t', 'quiet', 70),
  ]
  const split = mcpSplitter(schema)
  expect(split('mcp__my_srv__go')).toEqual({ server: 'my srv', tool: 'go' })
  expect(split('mcp__my__x')).toEqual({ server: 'my', tool: 'x' })
  expect(split('mcp__unlisted__a__b')).toEqual({ server: 'unlisted', tool: 'a__b' })
  expect(split('Read')).toBe(null)
  const c = emptyCounters()
  tallyTool(c, 'mcp__linear__get_issue', false, 400)
  tallyTool(c, 'mcp__linear__get_issue', true, 400)
  tallyTool(c, 'mcp__my_srv__go', false, 40)
  tallyTool(c, 'mcp__unlisted__z', false, 4)
  tallyTool(c, 'Read', false, 4)
  expect(mcpRows(c.tools, schema)).toEqual([
    { server: 'linear', calls: 2, loaded: 1, all: 2, schemaTokens: 300, chars: 800 },
    { server: 'my srv', calls: 1, loaded: 1, all: 1, schemaTokens: 120, chars: 40 },
    { server: 'unlisted', calls: 1, loaded: 0, all: 0, schemaTokens: 0, chars: 4 },
    { server: 'my', calls: 0, loaded: 1, all: 1, schemaTokens: 50, chars: 0 },
    { server: 'quiet', calls: 0, loaded: 1, all: 1, schemaTokens: 70, chars: 0 },
  ])
  expect(toolRows(c.tools, schema)).toEqual([
    { name: 'mcp (3 servers)', main: 3, sub: 1, chars: 844, servers: 3 },
    { name: 'Read', main: 1, sub: 0, chars: 4 },
  ])
  const one = emptyCounters()
  tallyTool(one, 'mcp__linear__get_issue', false, 4)
  expect(toolRows(one.tools, schema)[0]!.name).toBe('mcp (1 server)')
  expect(mcpRows(emptyCounters().tools, [])).toEqual([])
})

test('refresh: clamped to 10-600 seconds, rounded; a non-number is refused; the switches take true, "true" and "on"', () => {
  expect([9, 10, 10.4, 11, 599, 600, 601, -5, 9999].map(clampRefresh)).toEqual([10, 10, 10, 11, 599, 600, 600, 10, 600])
  expect(coerce('refresh', '45')).toEqual({ value: 45 })
  expect(coerce('refresh', 5)).toEqual({ value: 10 })
  for (const bad of ['abc', '', ' ', true, false, null, undefined, NaN, Infinity]) expect(coerce('refresh', bad).error, String(bad)).toMatch(/is not a valid refresh/)
  for (const on of [true, 'true', 'on']) expect(coerce('enabled', on), String(on)).toEqual({ value: true })
  for (const off of [false, 'false', 'off', 'yes', 1]) expect(coerce('agents_only', off), String(off)).toEqual({ value: false })
})

test('the reveal command and the transcript: Finder on macOS, the folder elsewhere; the session\'s own file, else the newest', () => {
  expect(revealCommand('Darwin', '/c/projects/-r/s1.jsonl')).toEqual(['open', '-R', '/c/projects/-r/s1.jsonl'])
  expect(revealCommand('Linux', '/c/projects/-r/s1.jsonl')).toEqual(['xdg-open', '/c/projects/-r'])
  expect(revealCommand('', '/s1.jsonl')).toEqual(['xdg-open', '/'])
  expect(projectFolder('/Users/k/My Repo/.worktrees/T17')).toBe('-Users-k-My-Repo--worktrees-T17')
  const file = (name: string, mtimeMs: number, kind = 'file') => ({ name, kind, mtimeMs })
  const entries = [file('old.jsonl', 1), file('s1.jsonl', 2), file('new.jsonl', 9), file('newest.txt', 99), file('dir.jsonl', 100, 'dir')]
  expect(pickTranscript(entries, 's1')).toBe('s1.jsonl')
  expect(pickTranscript(entries, 'gone')).toBe('new.jsonl')
  expect(pickTranscript([], 's1')).toBe(undefined)
})

test('ago: now, seconds, minutes, hours, days', () => {
  expect([0, 4999, 5000, 59_999, 60_000, 3 * 60_000 + 5, 3_600_000, 86_400_000 * 2].map(ms => ago(0, ms))).toEqual(
    ['now', 'now', '5 s ago', '59 s ago', '1 m ago', '3 m ago', '1 h ago', '2 d ago'])
  expect(ago(10, 0)).toBe('now') // a clock that went back
})

// the module --------------------------------------------------------------------------------------------------------

// The module's own state is not this file's to read (the engine loads its own copy): everything below is seen the way
// the person sees it, in the pane, or in what the module asked of the world.

type Opts = {
  porcelain?: string
  gitExit?: number
  agents?: AgentInfo[]
  mcp?: ContextMcpTool[]
  os?: string
  revealExit?: number
  sessionId?: string
  transcripts?: { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }[]
  commands?: { name: string; source: string }[]
  env?: Record<string, string> // in place of CLAUDE_CONFIG_DIR and HOME
  shellHome?: string // what `sh -c 'echo $HOME'` prints
  cfgDir?: string // where the transcripts live, when env moves it from CFG
  revealStderr?: string // what a failing open prints
}
// A world call that is refused (the reason a fixed text, or for `open` the switch's) while its switch is on.
type Fail = { agents?: boolean; usage?: boolean; cwd?: boolean; git?: boolean; panes?: boolean; uname?: boolean; reveal?: boolean; open?: string }
type Rec = ReturnType<typeof world>
function world(on: On, o: Opts = {}) {
  mock.store(on)
  mock.env(on, o.env ?? { CLAUDE_CONFIG_DIR: CFG, HOME })
  const clock = mock.clock(on, { now: T0 })
  const rec = {
    clock,
    panes: [] as string[], // open, in open order
    opened: [] as { id: string; focus?: boolean }[],
    closed: [] as string[],
    runs: [] as string[][],
    toasts: [] as string[],
    config: [] as { key: string; value: unknown }[],
    agents: o.agents ?? ([] as AgentInfo[]),
    mcp: o.mcp ?? ([] as ContextMcpTool[]),
    porcelain: o.porcelain ?? PORCELAIN,
    gitExit: o.gitExit ?? 0,
    cwd: WT,
    nextAgent: 'a1',
    spawnModel: 'claude-haiku-5-5',
    hold: undefined as Promise<void> | undefined, // agent.list waits on it while set
    files: {} as Record<string, string>,
    asked: 0, // ui.panes queries: a poll tick asks before it loads
    fail: {} as Fail,
    log: [] as string[], // ui.open and ui.close in call order, `ui.open <id>[ focus]`
    commands: o.commands ?? [],
    gates: [] as Promise<void>[], // each agent.list in turn waits on the next, answering the agents of its call's time
  }
  const done = (stdout = '', exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('ui.open', (_$, e) => {
    if (rec.fail.open !== undefined) return { deny: rec.fail.open } as never
    rec.log.push(`ui.open ${e.id}${e.focus ? ' focus' : ''}`)
    rec.opened.push({ id: e.id, focus: e.focus })
    if (!rec.panes.includes(e.id)) rec.panes.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_$, e) => { rec.log.push(`ui.close ${e.id}`); rec.closed.push(e.id); rec.panes = rec.panes.filter(p => p !== e.id); return { value: undefined } })
  on('ui.panes', () => {
    rec.asked++
    if (rec.fail.panes) return { deny: 'panes unreadable' } as never
    return { value: rec.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) as never }
  })
  on('ui.focus', () => ({}))
  on('ui.toast', (_$, e) => { rec.toasts.push(e.text); return { value: undefined } })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: rec.commands.map(c => ({ description: '', ...c })) as never }))
  on('config.set', (_$, e) => { rec.config.push({ key: e.key, value: e.value }); return { value: e.value } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, ev) => ({ sessionId: ev.sessionId }))
  on('session.cwd', () => {
    if (rec.fail.cwd) return { deny: 'no cwd' } as never
    return { value: rec.cwd }
  })
  on('session.id', () => ({ value: o.sessionId ?? 's1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => {
    if (rec.fail.usage) return { deny: 'no usage' } as never
    return { value: { startedAt: 0, context: { breakdown: { mcpTools: rec.mcp } } } as never }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('agent.list', async () => {
    const gate = rec.gates.shift()
    const then = rec.agents
    if (gate) await gate
    else await rec.hold
    if (rec.fail.agents) return { deny: 'agents unreadable' } as never
    return { value: gate ? then : rec.agents }
  })
  on('agent.spawn', (_$, e) => ({ model: e.model ?? rec.spawnModel, agentId: rec.nextAgent }))
  on('tool.call', (_$, e) => ((e as { noText?: boolean }).noText ? { result: 'ok' } : { result: 'ok', text: (e as { answer?: string }).answer ?? 'twelve chars' }))
  on('command.run', (_$, e) => ({ text: `ran ${e.command}` }))
  on('fs.list', (_$, e) => {
    if (e.path !== `${o.cfgDir ?? CFG}/projects/${projectFolder(rec.cwd)}`) throw new Error(`ENOENT ${e.path}`)
    return { value: (o.transcripts ?? []).map(t => ({ size: 1, isLink: false, ...t })) }
  })
  on('fs.exists', (_$, e) => ({ value: e.path in rec.files }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('fs.read', (_$, e) => {
    if (!(e.path in rec.files)) throw new Error(`ENOENT ${e.path}`)
    return { value: rec.files[e.path]! }
  })
  on('fs.write', (_$, e) => { rec.files[e.path] = e.text; return { value: undefined } })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    rec.runs.push(argv)
    if (argv[0] === 'git' && argv.includes('worktree')) {
      if (rec.fail.git) return { deny: 'git: no such file' } as never
      return done(rec.porcelain, rec.gitExit)
    }
    if (argv[0] === 'git') return done('', 128)
    if (argv[0] === 'uname') {
      if (rec.fail.uname) return { deny: 'uname: not found' } as never
      return done(`${o.os ?? 'Darwin'}\n`)
    }
    if (argv[0] === 'sh') return done(`${o.shellHome ?? ''}\n`)
    if ((argv[0] === 'open' || argv[0] === 'xdg-open') && rec.fail.reveal) return { deny: 'spawn failed' } as never
    if (argv[0] === 'open' || argv[0] === 'xdg-open') return done('', o.revealExit ?? 0, o.revealExit ? (o.revealStderr ?? 'no such app') : '')
    if (argv[0] === 'rm') delete rec.files[argv.at(-1)!]
    return done()
  })
  // The engine's own drawing where the mod passes.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({ key: 'engine' }))
  return rec
}

const start = ($: Engine) => $.session.start({ cwd: WT, surface: 'terminal', isInteractive: true })
const composer = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }
const run = ($: Engine, command: string, args = '') => $.command.run({ command, args, ...composer }) as Promise<{ text?: string }>
const tools = ($: Engine, args = '') => run($, 'junkd:tools', args)
const turnEnd = ($: Engine, answer = 'a') => $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const gitRuns = (rec: Rec) => rec.runs.filter(r => r[0] === 'git' && r.includes('worktree')).length
const paneOf = (bodyColumns = 100) =>
  ({ component: 'Pane', requestId: PANE_ID, props: { title: 'tools', isFocused: true, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } }) as const
const mount = ($: Engine, surface: (typeof SURFACES)[number] = 'terminal', cols = 100) => $.ui.mount({ plugin: 'junkd', surface, ...paneOf(cols) })
type Mounted = Awaited<ReturnType<typeof mount>>
// The pane drawn once, for `fn` to read and press; unmounted after.
async function onPane<R>($: Engine, fn: (ui: Mounted) => Promise<R>, surface: (typeof SURFACES)[number] = 'terminal', cols = 100): Promise<R> {
  const ui = await mount($, surface, cols)
  try {
    return await fn(ui)
  } finally {
    await ui.unmount()
  }
}
const lines = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).map(t => t.text)
const linesOf = ($: Engine) => onPane($, lines)
// The table row of `name` (its cells after the two-space indent), on whichever tab is drawn.
const rowOf = async (ui: Mounted, name: string) => (await lines(ui)).find(l => l.startsWith(`  ${name} `) || l === `  ${name}`)
const activeTab = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).find(t => t.props.inverse)?.text
const nodeText = async (ui: Mounted, id: string) => (await ui.find({ type: 'Button', key: `node:${id}` }))?.text
const nodeKeys = async (ui: Mounted) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('node:'))
const MINUTE = 60_000
const pickedRows = async (ui: Mounted) => (await ui.findAll({ type: 'Box' })).filter(b => b.props.backgroundColor === 'userMessageBackground').map(b => b.key)
const spawn = ($: Engine, e: Partial<Args<'agent.spawn'>> = {}) =>
  $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'd', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'opus', background: true, fork: false, ...e })
// A model's call: on the main loop, or a subagent's with its loop's agentId (which $.tool.call's type leaves out).
const mainCall = (tool: string, more: Record<string, unknown> = {}) => ({ tool, ...more }) as unknown as Parameters<Engine['tool']['call']>[0]
const sub = (tool: string, agentId: string, more: Record<string, unknown> = {}) => mainCall(tool, { agentId, ...more })

// A caller plugin beside junkd: `/frame <method> [json]` calls `$.junkd.<method>`, `$.config.set` for `config` (the
// /config menu's own path), `$.tool.call` for `tool` (another plugin's call), `$.ui.close` for `close` (the person's
// ×, as another plugin's close reaches the pane's hook), and answers what came back. A turn whose answer is
// `run <command>` makes it run that command as a plugin's `$.command.run` (a command.run hook may not).
const FRAME: Plugin = {
  name: 'frame',
  register(on) {
    on('command.run', { command: 'frame' }, async ($, e) => {
      const [method = '', ...rest] = e.args.trim().split(/\s+/)
      const input = rest.length ? JSON.parse(rest.join(' ')) : undefined
      try {
        if (method === 'get') return { text: JSON.stringify({ ok: await $.junkd.get(input) }) }
        if (method === 'set') return { text: JSON.stringify({ ok: await $.junkd.set(input) }) }
        if (method === 'open') return { text: JSON.stringify({ ok: (await $.junkd.open(input)) ?? null }) }
        if (method === 'config') return { text: JSON.stringify({ ok: await $.config.set(input) }) }
        if (method === 'tool') return { text: JSON.stringify({ ok: await $.tool.call(input) }) }
        if (method === 'close') return { text: JSON.stringify({ ok: (await $.ui.close(input)) ?? null }) }
        return { text: JSON.stringify({ error: `no method ${method}` }) }
      } catch (err) {
        return { text: JSON.stringify({ error: String((err as Error).message ?? err) }) }
      }
    })
    on('turn.complete', async ($, e, next) => {
      const m = /^run (\S+)$/.exec(String((e as { answer?: string }).answer ?? ''))
      if (m) await $.command.run({ command: m[1]!, args: '' })
      return next(e)
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
const W = { plugins: [HOST, FRAME] }
async function frame($: Engine, method: string, input?: unknown): Promise<unknown> {
  const r = await run($, 'frame', input === undefined ? method : `${method} ${JSON.stringify(input)}`)
  const out = JSON.parse(r.text ?? '{}') as { ok?: unknown; error?: string }
  if (out.error !== undefined) throw new Error(out.error)
  return out.ok
}

test('tool.call: the model\'s calls counted per tool, main loop and subagents apart, ≈tokens from the result text', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await $.tool.call(mainCall('Read', { answer: 'x'.repeat(400) }))
  await $.tool.call(mainCall('Read'))
  await $.tool.call(sub('Read', 'a1', { answer: 'y'.repeat(4000) }))
  await $.tool.call(sub('Bash', 'a1'))
  await $.tool.call(sub('Bash', 'a2'))
  await $.tool.call(mainCall('constructor'))
  await frame($, 'tool', { tool: 'Grep', pattern: 'x' }) // another plugin's $.tool.call: no call of the model's
  await tools($, 'tools')
  for (const surface of SURFACES)
    await onPane($, async ui => {
      const text = await lines(ui)
      expect(await rowOf(ui, 'tool')).toMatch(/^ {2}tool\s+main\s+sub\s+≈tokens$/)
      expect(await rowOf(ui, 'Read')).toMatch(/\s2\s+1\s+1\.1k$/) // (400 + 12 + 4000) / 4
      expect(await rowOf(ui, 'Bash')).toMatch(/\s0\s+2\s+6$/)
      expect(await rowOf(ui, 'constructor')).toMatch(/\s1\s+0\s+3$/)
      expect(await rowOf(ui, 'Grep')).toBe(undefined)
      // most calls first
      expect(text.findIndex(l => l.startsWith('  Read '))).toBeLessThan(text.findIndex(l => l.startsWith('  Bash ')))
      expect(text.findIndex(l => l.startsWith('  Bash '))).toBeLessThan(text.findIndex(l => l.startsWith('  constructor ')))
      expect(text).toContain('6 calls · 3 rows · ≈tokens = result chars ÷ 4 · reset on /clear')
    }, surface)
  expect(rec.toasts).toEqual([])
})

// A plugin beneath junkd that refuses every Write, as a permission hook does.
const DENIER: Plugin = { name: 'denier', tier: 'append', register(on) { on('tool.call', { tool: 'Write' }, () => ({ deny: 'no' })) } }

test('a refused call is not counted; with tools off nothing is, and turning it off drops what was counted', { plugins: [HOST, FRAME, DENIER] }, async ($, on) => {
  world(on)
  await start($)
  await $.tool.call(mainCall('Write', { file_path: '/x', content: '' }))
  await $.tool.call(mainCall('Read'))
  await tools($, 'tools')
  await onPane($, async ui => {
    expect(await rowOf(ui, 'Read')).toMatch(/\s1\s+0\s+3$/)
    expect(await rowOf(ui, 'Write')).toBe(undefined)
  })
  await frame($, 'set', { key: 'tools_enabled', value: false })
  await $.tool.call(mainCall('Read'))
  await $.tool.call(mainCall('Skill', { skill: 'junkd:tldr' }))
  await frame($, 'set', { key: 'tools_enabled', value: true })
  await tools($, 'tools')
  expect(await linesOf($)).toContain('  no tool call yet')
  await tools($, 'skills')
  expect(await linesOf($)).toContain('  no skill run yet')
})

test('MCP: the Tools tab folds them into one row with a hint; the MCP tab has one row per server from the usage summary', W, async ($, on) => {
  const mcp = [mcpTool('mcp__linear__get_issue', 'linear', 1200), mcpTool('mcp__linear__save', 'linear', 800, false), mcpTool('mcp__idle__t', 'idle', 30)]
  world(on, { mcp })
  await start($)
  await $.tool.call(mainCall('mcp__linear__get_issue', { answer: 'z'.repeat(80) }))
  await $.tool.call(sub('mcp__linear__get_issue', 'a1'))
  await $.tool.call(mainCall('mcp__github__pr'))
  await tools($, 'tools')
  for (const surface of SURFACES)
    await onPane($, async ui => {
      const text = await lines(ui)
      expect(text.find(l => l.includes('mcp ('))).toMatch(/^ {2}mcp \(2 servers\)\s+2\s+1\s+26$/) // (80 + 12 + 12) / 4
      expect(text).toContain('    each server on the MCP tab (3)')
      expect(text.some(l => l.includes('get_issue') || l.includes('github'))).toBe(false)
      await ui.press({ key: 'tab-mcp' })
      expect(await activeTab(ui)).toBe(' 3 MCP ')
      expect(await rowOf(ui, 'server')).toMatch(/server\s+calls\s+tools\s+schema\s+result$/)
      expect(await rowOf(ui, 'linear')).toMatch(/linear\s+2\s+1\/2\s+1\.2k\s+23$/)
      expect(await rowOf(ui, 'github')).toMatch(/github\s+1\s+0\/0\s+-\s+3$/)
      expect(await rowOf(ui, 'idle')).toMatch(/idle\s+0\s+1\/1\s+30\s+-$/)
      const text3 = await lines(ui)
      expect(text3.indexOf(await rowOf(ui, 'github') as string)).toBeLessThan(text3.indexOf(await rowOf(ui, 'idle') as string))
      await ui.press({ key: 'tab-tools' })
    }, surface)
})

test('every tab, empty: one line says so', W, async ($, on) => {
  world(on)
  await start($)
  await tools($)
  await onPane($, async ui => {
    expect(await lines(ui)).toContain('  no agent spawned this session')
    await ui.press({ key: 'tab-tools' })
    expect(await lines(ui)).toContain('  no tool call yet')
    await ui.press({ key: 'tab-mcp' })
    expect(await lines(ui)).toContain('  no MCP server')
    await ui.press({ key: 'tab-skills' })
    expect(await lines(ui)).toContain('  no skill run yet')
  })
})

test('skills: the Skill tool and a slash run of a plugin\'s or the person\'s skill; not a built-in, a plugin\'s run, or the toggles', W, async ($, on) => {
  const commands = [
    { name: 'junkd:tldr', source: 'plugin' }, { name: 'mine', source: 'user' }, { name: 'compact', source: 'builtin' },
    { name: 'srv:prompt', source: 'mcp' }, { name: 'junkd:tools', source: 'plugin' }, { name: 'junkd:junkd', source: 'plugin' },
    { name: 'plugged', source: 'plugin' },
  ]
  const rec = world(on, { commands })
  await start($)
  await run($, 'junkd:tldr', '3')
  await rec.clock.advance(MINUTE)
  await run($, 'mine')
  await run($, 'mine')
  await run($, 'compact')
  await run($, 'srv:prompt')
  await turnEnd($, 'run plugged') // a plugin's $.command.run
  await run($, 'junkd:junkd')
  await run($, 'junkd:junkd')
  await $.tool.call(mainCall('Skill', { skill: 'junkd:tldr' })) // 60 s after the typed run: another run
  await $.tool.call(sub('Skill', 'a1', { skill: 'review' }))
  await $.tool.call(mainCall('Skill', { skill: 42 })) // no name: a Skill call, no skill run
  await rec.clock.advance(3 * 60_000)
  await tools($, 'skills') // the toggle itself is no run; the open's load reads the clock `last` is drawn against
  await rec.clock.settle()
  await onPane($, async ui => {
    const text = await lines(ui)
    expect(await rowOf(ui, 'skill')).toMatch(/skill\s+via\s+count\s+last$/)
    expect(await rowOf(ui, 'junkd:tldr')).toMatch(/junkd:tldr\s+tool\s+2\s+3 m ago$/)
    expect(await rowOf(ui, 'mine')).toMatch(/mine\s+slash\s+2\s+3 m ago$/)
    expect(await rowOf(ui, 'review')).toMatch(/review\s+tool\s+1\s+3 m ago$/)
    for (const not of ['compact', 'srv:prompt', 'plugged', 'junkd:tools', 'junkd:junkd', '42']) expect(await rowOf(ui, not), not).toBe(undefined)
    expect(text).toContain('5 runs · 3 skills · via slash: typed, via tool: the model\'s Skill call · reset on /clear')
    await ui.press({ key: 'tab-tools' })
    expect(await rowOf(ui, 'Skill')).toMatch(/Skill\s+2\s+1\s+9$/)
  })
})

test('a /clear or /resume starts the counters over; another end does not; the folds and the tab stay', W, async ($, on) => {
  const rec = world(on, { agents: [agent('a1', 'running')] })
  await start($)
  await spawn($)
  await tools($)
  await rec.clock.settle()
  await onPane($, async ui => {
    await ui.press({ key: `node:wt:${WT}` }) // fold the worktree
    await ui.press({ key: 'tab-tools' })
  })
  for (const [reason, resets] of [['prompt_input_exit', false], ['other', false], ['logout', false], ['clear', true], ['resume', true]] as const) {
    await $.tool.call(mainCall('Read'))
    await $.tool.call(mainCall('Skill', { skill: 'x' }))
    await $.session.end({ reason, sessionId: 's1', resume: {} as never })
    await onPane($, async ui => {
      expect(await activeTab(ui), reason).toBe(' 2 Tools ')
      expect((await lines(ui)).includes('  no tool call yet'), reason).toBe(resets)
      await ui.press({ key: 'tab-skills' })
      expect((await lines(ui)).includes('  no skill run yet'), reason).toBe(resets)
      await ui.press({ key: 'tab-tools' })
    })
  }
  await rec.clock.settle()
  await onPane($, async ui => {
    await ui.press({ key: 'tab-agents' })
    expect(await nodeText(ui, `wt:${WT}`)).toBe('├─ ▸ T17  task/T17-tools-pane') // still folded
  })
})

test('agent.spawn records the model the agent got and its directory (the call\'s, else the session\'s); a refused spawn none', W, async ($, on) => {
  on('agent.spawn', { subagentType: 'nope' }, () => ({ deny: 'no such agent' }))
  const rec = world(on)
  await start($)
  rec.nextAgent = 'a1'
  await spawn($, { model: 'claude-haiku-5-5', name: 'scout' })
  rec.nextAgent = 'a2'
  rec.spawnModel = 'claude-opus-5-5'
  await spawn($, { cwd: OTHER })
  rec.nextAgent = 'a3'
  await spawn($, { subagentType: 'nope', cwd: WT })
  // the list knows neither the model nor the directory (nor the name, here): the tree has them from the spawn
  rec.agents = [agent('a1', 'running'), agent('a2', 'waiting', { type: 'Explore' }), agent('a3', 'running', { name: 'refused' })]
  await tools($)
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await nodeKeys(ui)).toEqual(['node:root', 'node:agent:a3', `node:wt:${WT}`, 'node:agent:a1', `node:wt:${OTHER}`, 'node:agent:a2'])
    expect(await nodeText(ui, 'agent:a1')).toBe('│  └─   ● scout  general-purpose  haiku')
    expect(await nodeText(ui, 'agent:a2')).toBe('   └─   ◐ task a2  Explore  opus')
    expect(await nodeText(ui, 'agent:a3')).toBe('├─   ● refused  general-purpose') // no spawn record: under the root, no model
  })
})

test('the Agents tab: the main checkout, its worktrees with their branches, each agent under its own with its glyph, legend', W, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const [id, cwd] of [['a1', WT], ['a2', WT], ['a3', '/tmp']] as const) {
    rec.nextAgent = id
    await spawn($, { cwd })
  }
  rec.agents = [agent('a1', 'running', { name: 'one' }), agent('a2', 'completed', { name: 'two' }), agent('a3', 'idle', { name: 'three' })]
  await tools($)
  await rec.clock.settle()
  for (const surface of SURFACES)
    await onPane($, async ui => {
      expect(await activeTab(ui)).toBe(' 1 Agents ')
      // the active agents only (a2 finished), and one footer line counting the finished
      expect(await nodeKeys(ui)).toEqual(['node:root', 'node:agent:a3', `node:wt:${WT}`, 'node:agent:a1', `node:wt:${OTHER}`])
      expect(await lines(ui)).toContain('  1 finished')
      expect(await nodeText(ui, 'root')).toBe('▾ repo  main')
      expect(await nodeText(ui, `wt:${WT}`)).toBe('├─ ▾ T17  task/T17-tools-pane')
      expect(await nodeText(ui, 'agent:a1')).toBe('│  └─   ● one  general-purpose  haiku')
      // a flips to all (a2 back, no footer), a again to active only
      await ui.press({ key: 'all' })
      expect(await nodeKeys(ui)).toEqual(['node:root', 'node:agent:a3', `node:wt:${WT}`, 'node:agent:a1', 'node:agent:a2', `node:wt:${OTHER}`])
      expect(await nodeText(ui, 'agent:a1')).toBe('│  ├─   ● one  general-purpose  haiku')
      expect(await nodeText(ui, 'agent:a2')).toBe('│  └─   ○ two  general-purpose  haiku  done')
      expect((await lines(ui)).some(l => l.includes('finished'))).toBe(false)
      expect(await lines(ui)).toContain(' active only') // the key hint says what a does next
      expect(await nodeText(ui, 'agent:a3')).toBe('├─   ◐ three  general-purpose  haiku')
      expect(await nodeText(ui, `wt:${OTHER}`)).toBe('└─   feature x  detached')
      // the glyphs in the theme's colours
      const glyph = async (g: string) => (await ui.findAll({ type: 'Text' })).find(t => t.text === `${g} `)?.props.color
      expect(await glyph('●')).toBe('success')
      expect(await glyph('◐')).toBe('warning')
      expect(await glyph('○')).toBe('inactive')
      const text = await lines(ui)
      expect(text).toContain('● running ◐ waiting ○ done · agents of this session only')
      for (const k of ['↑↓', 'enter', 'a', 'r', 't', '1-4', 'q']) expect(text, k).toContain(k)
      await ui.press({ key: 'all' }) // back to active only: the next surface starts there
      expect(await lines(ui)).toContain('  1 finished')
      expect(await lines(ui)).toContain(' all')
    }, surface)
})

test('active agents: running, pending, waiting and idle; the finished are completed, failed and killed', () => {
  const live = [agent('r', 'running'), agent('p', 'pending'), agent('w', 'waiting'), agent('i', 'idle')]
  const done = [agent('c', 'completed'), agent('f', 'failed'), agent('k', 'killed')]
  expect(activeOf([...live, ...done], false).map(a => a.id)).toEqual(['r', 'p', 'w', 'i'])
  expect(activeOf([...live, ...done], true).map(a => a.id)).toEqual(['r', 'p', 'w', 'i', 'c', 'f', 'k'])
  expect(activeOf([], false)).toEqual([])
})

test('3 active and 5 finished: the pane lists the 3 and counts 5 finished; a shows all 8, and stays on through a refresh and a tab switch; a stopped agent leaves within one refresh', W, async ($, on) => {
  const rec = world(on)
  await start($)
  const ids = ['a1', 'a2', 'a3', 'f1', 'f2', 'f3', 'f4', 'f5']
  for (const id of ids) {
    rec.nextAgent = id
    await spawn($, { cwd: WT })
  }
  const listed = (stopped: string[] = []) => [
    agent('a1', stopped.includes('a1') ? 'killed' : 'running', { name: 'one' }), agent('a2', 'waiting', { name: 'two' }), agent('a3', 'idle', { name: 'three' }),
    agent('f1', 'completed', { name: 'f-one' }), agent('f2', 'completed', { name: 'f-two' }), agent('f3', 'failed', { name: 'f-three' }), agent('f4', 'killed', { name: 'f-four' }),
    agent('f5', 'running', { name: 'f-five' }),
  ]
  rec.agents = listed()
  await tools($)
  await rec.clock.settle()
  rec.agents = listed().slice(0, 7) // f5 was listed running and the engine dropped it: finished too
  await onPane($, ui => ui.press({ key: 'refresh' }))
  await rec.clock.settle()
  const active = ['node:root', `node:wt:${WT}`, 'node:agent:a1', 'node:agent:a2', 'node:agent:a3', `node:wt:${OTHER}`]
  await onPane($, async ui => {
    expect(await nodeKeys(ui)).toEqual(active)
    expect(await lines(ui)).toContain('  5 finished')
    await ui.press({ key: 'all' })
    expect((await nodeKeys(ui)).filter(k => k.startsWith('node:agent:'))).toHaveLength(8)
    expect((await lines(ui)).some(l => l.includes('finished'))).toBe(false)
    await ui.press({ key: 'refresh' })
  })
  await rec.clock.settle()
  await onPane($, async ui => {
    expect((await nodeKeys(ui)).filter(k => k.startsWith('node:agent:'))).toHaveLength(8) // the refresh kept the toggle
    await ui.press({ key: 'tab-tools' })
    await ui.press({ key: 'tab-agents' })
    expect((await nodeKeys(ui)).filter(k => k.startsWith('node:agent:'))).toHaveLength(8) // so did the tab switch
    await ui.press({ key: 'all' })
  })
  rec.agents = listed(['a1']).slice(0, 7) // a1 is stopped (f5 still dropped)
  await onPane($, ui => ui.press({ key: 'refresh' }))
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await nodeKeys(ui)).toEqual(active.filter(k => k !== 'node:agent:a1'))
    expect(await lines(ui)).toContain('  6 finished')
  })
})

test('the Agents tab with agents_only: the empty worktrees are left out, the main checkout stays', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'set', { key: 'tools_agents_only', value: true })
  await tools($)
  await rec.clock.settle()
  await onPane($, async ui => expect(await nodeKeys(ui)).toEqual(['node:root']))
  rec.agents = [agent('a1', 'running')]
  await spawn($, { cwd: WT })
  await rec.clock.settle()
  await onPane($, async ui => expect(await nodeKeys(ui)).toEqual(['node:root', `node:wt:${WT}`, 'node:agent:a1']))
  await frame($, 'set', { key: 'tools_agents_only', value: false })
  await onPane($, async ui => expect(await nodeKeys(ui)).toEqual(['node:root', `node:wt:${WT}`, 'node:agent:a1', `node:wt:${OTHER}`]))
})

test('the agents_only option the engine fills in is read at load', { ...W, options: { tools_agents_only: true } }, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'get', { key: 'tools_agents_only' })).toBe(true)
})

test('an agent the engine dropped from its list stays, as done; outside a repo the session\'s folder is the root', W, async ($, on) => {
  const rec = world(on, { gitExit: 128, porcelain: '' })
  await start($)
  await spawn($)
  rec.agents = [agent('a1', 'running', { name: 'gone soon' })]
  await tools($)
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await nodeText(ui, 'root')).toBe('▾ T17')
    expect(await nodeText(ui, 'agent:a1')).toBe('└─   ● gone soon  general-purpose  haiku')
    rec.agents = []
    await ui.press({ key: 'refresh' })
  })
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await nodeText(ui, 'agent:a1')).toBeUndefined() // dropped from the list: finished, so off the active list
    expect(await lines(ui)).toContain('  no active agent') // the one agent seen has finished
    expect(await lines(ui)).toContain('  1 finished')
    await ui.press({ key: 'all' })
    expect(await nodeText(ui, 'agent:a1')).toBe('└─   ○ gone soon  general-purpose  haiku  done')
  })
})

test('the tree refreshes on every spawn and at every turn\'s end while open, never while closed', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await spawn($)
  await turnEnd($)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(0)
  await tools($)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(1) // the open
  rec.nextAgent = 'a2'
  rec.agents = [agent('a2', 'running', { name: 'new one' })]
  await spawn($)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(2)
  await onPane($, async ui => expect(await nodeText(ui, 'agent:a2')).toContain('● new one'))
  rec.agents = [agent('a2', 'completed', { name: 'new one' })]
  await turnEnd($)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(3)
  await onPane($, async ui => {
    expect(await nodeText(ui, 'agent:a2')).toBeUndefined() // finished: gone from the list within one refresh
    expect(await lines(ui)).toContain('  1 finished')
  })
})

test('reading… until the first load; then the tree', W, async ($, on) => {
  const rec = world(on)
  await start($)
  let release = () => {}
  rec.hold = new Promise<void>(r => { release = r })
  await tools($)
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await lines(ui)).toContain('  reading…')
    await ui.press({ key: 'tab-mcp' })
    expect(await lines(ui)).toContain('  reading…')
    await ui.press({ key: 'tab-tools' })
    expect(await lines(ui)).not.toContain('  reading…') // the counters need no load
    await ui.press({ key: 'tab-agents' })
  })
  release()
  rec.hold = undefined
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await lines(ui)).not.toContain('  reading…')
    expect(await nodeText(ui, 'root')).toBe('▾ repo  main')
  })
})

test('folds and the selection survive a refresh: Enter on a row folds it, the arrows (the focus ring) select, j/k move', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await spawn($, { cwd: WT })
  rec.agents = [agent('a1', 'running')]
  await tools($)
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await pickedRows(ui)).toEqual(['row-root']) // the first row until the person picks one
    await ui.press({ key: `node:wt:${WT}` })
  })
  const folded = async (ui: Mounted) => {
    expect(await nodeText(ui, `wt:${WT}`)).toBe('├─ ▸ T17  task/T17-tools-pane')
    expect(await nodeText(ui, 'agent:a1')).toBe(undefined)
    expect(await pickedRows(ui)).toEqual([`row-wt:${WT}`])
  }
  await onPane($, folded)
  await onPane($, ui => ui.press({ key: 'refresh' }))
  await rec.clock.advance(MINUTE) // and a poll tick
  await onPane($, folded)

  await onPane($, async ui => {
    // a leaf has nothing to fold: a press selects it
    await ui.press({ key: `node:wt:${OTHER}` })
    expect(await nodeText(ui, `wt:${OTHER}`)).toBe('└─   feature x  detached')
    expect(await pickedRows(ui)).toEqual([`row-wt:${OTHER}`])
    // the person's arrows move the ring: the row it lands on is the selection; a tab is no row
    await $.ui.focus({ component: 'Pane', requestId: PANE_ID, plugin: 'junkd', element: 'node:root', origin: { kind: 'person' } } as never)
    expect(await pickedRows(ui)).toEqual(['row-root'])
    await $.ui.focus({ component: 'Pane', requestId: PANE_ID, plugin: 'junkd', element: 'tab-mcp', origin: { kind: 'person' } } as never)
    expect(await pickedRows(ui)).toEqual(['row-root'])
    // j and k move the selection within the rows (and ask the ring along: the engine moves it only while the pane
    // holds the keys, which a mounted drawing does not)
    await ui.press({ key: 'down' })
    expect(await pickedRows(ui)).toEqual([`row-wt:${WT}`])
    await ui.press({ key: 'down' })
    await ui.press({ key: 'down' })
    expect(await pickedRows(ui)).toEqual([`row-wt:${OTHER}`])
    await ui.press({ key: 'up' })
    await ui.press({ key: 'up' })
    await ui.press({ key: 'up' })
    expect(await pickedRows(ui)).toEqual(['row-root'])
    // unfold: the agent's row comes back under it, the next row down
    await ui.press({ key: `node:wt:${WT}` })
    expect(await pickedRows(ui)).toEqual([`row-wt:${WT}`])
    await ui.press({ key: 'down' })
    expect(await pickedRows(ui)).toEqual(['row-agent:a1'])
    await ui.press({ key: 'down' })
    expect(await pickedRows(ui)).toEqual([`row-wt:${OTHER}`])
  })
  // the selected row gone from the tree (an empty worktree, now hidden): the selection lands on the row at its index,
  // or the last row when there is none that far down
  await frame($, 'set', { key: 'tools_agents_only', value: true })
  await onPane($, async ui => {
    expect(await nodeKeys(ui)).toEqual(['node:root', `node:wt:${WT}`, 'node:agent:a1'])
    expect(await pickedRows(ui)).toEqual(['row-agent:a1'])
  })
})

test('the poll: every tools_refresh seconds while open; it stops on q, on the pane\'s ×, and when a drawing throws', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await rec.clock.advance(600_000)
  expect(gitRuns(rec)).toBe(0) // nothing polls while closed
  await tools($)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(1)
  await rec.clock.advance(59_999)
  expect(gitRuns(rec)).toBe(1)
  await rec.clock.advance(1)
  expect(gitRuns(rec)).toBe(2)
  await rec.clock.advance(MINUTE)
  expect(gitRuns(rec)).toBe(3)

  // q
  await onPane($, ui => ui.press({ key: 'close' }))
  expect(rec.closed).toEqual([PANE_ID])
  let asked = rec.asked
  await rec.clock.advance(600_000)
  expect(gitRuns(rec)).toBe(3)
  expect(rec.asked).toBe(asked) // no tick left: the timer itself is cancelled

  // the person's × (another plugin's close reaches the pane's hook as the engine's does)
  await tools($)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(4)
  await frame($, 'close', { id: PANE_ID })
  expect(rec.panes).toEqual([])
  asked = rec.asked
  await rec.clock.advance(600_000)
  expect(gitRuns(rec)).toBe(4)
  expect(rec.asked).toBe(asked)
  await tools($) // closed by the person: the next toggle opens
  await rec.clock.settle()
  expect(rec.panes).toEqual([PANE_ID])
  expect(gitRuns(rec)).toBe(5)

  // a drawing that throws: an agent whose fields are no text
  rec.agents = [{ id: 'bad', description: 7, type: 8, status: 'running' } as unknown as AgentInfo]
  await rec.clock.advance(MINUTE)
  expect(gitRuns(rec)).toBe(6)
  await mount($).then(ui => ui.unmount(), () => undefined)
  await rec.clock.advance(MINUTE) // the tick that finds the pane gone ends the poll
  asked = rec.asked
  await rec.clock.advance(600_000)
  expect(gitRuns(rec)).toBe(6)
  expect(rec.asked).toBe(asked)
  // the pane is no longer the module's: the next toggle opens it again
  rec.agents = []
  await tools($)
  expect(rec.opened.filter(o => o.id === PANE_ID).length).toBe(4)
})

test('the poll ends at a tick that finds the pane gone with no close; tools_refresh retimes a running poll', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await tools($)
  await rec.clock.settle()
  await frame($, 'set', { key: 'tools_refresh', value: 5 }) // clamped to 10
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.tools_refresh', value: 10 })
  const before = gitRuns(rec)
  await rec.clock.advance(10_000)
  expect(gitRuns(rec)).toBe(before + 1)
  await rec.clock.advance(10_000)
  expect(gitRuns(rec)).toBe(before + 2)
  rec.panes = [] // gone with no ui.close
  await rec.clock.advance(10_000)
  const asked = rec.asked
  await rec.clock.advance(100_000)
  expect(gitRuns(rec)).toBe(before + 2)
  expect(rec.asked).toBe(asked) // that tick was the last
  await tools($) // not open any more: the toggle opens
  expect(rec.panes).toEqual([PANE_ID])
})

test('a refresh set while closed times the next open\'s poll', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'set', { key: 'tools_refresh', value: 600 })
  await tools($)
  await rec.clock.settle()
  await rec.clock.advance(599_999)
  expect(gitRuns(rec)).toBe(1)
  await rec.clock.advance(1)
  expect(gitRuns(rec)).toBe(2)
})

test('settings: get and set over $.junkd, refresh clamped at both ends, a non-number refused', W, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await frame($, 'get', { key: 'tools_enabled' })).toBe(true)
  expect(await frame($, 'get', { key: 'tools_refresh' })).toBe(60)
  expect(await frame($, 'get', { key: 'tools_agents_only' })).toBe(false)
  for (const [raw, stored] of [[9, 10], [10, 10], [11, 11], [599, 599], [600, 600], [601, 600], ['30', 30]] as const) {
    expect(await frame($, 'set', { key: 'tools_refresh', value: raw }), String(raw)).toBe(stored)
    expect(rec.config.at(-1), String(raw)).toEqual({ key: 'junkd.tools_refresh', value: stored })
    expect(await frame($, 'get', { key: 'tools_refresh' })).toBe(stored)
  }
  const writes = rec.config.length
  await expect(frame($, 'set', { key: 'tools_refresh', value: 'soon' })).rejects.toThrow(/soon is not a valid refresh/)
  expect(rec.config.length).toBe(writes)
  expect(await frame($, 'get', { key: 'tools_refresh' })).toBe(30)
  for (const [raw, want] of [['on', true], ['off', false], ['true', true], [false, false], [true, true]] as const) {
    expect(await frame($, 'set', { key: 'tools_agents_only', value: raw }), String(raw)).toBe(want)
    expect(await frame($, 'get', { key: 'tools_agents_only' }), String(raw)).toBe(want)
  }
  await expect(frame($, 'set', { key: 'tools_nope', value: 1 })).rejects.toThrow(/junkd: no setting tools_nope/)
})

test('a refresh out of range in the options (a hand edit) is clamped at load', { ...W, options: { tools_refresh: 3 } }, async ($, on) => {
  world(on)
  await start($)
  expect(await frame($, 'get', { key: 'tools_refresh' })).toBe(10)
})

test('a refused row write keeps the value', W, async ($, on) => {
  on('config.set', { key: 'junkd.tools_enabled' }, () => ({ deny: 'locked' }))
  const rec = world(on)
  await start($)
  await tools($)
  await expect(frame($, 'set', { key: 'tools_enabled', value: false })).rejects.toThrow(/locked/)
  expect(await frame($, 'get', { key: 'tools_enabled' })).toBe(true)
  expect(rec.panes).toEqual([PANE_ID])
})

test('the /config menu: each spelling of a switch, and refresh read and clamped as set reads it, or refused', W, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const [raw, want] of [[false, false], ['on', true], ['off', false], ['true', true], ['false', false], [true, true]] as const) {
    await frame($, 'config', { key: 'junkd.tools_agents_only', value: raw })
    expect(rec.config.at(-1), String(raw)).toEqual({ key: 'junkd.tools_agents_only', value: want })
    expect(await frame($, 'get', { key: 'tools_agents_only' }), String(raw)).toBe(want)
  }
  for (const [raw, want] of [['off', false], [true, true], ['false', false], ['on', true], [false, false], ['true', true]] as const) {
    await frame($, 'config', { key: 'junkd.tools_enabled', value: raw })
    expect(rec.config.at(-1), String(raw)).toEqual({ key: 'junkd.tools_enabled', value: want })
    expect(await frame($, 'get', { key: 'tools_enabled' }), String(raw)).toBe(want)
  }
  await frame($, 'config', { key: 'junkd.tools_refresh', value: 1000 })
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.tools_refresh', value: 600 })
  expect(await frame($, 'get', { key: 'tools_refresh' })).toBe(600)
  const writes = rec.config.length
  expect(await frame($, 'config', { key: 'junkd.tools_refresh', value: 'x' })).toEqual({ deny: 'x is not a valid refresh (seconds, 10-600)' })
  expect(rec.config.length).toBe(writes)
  expect(await frame($, 'get', { key: 'tools_refresh' })).toBe(600)
  // a row of no field passes as it came
  await frame($, 'config', { key: 'junkd.tools_other', value: 'v' })
  expect(rec.config.at(-1)).toEqual({ key: 'junkd.tools_other', value: 'v' })
})

test('tools_enabled off: the pane closes, the /junkd set leaves its tab out, /junkd:tools and open say it is off; on again', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await run($, 'junkd') // the set: junkd, handoff, orch, statusline, tools
  expect(rec.panes).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', PANE_ID, 'junkd-lessons'])
  await rec.clock.settle()
  const polled = gitRuns(rec)
  await frame($, 'set', { key: 'tools_enabled', value: false })
  expect(rec.panes).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-lessons'])
  await rec.clock.advance(600_000)
  expect(gitRuns(rec)).toBe(polled) // its poll went with it
  await run($, 'junkd')
  expect(rec.panes).toEqual([])
  await run($, 'junkd')
  expect(rec.panes).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-lessons'])
  await run($, 'junkd')
  expect((await tools($)).text).toBe('junkd: the tools pane is off: /junkd → tools → Tools pane: enabled')
  expect((await tools($, 'mcp')).text).toMatch(/the tools pane is off/)
  await expect(frame($, 'open', { pane: 'tools' })).rejects.toThrow(/the tools pane is off/)
  await expect(frame($, 'open', { pane: 'tools', route: 'mcp' })).rejects.toThrow(/the tools pane is off/)
  expect(rec.panes).toEqual([])
  // on again, by set; then off and on by the /config menu
  await frame($, 'set', { key: 'tools_enabled', value: true })
  await tools($)
  expect(rec.panes).toEqual([PANE_ID])
  await frame($, 'config', { key: 'junkd.tools_enabled', value: 'off' })
  expect(rec.panes).toEqual([])
  await frame($, 'config', { key: 'junkd.tools_enabled', value: 'on' })
  await run($, 'junkd')
  expect(rec.panes).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', PANE_ID, 'junkd-lessons'])
})

test('tools_enabled off in the options: the set has no tools tab from the start', { ...W, options: { tools_enabled: false } }, async ($, on) => {
  const rec = world(on)
  await start($)
  await run($, 'junkd')
  expect(rec.panes).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', 'junkd-lessons'])
})

test('/junkd:tools toggles; /junkd:tools <tab> opens on that tab or switches to it; an unknown tab is said', W, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await tools($)).toEqual({})
  expect(rec.opened).toEqual([{ id: PANE_ID, focus: true }])
  await onPane($, async ui => expect(await activeTab(ui)).toBe(' 1 Agents '))
  await tools($)
  expect(rec.panes).toEqual([])
  await tools($, ' MCP ')
  expect(rec.panes).toEqual([PANE_ID])
  await onPane($, async ui => expect(await activeTab(ui)).toBe(' 3 MCP '))
  await tools($, 'skills') // up already: switches, stays open, no second open
  expect(rec.panes).toEqual([PANE_ID])
  expect(rec.opened.length).toBe(2)
  await onPane($, async ui => expect(await activeTab(ui)).toBe(' 4 Skills '))
  expect((await tools($, 'nope')).text).toBe('junkd: the tools pane has no tab nope (agents, tools, mcp or skills)')
  await onPane($, async ui => expect(await activeTab(ui)).toBe(' 4 Skills '))
  expect(rec.panes).toEqual([PANE_ID])
  await tools($, 'tools')
  await onPane($, async ui => expect(await activeTab(ui)).toBe(' 2 Tools '))
  await tools($, 'agents')
  await onPane($, async ui => expect(await activeTab(ui)).toBe(' 1 Agents '))
})

test('$.junkd.open({ pane: \'tools\', route }) opens on that tab; each pane refuses the other\'s routes; handoff\'s still work', W, async ($, on) => {
  const rec = world(on)
  await start($)
  expect(await frame($, 'open', { pane: 'tools', route: 'mcp' })).toBe(null)
  expect(rec.panes).toEqual([PANE_ID])
  await onPane($, async ui => expect(await activeTab(ui)).toBe(' 3 MCP '))
  await frame($, 'open', { pane: 'tools', route: 'skills' })
  expect(rec.panes).toEqual([PANE_ID])
  await onPane($, async ui => expect(await activeTab(ui)).toBe(' 4 Skills '))
  await frame($, 'open', { pane: 'tools' })
  expect(rec.panes).toEqual([])
  await expect(frame($, 'open', { pane: 'tools', route: 'settings' })).rejects.toThrow(/junkd: no tab settings/)
  await expect(frame($, 'open', { pane: 'handoff', route: 'mcp' })).rejects.toThrow(/junkd: no tab mcp/)
  await expect(frame($, 'open', { pane: 'orch', route: 'agents' })).rejects.toThrow(/junkd: no tab agents/)
  expect(rec.panes).toEqual([])
  await frame($, 'open', { pane: 'handoff', route: 'settings' })
  expect(rec.panes).toEqual(['ahandoff'])
  await frame($, 'open', { pane: 'tools', route: 'skills' })
  expect(rec.panes).toEqual(['ahandoff', PANE_ID])
})

test('settings ▸ on the tools group opens the tools pane on its Agents tab; junkd and the other set panes close', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await tools($, 'skills')
  await tools($)
  await run($, 'junkd')
  const junkd = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', component: 'Pane', requestId: 'junkd', props: { ...paneOf().props, title: 'junkd' } })
  await junkd.press({ key: 'pane:tools' })
  await junkd.unmount()
  expect(rec.panes).toEqual([PANE_ID])
  expect(rec.opened.at(-1)).toEqual({ id: PANE_ID, focus: true })
  await onPane($, async ui => expect(await activeTab(ui)).toBe(' 1 Agents '))
})

test('t reveals this session\'s transcript in Finder on macOS, as a toast', W, async ($, on) => {
  const dir = `${CFG}/projects/${projectFolder(WT)}`
  const transcripts = [{ name: 'other.jsonl', kind: 'file' as const, mtimeMs: 9 }, { name: 's1.jsonl', kind: 'file' as const, mtimeMs: 1 }]
  const rec = world(on, { transcripts })
  await start($)
  await tools($)
  await onPane($, ui => ui.press({ key: 'transcript' }))
  expect(rec.runs.filter(r => r[0] === 'open')).toEqual([['open', '-R', `${dir}/s1.jsonl`]])
  expect(rec.toasts).toEqual([`✓ open -R ${dir}/s1.jsonl`])
})

test('t on Linux opens the folder of the newest transcript when the session has none of its own; a failed open is the toast', W, async ($, on) => {
  const dir = `${CFG}/projects/${projectFolder(WT)}`
  const transcripts = [{ name: 'a.jsonl', kind: 'file' as const, mtimeMs: 1 }, { name: 'b.jsonl', kind: 'file' as const, mtimeMs: 5 }]
  const rec = world(on, { transcripts, os: 'Linux', sessionId: 'zzz', revealExit: 3 })
  await start($)
  await tools($)
  await onPane($, ui => ui.press({ key: 'transcript' }))
  expect(rec.runs.filter(r => r[0] === 'xdg-open')).toEqual([['xdg-open', dir]])
  expect(rec.toasts).toEqual(['✗ no such app'])
})

test('t with no transcript yet: a toast, nothing run', W, async ($, on) => {
  const rec = world(on)
  await start($)
  rec.cwd = '/no/project/yet'
  await tools($)
  await onPane($, ui => ui.press({ key: 'transcript' }))
  expect(rec.runs.filter(r => r[0] === 'open' || r[0] === 'xdg-open' || r[0] === 'uname')).toEqual([])
  expect(rec.toasts).toEqual([`✗ no transcript in ${CFG}/projects/-no-project-yet yet: send a prompt first`])
})

test('the pane: tabs 1-4, r, t and q; every row within the pane\'s width, long names cut; mobile gets the engine\'s pane', W, async ($, on) => {
  const long = 'x'.repeat(200)
  const rec = world(on, { mcp: [mcpTool(`mcp__${long}__t`, long, 5)] })
  await start($)
  rec.nextAgent = 'a1'
  await spawn($, { cwd: WT, name: long })
  rec.agents = [agent('a1', 'running', { name: long })]
  await $.tool.call(mainCall(`Tool${long}`))
  await $.tool.call(mainCall(`mcp__${long}__t`))
  await $.tool.call(mainCall('Skill', { skill: long }))
  await tools($)
  await rec.clock.settle()
  // Each tab's rows, whatever the width: the tree's four nodes; a head and the long tool, Skill and the folded MCP row;
  // a head and the one server; a head and the one skill.
  const ROWS: Record<string, string[]> = {
    agents: ['row-root', `row-wt:${WT}`, 'row-agent:a1', `row-wt:${OTHER}`],
    tools: ['head', 'tool-row-mcp (1 server)', 'tool-row-Skill', `tool-row-Tool${long}`],
    mcp: ['head', `mcp-${long}`],
    skills: ['head', `skill-${long}`],
  }
  for (const cols of [30, 40, 80])
    await onPane($, async ui => {
      const hotkeys = (await ui.findAll({ type: 'Button' })).filter(b => b.props.hotkey).map(b => `${b.props.hotkey}:${b.key}`)
      for (const k of ['r:refresh', 't:transcript', 'q:close', '1:tab-agents', '2:tab-tools', '3:tab-mcp', '4:tab-skills', 'j:down', 'k:up'])
        expect(hotkeys, `${k} at ${cols}`).toContain(k)
      for (const [digit, route] of [['2', 'tools'], ['3', 'mcp'], ['4', 'skills'], ['1', 'agents']] as const) {
        await ui.press({ key: `tab-${route}` })
        expect(await activeTab(ui)).toMatch(new RegExp(`^ ${digit} `))
        const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.height === 1 && /^(row-|tool-row-|mcp-|skill-|head)/.test(b.key ?? ''))
        expect(rows.map(r => r.key), `${route} at ${cols}`).toEqual(ROWS[route])
        for (const r of rows) expect([...r.text].length, `${route} ${r.key} at ${cols}: ${JSON.stringify(r.text)}`).toBeLessThanOrEqual(cols - 2)
        expect(rows.some(r => r.text.includes('…')), `${route}: the long name is cut`).toBe(true)
      }
    }, 'terminal', cols)
  const mobile = await $.ui.mount({ plugin: 'junkd', surface: 'mobile', ...paneOf() } as never)
  expect(await (mobile as Mounted).find({ type: 'Box', key: 'engine' })).toBeDefined()
})

// fix round 1: the failure paths, the stale load, a refused open, a reload, and the matrix rows below ---------------

test('splitMcp: a name with no server part or no tool part is no MCP tool; it keeps its own Tools row', () => {
  for (const name of ['mcp__x', 'mcp__x__', 'mcp____t', 'mcpx__s__t']) expect(splitMcp(name), name).toBeNull()
  expect(splitMcp('mcp__s__t__u')).toEqual({ server: 's', tool: 't__u' })
  const c = emptyCounters()
  tallyTool(c, 'mcp__x', false, 0)
  tallyTool(c, 'mcp__s__t', false, 0)
  expect(toolRows(c.tools, []).map(r => r.name).sort()).toEqual(['mcp (1 server)', 'mcp__x'])
})

test('≈tokens: below a thousand whole, from a thousand in k; chars are divided by 4; none is a dash', () => {
  expect(tokens(999)).toBe('999')
  expect(tokens(999.4)).toBe('999')
  expect(tokens(1000)).toBe('1.0k')
  expect(tokens(1250)).toBe('1.3k')
  expect(approxTokens(3996)).toBe('999')
  expect(approxTokens(4000)).toBe('1.0k')
  expect(approxTokens(0)).toBe('-')
})

test('the porcelain parser: a block that says both bare and detached is bare', () => {
  expect(readWorktrees(['worktree /r', 'bare', 'detached', ''].join('\n'))).toEqual([{ path: '/r', branch: 'bare' }])
  expect(readWorktrees(['worktree /r', 'detached', 'bare', ''].join('\n'))).toEqual([{ path: '/r', branch: 'bare' }])
})

test('the tree: a worktree is a whole folder, not a name prefix; a trailing slash on either side still matches', () => {
  const trees = [{ path: '/w/main', branch: 'main' }, { path: '/w/a', branch: 'a' }, { path: '/w/b/', branch: 'b' }]
  const agents = [agent('x', 'running'), agent('y', 'running'), agent('z', 'running'), agent('v', 'running')]
  const spawned = {
    x: { model: 'm', cwd: '/w/ab' }, // a sibling whose name starts like /w/a: not under it
    y: { model: 'm', cwd: '/w/a/' }, // the worktree itself, with a slash
    z: { model: 'm', cwd: '/w/b/src' }, // under a worktree git listed with a slash
    v: { model: 'm', cwd: '/w/b' },
  }
  const root = buildTree(trees, agents, spawned, false)
  expect(root.children.map(n => n.id)).toEqual(['agent:x', 'wt:/w/a', 'wt:/w/b/'])
  expect(root.children[1]!.children.map(n => n.id)).toEqual(['agent:y'])
  expect(root.children[2]!.label).toBe('b')
  expect(root.children[2]!.children.map(n => n.id)).toEqual(['agent:z', 'agent:v'])
})

test('a result with no text is a call with no ≈tokens', W, async ($, on) => {
  world(on)
  await start($)
  await $.tool.call(mainCall('Bash', { noText: true }))
  await tools($, 'tools')
  await onPane($, async ui => expect(await rowOf(ui, 'Bash')).toMatch(/^ {2}Bash\s+1\s+0\s+-$/))
})

test('agents that failed or were killed are done; pending runs', W, async ($, on) => {
  const rec = world(on, { agents: [agent('f', 'failed', { name: 'eff' }), agent('k', 'killed', { name: 'kay' }), agent('p', 'pending', { name: 'pea' })] })
  await start($)
  await tools($)
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await nodeKeys(ui)).toEqual(['node:root', 'node:agent:p', `node:wt:${WT}`, `node:wt:${OTHER}`]) // failed and killed have left
    expect(await lines(ui)).toContain('  2 finished')
    expect(await nodeText(ui, 'agent:p')).toBe('├─   ● pea  general-purpose')
    await ui.press({ key: 'all' })
    expect(await nodeText(ui, 'agent:f')).toBe('├─   ○ eff  general-purpose  done')
    expect(await nodeText(ui, 'agent:k')).toBe('├─   ○ kay  general-purpose  done')
    expect(await nodeText(ui, 'agent:p')).toBe('├─   ● pea  general-purpose')
  })
})

test('an agents list that fails keeps the last tree as it was, running agents running', W, async ($, on) => {
  const rec = world(on, { agents: [agent('a1', 'running', { name: 'one' })] })
  await start($)
  await tools($)
  await rec.clock.settle()
  await onPane($, async ui => expect(await nodeText(ui, 'agent:a1')).toBe('├─   ● one  general-purpose'))
  rec.fail.agents = true
  await onPane($, ui => ui.press({ key: 'refresh' }))
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(2) // the load ran
  await onPane($, async ui => expect(await nodeText(ui, 'agent:a1')).toBe('├─   ● one  general-purpose'))
})

test('a usage read that fails keeps the last MCP schemas', W, async ($, on) => {
  const rec = world(on, { mcp: [mcpTool('mcp__linear__get', 'linear', 1200), mcpTool('mcp__linear__save', 'linear', 800, false)] })
  await start($)
  await tools($, 'mcp')
  await rec.clock.settle()
  await onPane($, async ui => expect(await rowOf(ui, 'linear')).toMatch(/linear\s+0\s+1\/2\s+1\.2k\s+-$/))
  rec.fail.usage = true
  await onPane($, ui => ui.press({ key: 'refresh' }))
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(2)
  await onPane($, async ui => expect(await rowOf(ui, 'linear')).toMatch(/linear\s+0\s+1\/2\s+1\.2k\s+-$/))
})

test('of two loads side by side, only the newest draws: an older one that ends last is dropped', W, async ($, on) => {
  const rec = world(on, { agents: [agent('a1', 'running', { name: 'one' })] })
  await start($)
  let first = () => {}
  let second = () => {}
  rec.gates.push(new Promise<void>(r => { first = r }), new Promise<void>(r => { second = r }))
  await tools($) // the first load asks for the agents while a1 runs ...
  rec.agents = [agent('a1', 'completed', { name: 'one' })]
  await onPane($, ui => ui.press({ key: 'refresh' })) // ... the second once it is done
  second()
  await rec.clock.settle()
  first()
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await nodeText(ui, 'agent:a1')).toBeUndefined() // the newest load (completed) drew, not the older one (running)
    expect(await lines(ui)).toContain('  1 finished')
  })
})

test('a refused open: the reason is said, the pane is not open, nothing polls, and the next toggle opens it', W, async ($, on) => {
  const rec = world(on)
  await start($)
  rec.fail.open = 'no room for a pane'
  expect((await tools($)).text).toContain('no room for a pane')
  await rec.clock.settle()
  const runs = gitRuns(rec)
  const asked = rec.asked
  await rec.clock.advance(600_000)
  expect(gitRuns(rec)).toBe(runs)
  expect(rec.asked).toBe(asked)
  rec.fail.open = undefined
  await tools($)
  expect(rec.panes).toEqual([PANE_ID])
  expect(rec.closed).toEqual([])
})

test('a pane left open across a reload polls again; with tools off it closes at the start', W, async ($, on) => {
  const rec = world(on)
  rec.panes = [PANE_ID]
  await start($)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(1)
  await rec.clock.advance(MINUTE)
  expect(gitRuns(rec)).toBe(2)
  expect(rec.closed).toEqual([])
})

test('a pane left open across a reload with tools off closes at the start and is never read', { ...W, options: { tools_enabled: false } }, async ($, on) => {
  const rec = world(on)
  rec.panes = [PANE_ID]
  await start($)
  await rec.clock.advance(600_000)
  expect(rec.closed).toEqual([PANE_ID])
  expect(gitRuns(rec)).toBe(0)
})

test('a session directory that cannot be read: no git, the agents under an unnamed root', W, async ($, on) => {
  const rec = world(on, { agents: [agent('a1', 'running', { name: 'one' })] })
  await start($)
  rec.fail.cwd = true
  await tools($)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(0)
  await onPane($, async ui => {
    expect(await nodeKeys(ui)).toEqual(['node:root', 'node:agent:a1'])
    expect(await nodeText(ui, 'root')).toBe('▾ ?')
  })
})

test('git worktree list that throws: the session\'s folder is the root, the agents under it', W, async ($, on) => {
  const rec = world(on, { agents: [agent('a1', 'running', { name: 'one' })] })
  await start($)
  rec.fail.git = true
  await tools($)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(1)
  await onPane($, async ui => {
    expect(await nodeKeys(ui)).toEqual(['node:root', 'node:agent:a1'])
    expect(await nodeText(ui, 'root')).toBe('▾ T17')
  })
})

test('a poll tick that cannot read the panes loads all the same', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await tools($)
  await rec.clock.settle()
  rec.fail.panes = true
  await rec.clock.advance(MINUTE)
  expect(gitRuns(rec)).toBe(2)
  await rec.clock.advance(MINUTE)
  expect(gitRuns(rec)).toBe(3)
})

test('a subagent\'s turn end reads the tree again too; a closed pane reads nothing', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await turnEnd($)
  expect(gitRuns(rec)).toBe(0)
  await tools($)
  await rec.clock.settle()
  await $.turn.complete({ answer: 'a', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId: 'a1' } as never)
  await rec.clock.settle()
  expect(gitRuns(rec)).toBe(2)
})

test('a /clear drops the agents seen before it, done ones too', W, async ($, on) => {
  const rec = world(on, { agents: [agent('a1', 'running', { name: 'one' })] })
  await start($)
  await tools($)
  await rec.clock.settle()
  rec.agents = [] // the engine dropped it: drawn as done
  await onPane($, ui => ui.press({ key: 'refresh' }))
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await lines(ui)).toContain('  1 finished')
    await ui.press({ key: 'all' })
    expect(await nodeText(ui, 'agent:a1')).toBe('├─   ○ one  general-purpose  done')
    await ui.press({ key: 'all' })
  })
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} as never })
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await nodeKeys(ui)).toEqual(['node:root', `node:wt:${WT}`, `node:wt:${OTHER}`])
    expect((await lines(ui)).some(l => l.includes('finished'))).toBe(false) // the orphan is not counted after the /clear
  })
})

test('a spawn while tools is off is not recorded: the agent has no model and sits under the root', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'set', { key: 'tools_enabled', value: false })
  await spawn($, { cwd: WT })
  await frame($, 'set', { key: 'tools_enabled', value: true })
  rec.agents = [agent('a1', 'running', { name: 'one' })]
  await tools($)
  await rec.clock.settle()
  await onPane($, async ui => {
    expect(await nodeKeys(ui)).toEqual(['node:root', 'node:agent:a1', `node:wt:${WT}`, `node:wt:${OTHER}`])
    expect(await nodeText(ui, 'agent:a1')).toBe('├─   ● one  general-purpose')
  })
})

test('a slash run of a command the list lacks reads the list again (a /reload-plugins added it)', W, async ($, on) => {
  const rec = world(on, { commands: [{ name: 'mine', source: 'user' }] })
  await start($)
  await run($, 'mine')
  rec.commands = [...rec.commands, { name: 'theirs', source: 'plugin' }]
  await run($, 'theirs')
  await tools($, 'skills')
  await onPane($, async ui => {
    expect(await rowOf(ui, 'mine')).toMatch(/mine\s+slash\s+1\s/)
    expect(await rowOf(ui, 'theirs')).toMatch(/theirs\s+slash\s+1\s/)
  })
})

test('the /config menu: refresh at 9 and 10 is 10, at 600 and 601 is 600', W, async ($, on) => {
  const rec = world(on)
  await start($)
  for (const [raw, want] of [[9, 10], [10, 10], [11, 11], [599, 599], [600, 600], [601, 600], [9.6, 10]] as const) {
    await frame($, 'config', { key: 'junkd.tools_refresh', value: raw })
    expect(rec.config.at(-1), String(raw)).toEqual({ key: 'junkd.tools_refresh', value: want })
  }
})

test('the set closes only a tools pane that is still its own: one reopened by hand stays', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await run($, 'junkd')
  await tools($) // the person closes the set's tools tab ...
  await tools($) // ... and opens it on their own
  await run($, 'junkd')
  expect(rec.panes).toEqual([PANE_ID])
})

test('settings ▸ on tools: the pane opens unfocused, junkd and the set\'s other panes close, then it asks for the keys', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await run($, 'junkd')
  expect(rec.panes).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', PANE_ID, 'junkd-lessons'])
  const junkd = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', component: 'Pane', requestId: 'junkd', props: { ...paneOf().props, title: 'junkd' } })
  const at = rec.log.length
  await junkd.press({ key: 'pane:tools' })
  await junkd.unmount()
  expect(rec.log.slice(at)).toEqual([`ui.open ${PANE_ID}`, 'ui.close junkd', 'ui.close ahandoff', 'ui.close orch', 'ui.close statusline', 'ui.close junkd-lessons', `ui.open ${PANE_ID} focus`])
  expect(rec.toasts).toEqual([])
  await run($, 'junkd') // the tools pane is the person's now: the set opens behind junkd ...
  expect(rec.panes).toEqual(['junkd', 'ahandoff', 'orch', 'statusline', PANE_ID, 'junkd-lessons'])
  await run($, 'junkd') // ... and, reopened in the set, closes with it
  expect(rec.panes).toEqual([])
})

test('settings ▸ on tools while it is off: junkd closes, nothing opens, the reason is a toast', W, async ($, on) => {
  const rec = world(on)
  await start($)
  await frame($, 'set', { key: 'tools_enabled', value: false })
  await run($, 'junkd')
  const junkd = await $.ui.mount({ plugin: 'junkd', surface: 'terminal', component: 'Pane', requestId: 'junkd', props: { ...paneOf().props, title: 'junkd' } })
  await junkd.press({ key: 'pane:tools' })
  await junkd.unmount()
  expect(rec.panes).toEqual([])
  expect(rec.opened.filter(o => o.id === PANE_ID)).toEqual([])
  expect(rec.toasts).toEqual(['✗ junkd: the tools pane is off: /junkd → tools → Tools pane: enabled'])
})

test('t: a failed open with nothing on stderr says the exit code', W, async ($, on) => {
  const rec = world(on, { transcripts: [{ name: 's1.jsonl', kind: 'file', mtimeMs: 1 }], revealExit: 4, revealStderr: '' })
  await start($)
  await tools($)
  await onPane($, ui => ui.press({ key: 'transcript' }))
  expect(rec.toasts).toEqual(['✗ open exited 4'])
})

test('t: uname that throws is no macOS (the folder opens); an open that throws is the toast', W, async ($, on) => {
  const dir = `${CFG}/projects/${projectFolder(WT)}`
  const rec = world(on, { transcripts: [{ name: 's1.jsonl', kind: 'file', mtimeMs: 1 }] })
  await start($)
  await tools($)
  rec.fail.uname = true
  await onPane($, ui => ui.press({ key: 'transcript' }))
  expect(rec.runs.filter(r => r[0] === 'xdg-open')).toEqual([['xdg-open', dir]])
  expect(rec.toasts).toEqual([`✓ xdg-open ${dir}`])
  rec.fail.reveal = true
  await onPane($, ui => ui.press({ key: 'transcript' }))
  expect(rec.toasts.at(-1)).toBe('✗ junkd: $.process.run: spawn failed')
})

test('t: a session directory that cannot be read is the toast, nothing run', W, async ($, on) => {
  const rec = world(on, { transcripts: [{ name: 's1.jsonl', kind: 'file', mtimeMs: 1 }] })
  await start($)
  await tools($)
  rec.fail.cwd = true
  await onPane($, ui => ui.press({ key: 'transcript' }))
  expect(rec.runs.filter(r => r[0] === 'open' || r[0] === 'xdg-open')).toEqual([])
  expect(rec.toasts).toEqual(['✗ junkd: $.session.cwd: no cwd'])
})

test('t: with no CLAUDE_CONFIG_DIR the transcripts are under HOME, and with no HOME under the shell\'s', W, async ($, on) => {
  const rec = world(on, { env: {}, shellHome: '/home/sh', cfgDir: '/home/sh/.claude', transcripts: [{ name: 's1.jsonl', kind: 'file', mtimeMs: 1 }] })
  await start($)
  await tools($)
  await onPane($, ui => ui.press({ key: 'transcript' }))
  expect(rec.runs).toContainEqual(['sh', '-c', 'echo $HOME'])
  expect(rec.toasts).toEqual([`✓ open -R /home/sh/.claude/projects/${projectFolder(WT)}/s1.jsonl`])
})

test('t: with HOME and no CLAUDE_CONFIG_DIR the transcripts are under HOME/.claude', W, async ($, on) => {
  const rec = world(on, { env: { HOME }, cfgDir: `${HOME}/.claude`, transcripts: [{ name: 's1.jsonl', kind: 'file', mtimeMs: 1 }] })
  await start($)
  await tools($)
  await onPane($, ui => ui.press({ key: 'transcript' }))
  expect(rec.runs.filter(r => r[0] === 'sh')).toEqual([])
  expect(rec.toasts).toEqual([`✓ open -R ${HOME}/.claude/projects/${projectFolder(WT)}/s1.jsonl`])
})

test('a narrow pane (under 22 columns) draws every row within it; control characters in a name are blanks', W, async ($, on) => {
  const rec = world(on, { mcp: [mcpTool('mcp__s\x1b[31m__t', 's\x1b[31m', 5)] })
  await start($)
  rec.nextAgent = 'a1'
  await spawn($, { cwd: WT })
  rec.agents = [agent('a1', 'running', { name: 'evil\n\tname\x1b[2J' })]
  await $.tool.call(mainCall('Bad\x07Tool'))
  await $.tool.call(mainCall('Skill', { skill: 'sk\rill' }))
  await tools($)
  await rec.clock.settle()
  for (const cols of [6, 8, 12, 21]) // at 6 and 8 the guide itself is cut
    await onPane($, async ui => {
      for (const route of ['agents', 'tools', 'mcp', 'skills'] as const) {
        await ui.press({ key: `tab-${route}` })
        const rows = (await ui.findAll({ type: 'Box' })).filter(b => b.props.height === 1 && /^(row-|tool-row-|mcp-|skill-|head)/.test(b.key ?? ''))
        expect(rows.length, route).toBeGreaterThan(0)
        for (const r of rows) expect([...r.text].length, `${route} ${r.key} at ${cols}: ${JSON.stringify(r.text)}`).toBeLessThanOrEqual(cols - 2)
        for (const t of await lines(ui)) expect(/[\u0000-\u001f\u007f-\u009f]/.test(t), `${route}: ${JSON.stringify(t)}`).toBe(false)
      }
    }, 'terminal', cols)
  await onPane($, async ui => {
    await ui.press({ key: 'tab-agents' })
    expect(await nodeText(ui, 'agent:a1')).toBe('│  └─   ● evil  name [2J  general-purpose  haiku')
  }, 'terminal', 100)
})
