// The orch dashboard's `$`-free half: the task store's parsers (frontmatter, the last verification table, the lessons),
// the phases each agent opens and closes on its task, the merge with the status.js already on disk, and the status
// itself (skills/orch/dashboard/status.sample.js holds the data contract the page reads). dashboard.tsx does the
// awaits (agent list, files, git, usage, clock) and the writes; bin/orch-status builds the same file from a shell.
import type { AgentInfo } from 'claude-code'

export type Column = 'todo' | 'in_progress' | 'verify' | 'done' | 'blocked'
export type Kind = 'implement' | 'verify' | 'fix' | 'done'
export type EventKind = 'info' | 'pass' | 'fail'
export type AgentState = 'running' | 'waiting' | 'done' | 'dead' | 'queued'

// `id` (the agent's) and `open` are the writers' own: an open phase is drawn live (end = the write's time) and closed
// at the agent's end; a status.js read back after a /reload-plugins keeps both.
export type Phase = { agent: string; model: string; kind: Kind; start: number; end: number; ctx: string; killed?: boolean; note?: string; id?: string; open?: boolean }
export type DashEvent = { t: number | string; text: string; kind: EventKind }
export type DashTask = {
  id: string
  title: string
  column: Column
  round?: number
  deps?: string[]
  ac?: [number, number]
  acx?: [number, number]
  note?: string
  implementer?: string
  verifier?: string
  worktree?: string
  lastActivity?: number
  phases?: Phase[]
}
export type DashAgent = {
  name: string
  role: string
  model: string
  status: AgentState
  lastCallSec: number | null
  ctx: string
  task?: string
  round?: number
  branch?: string
  worktree?: string
  lastStep?: string
  deadNote?: string
  events?: DashEvent[]
  id?: string
}
export type Lesson = { task: string; text: string }
export type Status = {
  mock: false
  generatedAt: number
  repo: string
  branch: string
  window: { start: number; end: number }
  tasks: DashTask[]
  agents: DashAgent[]
  events: DashEvent[]
  lessons: Lesson[]
  usage: { fiveHour?: number; week?: number }
  watchdog: { on?: boolean; minutes?: number }
}

export const HOUR = 3_600_000
export const MAX_EVENTS = 50 // the page's Recent events, newest first
export const MAX_AGENT_EVENTS = 40 // one agent's tool calls in its detail

// the task store ----------------------------------------------------------------------------------------------------

export type TaskHead = { id: string; title: string; status: string; deps: string[] }

const unquote = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, '$2')
// `[a, b]`, `a, b` or a block list (`deps:` then `  - a`); `[]` and an empty value are none.
function listOf(inline: string, block: string[]): string[] {
  const v = inline.trim()
  const items = v === '' ? block : v.replace(/^\[|\]$/g, '').split(',')
  return items.map(unquote).filter(Boolean)
}

// A task file's frontmatter: the first `---` block (CRLF taken as LF). undefined when the file has none, or an
// unclosed one. A missing id is the file's name; a missing status is todo.
export function parseTask(file: string, text: string): TaskHead | undefined {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return undefined
  const close = lines.indexOf('---', 1)
  if (close < 0) return undefined
  const fm = new Map<string, string>()
  const blocks = new Map<string, string[]>()
  let last = ''
  for (const line of lines.slice(1, close)) {
    const item = /^\s+-\s*(.*)$/.exec(line)
    if (item && last) {
      blocks.set(last, [...(blocks.get(last) ?? []), item[1]!])
      continue
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):(.*)$/.exec(line)
    if (!kv) continue
    last = kv[1]!
    fm.set(last, kv[2]!.replace(/\s+#.*$/, ''))
  }
  const id = unquote(fm.get('id') ?? '') || file.replace(/\.md$/i, '')
  return { id, title: unquote(fm.get('title') ?? ''), status: unquote(fm.get('status') ?? '') || 'todo', deps: listOf(fm.get('deps') ?? '', blocks.get('deps') ?? []) }
}

// Which files of the task dir are tasks: `*.md` not starting with `_` (_lessons.md, _notes-*.md).
export const isTaskFile = (name: string) => /\.md$/i.test(name) && !name.startsWith('_')

export type Verdicts = { round: number; ac?: [number, number]; acx?: [number, number]; note?: string }

// The last `## Verification` section (`## Verification round N`, or the spec's `## Verification — <branch>` with N = 1):
// N, and from its `| Criterion | … | Verdict |` table the AC and the ACX
// rows (an ACX row is one whose criterion starts with ACX, an AC row one starting with AC and a digit), each as
// [passed, all]. A verdict passes when it starts with PASS; FAIL and PM-REVIEW are named in the note. undefined: no
// such section.
export function parseVerification(text: string): Verdicts | undefined {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let at = -1
  let round = 0
  lines.forEach((l, i) => {
    const m = /^##\s+Verification\b(?:\s+round\s+(\d+)\b)?/i.exec(l)
    if (m) {
      at = i
      round = m[1] ? Number(m[1]) : 1
    }
  })
  if (at < 0) return undefined
  const section: string[] = []
  for (const l of lines.slice(at + 1)) {
    if (/^##\s/.test(l)) break
    section.push(l)
  }
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
  let verdictAt = -1
  const ac: [number, number] = [0, 0]
  const acx: [number, number] = [0, 0]
  const fail: string[] = []
  const pm: string[] = []
  for (const l of section) {
    if (!l.trim().startsWith('|')) continue
    const row = cells(l)
    if (verdictAt < 0) {
      if (/^criterion$/i.test(row[0] ?? '') || /^item$/i.test(row[0] ?? '')) verdictAt = row.findIndex(c => /^verdict$/i.test(c))
      continue
    }
    if (row.every(c => /^:?-+:?$/.test(c))) continue
    const criterion = row[0] ?? ''
    const verdict = (row[verdictAt] ?? row[row.length - 1] ?? '').toUpperCase()
    const name = criterion.split(/\s/)[0] ?? criterion
    const bucket = /^ACX\d/i.test(criterion) ? acx : /^AC\d/i.test(criterion) ? ac : undefined
    if (bucket) {
      bucket[1]++
      if (verdict.startsWith('PASS')) bucket[0]++
    }
    if (verdict.startsWith('FAIL')) fail.push(name)
    else if (verdict.startsWith('PM-REVIEW')) pm.push(name)
  }
  const note = [fail.length ? `FAIL: ${fail.join(', ')}` : '', pm.length ? `PM-REVIEW: ${pm.join(', ')}` : ''].filter(Boolean).join(' · ')
  return { round, ...(ac[1] ? { ac } : {}), ...(acx[1] ? { acx } : {}), ...(note ? { note: `round ${round}: ${note}` } : {}) }
}

// _lessons.md: `## T<n> (date)` or `## L<n> (date) … · from: T<n>` headings, each with its paragraph; the lesson is the
// paragraph's first sentence, its task the heading's `from:` when it has one (else the heading's first word). Newest
// first (the file appends).
export function parseLessons(text: string): Lesson[] {
  const out: Lesson[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(\S+)/.exec(lines[i]!)
    if (!m) continue
    let body = ''
    for (let j = i + 1; j < lines.length && !/^##\s/.test(lines[j]!); j++) {
      if (lines[j]!.trim() === '') {
        if (body) break
        continue
      }
      body += (body ? ' ' : '') + lines[j]!.trim()
    }
    const sentence = /^(.*?[.!?])(\s|$)/.exec(body)?.[1] ?? body
    const from = /\bfrom:\s*([^\s·,]+)/.exec(lines[i]!)?.[1]
    if (sentence) out.push({ task: from ?? m[1]!, text: sentence })
  }
  return out.reverse()
}

// The orch config's tasks_dir (`.orch/tasks` when unset or not a folder under .orch/, as orch-state reads it).
export function tasksDirOf(config: string | undefined): string {
  const m = /^tasks_dir:\s*(.*)$/m.exec((config ?? '').replace(/\r\n?/g, '\n'))
  const dir = m ? unquote(m[1]!.replace(/\s+#.*$/, '')).replace(/\/+$/, '') : ''
  return /^\.orch\/[^/]/.test(dir) && !dir.split('/').includes('..') ? dir : '.orch/tasks'
}

// The project root the orch scripts use (orch-state's `root`): the git toplevel, or, inside a task worktree that has
// no .orch/ of its own, the nearest enclosing checkout above a /.worktrees/ segment that has one.
export function orchRoot(toplevel: string, hasOrch: (dir: string) => boolean): string {
  let up = toplevel
  while (!hasOrch(up) && up.includes('/.worktrees/')) up = up.slice(0, up.lastIndexOf('/.worktrees/'))
  return hasOrch(up) ? up : toplevel
}

// the agents --------------------------------------------------------------------------------------------------------

// `junkd:implementer`, `orch:verify-coordinator` -> the role after the plugin's prefix.
export const roleOf = (type: string) => type.replace(/^.*:/, '')
const VERIFY = /^(verify-coordinator|ui-reviewer|test-planner)$/
const IMPLEMENT = /^(implementer|lead-implementer)$/

// A phase's kind from the spawn: an implementer (or lead) implements, and fixes once its task was in verify; a
// reviewer verifies. Any other type by its words: verify/review → verify, a push/PR/merge helper → done, else as an
// implementer.
export function kindOf(type: string, words: string, taskWasVerified: boolean): Kind {
  const role = roleOf(type)
  if (VERIFY.test(role)) return 'verify'
  if (!IMPLEMENT.test(role)) {
    if (/verif|review/i.test(words)) return 'verify'
    if (/\b(pr|push|merge|gh)\b/i.test(words)) return 'done'
  }
  return taskWasVerified ? 'fix' : 'implement'
}

// The task a spawn works on: a `.worktrees/<id>` segment of its directory first, then the earliest task id named in
// its name, then its description, then its prompt (as a whole word). undefined when none names a known id.
export function taskOf(ids: readonly string[], e: { cwd?: string; name?: string; description?: string; prompt?: string }): string | undefined {
  const wt = /\/\.worktrees\/([^/]+)\/?$/.exec(e.cwd ?? '')?.[1]
  if (wt !== undefined && ids.includes(wt)) return wt
  for (const text of [e.name, e.description, e.prompt]) {
    if (!text) continue
    let best: { id: string; at: number } | undefined
    for (const id of ids) {
      const m = new RegExp(`(^|[^A-Za-z0-9])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`).exec(text)
      if (!m) continue
      const at = m.index + m[1]!.length
      if (!best || at < best.at || (at === best.at && id.length > best.id.length)) best = { id, at }
    }
    if (best) return best.id
  }
  return undefined
}

// The list's status to the page's: pending is queued, waiting and idle wait, completed is done, failed and killed are
// dead.
export function stateOf(status: AgentInfo['status'] | undefined): AgentState {
  if (status === 'pending') return 'queued'
  if (status === 'waiting' || status === 'idle') return 'waiting'
  if (status === 'completed') return 'done'
  if (status === 'failed' || status === 'killed') return 'dead'
  return 'running'
}

export const shortModel = (model: string) => /fable|opus|sonnet|haiku/i.exec(model)?.[0].toLowerCase() ?? (model || '—')
// Context tokens as the page draws them: `148k`, `—` when unknown.
export const ctxText = (tokens: number | undefined) => (tokens === undefined || !Number.isFinite(tokens) ? '—' : tokens < 1000 ? String(Math.round(tokens)) : `${Math.round(tokens / 1000)}k`)
// A tool call as an agent's last step: the tool and what it was about, one line, at most 80 characters.
export function stepOf(tool: string, input: Record<string, unknown>): string {
  const pick = ['command', 'file_path', 'path', 'pattern', 'url', 'description', 'to', 'skill']
  const key = pick.find(k => typeof input[k] === 'string' && (input[k] as string).trim() !== '')
  let what = key ? String(input[key]) : ''
  if (key === 'file_path' || key === 'path') what = what.replace(/^.*\//, '')
  const line = `${tool}${what ? ` ${what}` : ''}`.replace(/\s+/g, ' ').trim()
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}
// A path inside the root, relative to it; any other path as it is.
export const relTo = (root: string, path: string) => (root && path.startsWith(`${root.replace(/\/+$/, '')}/`) ? path.slice(root.replace(/\/+$/, '').length + 1) : path)

// the phases --------------------------------------------------------------------------------------------------------

export const phaseKey = (p: Phase) => `${p.id ?? p.agent}@${p.start}`

// One task's phases: the ones in memory win over the ones read back, by agent and start; in start order.
export function mergePhases(mine: readonly Phase[], before: readonly Phase[]): Phase[] {
  const out = new Map<string, Phase>()
  for (const p of before) out.set(phaseKey(p), p)
  for (const p of mine) out.set(phaseKey(p), p)
  return [...out.values()].sort((a, b) => a.start - b.start)
}

// A status.js as the writers write it (`window.ORCH = {…};`): the object, or undefined when it does not parse.
export function readStatusJs(text: string | undefined): Partial<Status> | undefined {
  if (!text) return undefined
  const m = /^\s*window\.ORCH\s*=\s*([\s\S]*?);?\s*$/.exec(text)
  if (!m) return undefined
  try {
    const o = JSON.parse(m[1]!) as unknown
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Partial<Status>) : undefined
  } catch {
    return undefined
  }
}
export const statusJs = (s: Status) => `window.ORCH = ${JSON.stringify(s)};\n`

// The board column of a task: the store's status, with in_progress drawn as verify while its last phase verifies.
export function columnOf(status: string, phases: readonly Phase[]): Column {
  const s = status.trim().toLowerCase()
  if (s === 'done' || s === 'blocked' || s === 'todo') return s
  if (s === 'in_progress' || s === 'verify') {
    const last = [...phases].sort((a, b) => a.start - b.start).at(-1)
    return s === 'verify' || last?.kind === 'verify' ? 'verify' : 'in_progress'
  }
  return 'todo'
}

// the status --------------------------------------------------------------------------------------------------------

export type BuildInput = {
  now: number
  windowH: number
  repo: string
  branch: string
  root: string // the orch root: worktrees are drawn relative to it
  tasks: { head: TaskHead; verdicts?: Verdicts }[]
  phases: Record<string, Phase[]> // by task id, merged already
  agents: DashAgent[]
  events: DashEvent[]
  lessons: Lesson[]
  usage: { kind: string; percentUsed: number }[]
}

// The status the page reads. Open phases end now (drawn live); a task's implementer and verifier are its latest of
// each kind; its worktree the one its latest phase's agent runs in; its last activity the latest phase end.
export function buildStatus(i: BuildInput): Status {
  const byName = new Map(i.agents.map(a => [a.name, a]))
  const tasks = i.tasks.map(({ head, verdicts }): DashTask => {
    const phases = (i.phases[head.id] ?? []).map(p => (p.open ? { ...p, end: i.now } : p))
    const latest = (kinds: Kind[]) => [...phases].reverse().find(p => kinds.includes(p.kind))?.agent
    const t: DashTask = { id: head.id, title: head.title, column: columnOf(head.status, phases) }
    if (head.deps.length) t.deps = head.deps
    if (verdicts) {
      t.round = verdicts.round
      if (verdicts.ac) t.ac = verdicts.ac
      if (verdicts.acx) t.acx = verdicts.acx
      if (verdicts.note) t.note = verdicts.note
    }
    const impl = latest(['implement', 'fix'])
    const verifier = latest(['verify'])
    if (impl) t.implementer = impl
    if (verifier) t.verifier = verifier
    const wt = [...phases].reverse().map(p => byName.get(p.agent)?.worktree).find(Boolean)
    if (wt) t.worktree = wt
    if (phases.length) {
      t.lastActivity = Math.max(...phases.map(p => p.end))
      t.phases = phases
    }
    return t
  })
  const usage: Status['usage'] = {}
  for (const u of i.usage) {
    if (u.kind === 'five_hour') usage.fiveHour = Math.round(u.percentUsed)
    if (u.kind === 'seven_day') usage.week = Math.round(u.percentUsed)
  }
  return {
    mock: false,
    generatedAt: i.now,
    repo: i.repo,
    branch: i.branch,
    window: { start: i.now - i.windowH * HOUR, end: i.now },
    tasks,
    agents: i.agents,
    events: i.events.slice(0, MAX_EVENTS),
    lessons: i.lessons,
    usage,
    watchdog: {},
  }
}

// The command that opens the page: `open` on macOS (`uname -s` Darwin), `xdg-open` elsewhere.
export const openArgv = (os: string, file: string): string[] => (os.trim() === 'Darwin' ? ['open', file] : ['xdg-open', file])
