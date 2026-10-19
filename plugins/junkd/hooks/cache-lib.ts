// The prompt-cache check's setting, `$`-free: core.ts reads and writes it (the row is in the core group), cache.tsx
// runs the check with it. `core_cache_check_sessions`: how many of the project's newest sessions
// scripts/cache-check.sh reads, 0 = the check is off.
export const C = { sessions: 10 }
// A whole number in these bounds, as the manifest's min and max (the manifest has no "integer" field).
export const CACHE_RANGE = [0, 30] as const
const DEFAULT = 10

// A raw value (typed in the pane, handed to $.junkd.set, or written in the /config menu) to the row's number;
// `error` when it does not fit. The one check for every write path: a write is refused, never clamped.
export type Coerced = { value: number; error?: undefined } | { error: string; value?: undefined }
export function coerceSessions(raw: unknown): Coerced {
  const [lo, hi] = CACHE_RANGE
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  return Number.isInteger(n) && n >= lo && n <= hi ? { value: n } : { error: `junkd: ${String(raw)} is not a valid cache_check_sessions (a whole number ${lo}–${hi})` }
}

// The option the engine fills in from the manifest at load: rounded, a numeric string taken, out of range clamped,
// anything else the default (a load is no write, so nothing is refused).
export function applyCacheSettings(raw: unknown): void {
  const n = Math.round(typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN)
  const [lo, hi] = CACHE_RANGE
  C.sessions = Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : DEFAULT
}
