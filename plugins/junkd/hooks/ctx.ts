// ctx: the `ctx` settings group (enabled, threshold, action, cmd) and /junkd:ctx-limit. bin/ctx-limit-hook
// (UserPromptSubmit, a shell hook: it reads no `$.config`) decides each turn from three files under
// ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/, which bin/ctx-limit (the CLI the skill runs) writes too:
// - ctx-limit-threshold: the limit in tokens, there while the guard is on (enabled's and threshold's truth);
// - ctx-limit-action: block, warn or cmd (none: block);
// - ctx-limit-cmd: the command of action cmd (none while it is empty).
// The files are the truth, as tldr-on is for terse: get reads them, so a change by the CLI shows. A write to a row,
// by `$.junkd.set` or by the /config menu, writes its file first, then the row; a refused row puts the file back.
// threshold's file is written only while the guard is on (the row keeps the number enabled writes). At session start
// the files of the plugin before junkd (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/ctx-limit-*) move into junkd/ once, where
// junkd/ has none of its own.
import type { On } from 'claude-code'
import type { JunkdCtxAction as Action, JunkdCtxField as Field } from '../types'
import type { $, SetResult } from './feature'
import { configKey, configKeys, fieldOf, groupOptions, keyOf, rowsOf } from './settings'

const isField = (key: unknown): key is Field => rowsOf('ctx').some(f => f.field === key)
export const CTX_ACTIONS: readonly Action[] = ['block', 'warn', 'cmd']
// The least threshold a set takes: below it every prompt of a session would be refused.
export const CTX_MIN = 1000
const DEFAULTS = { enabled: false, threshold: 300000, action: 'block' as Action, cmd: '' }
// The rows as last stored (or as the options at load have them).
const S = { ...DEFAULTS }

type File = 'threshold' | 'action' | 'cmd'
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
// The same spelling as bin/ctx-limit and bin/ctx-limit-hook: ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/ctx-limit-<name>.
async function filePath($: $, name: File): Promise<string> {
  return `${await configDir($)}/junkd/ctx-limit-${name}`
}

// A file's text, or undefined when there is none (or it cannot be read).
async function readFile($: $, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path).catch(() => false))) return undefined
  return $.fs.read(path).catch(() => undefined)
}
// What the hook reads: the threshold as a whole number (junk is off, as the hook takes it), the action (none or junk
// is block), the command.
const asThreshold = (text: string | undefined) => (text !== undefined && /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined)
const asAction = (text: string | undefined): Action => {
  const t = text?.trim()
  return CTX_ACTIONS.includes(t as Action) ? (t as Action) : 'block'
}

// A file to its new text (`null`: removed). Answers the reason when it could not.
async function writeFile($: $, path: string, text: string | null): Promise<string | undefined> {
  try {
    if (text !== null) await $.fs.write(path, text)
    else {
      const r = await $.process.run(['rm', '-f', '--', path])
      if (r.exitCode !== 0) return `ctx: could not remove ${path}: ${r.stderr.trim() || `rm exited ${r.exitCode}`}`
    }
  } catch (err) {
    return `ctx: could not write ${path}: ${(err as Error)?.message ?? String(err)}`
  }
  return undefined
}

// A raw value to the field's kind; `error` when it does not fit.
type Value = boolean | number | string
type Coerced = { value: Value; error?: undefined } | { error: string; value?: undefined }
// 300000, '300000', '300k', '1m' (any case) -> a whole number of tokens; undefined for anything else.
export function parseTokens(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) ? raw : undefined
  const m = /^(\d+)([kKmM]?)$/.exec(String(raw).trim())
  if (!m) return undefined
  const n = Number(m[1]) * (m[2] === '' ? 1 : /[kK]/.test(m[2]!) ? 1000 : 1000000)
  return Number.isSafeInteger(n) ? n : undefined
}
export function coerce(field: Field, raw: unknown): Coerced {
  if (field === 'enabled') return { value: raw === true || raw === 'true' || raw === 'on' }
  if (field === 'threshold') {
    const n = parseTokens(raw)
    if (n === undefined || n < CTX_MIN) {
      return { error: `junkd: ${String(raw)} is not a valid ctx_threshold (a whole number of tokens, ${CTX_MIN} or more; 300k and 1m are read too)` }
    }
    return { value: n }
  }
  if (field === 'action') {
    const v = String(raw).trim().toLowerCase()
    return CTX_ACTIONS.includes(v as Action) ? { value: v } : { error: `junkd: ${String(raw)} is not a valid ctx_action (block, warn or cmd)` }
  }
  return { value: String(raw ?? '').trim() }
}

// The file a row's value is mirrored into, and its new text (`null`: removed); none where the row has no file now
// (threshold while the guard is off).
async function mirrorOf($: $, field: Field, value: Value): Promise<{ path: string; text: string | null } | undefined> {
  if (field === 'enabled') return { path: await filePath($, 'threshold'), text: value === true ? `${await thresholdNow($)}\n` : null }
  if (field === 'threshold') {
    const path = await filePath($, 'threshold')
    return asThreshold(await readFile($, path)) === undefined ? undefined : { path, text: `${value}\n` }
  }
  if (field === 'action') return { path: await filePath($, 'action'), text: `${value}\n` }
  return { path: await filePath($, 'cmd'), text: value === '' ? null : `${value}\n` }
}

// A row's write, on either path: its file first, then the row (`store`). A file that could not be written stores
// nothing; a refused row puts the file back as it was.
async function storeRow<R extends { deny?: string }>($: $, field: Field, value: Value, store: () => Promise<R>): Promise<R | { deny: string }> {
  const mirror = await mirrorOf($, field, value)
  if (mirror === undefined) return store()
  const was = await readFile($, mirror.path)
  const failed = await writeFile($, mirror.path, mirror.text)
  if (failed !== undefined) return { deny: failed }
  const r = await store()
  if (r.deny !== undefined) await writeFile($, mirror.path, was ?? null)
  return r
}

function apply(field: Field, value: Value): void {
  ;(S as Record<Field, Value>)[field] = value
}

// The threshold enabled writes, and get answers: the file's number while the guard is on, else the row.
async function thresholdNow($: $): Promise<number> {
  return asThreshold(await readFile($, await filePath($, 'threshold'))) ?? S.threshold
}

export async function ctxGet($: $, field: string): Promise<Value> {
  if (field === 'enabled') return asThreshold(await readFile($, await filePath($, 'threshold'))) !== undefined
  if (field === 'threshold') return thresholdNow($)
  if (field === 'action') return asAction(await readFile($, await filePath($, 'action')))
  return (await readFile($, await filePath($, 'cmd')))?.trim() ?? ''
}

export async function ctxSet($: $, field: string, raw: unknown): Promise<SetResult> {
  if (!isField(field)) return { deny: `junkd: no setting ${keyOf('ctx', field)}` }
  const c = coerce(field, raw)
  if (c.error !== undefined) return { deny: c.error }
  // The host sends this write through the other plugins' hooks and skips ours below, so the file is written here.
  const { deny } = await storeRow($, field, c.value, () => $.config.set({ key: configKey(keyOf('ctx', field)), value: c.value }))
  if (deny !== undefined) return { deny }
  apply(field, c.value)
  return { value: c.value }
}

// The files of the plugin before junkd (${CLAUDE_CONFIG_DIR:-$HOME/.claude}/ctx-limit-*) into junkd/, each where
// junkd/ has none yet: copied, then the old one removed. A file that fails leaves the others moved.
export async function ctxStart($: $): Promise<void> {
  const cfg = await configDir($)
  await Promise.all(
    (['threshold', 'action', 'cmd'] as const).map(async name => {
      try {
        const old = `${cfg}/ctx-limit-${name}`
        const text = await readFile($, old)
        if (text === undefined || (await $.fs.exists(await filePath($, name)))) return
        if ((await writeFile($, await filePath($, name), text)) === undefined) await writeFile($, old, null)
      } catch {}
    }),
  )
}

// A one-line status, as bin/ctx-limit status prints it.
async function statusLine($: $): Promise<string> {
  const on = (await ctxGet($, 'enabled')) === true
  const action = await ctxGet($, 'action')
  const cmd = action === 'cmd' ? `, cmd: ${(await ctxGet($, 'cmd')) || '(none)'}` : ''
  return `ctx-limit: ${on ? `ON @ ${await ctxGet($, 'threshold')} tokens` : 'OFF'}, action: ${action}${cmd}`
}

// /junkd:ctx-limit's argument, through the group's set (the rows and the files stay in step). Answers the toast.
async function runCommand($: $, args: string): Promise<string> {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const all = async (...writes: [Field, unknown][]) => {
    for (const [field, value] of writes) {
      const r = await ctxSet($, field, value)
      if (r.deny !== undefined) return `✗ ${r.deny}`
    }
    return `✓ ${await statusLine($)}`
  }
  if (word === '' || word === 'status') return statusLine($)
  if (word === 'on') return all(['enabled', true])
  if (word === 'off' || word === 'reset') return all(['enabled', false])
  if (word === 'action') return all(['action', rest.join(' ')])
  if (word === 'cmd') {
    const cmd = args.trim().slice(3).trim()
    if (cmd === '') return '✗ usage: /junkd:ctx-limit cmd <shell command>'
    return all(['cmd', cmd], ['action', 'cmd'])
  }
  if (rest.length === 0 && parseTokens(word) !== undefined) return all(['threshold', word], ['enabled', true])
  return '✗ usage: /junkd:ctx-limit [<tokens e.g. 300k> | on | off | status | action <block|warn|cmd> | cmd <shell>]'
}

export function registerCtx(on: On, options: Record<string, unknown>): void {
  const o = groupOptions(options, 'ctx')
  // A value the row cannot hold (a hand edit of the file) is the default.
  S.enabled = o.enabled === true
  S.threshold = (coerce('threshold', o.threshold ?? DEFAULTS.threshold).value as number | undefined) ?? DEFAULTS.threshold
  S.action = (coerce('action', o.action ?? DEFAULTS.action).value as Action | undefined) ?? DEFAULTS.action
  S.cmd = typeof o.cmd === 'string' ? o.cmd.trim() : DEFAULTS.cmd

  // The /config menu's own writes to a ctx row land here (a hook never sees its plugin's own `$.config.set`): read as
  // `set` reads it, refused where `set` refuses; the file first, as `set` writes it.
  on('config.set', { key: configKeys('ctx') }, async ($, e, next) => {
    const field = fieldOf('ctx', e.key)
    if (!isField(field)) return next(e)
    const c = coerce(field, e.value)
    if (c.error !== undefined) return { deny: c.error }
    const r = await storeRow($, field, c.value, () => next({ ...e, value: c.value }))
    if (r.deny === undefined) apply(field, c.value)
    return r
  })
  // /junkd:ctx-limit: every form through the group's set, the answer a toast (the skill's CLI is the other hosts').
  on('command.run', { command: 'junkd:ctx-limit' }, async ($, e) => {
    $.ui.toast(await runCommand($, e.args))
    return {}
  })
}
