// statusline: the `statusline` settings group (enabled and the six segments), /junkd:statusline and its pane. The
// drawing is statusline-views.tsx. The status line itself is bin/statusline.sh, which Claude Code runs from
// ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/statusline.sh (a copy: the plugin's own folder is a versioned cache);
// bin/statusline-setup on|off copies it there and points settings.json's statusLine at it, or takes it out.
// - enabled: true runs `statusline-setup on --config <key>`, false `statusline-setup off`, before the row is stored; a
//   run that refuses (a statusLine of the person's own) or fails is the refusal, and the row stays as it was. Then the
//   row waits until the host has read settings.json again (hostReadsFile: the host writes its own copy of the file back
//   whole with the row, and would put the line back or drop it), and once it is stored the file is looked at: when it
//   does not say what the row says, the script runs once more. At session start, while enabled, `on` runs again when
//   the installed copy is missing or differs from the plugin's (a plugin update, the old plugin's path), or when
//   settings.json has no statusLine, or one of ours whose command is not `<copy> --config <key>`; what it says is not
//   shown. While the row is off, `off` runs at the start when settings.json still has junkd's line (the host wrote its
//   copy back after the row's own `off`; the write reloaded the module, so the copy that stored the row never looked
//   again). The start waits for the host the same way and looks again VERIFY_MS later (another writer of settings.json
//   at the session start can drop the line, or put it back).
// - the segments: plain rows; the renderer reads them from settings.json (pluginConfigs) itself on every draw, from
//   the entry the statusLine command names (`--config <key>`): the key this module's options are stored under.
//   The engine does not hand a module its own key, so pluginKey derives it from the plugin's directory: an installed
//   plugin lives in <config>/plugins/cache/<marketplace>/junkd/<version> (key junkd@<marketplace>), any other
//   directory is a --plugin-dir session (key junkd@inline). Without --config the renderer would read the first
//   junkd@ entry, which is the marketplace copy's whenever both are in the file.
// The pane shows the rows, the key and a warning when a second junkd@ config could be the one the line reads, and a
// preview: bin/statusline.sh run on a sample session, after every flip.
// - every write of a row makes the host load this module again (it reads pluginConfigs anew), with the pane still on the
//   screen: the new copy has nothing in memory, and the copy that wrote the row is cancelled where it waits. The start
//   takes the pane back (adoptPane): it is among the panes the host has up, the files say what to draw, and the note of the
//   flip was kept in $.store before the write. The key row is drawn from the first frame, so the rows never move under a
//   click. A press is served by the `ui.press` hook (the closure of the drawing is gone for a moment after a reload), flips
//   the row as it stands (not as an older drawing held it), waits for a script that is rewriting settings.json, and is
//   refused while the wired switch is being applied.
import type { On, RenderInput } from 'claude-code'
import type { JunkdStatuslineField as Field } from '../types'
import type { $, HideInput, OpenInput, SetResult, ShowInput } from './feature'
import { isSets, shutSet } from './set'
import { PLUGIN, configKey, configKeys, fieldOf, groupOptions, keyOf, rowsOf } from './settings'
import { FIELDS, plain, statuslineView, type Els } from './statusline-views'

const PANE = 'statusline'
// $.store key of what the pane shows that a reload of the module would lose (the last row's note), and how long it holds.
const KEPT = 'statusline-pane'
const KEPT_MS = 10_000
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
// What a press flips: the row as it stands when the press is served (the switch for `enabled` is the wired line, not
// the option), never the value an older drawing of the pane held.
const current = (field: Field) => (field === 'enabled' ? S.enabled && wired : S[field])
// The wired switch takes up to SETTLE_TRIES x SETTLE_MS to apply (it waits for the host's copy of settings.json), and
// the write that ends it makes the host load this module again and cancel what the copy that wrote it still waits for. A
// press that comes meanwhile would write beside it from a copy the host has not updated, or be lost with the old copy: it
// is refused, and the note says so. A segment is written at once and needs no such wait.
let settling = false
// The script that the start runs rewrites settings.json from what it read; a press waits for it, or its row is lost in the
// rewrite.
let wiring: Promise<unknown> = Promise.resolve()

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

// The host keeps settings.json in memory and writes that copy back whole when a /config row changes. A statusLine that
// statusline-setup has just written or removed is therefore undone by the row's own write (the line comes back after
// `off`, goes after `on`) unless the host has read the file again, which it does a moment later on its own.
// `$.settings.read` answers the host's copy: hostReadsFile waits until its statusLine is the file's (it gives up after
// SETTLE_TRIES x SETTLE_MS and says so by returning false; a host that cannot say is the same as one that does not
// catch up).
export const SETTLE_MS = 100
export const SETTLE_TRIES = 50
const lineOf = (settings: Json | undefined) => JSON.stringify(settings?.statusLine ?? null)
async function hostReadsFile($: $): Promise<boolean> {
  for (let i = 0; i < SETTLE_TRIES; i++) {
    const host = await $.settings.read({ source: 'user' }).catch(() => undefined)
    if (lineOf(host) === lineOf(await userSettings($))) return true
    await $.clock.sleep(SETTLE_MS)
  }
  return false
}
// Whether settings.json says what the enabled row says: junkd's line wired for on, none of junkd's for off.
async function lineFollows($: $, value: boolean): Promise<boolean> {
  return isWired(await userSettings($), await configDir($)) === value
}

// The note a row's flip leaves on the pane.
const flipped = (field: Field, value: boolean) => `✓ ${field} ${value ? 'on' : 'off'}`

// A row's write, on either path (`store` writes the row): enabled runs its script first and stores nothing when the
// script refuses, waits for the host to read the file the script wrote (hostReadsFile), stores the row, and runs the
// script once more when the file does not say what the row says after all; a refused row runs the other mode to put
// settings.json back. The note is kept in $.store before the write: the write makes the host load this module again,
// and the copy that was running does not get to say how it went (adoptPane reads the note back).
async function storeRow<R extends { deny?: string }>($: $, field: Field, value: boolean, store: () => Promise<R>): Promise<R | { deny: string }> {
  if (field !== 'enabled') return keeping($, field, value, store)
  const mode = value ? 'on' : 'off'
  const run = await runSetup($, mode)
  if (run.deny !== undefined) return { deny: run.deny }
  await hostReadsFile($)
  const r = await keeping($, field, value, store)
  if (r.deny !== undefined) await runSetup($, value ? 'off' : 'on')
  else if (!(await lineFollows($, value))) await runSetup($, mode)
  return r
}
async function keeping<R extends { deny?: string }>($: $, field: Field, value: boolean, store: () => Promise<R>): Promise<R> {
  await $.store.set(KEPT, { note: flipped(field, value), at: Date.now() }).catch(() => undefined)
  const r = await store()
  if (r.deny !== undefined) await $.store.delete(KEPT).catch(() => undefined)
  return r
}

// Writes one row and applies it; the pane's note says how it went.
async function applyRow($: $, field: Field, value: boolean): Promise<SetResult> {
  const { deny } = await storeRow($, field, value, () => $.config.set({ key: configKey(keyOf('statusline', field)), value }))
  if (deny !== undefined) {
    note = `✗ ${deny}`
    redraw($)
    return { deny }
  }
  S[field] = value
  note = flipped(field, value)
  await refreshPreview($)
  redraw($)
  return { value }
}
function setRow($: $, field: Field, raw: unknown) {
  return applyRow($, field, coerce(raw))
}
// A press on a switch: the other value than the row has when the press is served.
async function toggleRow($: $, field: Field) {
  if (settling) {
    note = '✗ the wired switch is still being applied: press again in a moment'
    redraw($)
    return
  }
  settling = field === 'enabled'
  try {
    await wiring
    // The flag is only filled by the pane's refresh, which a reload's start has not finished yet: a press that comes first
    // would read the line as unwired and flip an `off` into an `on`. The file says.
    if (field === 'enabled') wired = isWired(await userSettings($), await configDir($))
    await applyRow($, field, !current(field))
  } catch (err) {
    note = `✗ ${reason(err)}`
    redraw($)
  } finally {
    if (field === 'enabled') settling = false
  }
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
// Every write of a row makes the host load this module again, with the pane still on the screen and nothing in
// memory: not open, no note, the line not known to be wired, no preview. The start finds the pane among the panes the
// host has up, reads the note back and draws what the files say.
// ponytail: the mark that the /junkd set opened the pane (`owner`) is not kept; a pane the set opened closes alone
// after a flip, until the set opens it again.
async function adoptPane($: $) {
  if (!(await $.ui.panes().catch(() => [])).some(p => p.id === PANE)) return
  paneOpen = true
  const kept = (await $.store.get(KEPT).catch(() => undefined)) as { note?: unknown; at?: unknown } | undefined
  if (typeof kept?.note === 'string' && Date.now() - Number(kept.at) < KEPT_MS) note = kept.note
  await refreshPreview($)
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
// Whether the line needs wiring: the installed copy is missing or is not the plugin's script, or settings.json has no
// statusLine, or a junkd one that does not read this session's key. A statusLine of the person's own is left alone
// (on would only be refused).
async function needsWiring($: $): Promise<boolean> {
  const cfg = await configDir($)
  const copy = `${cfg}/junkd/statusline.sh`
  const installed = await $.fs.read(copy).catch(() => undefined)
  const ours = await $.fs.read(`${$.plugin.root}/bin/statusline.sh`).catch(() => undefined)
  const line = (await userSettings($))?.statusLine
  const command = isObject(line) && typeof line.command === 'string' ? line.command : undefined
  const settled = command === commandFor(copy, pluginKey($.plugin.root)) || (line !== undefined && line !== null && !(command !== undefined && isJunkdCommand(command, cfg)))
  return !(ours !== undefined && installed === ours && settled)
}
// A session start runs beside the other writers of settings.json (setup.sh's output style, the host's own first
// writes), each of which reads the file and writes it back whole: one of them can drop the line statusline-setup has
// just written. So the line is looked at again VERIFY_MS later and wired once more if it is gone.
export const VERIFY_MS = 3000
// `statusline-setup on` while enabled when needsWiring, `off` with the row off while junkd's line is wired (wire), then a
// pane left up by a reload is taken back (adoptPane: after the script, so it draws the line that is there), then the
// host's read of the file (so its next write of a row keeps the line) and the second look. Silent.
export async function statuslineStart($: $): Promise<void> {
  const wires = await wire($)
  await adoptPane($)
  if (!wires) return
  await hostReadsFile($)
  void $.clock.sleep(VERIFY_MS).then(async () => {
    if (await wire($)) await refreshPreview($)
  }).catch(() => undefined)
}
// needsWiring and the script behind it, as the one thing a press waits for (`wiring`): true when the script ran. It is set
// before the look at the files, which takes a moment of its own. With the row off the line is taken out again when the
// host has written it back (the row's own write reloads the module and cancels the copy that would have looked: this
// start is the one that does).
function wire($: $): Promise<boolean> {
  const done = (async () => {
    if (!S.enabled) {
      if (!isWired(await userSettings($), await configDir($))) return false
      await runSetup($, 'off')
      return true
    }
    if (!(await needsWiring($))) return false
    await runSetup($, 'on')
    return true
  })()
  wiring = done
  return done
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

  // A press on a switch (a click, or its key a-g) is served here, not by the closure the drawing holds: that closure belongs to
  // the copy of the module that drew the pane, and for a moment after a write has made the host load the module again it
  // is gone, so a press then did nothing. The hook of the new copy is there at once. The other buttons (×) keep their closures.
  on('ui.press', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    const field = e.element.startsWith('set:') ? e.element.slice('set:'.length) : undefined
    if (!isField(field)) return next(e)
    void toggleRow($, field)
    return { element: e.element }
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
    return statuslineView($.ui.resolve(e) as Els, e.props, { values: { ...S, enabled: S.enabled && wired }, preview, note, config: { ...configInfo, key: configInfo.key || pluginKey($.plugin.root) } }, {
      close: () => void (isSets(owner) ? shutSet($) : closePane($)),
    })
  })
}
