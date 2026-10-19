// tldr: the `tldr` settings group (enabled, terse, sentences) and /junkd:tldr's default sentence count. bin/tldr-hook
// (UserPromptSubmit, a shell hook: it reads no `$.config`) decides each turn from two flag files under
// ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/: `tldr-on` is terse mode's truth (bin/tldr-flag writes it too, so terse
// is read from the file), `tldr-off` mirrors the enabled row (there while off). A write to either row, by
// `$.junkd.set` or by the /config menu, writes its flag file first; enabled's is mirrored again at session start.
import type { On } from 'claude-code'
import type { JunkdTldrField } from '../types'
import type { $, SetResult } from './feature'
import { configKey, configKeys, fieldOf, groupOptions, keyOf, rowsOf } from './settings'

type Field = JunkdTldrField
const isField = (key: unknown): key is Field => rowsOf('tldr').some(f => f.field === key)
const S = { enabled: true, sentences: 3 }

// The same spelling as bin/tldr-flag and bin/tldr-hook: ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/<name>.
type Flag = 'tldr-on' | 'tldr-off'
async function flagPath($: $, name: Flag): Promise<string> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
  return `${dir}/junkd/${name}`
}
// The flag file a field's row is mirrored into, and whether a value puts it there: terse on -> tldr-on, enabled off
// -> tldr-off. Sentences has none.
const FLAG_OF: Partial<Record<Field, { name: Flag; present: (value: boolean) => boolean }>> = {
  terse: { name: 'tldr-on', present: v => v },
  enabled: { name: 'tldr-off', present: v => !v },
}

// The hook sees presence only: the empty file, or none. Answers the reason when it could not.
async function writeFlag($: $, flag: string, present: boolean): Promise<string | undefined> {
  try {
    if (present) await $.fs.write(flag, '')
    else {
      const r = await $.process.run(['rm', '-f', '--', flag])
      if (r.exitCode !== 0) return `tldr: could not remove ${flag}: ${r.stderr.trim() || `rm exited ${r.exitCode}`}`
    }
  } catch (err) {
    return `tldr: could not write ${flag}: ${(err as Error)?.message ?? String(err)}`
  }
  return undefined
}

// A mirrored row, on either path: the flag file first, then the row (`store`). A flag that could not be written
// stores nothing; a refused row puts the flag back as it was.
async function writeMirrored<R extends { deny?: string }>($: $, flag: string, present: boolean, store: () => Promise<R>): Promise<R | { deny: string }> {
  const was = await $.fs.exists(flag)
  const failed = await writeFlag($, flag, present)
  if (failed !== undefined) return { deny: failed }
  const r = await store()
  if (r.deny !== undefined) await writeFlag($, flag, was)
  return r
}

// A row's write, its flag file first where it has one.
async function storeRow<R extends { deny?: string }>($: $, field: Field, value: number | boolean, store: () => Promise<R>): Promise<R | { deny: string }> {
  const mirror = FLAG_OF[field]
  if (mirror === undefined) return store()
  return writeMirrored($, await flagPath($, mirror.name), mirror.present(value === true), store)
}

// A raw value to the field's kind; `error` when it does not fit.
type Coerced = { value: number | boolean; error?: undefined } | { error: string; value?: undefined }
function coerce(key: Field, raw: unknown): Coerced {
  if (key === 'terse' || key === 'enabled') return { value: raw === true || raw === 'true' || raw === 'on' }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) return { error: `${String(raw)} is not a valid sentences (a whole number, 1 or more)` }
  return { value }
}

// What a stored row changes in memory.
function apply(field: Field, value: number | boolean): void {
  if (field === 'sentences') S.sentences = value as number
  if (field === 'enabled') S.enabled = value as boolean
}

export async function tldrGet($: $, field: string): Promise<number | boolean> {
  if (field === 'terse') return $.fs.exists(await flagPath($, 'tldr-on'))
  if (field === 'enabled') return S.enabled
  return S.sentences
}

export async function tldrSet($: $, field: string, raw: unknown): Promise<SetResult> {
  if (!isField(field)) return { deny: `junkd: no setting ${keyOf('tldr', field)}` }
  const c = coerce(field, raw)
  if (c.error !== undefined) return { deny: c.error }
  // The host sends this write through the other plugins' hooks and skips ours below, so the value is applied here.
  const { deny } = await storeRow($, field, c.value, () => $.config.set({ key: configKey(keyOf('tldr', field)), value: c.value }))
  if (deny !== undefined) return { deny }
  apply(field, c.value)
  return { value: c.value }
}

// The enabled row into tldr-off, as the options at load (or the last write) have it: a session started after a hand
// edit of settings.json, or after the flag was lost, puts the file back in step. A failure leaves the other starts be.
export async function tldrStart($: $): Promise<void> {
  try {
    await writeFlag($, await flagPath($, 'tldr-off'), !S.enabled)
  } catch {}
}

export function registerTldr(on: On, options: Record<string, unknown>): void {
  const o = groupOptions(options, 'tldr')
  S.sentences = coerce('sentences', o.sentences ?? 3).value as number ?? 3
  S.enabled = o.enabled !== false // the engine hands only a boolean (it refuses another type at load), or none: on

  // The /config menu's own writes to a tldr row land here (a hook never sees its plugin's own `$.config.set`):
  // read as `set` reads it, refused where `set` refuses; terse and enabled write their flag first as `set` does.
  on('config.set', { key: configKeys('tldr') }, async ($, e, next) => {
    const field = fieldOf('tldr', e.key)
    if (!isField(field)) return next(e)
    const c = coerce(field, e.value)
    if (c.error !== undefined) return { deny: c.error }
    const r = await storeRow($, field, c.value, () => next({ ...e, value: c.value }))
    if (r.deny === undefined) apply(field, c.value)
    return r
  })
  // `/junkd:tldr` with no argument: the sentences setting is the number the skill reads (its markdown's own "else 3"
  // is the default on the hosts without this module). A number, on, off, status pass as typed.
  on('command.run', { command: 'junkd:tldr' }, (_$, e, next) => next(e.args.trim() === '' ? { ...e, args: String(S.sentences) } : e))
}
