// tools: the `tools` pane's `$`-free side. Its state (T), the settings group's coercion, the session's counters
// (tool calls, MCP servers, skill runs), the `git worktree list --porcelain` parser and the agents tree. tools-pane.tsx
// feeds it from the hooks (tool.call, command.run, agent.spawn, session.end) and from the reads ($.agent.list, git,
// $.session.usage); tools-views.tsx draws from it.
import type { ContextMcpTool, AgentInfo } from 'claude-code'
import type { JunkdToolsField, JunkdToolsRoute } from '../types'
import { W } from './watchdog.ts'

export type Route = JunkdToolsRoute
export const ROUTES: readonly Route[] = ['agents', 'tools', 'mcp', 'skills']
export const isRoute = (route: unknown): route is Route => (ROUTES as readonly unknown[]).includes(route)

// settings ----------------------------------------------------------------------------------------------------------

// tools_refresh: seconds between two loads while the pane is open, clamped here (the manifest keeps type and default
// only: the engine refuses a whole module whose stored value is out of a manifest range).
export const REFRESH_MIN = 10
export const REFRESH_MAX = 600
export const REFRESH_DEFAULT = 60
export const clampRefresh = (n: number) => Math.min(REFRESH_MAX, Math.max(REFRESH_MIN, Math.round(n)))

const FIELDS: readonly JunkdToolsField[] = ['enabled', 'refresh', 'agents_only']
export const isField = (key: unknown): key is JunkdToolsField => (FIELDS as readonly unknown[]).includes(key)

// A raw value to the field's kind: a switch is on for true, 'true' or 'on' (anything else is off); refresh takes any
// finite number, clamped, and refuses the rest.
export type Coerced = { value: number | boolean; error?: undefined } | { error: string; value?: undefined }
export function coerce(field: JunkdToolsField, raw: unknown): Coerced {
  if (field !== 'refresh') return { value: raw === true || raw === 'true' || raw === 'on' }
  const n = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN
  if (!Number.isFinite(n)) return { error: `${String(raw)} is not a valid refresh (seconds, ${REFRESH_MIN}-${REFRESH_MAX})` }
  return { value: clampRefresh(n) }
}

// counters ----------------------------------------------------------------------------------------------------------

type Via = 'tool' | 'slash'
// chars: the length of the result text the model read (drawn as chars ÷ 4, ≈tokens).
export type ToolCount = { main: number; sub: number; chars: number }
export type SkillRun = { via: Via; count: number; last: number }
export type Counters = { tools: Record<string, ToolCount>; skills: Record<string, SkillRun> }

// Prototype-free: the names come from the model (`constructor`, `__proto__` are names like any other).
export function emptyCounters(): Counters {
  return { tools: Object.create(null), skills: Object.create(null) }
}

export function tallyTool(c: Counters, tool: string, isSub: boolean, chars: number): void {
  let n = c.tools[tool]
  if (!n) c.tools[tool] = n = { main: 0, sub: 0, chars: 0 }
  if (isSub) n.sub++
  else n.main++
  n.chars += chars
}

// A typed /<skill> can also reach the model as a Skill tool call of the same name: the second way within this
// window is the same run, counted once.
export const SAME_RUN_MS = 2000
export function countSkill(c: Counters, name: string, via: Via, now: number): void {
  const r = c.skills[name]
  if (r && r.via !== via && now - r.last < SAME_RUN_MS) return
  c.skills[name] = { via, last: now, count: 1 + (r ? r.count : 0) }
}

// state -------------------------------------------------------------------------------------------------------------

export type Worktree = { path: string; branch: string } // branch: its name, `detached` or `bare`
export type Spawned = { model: string; cwd: string; name?: string } // what agent.spawn resolved; the agent list has neither

// ponytail: module state. A /clear (or /resume) resets the counters and the agents seen; the folds and the selection
// stay, as the person left them.
export const T = {
  enabled: true,
  refresh: REFRESH_DEFAULT,
  agentsOnly: false,
  showAll: false, // the Agents tab lists this project's live agents and the worktrees they sit in; `a` lists everything, for the session
  open: false,
  loaded: false, // a first load since the pane opened has finished: until then the tabs draw `reading…`
  route: 'agents' as Route,
  selected: null as string | null, // the selected row's node id
  selectedAt: 0, // its index, where the selection lands when its row leaves the list
  folded: Object.create(null) as Record<string, boolean>, // node id -> folded, as the person last set it
  since: 0, // when the counters started: session start, then each /clear or /resume
  counters: emptyCounters(),
  worktrees: [] as Worktree[], // in git's order: the main checkout comes first
  agents: [] as AgentInfo[],
  seen: Object.create(null) as Record<string, AgentInfo>, // every agent listed this session, by id
  spawned: Object.create(null) as Record<string, Spawned>, // by agent id
  mcp: [] as ContextMcpTool[],
}

// Every field back to its start: a register is a fresh load of the module.
export function resetTools(): void {
  Object.assign(T, {
    showAll: false, open: false, loaded: false, route: 'agents', selected: null, selectedAt: 0, folded: Object.create(null), since: 0,
    counters: emptyCounters(), worktrees: [], agents: [], seen: Object.create(null), spawned: Object.create(null), mcp: [],
  })
}

export function applyToolsSettings(o: Record<string, unknown>): void {
  T.enabled = o.enabled !== false // the engine hands a boolean or nothing: on
  T.agentsOnly = o.agents_only === true
  T.refresh = typeof o.refresh === 'number' && Number.isFinite(o.refresh) ? clampRefresh(o.refresh) : REFRESH_DEFAULT
}

// The engine drops a finished agent from its list (seconds after a subagent ends): one listed before and gone now is
// kept, as done. A listed one is taken as listed.
export function mergeAgents(listed: AgentInfo[]): AgentInfo[] {
  const ids = new Set(listed.map(a => a.id))
  for (const a of listed) T.seen[a.id] = a
  for (const [id, a] of Object.entries(T.seen)) if (!ids.has(id) && !isDone(a.status)) T.seen[id] = { ...a, status: 'completed' }
  return Object.values(T.seen)
}

// MCP ---------------------------------------------------------------------------------------------------------------

export type McpPart = { server: string; tool: string }
// A tool called `mcp__<server>__<tool>`: past the `mcp__` prefix, the text up to the first `__` that follows names
// the server, the rest the tool.
export function splitMcp(name: string): McpPart | null {
  const hit = name.match(/^mcp__(.+?)__(.+)$/)
  return hit === null ? null : { server: hit[1]!, tool: hit[2]! }
}

// A wire name's server, by the schemas where they name it: the engine spells a server's name on the wire with each
// character a wire name cannot hold as `_`, so `my server` is `mcp__my_server__t`. The longest wire segment a name
// starts with wins; a name of no listed server is split at its first `__`.
export function mcpSplitter(schema: readonly ContextMcpTool[]) {
  const byWire = new Map<string, string>()
  for (const m of schema) {
    const wire = m.serverName.replace(/[^A-Za-z0-9_-]/g, '_')
    if (m.name.startsWith(`mcp__${wire}__`)) byWire.set(wire, m.serverName)
  }
  const wires = [...byWire.keys()].sort((a, b) => b.length - a.length)
  return (name: string): McpPart | null => {
    const wire = wires.find(w => name.startsWith(`mcp__${w}__`))
    return wire === undefined ? splitMcp(name) : { server: byWire.get(wire)!, tool: name.slice(`mcp__${wire}__`.length) }
  }
}

export type McpRow = { server: string; calls: number; loaded: number; all: number; schemaTokens: number; chars: number }

// One row per server, from the schemas (tools loaded/total, schema tokens of the loaded ones) and from the calls
// (calls, result chars). The servers called first, most calls first; then the others by name.
export function mcpRows(counts: Record<string, ToolCount>, schema: readonly ContextMcpTool[]): McpRow[] {
  const split = mcpSplitter(schema)
  const rows = new Map<string, McpRow>()
  const row = (server: string) => {
    let r = rows.get(server)
    if (!r) rows.set(server, (r = { server, calls: 0, loaded: 0, all: 0, schemaTokens: 0, chars: 0 }))
    return r
  }
  for (const m of schema) {
    const p = split(m.name)
    if (!p) continue
    const r = row(p.server)
    r.all++
    if (m.isLoaded) {
      r.loaded++
      r.schemaTokens += m.tokens
    }
  }
  for (const name of Object.keys(counts)) {
    const p = split(name)
    if (!p) continue
    const n = counts[name]!
    const r = row(p.server)
    r.calls += n.main + n.sub
    r.chars += n.chars
  }
  return [...rows.values()].sort((a, b) => Number(b.calls > 0) - Number(a.calls > 0) || b.calls - a.calls || a.server.localeCompare(b.server))
}

export type ToolRow = { name: string; main: number; sub: number; chars: number; servers?: number }

// One row per tool, most calls first; every MCP tool folds into one `mcp (N servers)` row (the MCP tab has them).
export function toolRows(counts: Record<string, ToolCount>, schema: readonly ContextMcpTool[]): ToolRow[] {
  const split = mcpSplitter(schema)
  const rows: ToolRow[] = []
  const servers = new Set<string>()
  const mcp: ToolRow = { name: '', main: 0, sub: 0, chars: 0 }
  for (const name of Object.keys(counts)) {
    const n = counts[name]!
    const p = split(name)
    if (!p) {
      rows.push({ name, ...n })
      continue
    }
    servers.add(p.server)
    mcp.main += n.main
    mcp.sub += n.sub
    mcp.chars += n.chars
  }
  if (servers.size) rows.push({ ...mcp, name: `mcp (${servers.size} server${servers.size === 1 ? '' : 's'})`, servers: servers.size })
  const total = (r: ToolRow) => r.main + r.sub
  return rows.sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name))
}

export const skillRows = (c: Counters) => Object.entries(c.skills).sort(([an, a], [bn, b]) => b.count - a.count || b.last - a.last || an.localeCompare(bn))

// worktrees and the tree --------------------------------------------------------------------------------------------

// `git worktree list --porcelain`: one block per worktree, the main checkout first, blocks apart by a blank line. A
// block's `worktree <path>` line holds the path whole (spaces and all); `branch refs/heads/<name>`, else `detached`
// or `bare`.
export function readWorktrees(out: string): Worktree[] {
  const list: Worktree[] = []
  for (const block of out.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const head = lines.find(l => l.startsWith('worktree '))
    if (head === undefined) continue
    const ref = lines.find(l => l.startsWith('branch '))?.slice('branch '.length)
    const branch = ref !== undefined ? ref.replace(/^refs\/heads\//, '') : lines.includes('bare') ? 'bare' : lines.includes('detached') ? 'detached' : ''
    list.push({ path: head.slice('worktree '.length), branch })
  }
  return list
}

export type Status = 'running' | 'waiting' | 'done'
export const isDone = (status: string) => status === 'completed' || status === 'failed' || status === 'killed'
export const statusOf = (status: string): Status =>
  isDone(status) ? 'done' : status === 'waiting' || status === 'idle' ? 'waiting' : 'running'

// Live = running, or waiting: a prompt, or an implementer that reported and waits for its next review or fix round. The
// engine lists that one as completed, so the watchdog's verdict decides: `kept` (a stop record, no stop, its task still
// open) is waiting and stays; `stop`, `idle` and `stopped` (a reviewer that reported, a task done or blocked, a stop
// sent) are out. With no verdict (the watchdog off, a nested agent) the list's status decides: completed, failed,
// killed, or gone from the list is finished.
// ponytail: "agent record, no stop event, task not closed" is the one rule for waiting; the records cannot tell a
// finished implementer from one waiting for a fix round any other way.
const DUE = new Set(['stop', 'idle', 'stopped'])
export function isLive(a: AgentInfo): boolean {
  if (a.status === 'killed' || a.status === 'failed') return false // the watchdog's `kept` never revives these
  const kind = W.state.verdicts[a.id]?.kind
  return kind === 'kept' || (!DUE.has(kind ?? '') && !isDone(a.status))
}
export const activeOf = (agents: readonly AgentInfo[], all: boolean) => (all ? agents : agents.filter(isLive))

export type NodeKind = 'root' | 'worktree' | 'agent'
export type Node = {
  id: string
  kind: NodeKind
  label: string
  branch?: string
  type?: string
  model?: string
  status?: Status
  children: Node[]
}

const folderName = (path: string) => path.replace(/\/+$/, '').split('/').pop() || path
const shortModel = (model: string) => /fable|opus|sonnet|haiku/i.exec(model)?.[0].toLowerCase() ?? model
// A path in a folder, or the folder itself; a trailing slash on either side changes nothing (a path that is the
// folder plus slashes starts with `<folder>/`).
const under = (path: string, dir: string) => {
  const d = dir.replace(/\/+$/, '')
  return path === d || path.startsWith(`${d}/`)
}
// This project's agents: the spawn's directory is in a worktree of the session's repo (the main checkout included).
// ponytail: the records hold no project, so the directory agent.spawn gave is the match; an agent with no spawn record
// (spawned before the module loaded) has none and counts as this project's, as the tree already files it under the root.
export const ofProject = (agents: readonly AgentInfo[], spawned: Record<string, Spawned>, worktrees: readonly Worktree[]) =>
  agents.filter(a => !spawned[a.id]?.cwd || worktrees.some(w => under(spawned[a.id]!.cwd, w.path)))

// Root = the main checkout, its children the other worktrees (by path basename, with the branch). An agent sits under
// the deepest worktree its cwd is in (the cwd agent.spawn gave it, else the session's then); one whose cwd is in no
// worktree, or unknown (spawned before this module loaded), sits under the root, before the worktrees. With
// `agentsOnly` a worktree with no agent is left out.
export function buildTree(worktrees: readonly Worktree[], agents: readonly AgentInfo[], spawned: Record<string, Spawned>, agentsOnly: boolean): Node {
  const main = worktrees[0]
  const rest = worktrees.slice(1)
  const root: Node = { id: 'root', kind: 'root', label: main ? folderName(main.path) : '', branch: main?.branch, children: [] }
  const nodes = rest.map(w => ({ path: w.path, node: { id: `wt:${w.path}`, kind: 'worktree', label: folderName(w.path), branch: w.branch, children: [] } as Node }))
  for (const a of agents) {
    const s = spawned[a.id]
    const agent: Node = {
      id: `agent:${a.id}`,
      kind: 'agent',
      label: a.name || s?.name || a.description || a.type,
      type: a.type,
      model: s ? shortModel(s.model) : undefined,
      status: W.state.verdicts[a.id]?.kind === 'kept' && isLive(a) ? 'waiting' : statusOf(a.status), // reported, waiting for its next round
      children: [],
    }
    const cwd = s?.cwd
    const hit = cwd ? nodes.filter(w => under(cwd, w.path)).sort((x, y) => y.path.length - x.path.length)[0] : undefined
    ;(hit?.node ?? root).children.push(agent)
  }
  root.children.push(...nodes.map(w => w.node).filter(n => !agentsOnly || n.children.length > 0))
  return root
}

export type Row = { node: Node; guide: string; depth: number }

// Depth first, a folded node's children left out; `guide` is the `├─ └─ │` prefix its row is drawn after.
export function flatten(root: Node, folded: Record<string, boolean>): Row[] {
  const rows: Row[] = []
  const visit = (n: Node, guide: string, indent: string, depth: number) => {
    rows.push({ depth, guide, node: n })
    if (folded[n.id]) return
    n.children.forEach((child, i) => {
      const end = i === n.children.length - 1
      visit(child, indent + (end ? '└─ ' : '├─ '), indent + (end ? '   ' : '│  '), depth + 1)
    })
  }
  visit(root, '', '', 0)
  return rows
}

// The selected row among `ids`: by its id, else (its row gone) the row now at its last index. Kept for the next draw.
export function selectedIn(ids: readonly string[]): number {
  let i = T.selected !== null ? ids.indexOf(T.selected) : -1
  if (i === -1) i = Math.min(Math.max(T.selectedAt, 0), Math.max(ids.length - 1, 0))
  T.selected = ids[i] ?? null
  T.selectedAt = i
  return i
}
export function select(id: string, ids: readonly string[]): void {
  const i = ids.indexOf(id)
  if (i < 0) return
  T.selected = id
  T.selectedAt = i
}
export function move(ids: readonly string[], by: number): string | null {
  const i = Math.max(0, Math.min(selectedIn(ids) + by, ids.length - 1))
  T.selected = ids[i] ?? null
  T.selectedAt = i
  return T.selected
}
// A node with children folds and unfolds; a leaf has nothing to fold.
export function fold(node: Node | undefined): boolean {
  if (!node?.children.length) return false
  T.folded[node.id] = !T.folded[node.id]
  return true
}

// drawing helpers, `$`-free -----------------------------------------------------------------------------------------

// ≈tokens from chars (÷4), as `1.2k` past a thousand; `-` for none.
export const approxTokens = (chars: number) => (chars > 0 ? tokens(chars / 4) : '-')
export const tokens = (n: number) => (n < 1000 ? String(Math.round(n)) : `${(n / 1000).toFixed(1)}k`)

// `now - then` as the Skills tab draws it: `now`, `42 s ago`, `3 m ago`, `2 h ago`, `4 d ago`.
export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.floor((now - then) / 1000))
  if (s < 5) return 'now'
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} m ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

// the transcript ----------------------------------------------------------------------------------------------------

// The engine's project folder of a directory: each character that is no letter or digit becomes `-`.
export const projectFolder = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, '-')
// This session's transcript among a project folder's files: `<session id>.jsonl` when it is there, else the newest
// `.jsonl`. undefined when there is none.
export function pickTranscript(entries: readonly { name: string; kind: string; mtimeMs: number }[], sessionId: string): string | undefined {
  const files = entries.filter(e => e.kind === 'file' && e.name.endsWith('.jsonl'))
  return files.find(e => e.name === `${sessionId}.jsonl`)?.name ?? [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name
}
// macOS (`uname -s` Darwin) shows the file in Finder; elsewhere the folder opens.
export const revealCommand = (os: string, file: string): string[] =>
  os === 'Darwin' ? ['open', '-R', file] : ['xdg-open', file.replace(/\/[^/]*$/, '') || '/']
