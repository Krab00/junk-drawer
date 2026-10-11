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

declare module 'claude-code' {
  interface PluginState {
    handoff: { ahandoff: Ahandoff }
  }
}
