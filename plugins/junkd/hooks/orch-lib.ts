// orch's `$`-free half: the settings and the main-loop guard. orch.tsx does the awaits (the main loop's
// model, the config dir, whether a Write target exists, the SendMessage target's record) and passes the values in.
import type { JunkdOrchField as OrchField, JunkdOrchGuard as OrchGuard } from '../types'
import { rowsOf } from './settings'

// One row of the orch group as this file and orch-views.tsx read it: the field (not the `orch_` row key).
export type OrchSchemaEntry = {
  key: OrchField
  type: 'string' | 'number' | 'boolean'
  title: string
  default: string | number | boolean
  main: boolean
  options?: readonly string[]
}

export type AgentRecord = { type?: string; tokens?: number } // SendMessage target: agent type, context tokens
export type OrchState = {
  model: string
  binDir: string // `${plugin root}/bin/`
  configDir: string // CLAUDE_CONFIG_DIR or ~/.claude
  repo: string // the session's git toplevel, whose .orch/ is the task store; '' when the session is in no repo
  exists?: boolean // Write: whether file_path exists already
  agent?: AgentRecord | null // SendMessage: the target, null = no agent of that id or name is known
  // Read/Write: where file_path lands (symlinks, case and Unicode aliases resolved) and the two dirs resolved the
  // same way; null = it can't be placed (its folder doesn't resolve). Left out, only the spelling is checked.
  placed?: { path: string; configDir: string; binDir: string; repo: string } | null
}

// The orch rows of settings.ts (the one mirror of plugin.json's userConfig; tests/smoke.sh holds it to the
// manifest), keyed by field. `main` marks the rows the /junkd pane draws first. `guard` is the string-with-options row.
export const SCHEMA: readonly OrchSchemaEntry[] = rowsOf('orch').map(f => ({
  key: f.field as OrchField,
  type: f.type,
  title: f.title,
  default: f.default,
  main: f.main,
  ...(f.options ? { options: f.options } : {}),
}))
export const isField = (key: unknown): key is OrchField => SCHEMA.some(f => f.key === key)
// The dashboard's two number rows: any finite number, rounded and clamped to these bounds (the manifest has no
// min/max: the engine would refuse the whole module over a stored value out of range).
export type DashField = 'dashboard_refresh' | 'dashboard_window_h'
export type DashValues = { dashboard_refresh: number; dashboard_window_h: number }
export const DASH_RANGE: Record<DashField, readonly [number, number]> = { dashboard_refresh: [5, 600], dashboard_window_h: [1, 168] }
export const DASH_DEFAULTS: DashValues = { dashboard_refresh: 30, dashboard_window_h: 24 }
export const isDashField = (key: unknown): key is DashField => key === 'dashboard_refresh' || key === 'dashboard_window_h'
export const clampDash = (key: DashField, n: number): number => Math.min(DASH_RANGE[key][1], Math.max(DASH_RANGE[key][0], Math.round(n)))
// A number, or a string holding one (trimmed); NaN for anything else.
const asNumber = (raw: unknown): number => (typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN)
// The number rows take a whole number in these bounds; the manifest has no min/max field, so they live here.
export type OrchNumberField = 'implementer_ctx_k' | 'rounds' | 'idle_stop_minutes' | 'stall_minutes'
export const ORCH_RANGE: Record<OrchNumberField, readonly [number, number]> = { implementer_ctx_k: [50, 1000], rounds: [1, 10], idle_stop_minutes: [1, 120], stall_minutes: [1, 120] }
// The watchdog's minutes are clamped on every write (any finite number is taken, rounded into the bounds); the other
// two number rows refuse a value out of their bounds.
export const CLAMPED: ReadonlySet<string> = new Set(['idle_stop_minutes', 'stall_minutes'])
const clampTo = (key: OrchNumberField, n: number) => Math.min(ORCH_RANGE[key][1], Math.max(ORCH_RANGE[key][0], Math.round(n)))
export type OrchValues = {
  enabled: boolean; guard: OrchGuard; allow_fable_agents: boolean; implementer_ctx_k: number; ui_review: boolean; inject_rules: boolean; rounds: number; claude_md: boolean
  watchdog: boolean; idle_stop: boolean; idle_stop_minutes: number; stall_minutes: number; lessons: boolean
} & DashValues
export const O: OrchValues = {
  enabled: true, guard: 'fable', allow_fable_agents: false, implementer_ctx_k: 400, ui_review: true, inject_rules: true, rounds: 3, claude_md: false,
  watchdog: true, idle_stop: true, idle_stop_minutes: 10, stall_minutes: 15, lessons: true, ...DASH_DEFAULTS,
}

// A raw value (typed in the pane, handed to $.junkd.set, or written in the /config menu) to the field's kind;
// `error` when it does not fit. The one check for every write path.
export type Coerced = { value: OrchGuard | number | boolean; error?: undefined } | { error: string; value?: undefined }
export function coerce(key: OrchField, raw: unknown): Coerced {
  if (key === 'guard') {
    const v = String(raw).trim().toLowerCase()
    return v === 'fable' || v === 'always' || v === 'off' ? { value: v } : { error: `${String(raw)} is not a valid guard (fable, always or off)` }
  }
  if (isDashField(key)) {
    const n = asNumber(raw)
    const [lo, hi] = DASH_RANGE[key]
    return Number.isFinite(n) ? { value: clampDash(key, n) } : { error: `${String(raw)} is not a valid ${key} (a number, ${lo}–${hi})` }
  }
  if (key === 'idle_stop_minutes' || key === 'stall_minutes') {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
    const [lo, hi] = ORCH_RANGE[key]
    return Number.isFinite(n) ? { value: clampTo(key, n) } : { error: `${String(raw)} is not a valid ${key} (minutes, ${lo}–${hi})` }
  }
  if (key === 'implementer_ctx_k' || key === 'rounds') {
    const [lo, hi] = ORCH_RANGE[key]
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
    return Number.isInteger(n) && n >= lo && n <= hi ? { value: n } : { error: `${String(raw)} is not a valid ${key} (a whole number ${lo}–${hi})` }
  }
  return { value: raw === true || raw === 'true' || raw === 'on' }
}

// The options the engine fills in from the manifest at load: a key left out or of the wrong type keeps the default,
// a number out of range is clamped (a load is no write, so nothing is refused).
export function applyOrchSettings(v: Record<string, unknown>): void {
  O.enabled = v.enabled === undefined ? true : v.enabled === true
  const g = coerce('guard', v.guard)
  O.guard = g.error === undefined ? (g.value as OrchGuard) : 'fable'
  O.allow_fable_agents = v.allow_fable_agents === true
  O.ui_review = v.ui_review === undefined ? true : v.ui_review === true
  O.inject_rules = v.inject_rules === undefined ? true : v.inject_rules === true
  O.claude_md = v.claude_md === true
  O.watchdog = v.watchdog === undefined ? true : v.watchdog === true
  O.idle_stop = v.idle_stop === undefined ? true : v.idle_stop === true
  O.lessons = v.lessons === undefined ? true : v.lessons === true
  for (const key of ['implementer_ctx_k', 'rounds', 'idle_stop_minutes', 'stall_minutes'] as const) {
    const x = v[key]
    const n = Math.round(typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN)
    O[key] = Number.isFinite(n) ? clampTo(key, n) : (SCHEMA.find(f => f.key === key)!.default as number)
  }
  for (const key of ['dashboard_refresh', 'dashboard_window_h'] as const) {
    const n = asNumber(v[key])
    O[key] = Number.isFinite(n) ? clampDash(key, n) : DASH_DEFAULTS[key]
  }
}

// Coordination only. RemoteTrigger runs a claude.ai routine (main-loop-only tool: its OAuth token is in-process, a
// subagent has none). Agent, SendMessage, Read, Write, Bash, Monitor, CronCreate and ScheduleWakeup have rules below.
const ALLOW = new Set([
  'ListAgents', 'TaskStop', 'AskUserQuestion', 'ToolSearch', 'Skill',
  'CronList', 'CronDelete', 'EnterPlanMode', 'ExitPlanMode', 'PushNotification', 'RemoteTrigger',
  'ReadNotifications', // the session's own notification queue (the handoff chain reads it): nothing to delegate
])
const AGENT_ID = /^a[0-9a-f]{15,}$/ // a subagent's id (`a` + 16 hex); any other recipient is a peer session (by name), `main` or a protocol reply
// A SendMessage recipient as the guard reads it: trimmed, ListAgents' " [ref]" dropped, trimmed again.
export const recipient = (to: unknown): string => String(to).trim().replace(/ \[[^\]]*\]$/, '').trim()
const REVIEWER = /^(junkd:)?(verify-coordinator|ui-reviewer|test-planner)$/
const MODELS = new Set(['opus', 'sonnet', 'haiku']) // an Agent's `model`: never inherit; fable only as below
const FABLE = /fable/i // `fable` or a full Fable id: an Agent's explicit model, only with allow_fable_agents
const PLAIN_PATH = /^\/[\x20-\x7e]*$/ // absolute, printable ASCII: no `~`-relative, no Unicode alias of a name
// The engine already refuses built-ins and disable-model-invocation skills from a scheduled prompt; this rule
// keeps the main loop to /junkd:orch and /loop (of an allowed prompt) or a plain prompt, as defence in depth.
const LOOP = /^\/loop(\s+\d+[smhd])?(\s+|$)/
const ORCH_CMD = /^\/(junkd:)?orch(\s|$)/ // the plugin's skill, namespaced or bare
const scheduled = (p: string): boolean => {
  if (!p.startsWith('/') || ORCH_CMD.test(p)) return true
  const loop = LOOP.exec(p)
  return loop !== null && scheduled(p.slice(loop[0].length))
}
const SCRATCHPAD = /^(\/private)?\/tmp\/claude-\d+\/[^/]+\/[^/]+\/scratchpad\// // <tmp>/claude-<uid>/<project>/<session>/scratchpad/
const MEMORY = /^projects\/[^/]+\/memory\// // under the config dir: a project's auto-memory
const DOTDOT = /(^|\/)\.\.(\/|$)/
// Never written, even inside a root: settings and whatever Claude Code loads as config or instructions (a new skill
// or agent would be live in this session): a .claude dir (the config dir's own roots aside), any plugin under a
// plugins/ path (a marketplace's, the plugin cache, a --plugin-dir checkout), a .claude-plugin/ manifest dir, and
// this module's own control state (junkd/orch-off and junkd/orch-rules-off, the enabled and inject_rules flags, or
// anything under those names: a directory there would read as the flag; junkd/orch/_agents/, the SubagentStop
// records the SendMessage rule reads). Case-insensitive: macOS paths are.
const NEVER_WRITE =
  /\/junkd\/orch-(rules-)?off(\/|$)|\/junkd\/orch\/_agents(\/|$)|\/\.claude\/settings[^/]*\.json$|\/plugins\/(.*\/)?(agents|commands|skills|hooks|rules|output-styles)\/|\/\.claude-plugin\/|(^|\/)(CLAUDE|CLAUDE\.local|AGENTS|SKILL)\.md$/i
const DOT_CLAUDE = /\/\.claude\//i
const LOADED = /\/(agents|commands|skills|hooks|rules|output-styles)\//i
const SCRIPT = /^([A-Za-z0-9][A-Za-z0-9._-]*)([\s\S]*)$/ // a file right in bin/: no slash, so no `..` can lead out of it
const ARGS = /^( [A-Za-z0-9 _./:=@+-]*)?$/ // plain words: no quote, $, `, ;, &, |, <, >, newline

export const PREFIX = 'Orchestrator mode (orch):'
const deny = (what: string) =>
  `${PREFIX} the main loop may not run ${what}. Delegate it to a subagent with the Agent tool (sonnet for reads, opus for code); have it write a report to the scratchpad and return one line, then Read that path.`

// `/./` and `//` segments dropped, so a path is matched as the file system resolves it (`..` is refused apart).
const norm = (path: string) => path.split('/').filter((seg, i) => i === 0 || (seg !== '' && seg !== '.')).join('/')
const under = (path: string, dir: string) => path.toLowerCase().startsWith(`${dir.toLowerCase()}/`)

// The session scratchpad, and in the config dir the orch state, the handoffs and the projects' auto-memory.
const inRoots = (path: string, cfg: string) => {
  const rest = path.startsWith(`${cfg}/`) ? path.slice(cfg.length + 1) : undefined
  return SCRATCHPAD.test(path) || (rest !== undefined && (rest.startsWith('orch/') || rest.startsWith('handoffs/') || MEMORY.test(rest)))
}

// The repo's task store (.orch/: the config, the task files, _lessons.md), which /junkd:orch reads and writes first.
const inStore = (path: string, repo: string) => repo !== '' && under(path, `${repo}/.orch`)
// Write in the store: a .md only (task files, _lessons.md, notes), never the existing config: its tasks_dir steers the
// bin scripts. A new config.md passes as any new .md does; changing one is delegated.
const storeWrite = (path: string, repo: string) =>
  inStore(path, repo) && /\.md$/i.test(path) && path.toLowerCase() !== `${repo}/.orch/config.md`.toLowerCase()

// Write: never the deny list, a `..` path, a .claude dir or the config dir outside the roots, this plugin (its root
// is bin/'s parent) or a loaded dir anywhere in its marketplace (`<marketplace>/plugins/<name>/bin/`; a plugin may
// sit at its root).
const forbidden = (path: string, s: OrchState) => {
  const market = /^(.*)\/plugins\/[^/]+\/bin\/$/i.exec(s.binDir)?.[1]
  return NEVER_WRITE.test(path) || DOTDOT.test(path) || ((DOT_CLAUDE.test(path) || under(path, s.configDir)) && !inRoots(path, s.configDir)) ||
    (s.binDir !== '' && under(path, s.binDir.replace(/\/bin\/$/, ''))) ||
    (market !== undefined && under(path, market) && LOADED.test(path.slice(market.length)))
}

// Read and Write of one spelling of the path, against the dirs spelled alike.
function pathRule(tool: string, path: string, s: OrchState): string | undefined {
  if (tool === 'Read')
    return (inRoots(path, s.configDir) || inStore(path, s.repo)) && !DOTDOT.test(path)
      ? undefined
      : deny("Read outside the scratchpad, the repo's .orch/ task store, the orch state dir, the handoffs and the project memory")
  if (!forbidden(path, s) && (inRoots(path, s.configDir) || storeWrite(path, s.repo) || (path.endsWith('.md') && s.exists === false))) return undefined
  return `${PREFIX} the main loop may Write only to the scratchpad, a .md in the repo's .orch/ task store (not an existing config.md), the orch state dir, the handoffs, the project memory or a new .md file, never to settings, Claude Code config (a .claude dir, the skills, agents, rules, commands, hooks of any plugin, CLAUDE.md, AGENTS.md, SKILL.md, anything else in the config dir) or this plugin. For ${path}, ask the user for a target path or delegate.`
}

// `<bin>/<script> <plain args>`, one optional pair of quotes around the script path.
function isBinCall(command: string, binDir: string): boolean {
  if (!binDir) return false
  let rest = command.trim()
  const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : ''
  rest = rest.slice(quote.length)
  if (!rest.startsWith(binDir)) return false
  const m = SCRIPT.exec(rest.slice(binDir.length))
  if (!m) return false
  let args = m[2]!
  if (quote) {
    if (args[0] !== quote) return false
    args = args.slice(1)
  }
  return ARGS.test(args)
}

// Whether the guard holds the main loop right now: never while orch is disabled; else `fable` = the main loop's
// model is a Fable, `always` = any model, `off` = never.
export const guardActive = (model: string, o = O): boolean => o.enabled && (o.guard === 'always' || (o.guard === 'fable' && FABLE.test(model)))

// A deny text, or undefined to let the call through. Only the main loop is guarded (a subagent's call passes),
// and only while orch is enabled and `guard` matches (guardActive).
export function orchGuard(e: { tool: string; agentId?: string; [k: string]: unknown }, s: OrchState, o = O): string | undefined {
  if (e.agentId || !guardActive(s.model, o)) return undefined
  switch (e.tool) {
    case 'Read':
    case 'Write': {
      // Both spellings must pass: the path as given and where it lands, each against the dirs spelled alike.
      const raw = String(e.file_path ?? '')
      if (raw !== raw.trim() || !PLAIN_PATH.test(raw))
        return `${PREFIX} ${e.tool} of "${raw}": use a plain absolute ASCII path (no ~, no relative path, no surrounding spaces, no non-ASCII letters).`
      if (s.placed === null) return `${PREFIX} ${e.tool} of ${raw}: the path can't be placed (its folder doesn't resolve, or it is a link to nothing). Delegate it, or use an existing folder.`
      return pathRule(e.tool, norm(raw), s) ?? (s.placed ? pathRule(e.tool, norm(s.placed.path), { ...s, ...s.placed }) : undefined)
    }
    case 'CronCreate':
    case 'ScheduleWakeup': {
      const prompt = typeof e.prompt === 'string' ? e.prompt.trimStart() : undefined
      if (prompt === undefined || e.stop === true || scheduled(prompt)) return undefined
      return `${PREFIX} ${e.tool} may schedule only /junkd:orch, /loop or a plain prompt; a scheduled ${prompt.split(/\s/)[0]} would run as a command in this loop.`
    }
    case 'Bash':
      return isBinCall(String(e.command ?? ''), s.binDir) ? undefined : deny("Bash (only the junkd plugin's own bin/ scripts, plain arguments)")
    case 'Monitor': // a command runs in Bash's shell: the same rule; a WebSocket monitor runs nothing
      return e.command === undefined || isBinCall(String(e.command), s.binDir) ? undefined : deny("Monitor with a command (only the junkd plugin's own bin/ scripts)")
    case 'Agent': {
      const type = String(e.subagent_type ?? '')
      const model = e.model === undefined ? undefined : String(e.model).trim().toLowerCase()
      if (type === 'fork' || (model === undefined ? !type.startsWith('junkd:') : !MODELS.has(model) && !(o.allow_fable_agents && FABLE.test(model))))
        return `${PREFIX} a fork, an Agent without a model (other than a junkd: type) or with a model other than opus, sonnet or haiku runs on the main loop's model or a costlier one. Set model: opus|sonnet|haiku, or use a junkd: agent type without a model (theirs is pinned). A Fable subagent needs the user's ask and allow_fable_agents on (/junkd:orch panel).`
      return undefined
    }
    case 'SendMessage': {
      const a = s.agent
      // Unknown: refused only when it is spelled as a subagent id of this session. A name nobody carries (a peer
      // session, ListAgents' " [ref]" dropped) is the engine's to resolve; it reaches no subagent of this loop.
      if (a === null) return AGENT_ID.test(recipient(e.to).toLowerCase()) ? `${PREFIX} no agent "${String(e.to)}" is known (not in the agent list, no SubagentStop record). Spawn a fresh agent.` : undefined
      const type = a?.type ?? ''
      if (REVIEWER.test(type)) return `${PREFIX} ${type.replace(/^junkd:/, '')} is a reviewer, and reviewers are always fresh: spawn a new one.`
      if (a?.tokens !== undefined && a.tokens > o.implementer_ctx_k * 1000)
        return `${PREFIX} implementer context ${Math.round(a.tokens / 1000)}k exceeds cap ${o.implementer_ctx_k}k: spawn a fresh implementer, hand it \`git diff <base>...<branch>\` and why previous rounds failed.`
      return undefined
    }
  }
  return ALLOW.has(e.tool) ? undefined : deny(e.tool)
}

// agent.spawn, as the engine resolved the Agent call: the backstop of the Agent rule above, on the main loop only.
// A fork, or a model that resolves to a Fable (given; `inherit`, which is the parent's; or none on a non-junkd
// type, whose own definition has none pinned), is refused; a Fable given explicitly passes with allow_fable_agents.
// A `context: fork` skill raises no agent.spawn (its loop starts without one), so it is not seen here.
export function orchSpawn(
  e: { fork: boolean; model?: string; subagentType: string; parentModel: string; parentAgentId?: string },
  o = O,
): string | undefined {
  if (e.parentAgentId || !guardActive(e.parentModel, o)) return undefined
  const given = e.model?.trim() ?? ''
  const inherits = given === '' || given.toLowerCase() === 'inherit'
  const model = given.toLowerCase() === 'inherit' ? e.parentModel : given || (e.subagentType.startsWith('junkd:') ? '' : e.parentModel)
  if (e.fork || (FABLE.test(model) && (inherits || !o.allow_fable_agents)))
    return `${PREFIX} this subagent would run on ${e.fork ? "the main loop's model (a fork)" : model}. Set model: opus|sonnet|haiku, or use a junkd: agent type without a model.`
  return undefined
}

// The tokens of an agent's context from its transcript: the last usage record's input + cache-write + cache-read
// (its last iteration when the request ran server tools: the top level then sums iterations). undefined: none found.
export function transcriptTokens(text: string): number | undefined {
  const lines = text.split('\n').filter(l => l.includes('"usage"'))
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const u = (JSON.parse(lines[i]!) as { message?: { usage?: Record<string, unknown> } }).message?.usage
      if (typeof u !== 'object' || u === null) continue
      const iterations = u.iterations
      const last = (Array.isArray(iterations) && iterations.length ? iterations[iterations.length - 1] : u) as Record<string, unknown>
      const n = (k: string) => (typeof last[k] === 'number' ? (last[k] as number) : 0)
      return n('input_tokens') + n('cache_creation_input_tokens') + n('cache_read_input_tokens')
    } catch {
      continue
    }
  }
  return undefined
}
