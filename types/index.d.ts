export type Video =
  | { phase: 'idle' }
  | { phase: 'preparing'; step: string }
  | { phase: 'playing'; dir: string; frames: number; frame: number }
  | { phase: 'done' }
  | { phase: 'failed'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    rickroll: { isRolled: boolean; video: Video }
  }
}
