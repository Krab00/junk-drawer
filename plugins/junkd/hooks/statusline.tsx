// statusline: the `statusline` settings group (enabled and the six segments), /junkd:statusline and its pane. The
// drawing is statusline-views.tsx. The status line itself is bin/statusline.sh, which Claude Code runs from
// ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/statusline.sh (a copy: the plugin's own folder is a versioned cache);
// bin/statusline-setup on|off copies it there and points settings.json's statusLine at it, or takes it out.
// - enabled: true runs `statusline-setup on --config <key>`, false `statusline-setup off`, before the row is stored; a
//   run that refuses (a statusLine of the person's own) or fails is the refusal, and the row stays as it was. At
//   session start, while enabled, `on` runs again when the installed copy is missing or differs from the plugin's (a
//   plugin update, the old plugin's path), or when settings.json has no statusLine, or one of ours whose command is
//   not `<copy> --config <key>`; what it says is not shown.
// - the segments: plain rows; the renderer reads them from settings.json (pluginConfigs) itself on every draw, from
//   the entry the statusLine command names (`--config <key>`): the key this module's options are stored under.
//   The engine does not hand a module its own key, so pluginKey derives it from the plugin's directory: an installed
//   plugin lives in <config>/plugins/cache/<marketplace>/junkd/<version> (key junkd@<marketplace>), any other
//   directory is a --plugin-dir session (key junkd@inline). Without --config the renderer would read the first
//   junkd@ entry, which is the marketplace copy's whenever both are in the file.
// The pane shows the rows, the key and a warning when a second junkd@ config could be the one the line reads, and a
// preview: bin/statusline.sh run on a sample session, after every flip.
import type { On, RenderInput } from 'claude-code'
import type { JunkdStatuslineField as Field } from '../types'
import type { $, HideInput, OpenInput, SetResult, ShowInput } from './feature'
import { isSets, shutSet } from './set'
import { PLUGIN, configKey, configKeys, fieldOf, groupOptions, keyOf, rowsOf } from './settings'
import { FIELDS, plain, statuslineView, type Els } from './statusline-views'

const PANE = 'statusline'
const isField = (key: unknown): key is Field => rowsOf('statusline').some(f => f.field === key)
const S = Object.fromEntries(FIELDS.map(f => [f, true])) as Record<Field, boolean>

let note = ''
let preview = ''
// The key this session's rows are stored under and the second-config warning, read at every refresh.
let configInfo: ConfigNote = { key: '', warn: '' }
// Whether settings.json's statusLine is junkd's: the pane's `wired` switch shows this, not the statusline_enabled
// option (which says only what was asked for; the option can be on while the line is gone).
let wired = false
let paneOpen = false
// Who opened the pane through statuslineShow({ owner }) (the /junkd set); any other open or close clears it.
let owner: string | undefined
function redraw($: $) {
  return $.ui.invalidate('ui.render')
}
const reason = (err: unknown) => (err as Error)?.message ?? String(err)

let home = ''
async function homeDir($: $): Promise<string> {
  if (home) return home
  home = (await $.env.get('HOME')) ?? ''
  if (!home) home = (await $.process.run(['sh', '-c', 'echo $HOME'])).stdout.trim()
  return home
}
async function configDir($: $) {
  return (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await homeDir($)}/.claude`
}

const coerce = (raw: unknown) => raw === true || raw === 'true' || raw === 'on'

// ------------------------------------------------------------------ the pluginConfigs key this module's options live under

// `junkd@<marketplace>` when the plugin's directory is <anything>/plugins/cache/<marketplace>/junkd/<version> (an
// installed copy), `junkd@inline` otherwise (--plugin-dir). Probed on 2.1.303: `$.plugin` has only name and root, a
// module never sees its own plugin.register (provenance), and register(on, options) carries no key.
export function pluginKey(root: string): string {
  const m = /\/plugins\/cache\/([^/]+)\/junkd\/[^/]+\/?$/.exec(root)
  return `${PLUGIN}@${m?.[1] ?? 'inline'}`
}
// The statusLine command that reads `key`: the installed copy and the entry it reads.
const commandFor = (copy: string, key: string) => `${copy} --config ${key}`
// A command of junkd's: the copy (with or without --config) or the legacy path statusline-setup migrates.
const isJunkdCommand = (command: string, cfg: string) =>
  command === `${cfg}/junkd/statusline.sh` || command.startsWith(`${cfg}/junkd/statusline.sh --config `) || command === `${cfg}/junk-drawer-statusline.sh`
// The key a junkd command names (`--config <key>`), '' when it names none.
const keyOfCommand = (command: string) => / --config (\S+)\s*$/.exec(command)?.[1] ?? ''

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
// The user's settings.json as the file has it now (the host's own copy may be a moment old); undefined when it is
// missing or does not parse.
async function userSettings($: $): Promise<Json | undefined> {
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(`${await configDir($)}/settings.json`))
    return isObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
// The junkd@ keys of pluginConfigs in file order.
const junkdKeys = (settings: Json | undefined): string[] =>
  isObject(settings?.pluginConfigs) ? Object.keys(settings.pluginConfigs).filter(k => k.startsWith(`${PLUGIN}@`)) : []

// settings.json's statusLine runs junkd's copy (with or without --config).
export function isWired(settings: Json | undefined, cfg: string): boolean {
  const line = settings?.statusLine
  return isObject(line) && typeof line.command === 'string' && isJunkdCommand(line.command, cfg)
}

// What the pane shows about the key: `key` is the entry this session writes; `warn` is '' or the second-config warning.
export type ConfigNote = { key: string; warn: string }
// The entry the line reads is the statusLine command's --config key; a junkd command with none (installed before the
// key existed) reads the first junkd@ entry; with no junkd command wired, this session's key is the one that counts.
export function configNote(settings: Json | undefined, key: string, cfg: string): ConfigNote {
  const keys = junkdKeys(settings)
  const line = settings?.statusLine
  const command = isObject(line) && typeof line.command === 'string' ? line.command : ''
  const wired = command !== '' && isJunkdCommand(command, cfg)
  const reads = wired ? keyOfCommand(command) || keys[0] || key : key
  const distinct = new Set([key, ...keys, reads])
  if (distinct.size < 2) return { key, warn: '' }
  return { key, warn: `two junkd configs: ${reads} wins${reads === key ? '' : ` (this session writes ${key})`}` }
}

// bin/statusline-setup <mode>: `{ line }` (its last line) on exit 0, `{ deny }` (its reason) otherwise. `on` names the
// entry the line reads: `--config <this module's key>`.
async function runSetup($: $, mode: 'on' | 'off' | 'status'): Promise<{ line: string; deny?: undefined } | { deny: string; line?: undefined }> {
  try {
    const argv = [`${$.plugin.root}/bin/statusline-setup`, mode, ...(mode === 'on' ? ['--config', pluginKey($.plugin.root)] : [])]
    const r = await $.process.run(argv, { env: { CLAUDE_CONFIG_DIR: await configDir($) } })
    const last = (text: string) => text.trim().split('\n').at(-1) ?? ''
    if (r.exitCode === 0) return { line: last(r.stdout) }
    return { deny: last(r.stdout) || last(r.stderr) || `statusline-setup ${mode} exited ${r.exitCode}` }
  } catch (err) {
    return { deny: `statusline-setup ${mode} did not run: ${reason(err)}` }
  }
}

// The renderer on a sample session (model "preview", the project dir, 61k of a 200k context used, the rate limits at
// 12% and 33%), as the segment rows have it now. '' when it cannot run.
async function readPreview($: $): Promise<string> {
  const cwd = await $.session.cwd().catch(() => '')
  const sample = {
    model: { display_name: 'preview' },
    cwd,
    workspace: { current_dir: cwd },
    context_window: { context_window_size: 200000, total_input_tokens: 61000, total_output_tokens: 0, used_percentage: 30.5 },
    rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 33 } },
  }
  try {
    const r = await $.process.run([`${$.plugin.root}/bin/statusline.sh`, '--config', pluginKey($.plugin.root)], { stdin: JSON.stringify(sample), env: { CLAUDE_CONFIG_DIR: await configDir($) } })
    return r.exitCode === 0 ? plain(r.stdout) : ''
  } catch {
    return ''
  }
}
async function refreshPreview($: $) {
  if (!paneOpen) return
  preview = await readPreview($)
  const settings = await userSettings($)
  const cfg = await configDir($)
  configInfo = configNote(settings, pluginKey($.plugin.root), cfg)
  wired = isWired(settings, cfg)
  redraw($)
}

// A row's write, on either path (`store` writes the row): enabled runs its script first and stores nothing when the
// script refuses; a refused row runs the other mode to put settings.json back.
async function storeRow<R extends { deny?: string }>($: $, field: Field, value: boolean, store: () => Promise<R>): Promise<R | { deny: string }> {
  if (field !== 'enabled') return store()
  const run = await runSetup($, value ? 'on' : 'off')
  if (run.deny !== undefined) return { deny: run.deny }
  const r = await store()
  if (r.deny !== undefined) await runSetup($, value ? 'off' : 'on')
  return r
}

// Writes one row and applies it; the pane's note says how it went.
async function setRow($: $, field: Field, raw: unknown): Promise<SetResult> {
  const value = coerce(raw)
  const { deny } = await storeRow($, field, value, () => $.config.set({ key: configKey(keyOf('statusline', field)), value }))
  if (deny !== undefined) {
    note = `✗ ${deny}`
    redraw($)
    return { deny }
  }
  S[field] = value
  note = `✓ ${field} ${value ? 'on' : 'off'}`
  await refreshPreview($)
  redraw($)
  return { value }
}

// `$.ui.open` before any await: only an open made while the press or command runs counts as asked.
async function openPane($: $, focus = true) {
  const opened = $.ui.open({ id: PANE, title: 'statusline', focus: focus || undefined })
  owner = undefined
  note = ''
  paneOpen = (await opened).isPlaced
  await refreshPreview($)
}
// The engine does not raise our own `$.ui.close` to our `ui.close` hook, so the flag is cleared here.
async function closePane($: $) {
  paneOpen = false
  owner = undefined
  await $.ui.close({ id: PANE })
}
function togglePane($: $) {
  return paneOpen ? closePane($) : openPane($)
}

// ------------------------------------------------------------------ what index.tsx and dispatch.ts call

export async function statuslineGet(_$: $, field: string): Promise<boolean> {
  return S[field as Field]
}
export async function statuslineSet($: $, field: string, raw: unknown): Promise<SetResult> {
  if (!isField(field)) return { deny: `junkd: no setting ${keyOf('statusline', field)}` }
  return setRow($, field, raw)
}
// open toggles the pane (no tabs: a route is refused).
export async function statuslineOpen($: $, input: OpenInput = {}): Promise<void> {
  if (input.route !== undefined) throw new Error(`junkd: the statusline pane has no tab ${String(input.route)}`)
  await togglePane($)
}
// show never closes; `owner` marks it as that caller's, for hide.
export async function statuslineShow($: $, input: ShowInput = {}): Promise<void> {
  const opened = openPane($, input.focus === true)
  owner = input.owner
  await opened
}
// hide closes the pane; with `owner`, only while the pane is still the one that owner's show opened.
export async function statuslineHide($: $, input: HideInput = {}): Promise<void> {
  if (input.owner !== undefined && input.owner !== owner) return
  await closePane($)
}
// While enabled: `statusline-setup on` when the installed copy is missing or is not the plugin's script, or when
// settings.json has no statusLine, or a junkd one that does not read this session's key. A statusLine of the person's
// own is left alone (on would only be refused). Silent.
export async function statuslineStart($: $): Promise<void> {
  if (!S.enabled) return
  const cfg = await configDir($)
  const copy = `${cfg}/junkd/statusline.sh`
  const installed = await $.fs.read(copy).catch(() => undefined)
  const ours = await $.fs.read(`${$.plugin.root}/bin/statusline.sh`).catch(() => undefined)
  const line = (await userSettings($))?.statusLine
  const command = isObject(line) && typeof line.command === 'string' ? line.command : undefined
  const settled = command === commandFor(copy, pluginKey($.plugin.root)) || (line !== undefined && line !== null && !(command !== undefined && isJunkdCommand(command, cfg)))
  if (ours !== undefined && installed === ours && settled) return
  await runSetup($, 'on')
}

export function registerStatusline(on: On, options: Record<string, unknown>): void {
  const o = groupOptions(options, 'statusline')
  // The engine hands only a boolean (it refuses another type at load), or none: on.
  for (const f of FIELDS) S[f] = o[f] !== false

  // The /config menu's own writes to a statusline row land here (a hook never sees its plugin's own `$.config.set`):
  // read as `set` reads it; enabled runs its script first, as `set` does.
  on('config.set', { key: configKeys('statusline') }, async ($, e, next) => {
    const field = fieldOf('statusline', e.key)
    if (!isField(field)) return next(e)
    const value = coerce(e.value)
    const r = await storeRow($, field, value, () => next({ ...e, value }))
    if (r.deny === undefined) {
      S[field] = value
      await refreshPreview($)
    }
    return r
  })

  // /junkd:statusline: no argument toggles the pane; on and off set the enabled row; status is a toast.
  on('command.run', { command: 'junkd:statusline' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') {
      await togglePane($)
      return {}
    }
    if (arg === 'on' || arg === 'off') {
      const r = await setRow($, 'enabled', arg)
      $.ui.toast(r.deny !== undefined ? `✗ ${r.deny}` : `✓ statusline ${arg}`)
      return {}
    }
    if (arg === 'status') {
      const r = await runSetup($, 'status')
      const off = FIELDS.filter(f => f !== 'enabled' && !S[f])
      $.ui.toast(r.deny !== undefined ? `✗ ${r.deny}` : `statusline: ${r.line}${off.length ? `; segments off: ${off.join(', ')}` : ''}`)
      return {}
    }
    $.ui.toast('✗ usage: /junkd:statusline [on | off | status]')
    return {}
  })

  // The person's closes (q, ×) pass here; ours go through closePane.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const isSet = isSets(owner)
    paneOpen = false
    owner = undefined
    const r = await next(e)
    if (isSet) await shutSet($)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e: RenderInput<'Pane'>, next) => {
    if (e.surface === 'mobile') return next(e)
    return statuslineView($.ui.resolve(e) as Els, e.props, { values: { ...S, enabled: S.enabled && wired }, preview, note, config: configInfo }, {
      close: () => void (isSets(owner) ? shutSet($) : closePane($)),
      set: (field, value) => void setRow($, field, value),
    })
  })
}
