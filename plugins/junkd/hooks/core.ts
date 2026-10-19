// core: the `core` settings group, two rows.
// - output_style (ste|off). The setup step (scripts/setup.sh, SessionStart) is off while the flag file
//   ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/junkd/output-style-off exists: a shell hook reads no `$.config`, so the row's
//   truth is mirrored there, at every write to the row and at session start. `ste` (the default) or `off`, as the
//   manifest's options; nothing else is taken.
// - cache_check_sessions (0-30, a whole number): how many sessions the prompt-cache check (cache.tsx) reads, 0 = off.
//   Kept in cache-lib.ts's C; no flag file (the module runs the script itself).
import type { On } from 'claude-code'
import type { JunkdStyle } from '../types'
import { C, applyCacheSettings, coerceSessions } from './cache-lib'
import type { $, SetResult } from './feature'
import { configKey, configKeys, fieldOf, groupOptions, keyOf } from './settings'

let styleIsOff = false

const STYLE_ERROR = (raw: unknown) => `junkd: ${String(raw)} is not a valid output_style (ste or off)`
function coerceStyle(raw: unknown): { value: JunkdStyle; error?: undefined } | { error: string; value?: undefined } {
  const v = String(raw).trim().toLowerCase()
  return v === 'ste' || v === 'off' ? { value: v } : { error: STYLE_ERROR(raw) }
}

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

async function writeStyleFlag($: $): Promise<void> {
  const flag = `${await configDir($)}/junkd/output-style-off`
  if (styleIsOff) await $.fs.write(flag, '')
  else await $.process.run(['rm', '-f', '--', flag])
}

export async function coreGet(_$: $, field: string): Promise<JunkdStyle | number> {
  if (field === 'cache_check_sessions') return C.sessions
  return styleIsOff ? 'off' : 'ste'
}

// The host sends our own `$.config.set` past our config.set hook, so the flag is written here too.
export async function coreSet($: $, field: string, raw: unknown): Promise<SetResult> {
  if (field === 'cache_check_sessions') {
    const n = coerceSessions(raw)
    if (n.error !== undefined) return { deny: n.error }
    const r = await $.config.set({ key: configKey('core_cache_check_sessions'), value: n.value })
    if (r.deny !== undefined) return { deny: r.deny }
    C.sessions = n.value
    return { value: n.value }
  }
  if (field !== 'output_style') return { deny: `junkd: no setting ${keyOf('core', field)}` }
  const c = coerceStyle(raw)
  if (c.error !== undefined) return { deny: c.error }
  const { deny } = await $.config.set({ key: configKey('core_output_style'), value: c.value })
  if (deny !== undefined) return { deny }
  styleIsOff = c.value === 'off'
  await writeStyleFlag($)
  return { value: c.value }
}

export async function coreStart($: $): Promise<void> {
  await writeStyleFlag($).catch(() => undefined)
}

export function registerCore(on: On, options: Record<string, unknown>): void {
  // A value the manifest's options do not name (an edit of the file by hand) is the default, ste.
  const o = groupOptions(options, 'core')
  styleIsOff = coerceStyle(o.output_style).value === 'off'
  applyCacheSettings(o.cache_check_sessions)

  // The /config menu's writes to the core rows land here. cache_check_sessions: read as `set` reads it, refused where
  // `set` refuses. output_style: a value the options do not name is refused, one the row took is mirrored into the
  // flag file.
  on('config.set', { key: configKeys('core') }, async ($, e, next) => {
    const field = fieldOf('core', e.key)
    if (field === 'cache_check_sessions') {
      const n = coerceSessions(e.value)
      if (n.error !== undefined) return { deny: n.error }
      const r = await next({ ...e, value: n.value })
      if (r.deny === undefined) C.sessions = n.value
      return r
    }
    if (field !== 'output_style') return next(e)
    const c = coerceStyle(e.value)
    if (c.error !== undefined) return { deny: c.error }
    const r = await next({ ...e, value: c.value })
    if (r.deny === undefined) {
      styleIsOff = c.value === 'off'
      await writeStyleFlag($)
    }
    return r
  })
}
