export type PlanTask = { n: number; name: string; checkboxes: number; ticked: number }
export type TaskRow = { n: number; name: string; isDone: boolean }
export type Snapshot = {
  planPath: string
  planName: string
  tasks: TaskRow[]
  eta: { lowMs: number; highMs: number } | null
  currentElapsedMs: number | null
}
export type PlanRecord = {
  done: number[]
  durationsMs: number[]
  mark: { sessionId: string; activeMs: number } | null
  isFinished: boolean
}
export type Master = { planPath: string; at: number }
export type Active = { accumulatedMs: number; since: number | null }
export type SessionInfo = { id: string; startedAt: number; root: string; key: string }

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': {
      snapshot: Snapshot | null
      isExpanded: boolean
      master: Master | null
      active: Active
      session: SessionInfo | null
    }
  }
}
