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
export type Handoff = {
  schema(): Promise<HandoffSchemaEntry[]>
  get(key: HandoffField): Promise<number | boolean>
  set(input: HandoffSetInput): Promise<number | boolean>
  open(input?: HandoffOpenInput): Promise<void>
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
