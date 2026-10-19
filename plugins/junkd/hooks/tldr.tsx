// tldr: the `tldr` settings group (enabled, terse, sentences) and /junkd:tldr's default sentence count. Terse
// mode's truth is the flag file bin/tldr-hook reads every turn (a shell hook cannot read $.config), so a write to the
// terse row, by `$.junkd.set` or by the /config menu, also writes that file, and the value is read from the file.
// CONTRACT (T11): the slice ports enabled's gate and the flag paths under ${CLAUDE_CONFIG_DIR}/junkd/.
import type { On } from 'claude-code'
import type { JunkdTldrField } from '../types'
import type { $, SetResult } from './feature'
import { configKey, configKeys, fieldOf, groupOptions, keyOf, rowsOf } from './settings'

type Field = JunkdTldrField
const isField = (key: unknown): key is Field => rowsOf('tldr').some(f => f.field === key)
const S = { enabled: true, sentences: 3 }

// The same spelling as bin/tldr-flag and bin/tldr-hook: ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tldr-on.
async function flagPath($: $): Promise<string> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
  return `${dir}/tldr-on`
}

// The hook sees presence only: `on` creates the empty file, `off` removes it. Answers the reason when it could not.
async function writeFlag($: $, on: boolean): Promise<string | undefined> {
  const flag = await flagPath($)
  try {
    if (on) await $.fs.write(flag, '')
    else {
      const r = await $.process.run(['rm', '-f', '--', flag])
      if (r.exitCode !== 0) return `tldr: could not remove ${flag}: ${r.stderr.trim() || `rm exited ${r.exitCode}`}`
    }
  } catch (err) {
    return `tldr: could not write ${flag}: ${(err as Error)?.message ?? String(err)}`
  }
  return undefined
}

// Terse mode, on either path: the flag file first, then the row (`store`). A flag that could not be written stores
// nothing; a refused row puts the flag back as it was.
async function writeTerse<R extends { deny?: string }>($: $, on: boolean, store: () => Promise<R>): Promise<R | { deny: string }> {
  const was = await $.fs.exists(await flagPath($))
  const failed = await writeFlag($, on)
  if (failed !== undefined) return { deny: failed }
  const r = await store()
  if (r.deny !== undefined) await writeFlag($, was)
  return r
}

// A raw value to the field's kind; `error` when it does not fit.
type Coerced = { value: number | boolean; error?: undefined } | { error: string; value?: undefined }
function coerce(key: Field, raw: unknown): Coerced {
  if (key === 'terse' || key === 'enabled') return { value: raw === true || raw === 'true' || raw === 'on' }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) return { error: `${String(raw)} is not a valid sentences (a whole number, 1 or more)` }
  return { value }
}

export async function tldrGet($: $, field: string): Promise<number | boolean> {
  if (field === 'terse') return $.fs.exists(await flagPath($))
  if (field === 'enabled') return S.enabled
  return S.sentences
}

export async function tldrSet($: $, field: string, raw: unknown): Promise<SetResult> {
  if (!isField(field)) return { deny: `junkd: no setting ${keyOf('tldr', field)}` }
  const c = coerce(field, raw)
  if (c.error !== undefined) return { deny: c.error }
  // The host sends this write through the other plugins' hooks and skips ours below, so the value is applied here.
  const store = () => $.config.set({ key: configKey(keyOf('tldr', field)), value: c.value })
  const { deny } = field === 'terse' ? await writeTerse($, c.value === true, store) : await store()
  if (deny !== undefined) return { deny }
  if (field === 'sentences') S.sentences = c.value as number
  if (field === 'enabled') S.enabled = c.value as boolean
  return { value: c.value }
}

export async function tldrStart(_$: $): Promise<void> {}

export function registerTldr(on: On, options: Record<string, unknown>): void {
  const o = groupOptions(options, 'tldr')
  S.sentences = coerce('sentences', o.sentences ?? 3).value as number ?? 3
  S.enabled = o.enabled === undefined ? true : o.enabled === true

  // The /config menu's own writes to a tldr row land here (a hook never sees its plugin's own `$.config.set`):
  // read as `set` reads it, refused where `set` refuses; terse writes the flag first as `set` does.
  on('config.set', { key: configKeys('tldr') }, async ($, e, next) => {
    const field = fieldOf('tldr', e.key)
    if (!isField(field)) return next(e)
    const c = coerce(field, e.value)
    if (c.error !== undefined) return { deny: c.error }
    if (field === 'terse') return writeTerse($, c.value === true, () => next({ ...e, value: c.value }))
    const r = await next({ ...e, value: c.value })
    if (r.deny === undefined && field === 'sentences') S.sentences = c.value as number
    if (r.deny === undefined && field === 'enabled') S.enabled = c.value as boolean
    return r
  })
  // `/junkd:tldr` with no argument: the sentences setting is the number the skill reads (its markdown's own "else 3"
  // is the default on the hosts without this module). A number, on, off, status pass as typed.
  on('command.run', { command: 'junkd:tldr' }, (_$, e, next) => next(e.args.trim() === '' ? { ...e, args: String(S.sentences) } : e))
}
