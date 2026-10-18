export type Ahandoff = {
  on: boolean
  phase: 'idle' | 'handoff' | 'clear' | 'resume'
  percent: number
  threshold: number
  checkEvery: number
  prompt: string
  lastId: string
  count: number
  route: 'auto' | 'handoffs' | 'settings'
  paneOpen: boolean
}

// What `$.handoff` offers other plugins (a frame plugin shows the `main` settings and jumps into the pane).
export type HandoffField = 'threshold' | 'checkEvery' | 'autoOn' | 'resumeAfterLimit' | 'staleDays' | 'segment'
export type HandoffSchemaEntry = { key: HandoffField; type: 'number' | 'boolean'; title: string; default: number | boolean; main: boolean }
export type HandoffRoute = 'auto' | 'handoffs' | 'settings'
export type HandoffStatus = { armed: boolean; percent: number; phase: 'idle' | 'handoff' | 'clear' | 'resume' }
// Every call through `$` resolves asynchronously (a noun's method is an event), so each returns a promise.
// The host hands a noun's method one input, so `set` and `open` take one object. `set`'s `scope`: only `user`
// (the `/config` row, user-global) exists today; the field is here so project or session scopes can be added
// later without changing callers. A refused `set` (unknown key, a value that does not fit, a scope not yet
// supported, a `config.set` hook's deny) rejects the promise with the reason.
export type HandoffSetInput = { key: HandoffField; value: number | boolean | string; scope?: 'user' }
export type HandoffOpenInput = { route?: HandoffRoute }
// `show` opens the pane and never closes it (`open` toggles): on `route` when given; `focus` asks for the keys;
// `owner` marks the pane as the caller's. `hide` closes it; with `owner`, only while the pane is still the one that
// owner's `show` opened (any other open or close since, the person's included, clears the mark).
export type HandoffShowInput = { route?: HandoffRoute; focus?: boolean; owner?: string }
export type HandoffHideInput = { owner?: string }
export type Handoff = {
  schema(): Promise<HandoffSchemaEntry[]>
  get(key: HandoffField): Promise<number | boolean>
  set(input: HandoffSetInput): Promise<number | boolean>
  open(input?: HandoffOpenInput): Promise<void>
  show(input?: HandoffShowInput): Promise<void>
  hide(input?: HandoffHideInput): Promise<void>
  status(): Promise<HandoffStatus>
}

declare module 'claude-code' {
  interface PluginState {
    handoff: { ahandoff: Ahandoff }
  }
  interface EngineInterface {
    handoff: Handoff
  }
}
