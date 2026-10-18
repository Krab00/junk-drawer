// The orch mod's `$`-free half: the settings and the main-loop guard. index.tsx does the awaits (the main loop's
// model, the config dir, whether a Write target exists, the SendMessage target's record) and passes the values in.
import type { OrchField, OrchGuard, OrchSchemaEntry } from '../types'

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

// A mirror of plugin.json's `userConfig` (a hooks module cannot import JSON); tests/smoke.sh holds every entry to
// the manifest. `main` marks the three a frame plugin shows first. `guard` is the manifest's string-with-options row.
export const SCHEMA: readonly OrchSchemaEntry[] = [
  { key: 'guard', type: 'string', title: 'Main-loop guard', default: 'fable', main: true, options: ['fable', 'always', 'off'] },
  { key: 'allow_fable_agents', type: 'boolean', title: 'Allow Fable subagents', default: false, main: true },
  { key: 'implementer_ctx_k', type: 'number', title: 'Implementer context cap (k tokens)', default: 400, main: true },
  { key: 'ui_review', type: 'boolean', title: 'UI review', default: true, main: false },
  { key: 'inject_rules', type: 'boolean', title: 'Inject orchestrator rules', default: true, main: false },
  { key: 'rounds', type: 'number', title: 'Fix rounds', default: 3, main: false },
]
export const isField = (key: unknown): key is OrchField => SCHEMA.some(f => f.key === key)
// The two number rows take a whole number in these bounds; the manifest has no min/max field, so they live here.
export const ORCH_RANGE: Record<'implementer_ctx_k' | 'rounds', readonly [number, number]> = { implementer_ctx_k: [50, 1000], rounds: [1, 10] }
export type OrchValues = { guard: OrchGuard; allow_fable_agents: boolean; implementer_ctx_k: number; ui_review: boolean; inject_rules: boolean; rounds: number }
export const O: OrchValues = { guard: 'fable', allow_fable_agents: false, implementer_ctx_k: 400, ui_review: true, inject_rules: true, rounds: 3 }

// A raw value (typed in the pane, handed to $.orch.set, or written in the /config menu) to the field's kind;
// `error` when it does not fit. The one check for every write path.
export type Coerced = { value: OrchGuard | number | boolean; error?: undefined } | { error: string; value?: undefined }
export function coerce(key: OrchField, raw: unknown): Coerced {
  if (key === 'guard') {
    const v = String(raw).trim().toLowerCase()
    return v === 'fable' || v === 'always' || v === 'off' ? { value: v } : { error: `${String(raw)} is not a valid guard (fable, always or off)` }
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
  const g = coerce('guard', v.guard)
  O.guard = g.error === undefined ? (g.value as OrchGuard) : 'fable'
  O.allow_fable_agents = v.allow_fable_agents === true
  O.ui_review = v.ui_review === undefined ? true : v.ui_review === true
  O.inject_rules = v.inject_rules === undefined ? true : v.inject_rules === true
  for (const key of ['implementer_ctx_k', 'rounds'] as const) {
    const x = v[key]
    const n = Math.round(typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN)
    const [lo, hi] = ORCH_RANGE[key]
    O[key] = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : (SCHEMA.find(f => f.key === key)!.default as number)
  }
}

// Coordination only. RemoteTrigger runs a claude.ai routine (main-loop-only tool: its OAuth token is in-process, a
// subagent has none). Agent, SendMessage, Read, Write, Bash, Monitor, CronCreate and ScheduleWakeup have rules below.
const ALLOW = new Set([
  'ListAgents', 'TaskStop', 'AskUserQuestion', 'ToolSearch', 'Skill',
  'CronList', 'CronDelete', 'EnterPlanMode', 'ExitPlanMode', 'PushNotification', 'RemoteTrigger',
])
const REVIEWER = /^(orch:)?(verify-coordinator|ui-reviewer)$/
const MODELS = new Set(['opus', 'sonnet', 'haiku']) // an Agent's `model`: never inherit; fable only as below
const FABLE = /fable/i // `fable` or a full Fable id: an Agent's explicit model, only with allow_fable_agents
const PLAIN_PATH = /^\/[\x20-\x7e]*$/ // absolute, printable ASCII: no `~`-relative, no Unicode alias of a name
// The engine already refuses built-ins and disable-model-invocation skills from a scheduled prompt; this rule
// keeps the main loop to /orch and /loop (of an allowed prompt) or a plain prompt, as defence in depth.
const LOOP = /^\/loop(\s+\d+[smhd])?(\s+|$)/
const ORCH_CMD = /^\/orch(:orch)?(\s|$)/ // the plugin command, bare or namespaced
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
// plugins/ path (a marketplace's, the plugin cache, a --plugin-dir checkout), a .claude-plugin/ manifest dir.
// Case-insensitive: macOS paths are.
const NEVER_WRITE =
  /\/\.claude\/settings[^/]*\.json$|\/plugins\/(.*\/)?(agents|commands|skills|hooks|rules|output-styles)\/|\/\.claude-plugin\/|(^|\/)(CLAUDE|CLAUDE\.local|AGENTS|SKILL)\.md$/i
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

// The repo's task store (.orch/: the config, the task files, _lessons.md), which /orch reads and writes first.
const inStore = (path: string, repo: string) => repo !== '' && under(path, `${repo}/.orch`)

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
  if (!forbidden(path, s) && (inRoots(path, s.configDir) || inStore(path, s.repo) || (path.endsWith('.md') && s.exists === false))) return undefined
  return `${PREFIX} the main loop may Write only to the scratchpad, the repo's .orch/ task store, the orch state dir, the handoffs, the project memory or a new .md file, never to settings, Claude Code config (a .claude dir, the skills, agents, rules, commands, hooks of any plugin, CLAUDE.md, AGENTS.md, SKILL.md, anything else in the config dir) or this plugin. For ${path}, ask the user for a target path or delegate.`
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

// Whether the guard holds the main loop right now: `fable` = the main loop's model is a Fable, `always` = any
// model, `off` = never.
export const guardActive = (model: string, o = O): boolean => o.guard === 'always' || (o.guard === 'fable' && FABLE.test(model))

// A deny text, or undefined to let the call through. Only the main loop is guarded (a subagent's call passes),
// and only while `guard` matches (guardActive).
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
      return `${PREFIX} ${e.tool} may schedule only /orch, /loop or a plain prompt; a scheduled ${prompt.split(/\s/)[0]} would run as a command in this loop.`
    }
    case 'Bash':
      return isBinCall(String(e.command ?? ''), s.binDir) ? undefined : deny("Bash (only the orch plugin's own bin/ scripts, plain arguments)")
    case 'Monitor': // a command runs in Bash's shell: the same rule; a WebSocket monitor runs nothing
      return e.command === undefined || isBinCall(String(e.command), s.binDir) ? undefined : deny("Monitor with a command (only the orch plugin's own bin/ scripts)")
    case 'Agent': {
      const type = String(e.subagent_type ?? '')
      const model = e.model === undefined ? undefined : String(e.model).trim().toLowerCase()
      if (type === 'fork' || (model === undefined ? !type.startsWith('orch:') : !MODELS.has(model) && !(o.allow_fable_agents && FABLE.test(model))))
        return `${PREFIX} a fork, an Agent without a model (other than an orch: type) or with a model other than opus, sonnet or haiku runs on the main loop's model or a costlier one. Set model: opus|sonnet|haiku, or use an orch: agent type without a model (theirs is pinned). A Fable subagent needs the user's ask and allow_fable_agents on (/orch panel).`
      return undefined
    }
    case 'SendMessage': {
      const a = s.agent
      if (a === null) return `${PREFIX} no agent "${String(e.to)}" is known (not in the agent list, no SubagentStop record). Spawn a fresh agent.`
      const type = a?.type ?? ''
      if (REVIEWER.test(type)) return `${PREFIX} ${type.replace(/^orch:/, '')} is a reviewer, and reviewers are always fresh: spawn a new one.`
      if (a?.tokens !== undefined && a.tokens > o.implementer_ctx_k * 1000)
        return `${PREFIX} implementer context ${Math.round(a.tokens / 1000)}k exceeds cap ${o.implementer_ctx_k}k: spawn a fresh implementer, hand it \`git diff <base>...<branch>\` and why previous rounds failed.`
      return undefined
    }
  }
  return ALLOW.has(e.tool) ? undefined : deny(e.tool)
}

// agent.spawn, as the engine resolved the Agent call: the backstop of the Agent rule above, on the main loop only.
// A fork, or a model that resolves to a Fable (given; `inherit`, which is the parent's; or none on a non-orch
// type, whose own definition has none pinned), is refused; a Fable given explicitly passes with allow_fable_agents.
// A `context: fork` skill raises no agent.spawn (its loop starts without one), so it is not seen here.
export function orchSpawn(
  e: { fork: boolean; model?: string; subagentType: string; parentModel: string; parentAgentId?: string },
  o = O,
): string | undefined {
  if (e.parentAgentId || !guardActive(e.parentModel, o)) return undefined
  const given = e.model?.trim() ?? ''
  const inherits = given === '' || given.toLowerCase() === 'inherit'
  const model = given.toLowerCase() === 'inherit' ? e.parentModel : given || (e.subagentType.startsWith('orch:') ? '' : e.parentModel)
  if (e.fork || (FABLE.test(model) && (inherits || !o.allow_fable_agents)))
    return `${PREFIX} this subagent would run on ${e.fork ? "the main loop's model (a fork)" : model}. Set model: opus|sonnet|haiku, or use an orch: agent type without a model.`
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
