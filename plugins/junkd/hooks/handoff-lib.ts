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
  written: null as string | null, // handoff file written this cycle: its Write succeeded; the turn end checks it is on disk before it continues
  candidate: null as string | null, // a handoff Write the model is making now (tool.call, before its result); promoted to `written` on success
  calls: 0,
  pending: null as { id: string; text: string; delivered: boolean } | null, // the continuation the handon turn carries (handoffContinuation)
  asks: 0, // times this cycle asked the model for the handoff file (1 when the loop fires, +1 per re-ask, 0 once it is written); MAX_ASKS then gives up
  clearTries: 0, // retries of a /clear that timed out or threw since one last worked; MAX_CLEAR_RETRIES then gives up
  resumeTries: 0, // turn ends that found the phase at resume with no chain in flight, this cycle; MAX_RESUME_RETRIES then gives up
  inFlight: false, // the clear → handon chain (continueFrom) is running: from its start to its end, the handon command included
  chain: 0, // the latest continueFrom's number: a chain that is no longer the latest stops (a retry or a reset superseded it)
  since: Date.now(), // when the phase last changed (setPhase)
  epoch: 0, // phase changes so far; the disk-trouble toast says itself once per epoch
  warned: -1, // the epoch the disk-trouble toast last showed in; -1 = never
  thresholdSrc: 'default' as 'default' | 'settings', // where S.threshold came from: the option the engine handed, a set, or the default
  count: 0,
  lastId: null as string | null,
  fresh: false, // right after /clear: usage() still reports the old window until the first response
  threshold: 300, // thousands of tokens (300 = 300k); 100 or less is the legacy percent of the window, see thresholdTokens
  base: 0, // used tokens on the first measurement of the window (system prompt + handon); 0 = not measured yet
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
  logPath: '', // the measurement log's path as the last append found it; '' = none yet
  armedAt: null as number | null,
  external: null as string | null, // a handoff file the main loop wrote while armed and idle, not asked for by the loop; the turn end follows it
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

// Every phase change goes through here: `since` and the epoch move only when the phase does.
export function setPhase(p: Phase): void {
  if (S.phase === p) return
  S.phase = p
  S.since = Date.now()
  S.epoch++
}

export function loadOptions(options: Record<string, unknown>): void {
  // a value `set` would refuse falls back to the default, so what loads is what `set` could have stored
  const num = (f: Field, d: number) => (coerce(f, options[f] ?? d).value as number | undefined) ?? d
  S.threshold = num('threshold', 300)
  S.thresholdSrc = coerce('threshold', options.threshold).error === undefined && options.threshold !== undefined ? 'settings' : 'default'
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

// The /clear of a cycle: how long it may take before it counts as lost, and how many turn ends retry it.
// ponytail: both are the person's figures (10 s, 3), not measured against the host.
export const CLEAR_TIMEOUT_MS = 10_000
export const MAX_CLEAR_RETRIES = 3
// The cycle's resume (phase `resume` with no clear → handon chain running, seen live: a persist that rejected before the
// chain was started left it there for good): how many turn ends start the chain again before the loop goes back to idle.
// ponytail: the person's figure, as MAX_CLEAR_RETRIES; counted in turn ends, never in time — a handon runs a whole turn.
export const MAX_RESUME_RETRIES = 3

export const LIMIT_PROMPT = 'Continue where the rate limit stopped you'
export const LIMIT_GRACE = 120_000 // 2 min after the window resets

// The threshold in tokens. A value of 100 or less is what an older config holds, a percent of the window: read as such
// (against the window the host reported) for one release, and every measurement says `legacy-percent`.
// ponytail: 1..100 can't be a token count in thousands (100k is the least), the ceiling of this one-release rule.
export const LEGACY_MAX = 100
export const isLegacy = (): boolean => S.threshold <= LEGACY_MAX
export const thresholdTokens = (): number => (isLegacy() ? Math.round((S.threshold / 100) * S.window) : S.threshold * 1000)
export const kTokens = (n: number): string => (Number.isFinite(n) ? `${Math.round(n / 1000)}k` : '?')
// The threshold as the person set it: `300k`, or `85%` while it is legacy.
export const thresholdText = (): string => (isLegacy() ? `${S.threshold}%` : `${S.threshold}k`)

// Where the threshold comes from, for the status: the plugin setting `handoff_threshold` (never the ctx-limit guard's
// own ~/.claude/junkd/ctx-limit-threshold file, a different feature), and how it is read.
export const thresholdSource = (): string =>
  `src=${S.thresholdSrc} handoff_threshold=${S.threshold} ${isLegacy() ? 'legacy-percent' : `tokens=${S.threshold * 1000}`}`

// The used tokens that trigger a handoff: the threshold, or — when the window already starts at or above it —
// threshold tokens of growth above the window's baseline. A legacy percent with no window reported yet is no limit.
export const limit = (): number => {
  const t = thresholdTokens()
  return t <= 0 ? Infinity : t > S.base ? t : S.base + t
}

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
// what get answers. threshold: above 0 (thousands of tokens; 100 or less is the legacy percent); checkEvery: a whole number, 1 or more; staleDays: above 0.
export type Coerced = { value: number | boolean; error?: undefined } | { error: string; value?: undefined }
const RANGE = { threshold: 'a number above 0: thousands of tokens, 300 = 300k; 100 or less is read as a percent of the window', checkEvery: 'a whole number, 1 or more', staleDays: 'a number above 0' }
export function coerce(field: Field, raw: unknown): Coerced {
  if (field === 'threshold' || field === 'checkEvery' || field === 'staleDays') {
    const value = Number(raw)
    const fits = Number.isFinite(value) && value > 0 && (field !== 'checkEvery' || Number.isInteger(value))
    return fits ? { value } : { error: `${String(raw)} is not a valid ${field} (${RANGE[field]})` }
  }
  return { value: raw === true || raw === 'true' || raw === 'on' }
}

// The current value of a field as the mod holds it (options at load, then every set).
export function current(field: Field): number | boolean {
  return S[field]
}

// How long ago `ms` was, coarse: `12s ago`, `3m ago`, `2h ago`, `4d ago`.
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86_400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86_400)}d ago`
}

// The loop's own state as `/junkd:ahandoff status` and the pane show it, one `label value` pair each.
export function loopState(now = Date.now()): [string, string][] {
  return [
    ['armed', String(S.armed)],
    ['phase', S.phase],
    ['since', `${new Date(S.since).toISOString()} (${ago(S.since, now)})`],
    ['retries', `clear ${S.clearTries}/${MAX_CLEAR_RETRIES} · resume ${S.resumeTries}/${MAX_RESUME_RETRIES}`],
    ['written', S.written ?? (S.candidate ? `${S.candidate} (writing)` : 'none')],
    ['lastId', S.lastId ?? 'none'],
    ['pending', S.pending ? S.pending.id : 'none'],
    ['threshold', thresholdSource()],
  ]
}

export const status = () => ({ armed: S.armed, percent: S.percent, phase: S.phase })
