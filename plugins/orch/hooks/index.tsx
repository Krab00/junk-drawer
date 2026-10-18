// Plugin orch's hooks module: the main-loop guard of orchestrator mode (tool.call, agent.spawn), the settings pane
// (/orch panel) and `$.orch` for other plugins. The engine follows `$` only into functions of this file, never
// across an import, so every function that takes `$` lives here; the `$`-free parts are orch-lib.ts (settings,
// the guard's rules) and orch-views.tsx (the pane).
import type { EngineInterface, Register, RenderInput } from 'claude-code'
import type { OrchField, OrchGuard } from '../types'
import { O, PREFIX, SCHEMA, applyOrchSettings, coerce, guardActive, isField, orchGuard, orchSpawn, transcriptTokens, type AgentRecord, type OrchState } from './orch-lib'
import { orchView, type Els } from './orch-views'

type $ = EngineInterface

const PANE = 'orch'
const NO_HOOK = 'orch: the hooks module did not answer'

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}
// Paths follow CLAUDE_CONFIG_DIR like Claude Code itself; tests point it at a fake tree.
const configDir = async ($: $) => (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`

// ------------------------------------------------------------------ the guard's inputs

// The agents that stopped this session, by id and by name: their type and the context tokens of their transcript's
// last usage record (classic.SubagentStop below). SendMessage reaches a stopped agent, and this is what tells
// whether it is a reviewer or over the context cap.
const records = new Map<string, AgentRecord>()

// SendMessage's target: its type from the engine's agent list (by id, or by name, " [ref]" dropped), else from its
// SubagentStop record (by id, and by name for a named agent), which also holds its context tokens. null: neither
// knows it.
async function orchAgent($: $, to: string): Promise<AgentRecord | null> {
  const key = to.replace(/ \[[^\]]*\]$/, '')
  const listed = (await $.agent.list().catch(() => [])).find(a => a.id === key || a.name === key)
  const saved = records.get(listed?.id ?? key) ?? records.get(key)
  if (!listed && !saved) return null
  return { type: listed?.type ?? saved?.type, tokens: saved?.tokens }
}

// Where a path lands, the d.ts `placed` pattern: the file's real path when it exists, else its folder's plus the
// name; undefined when neither resolves. Only absolute paths reach it (the guard refuses any other spelling first).
// A link that leads nowhere is undefined too: Write would follow it and create its target, wherever that is. stat
// follows a link, so the folder's listing (each entry as it stands, an lstat) tells; an unreadable folder is
// undefined. Names compare case-blind, as macOS resolves them.
async function realPath($: $, path: string): Promise<string | undefined> {
  return (await $.fs.stat(path, { resolve: true }).catch(() => undefined))?.realPath
}
async function placed($: $, path: string): Promise<string | undefined> {
  const cut = path.lastIndexOf('/')
  const name = path.slice(cut + 1)
  if (cut < 0 || name === '' || name === '.' || name === '..') return undefined
  const own = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (own) return own.realPath
  const dir = (await realPath($, path.slice(0, cut + 1)))?.replace(/\/$/, '')
  if (dir === undefined) return undefined
  const entries = await $.fs.list(dir || '/').catch(() => undefined)
  const lower = name.toLowerCase()
  return entries && !entries.some(x => x.isLink && x.name.toLowerCase() === lower) ? `${dir}/${name}` : undefined
}

// A Read or Write path as it lands, with the config dir, the plugin's bin/ and the repo resolved alike (a dir that
// doesn't resolve keeps its spelling). ponytail: the dirs are resolved on every call; cache them if it ever shows.
async function orchPlace($: $, path: string, cfg: string, repo: string): Promise<OrchState['placed']> {
  const to = path.startsWith('/') ? await placed($, path) : undefined
  if (to === undefined) return null
  const root = (await realPath($, $.plugin.root)) ?? $.plugin.root
  return {
    path: to,
    configDir: (await realPath($, cfg)) ?? cfg,
    binDir: `${root.replace(/\/$/, '')}/bin/`,
    repo: repo && ((await realPath($, repo)) ?? repo),
  }
}

// The session's repo (git's toplevel of its cwd), whose .orch/ is the task store /orch reads first; '' when the
// cwd is in no repo or git fails. Cached per cwd: a `/cd` moves it.
const repos = new Map<string, string>()
async function sessionRepo($: $): Promise<string> {
  const cwd = await $.session.cwd().catch(() => '')
  if (!cwd) return ''
  let repo = repos.get(cwd)
  if (repo === undefined) {
    const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined)
    repo = r?.exitCode === 0 ? r.stdout.trim() : ''
    repos.set(cwd, repo)
  }
  return repo
}

// The main loop's model, read live so a /model switch counts at once. ponytail: a model that can't be read is no
// Fable: the guard fails open rather than block a session, and says so once per session.
let warned = false
async function liveModel($: $): Promise<string> {
  const model = await $.session.model().catch(() => '')
  if (!model && !warned) {
    warned = true
    $.ui.toast('orch: the main-loop model could not be read, so the fable guard is off this session')
  }
  return model
}

// The guard's inputs, awaited here so orchGuard stays pure.
async function orchCheck($: $, e: { tool: string; agentId?: string; [k: string]: unknown }) {
  if (e.agentId || O.guard === 'off') return undefined
  const model = O.guard === 'fable' ? await liveModel($) : ''
  if (!guardActive(model)) return undefined
  const cfg = await configDir($)
  const exists = e.tool === 'Write' ? await $.fs.exists(String(e.file_path ?? '')).catch(() => true) : undefined
  const agent = e.tool === 'SendMessage' ? await orchAgent($, String(e.to)) : undefined
  const repo = e.tool === 'Read' || e.tool === 'Write' ? await sessionRepo($) : ''
  const where = e.tool === 'Read' || e.tool === 'Write' ? await orchPlace($, String(e.file_path ?? ''), cfg, repo) : undefined
  return orchGuard(e, { model, binDir: `${$.plugin.root}/bin/`, configDir: cfg, repo, exists, agent, placed: where })
}

// ------------------------------------------------------------------ settings

let note = ''
let paneOpen = false
const redraw = ($: $) => $.ui.invalidate('ui.render')

// inject_rules off is the flag file scripts/orch-context.sh falls back to when settings.json holds no value it
// can read (a shell hook reads no `$.config`), written at every change of the row and at session start.
async function writeRulesFlag($: $): Promise<void> {
  const flag = `${await configDir($)}/orch/rules-off`
  if (O.inject_rules) await $.process.run(['rm', '-f', '--', flag])
  else await $.fs.write(flag, '')
}

// A value the row took lands in O (and, for inject_rules, in the flag file). Idempotent: a write of ours passes the
// other plugins' config.set hooks and skips our own, so setOption applies it; the menu's write reaches the hook.
async function apply($: $, key: OrchField, value: OrchGuard | number | boolean): Promise<void> {
  ;(O as Record<string, unknown>)[key] = value
  if (key === 'inject_rules') await writeRulesFlag($)
  redraw($)
}

// Writes one field to its `/config` row (`orch.<field>`) and mirrors it into O. `{ deny }` when the value does not
// fit or a hook refused; the pane's note says which either way.
async function setOption($: $, key: OrchField, raw: unknown) {
  const c = coerce(key, raw)
  if (c.error !== undefined) {
    note = `✗ ${c.error}`
    redraw($)
    return { deny: c.error }
  }
  const { deny } = await $.config.set({ key: `orch.${key}`, value: c.value })
  if (deny !== undefined) {
    note = `✗ ${deny}`
    redraw($)
    return { deny }
  }
  await apply($, key, c.value)
  note = `✓ ${key} = ${String(c.value)}`
  redraw($)
  return { value: O[key] }
}

// Who opened the pane through `$.orch.show({ owner })` (a frame's set of panes); any other open or close clears it,
// so `hide({ owner })` closes only a pane that owner opened and nobody reopened since.
let owner: string | undefined

// `$.ui.open` before any await: only an open made while the press or command runs counts as asked.
async function openPane($: $, focus = true) {
  const opened = $.ui.open({ id: PANE, title: 'orch', focus: focus || undefined })
  owner = undefined
  note = ''
  paneOpen = (await opened).isPlaced
  redraw($)
}
// The engine does not raise our own `$.ui.close` to our `ui.close` hook, so the flag is cleared here.
async function closePane($: $) {
  paneOpen = false
  owner = undefined
  await $.ui.close({ id: PANE })
}
const togglePane = ($: $) => (paneOpen ? closePane($) : openPane($))

export const register: Register = (on, options) => {
  applyOrchSettings(options)

  // `$.orch`, the noun other plugins call. The host hands a noun's method exactly one input and forbids the noun
  // capturing `$`: schema and get need none and answer here; set, open and guardState are answered by the hooks on
  // orch.set / orch.open / orch.guardState below.
  on('engine.create', async (_$, e, next) => ({
    ...(await next(e)),
    orch: {
      schema: async () => SCHEMA.map(f => ({ ...f, ...(f.options ? { options: [...f.options] } : {}) })),
      get: async (input: { key: OrchField }) => {
        if (!isField(input?.key)) throw new Error(`orch: no setting ${String(input?.key)}`)
        return O[input.key]
      },
      set: async () => { throw new Error(NO_HOOK) },
      open: async () => { throw new Error(NO_HOOK) },
      show: async () => { throw new Error(NO_HOOK) },
      hide: async () => { throw new Error(NO_HOOK) },
      guardState: async () => { throw new Error(NO_HOOK) },
    },
  }))
  // A `{ deny }` here rejects the caller's promise with the reason (the host's own rule for a noun's event).
  on('orch.set', async ($, e) => {
    if (!isField(e?.key)) return { deny: `orch: no setting ${String(e?.key)}` }
    if (e.scope !== undefined && e.scope !== 'user') return { deny: `orch: scope ${String(e.scope)} is not supported yet` }
    const r = await setOption($, e.key, e.value)
    return r.deny !== undefined ? { deny: r.deny } : { value: r.value }
  })
  on('orch.open', async $ => {
    await togglePane($)
    return { value: undefined }
  })
  // show never closes: the pane opens (or, up already, is asked again: retitled, the keys asked for); `owner` marks
  // it as that caller's, for hide.
  on('orch.show', async ($, e) => {
    const opened = openPane($, e?.focus === true)
    owner = e?.owner
    await opened
    return { value: undefined }
  })
  // hide closes the pane; with `owner`, only while the pane is still the one that owner's show opened.
  on('orch.hide', async ($, e) => {
    if (e?.owner !== undefined && e.owner !== owner) return { value: undefined }
    await closePane($)
    return { value: undefined }
  })
  on('orch.guardState', async $ => {
    const model = O.guard === 'off' ? await $.session.model().catch(() => '') : O.guard === 'fable' ? await liveModel($) : await $.session.model().catch(() => '')
    return { value: { active: guardActive(model), model } }
  })

  // The /config menu's own writes to an orch row pass here (a hook never sees its plugin's own `$.config.set`): a
  // value `set` would refuse is refused the same way, and one the row took lands in O through `apply`.
  on('config.set', async ($, e, next) => {
    if (!e.key.startsWith('orch.')) return next(e)
    const key = e.key.slice(5)
    if (!isField(key)) return next(e)
    const c = coerce(key, e.value)
    if (c.error !== undefined) return { deny: c.error }
    const r = await next({ ...e, value: c.value })
    if (r.deny === undefined) await apply($, key, c.value)
    return r
  })

  on('session.start', async ($, e, next) => {
    await writeRulesFlag($).catch(() => undefined)
    return next(e)
  })

  // The guard: the model's own calls on the main loop (not another plugin's $.tool.call, not a subagent's). A hook
  // that throws is skipped and the tool runs, so the .catch refuses instead on a guarded main loop.
  on('tool.call', async ($, e, next) => {
    const deny = next.origin.plugin === 'engine' ? await orchCheck($, e) : undefined
    return deny ? { deny } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : O.guard !== 'off' && !e.agentId ? { deny: `${PREFIX} guard error` } : next(e)))

  // The spawn as the engine resolved it (fork, model), behind the Agent rule of the guard above; the model's own
  // spawns only, as for tool.call.
  on('agent.spawn', async ($, e, next) => {
    const deny = next.origin.plugin === 'engine' ? orchSpawn(e) : undefined
    return deny ? { deny } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : O.guard !== 'off' && !e.parentAgentId ? { deny: `${PREFIX} guard error` } : next(e)))

  // A stopped agent's type and context, for the SendMessage rule: by its id, and by its name when it has one.
  // ponytail: the transcript is read whole; tail it through the shell if it ever shows.
  on('classic.SubagentStop', async ($, e, next) => {
    const text = await $.fs.read(e.agent_transcript_path).catch(() => '')
    const record: AgentRecord = { type: e.agent_type, tokens: transcriptTokens(text) }
    records.set(e.agent_id, record)
    const name = (await $.agent.list().catch(() => [])).find(a => a.id === e.agent_id)?.name
    if (name) records.set(name, record)
    return next(e)
  })

  // /orch panel toggles the pane; anything else is the plain /orch.
  on('command.run', { command: 'orch:orch' }, async ($, e, next) => {
    if (e.args.trim() !== 'panel') return next(e)
    await togglePane($)
    return {}
  })

  // The person's closes (q, ×) pass here; ours go through closePane.
  on('ui.close', { id: PANE }, (_$, e, next) => {
    paneOpen = false
    owner = undefined
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e: RenderInput<'Pane'>, next) => {
    if (e.surface === 'mobile') return next(e)
    return orchView($.ui.resolve(e) as Els, e.props, { ...O }, note, {
      close: () => void closePane($),
      set: (key, value) => void setOption($, key, value),
      focus: key => void $.ui.focus({ requestId: PANE, key }).catch(() => undefined), // a refused ring is no error
      refuse: text => {
        note = text
        redraw($)
      },
    })
  })
}
