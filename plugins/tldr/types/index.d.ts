// What `$.tldr` offers other plugins (a frame plugin shows both settings and flips terse mode).
export type TldrField = 'terse' | 'sentences'
export type TldrSchemaEntry = { key: TldrField; type: 'number' | 'boolean'; title: string; default: number | boolean; main: boolean }
// Every call through `$` resolves asynchronously (a noun's method is an event), so each returns a promise, and
// the host hands a noun's method one input, so `get` and `set` take one object. `set`'s `scope`: only `user`
// (the `/config` row, user-global) exists today; the field is here so project or session scopes can be added
// later without changing callers. A refused `set` (unknown key, a value that does not fit, a scope not yet
// supported, a `config.set` hook's deny) rejects the promise with the reason; `get` rejects an unknown key.
// `terse` is answered from the flag file the per-turn shell hook reads, so `/tldr on|off` and `set` agree.
export type TldrGetInput = { key: TldrField }
export type TldrSetInput = { key: TldrField; value: number | boolean | string; scope?: 'user' }
export type Tldr = {
  schema(): Promise<TldrSchemaEntry[]>
  get(input: TldrGetInput): Promise<number | boolean>
  set(input: TldrSetInput): Promise<number | boolean>
}

declare module 'claude-code' {
  interface EngineInterface {
    tldr: Tldr
  }
}
