// What `$.orch` offers other plugins (a frame plugin shows the `main` settings, opens the pane and asks whether
// the main-loop guard holds right now).
export type OrchField = 'guard' | 'allow_fable_agents' | 'implementer_ctx_k' | 'ui_review' | 'inject_rules' | 'rounds'
export type OrchGuard = 'fable' | 'always' | 'off'
// `guard` is the manifest's string row with `options` (a choice); the two number rows take a whole number
// (implementer_ctx_k 50–1000, rounds 1–10).
export type OrchSchemaEntry = {
  key: OrchField
  type: 'string' | 'number' | 'boolean'
  title: string
  default: string | number | boolean
  main: boolean
  options?: readonly string[]
}
// Every call through `$` resolves asynchronously (a noun's method is an event), so each returns a promise, and
// the host hands a noun's method one input, so `get` and `set` take one object. `set`'s `scope`: only `user`
// (the `/config` row, user-global) exists today; the field is here so project or session scopes can be added
// later without changing callers. A refused `set` (unknown key, a value that does not fit, a scope not yet
// supported, a `config.set` hook's deny) rejects the promise with the reason; `get` rejects an unknown key.
export type OrchGetInput = { key: OrchField }
export type OrchSetInput = { key: OrchField; value: string | number | boolean; scope?: 'user' }
// Whether the guard holds the main loop right now (`guard` against the live main-loop model), and that model.
export type OrchGuardState = { active: boolean; model: string }
// `show` opens the pane and never closes it (`open` toggles): `focus` asks for the keys; `reopen` closes a pane
// that is up first, so its tab goes after the caller's; `owner` marks the pane as the caller's. `hide` closes it;
// with `owner`, only while the pane is still the one that owner's `show` opened (any other open or close since, the
// person's included, clears the mark).
export type OrchShowInput = { focus?: boolean; reopen?: boolean; owner?: string }
export type OrchHideInput = { owner?: string }
export type Orch = {
  schema(): Promise<OrchSchemaEntry[]>
  get(input: OrchGetInput): Promise<string | number | boolean>
  set(input: OrchSetInput): Promise<string | number | boolean>
  open(): Promise<void>
  show(input?: OrchShowInput): Promise<void>
  hide(input?: OrchHideInput): Promise<void>
  guardState(): Promise<OrchGuardState>
}

declare module 'claude-code' {
  interface EngineInterface {
    orch: Orch
  }
}
