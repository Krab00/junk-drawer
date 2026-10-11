export type Ahandoff = {
  on: boolean
  phase: 'idle' | 'handoff' | 'resume'
  percent: number
  threshold: number
  checkEvery: number
  prompt: string
  lastId: string
  count: number
}

declare module 'claude-code' {
  interface PluginState {
    handoff: { ahandoff: Ahandoff }
  }
}
