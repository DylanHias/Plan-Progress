import type { PlanRecord } from '../types'

type Eta = { lowMs: number; highMs: number }

export function recordFlips(
  rec: PlanRecord | undefined,
  doneNow: ReadonlySet<number>,
  activeMs: number,
  sessionId: string,
): PlanRecord {
  const mark = { sessionId, activeMs }
  if (!rec) return { done: [...doneNow].sort((a, b) => a - b), durationsMs: [], mark, isFinished: false }

  const flipped = [...doneNow].filter(n => !rec.done.includes(n))
  const done = [...new Set([...rec.done, ...flipped])].sort((a, b) => a - b)
  if (flipped.length === 0) return { ...rec, done }

  // A mark from another session measured a different active clock: re-baseline instead.
  if (rec.mark?.sessionId !== sessionId) return { ...rec, done, mark }

  const each = (activeMs - rec.mark.activeMs) / flipped.length
  return { ...rec, done, durationsMs: [...rec.durationsMs, ...flipped.map(() => each)], mark }
}

function percentile(sorted: readonly number[], p: number): number {
  const i = p * (sorted.length - 1)
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (i - lo)
}

export function etaRange(durationsMs: readonly number[], remaining: number): Eta | null {
  if (durationsMs.length < 2) return null
  const sorted = [...durationsMs].sort((a, b) => a - b)
  return { lowMs: percentile(sorted, 0.25) * remaining, highMs: percentile(sorted, 0.75) * remaining }
}

function minutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60000))
}

function hours(m: number): string {
  const rest = m % 60
  return `${Math.floor(m / 60)}h${rest ? `${rest}m` : ''}`
}

export function formatEta(eta: Eta | null): string {
  if (!eta) return 'ETA —'
  const lo = minutes(eta.lowMs)
  const hi = minutes(eta.highMs)
  if (lo === hi) return lo < 60 ? `${lo}m` : hours(lo)
  if (hi < 60) return `${lo}–${hi}m`
  return `${lo < 60 ? `${lo}m` : hours(lo)}–${hours(hi)}`
}

export function formatElapsed(ms: number): string {
  return ms < 60000 ? '<1m' : `${Math.floor(ms / 60000)}m`
}
