// The handoff mod's state and the reads every file shares: options, commands, the handoffs folder.
import type { EngineInterface } from 'claude-code'
import type { JunkdHandoffField } from '../types'
import { rowsOf } from './settings'

export type $ = EngineInterface
export type Phase = 'idle' | 'handoff' | 'clear' | 'resume'
export type Route = 'auto' | 'handoffs' | 'settings'
export type Entry = { id: string; path: string; mtimeMs: number; title: string; stale: boolean }
export type Field = JunkdHandoffField

// `$`-free: every helper that takes `$` (findCommand, homeDir, handoffDir, listHandoffs, sync, persist) lives in
// handoff.tsx.

// ponytail: runtime state in a module object — it survives /clear (no reload); $.state is only a mirror.
export const DEFAULT_PROMPT = 'Continue after the handoff'

export const S = {
  enabled: true, // false = no auto loop at all: it cannot be armed, every loop hook passes, no 🪃 segment
  armed: false,
  phase: 'idle' as Phase,
  prompt: DEFAULT_PROMPT, // what the fresh session is told after /junkd:handon; `p` in the pane changes it
  written: null as string | null, // handoff file written this cycle
  calls: 0,
  pending: null as { id: string; text: string; delivered: boolean } | null, // the continuation the handon turn carries (handoffContinuation)
  asks: 0, // times this cycle asked the model for the handoff file (/junkd:handoff queued); MAX_ASKS then gives up
  count: 0,
  lastId: null as string | null,
  fresh: false, // right after /clear: usage() still reports the old window until the first response
  threshold: 85,
  base: 0, // usage on the first measurement of the window (system prompt + handon); 0 = not measured yet
  checkEvery: 5,
  staleDays: 30,
  segment: true,
  autoOn: false,
  resumeAfterLimit: true, // 5h rate limit: resume the stopped turn 2 min after the window resets
  fiveHour: 0, // percent of the 5h window used, from the last session.measure
  resetsAt: null as string | null, // when the 5h window resets (ISO)
  blocked: false, // a turn died on the 5h limit; a resume is scheduled
  resumeAt: null as number | null,
  percent: 0,
  tokens: 0,
  window: 0, // the context window the host reported with the last measurement (tokens); 0 = none yet
  last: '', // the last measurement as the log wrote it (without its time), for /junkd:ahandoff status; '' = none yet
  lastAt: 0,
  armedAt: null as number | null,
  route: 'auto' as Route,
  note: '',
  paneOpen: false,
  cols: 60,
  ring: null as string | null,
  selected: 0,
  filter: '',
  viewing: null as string | null,
  confirm: null as string | null,
  more: 0,
  session: [] as string[], // ids written in this session
  entries: null as Entry[] | null, // cached list; null = not read yet
  dir: '~/.claude/handoffs', // the handoffs folder as the pane draws it (the home as ~), set on each read
  version: '0.3.0',
}

export function loadOptions(options: Record<string, unknown>): void {
  // a value `set` would refuse falls back to the default, so what loads is what `set` could have stored
  const num = (f: Field, d: number) => (coerce(f, options[f] ?? d).value as number | undefined) ?? d
  S.threshold = num('threshold', 85)
  S.checkEvery = num('checkEvery', 5)
  S.enabled = options.enabled === undefined ? true : Boolean(options.enabled)
  S.autoOn = Boolean(options.autoOn)
  S.armed = S.enabled && S.autoOn
  if (S.armed) S.armedAt ??= Date.now()
  S.staleDays = num('staleDays', 30)
  S.segment = options.segment === undefined ? true : Boolean(options.segment)
  S.resumeAfterLimit = options.resumeAfterLimit === undefined ? true : Boolean(options.resumeAfterLimit)
}

// How long /junkd:ahandoff waits before it submits its prompt. Submitted while the slash command is still running, the host
// parks the prompt and starts its turn only when the person types something next (seen on 2.1.305 in a terminal: 1 start in 4
// with no wait, 5 in 5 after one second).
export const PROMPT_DELAY_MS = 1000

// The user's cap: a handoff asked for this many times and still not written disarms the loop.
export const MAX_ASKS = 3

export const LIMIT_PROMPT = 'Continue where the rate limit stopped you'
export const LIMIT_GRACE = 120_000 // 2 min after the window resets

// The usage that triggers a handoff: the threshold, or — when the window already starts at or above it —
// threshold points of growth above the window's baseline.
export const limit = (): number => (S.threshold > S.base ? S.threshold : S.base + S.threshold)

export const DAY = 86_400_000

export function idOf(name: string): string | null {
  return /_([0-9a-f]{8})\.md$/.exec(name)?.[1] ?? null
}

// The handoff rows of junkd's settings (settings.ts, the one mirror of plugin.json's `userConfig`), by field:
// `handoff_threshold` -> `threshold`. isField, coerce and the pane read the fields from here.
export type SchemaEntry = { key: Field; type: 'number' | 'boolean'; title: string; default: number | boolean; main: boolean }
export const SCHEMA: readonly SchemaEntry[] = rowsOf('handoff').map(f => ({
  key: f.field as Field, type: f.type as SchemaEntry['type'], title: f.title, default: f.default as SchemaEntry['default'], main: f.main,
}))
export const isField = (key: unknown): key is Field => SCHEMA.some(f => f.key === key)

// A raw value (typed in the pane, handed to $.junkd.set or written in the /config menu) to the field's kind;
// `error` when it does not fit. The value is stored as it comes back, never rounded later: what the row holds is
// what get answers. threshold: above 0, up to 100; checkEvery: a whole number, 1 or more; staleDays: above 0.
export type Coerced = { value: number | boolean; error?: undefined } | { error: string; value?: undefined }
const RANGE = { threshold: 'a number above 0, up to 100', checkEvery: 'a whole number, 1 or more', staleDays: 'a number above 0' }
export function coerce(field: Field, raw: unknown): Coerced {
  if (field === 'threshold' || field === 'checkEvery' || field === 'staleDays') {
    const value = Number(raw)
    const fits = Number.isFinite(value) && value > 0 && (field !== 'threshold' || value <= 100) && (field !== 'checkEvery' || Number.isInteger(value))
    return fits ? { value } : { error: `${String(raw)} is not a valid ${field} (${RANGE[field]})` }
  }
  return { value: raw === true || raw === 'true' || raw === 'on' }
}

// The current value of a field as the mod holds it (options at load, then every set).
export function current(field: Field): number | boolean {
  return S[field]
}

export const status = () => ({ armed: S.armed, percent: S.percent, phase: S.phase })
