// The handoff mod's state and the reads every file shares: options, commands, the handoffs folder.
import type { EngineInterface } from 'claude-code'

export type $ = EngineInterface
export type Phase = 'idle' | 'handoff' | 'clear' | 'resume'
export type Route = 'auto' | 'handoffs' | 'settings'
export type Entry = { id: string; path: string; mtimeMs: number; title: string; stale: boolean }

// The engine follows `$` only into functions of the hooks module itself, never across an import:
// every helper that takes `$` (findCommand, homeDir, handoffDir, listHandoffs, sync, persist) lives in register.tsx.

// ponytail: runtime state in a module object — it survives /clear (no reload); $.state is only a mirror.
export const S = {
  armed: false,
  phase: 'idle' as Phase,
  prompt: null as string | null, // extra continuation text; null = just continue the handoff
  written: null as string | null, // handoff file written this cycle
  calls: 0,
  count: 0,
  lastId: null as string | null,
  fresh: false, // right after /clear: usage() still reports the old window until the first response
  threshold: 85,
  checkEvery: 5,
  staleDays: 30,
  segment: true,
  autoOn: false,
  percent: 0,
  tokens: 0,
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
  version: '0.2.0',
}

export function loadOptions(options: Record<string, unknown>): void {
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
  S.threshold = num(options.threshold ?? 85, 85)
  S.checkEvery = Math.max(1, Math.round(num(options.checkEvery ?? 5, 5)))
  S.autoOn = S.armed = Boolean(options.autoOn)
  if (S.armed) S.armedAt ??= Date.now()
  S.staleDays = num(options.staleDays ?? 30, 30)
  S.segment = options.segment === undefined ? true : Boolean(options.segment)
}

export const DAY = 86_400_000

export function idOf(name: string): string | null {
  return /_([0-9a-f]{8})\.md$/.exec(name)?.[1] ?? null
}
