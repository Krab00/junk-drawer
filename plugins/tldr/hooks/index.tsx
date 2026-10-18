// The tldr mod: `$.tldr` (schema, get, set) over the plugin's two settings. Terse mode's truth is the flag file
// bin/tldr-hook reads every turn (a shell hook cannot read $.config), so a write to the `tldr.terse` row, by
// `set` or by the /config menu, also writes that file, and `get` answers `terse` from the file.
import type { EngineInterface, Register } from 'claude-code'
import type { TldrField, TldrSchemaEntry } from '../types'

type $ = EngineInterface

// A mirror of plugin.json's `userConfig` (a hooks module cannot import JSON); tests/smoke.sh holds it to the manifest.
export const SCHEMA: readonly TldrSchemaEntry[] = [
  { key: 'terse', type: 'boolean', title: 'Terse mode', default: false, main: true },
  { key: 'sentences', type: 'number', title: 'Sentences in a summary', default: 3, main: true },
]
const isField = (key: unknown): key is TldrField => SCHEMA.some(f => f.key === key)
const S = { sentences: 3 }

// The same spelling as bin/tldr-flag and bin/tldr-hook: ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/tldr-on.
async function flagPath($: $): Promise<string> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
  return `${dir}/tldr-on`
}

// The hook sees presence only: `on` creates the empty file, `off` removes it.
async function writeFlag($: $, on: boolean): Promise<void> {
  const flag = await flagPath($)
  if (on) await $.fs.write(flag, '')
  else await $.process.run(['rm', '-f', '--', flag])
}

// A raw value (handed to $.tldr.set) to the field's kind; `error` when it does not fit.
type Coerced = { value: number | boolean; error?: undefined } | { error: string; value?: undefined }
function coerce(key: TldrField, raw: unknown): Coerced {
  if (key === 'terse') return { value: raw === true || raw === 'true' || raw === 'on' }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) return { error: `${String(raw)} is not a valid sentences (a whole number, 1 or more)` }
  return { value }
}

// `get` and `set` need `$` (the flag file, $.config), and the host forbids a noun capturing it: the hooks on
// tldr.get / tldr.set below answer instead; `schema` needs none and answers here.
const NO_HOOK = 'tldr: the hooks module did not answer'

export const register: Register = (on, options) => {
  S.sentences = coerce('sentences', options.sentences ?? 3).value ?? 3

  on('engine.create', async (_$, e, next) => ({
    ...(await next(e)),
    tldr: {
      schema: async () => SCHEMA.map(f => ({ ...f })),
      get: async () => { throw new Error(NO_HOOK) },
      set: async () => { throw new Error(NO_HOOK) },
    },
  }))
  // A `{ deny }` here rejects the caller's promise with the reason (the host's own rule for a noun's event).
  on('tldr.get', async ($, e) => {
    if (!isField(e?.key)) return { deny: `tldr: no setting ${String(e?.key)}` }
    return { value: e.key === 'terse' ? await $.fs.exists(await flagPath($)) : S.sentences }
  })
  on('tldr.set', async ($, e) => {
    if (!isField(e?.key)) return { deny: `tldr: no setting ${String(e?.key)}` }
    if (e.scope !== undefined && e.scope !== 'user') return { deny: `tldr: scope ${String(e.scope)} is not supported yet` }
    const c = coerce(e.key, e.value)
    if (c.error !== undefined) return { deny: c.error }
    const { deny } = await $.config.set({ key: `tldr.${e.key}`, value: c.value })
    return deny !== undefined ? { deny } : { value: c.value }
  })

  // Every write to a tldr row, ours or the /config menu's, lands here once the row took it.
  on('config.set', { key: 'tldr.terse' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined) await writeFlag($, e.value === true)
    return r
  })
  on('config.set', { key: 'tldr.sentences' }, async (_$, e, next) => {
    const r = await next(e)
    if (r.deny === undefined) S.sentences = coerce('sentences', e.value).value ?? S.sentences
    return r
  })
}
