import type { EngineInterface, FsEntry } from 'claude-code'

import type { PlanRecord, Snapshot } from '../types'
import { recordFlips, etaRange } from './eta'
import { doneTasks, parseLedger, parsePlan, planName } from './parse'

export const PLANS_DIR = 'docs/superpowers/plans'
export const SDD_DIR = '.superpowers/sdd'

// The I/O this module needs, so tests can hand it an in-memory repo.
export type Io = {
  read: (path: string) => Promise<string | null>
  list: (path: string) => Promise<FsEntry[]>
  run: (argv: readonly string[], cwd: string) => Promise<{ exitCode: number; stdout: string }>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

// A missing file or directory is the normal "no plan here" case, so rejections read as absent.
export function ioFrom($: EngineInterface): Io {
  return {
    read: path => $.fs.read(path).then(text => (typeof text === 'string' ? text : null), () => null),
    list: path => $.fs.list(path).catch(() => []),
    run: (argv, cwd) => $.process.run(argv, { cwd }).catch(() => ({ exitCode: 1, stdout: '' })),
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value),
  }
}

function resolvePath(base: string, path: string): string {
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path : `${base}/${path}`).split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

export async function detectRepo(io: Io, cwd: string): Promise<{ root: string; key: string }> {
  const { exitCode, stdout } = await io.run(['git', 'rev-parse', '--show-toplevel', '--git-common-dir'], cwd)
  const [toplevel, commonDir] = stdout.trim().split('\n')
  if (exitCode !== 0 || !toplevel || !commonDir) return { root: cwd, key: cwd }
  return { root: toplevel, key: resolvePath(cwd, commonDir).replace(/\/\.git$/, '') }
}

export function toRepoRelative(root: string, path: string): string {
  if (path.startsWith(`${root}/`)) return path.slice(root.length + 1)
  const docs = path.indexOf('/docs/superpowers/')
  return docs >= 0 ? path.slice(docs + 1) : path
}

export function isPlanPath(path: string): boolean {
  return /(^|\/)docs\/superpowers\/plans\/[^/]+\.md$/.test(path)
}

type Ledger = { planPath: string; completed: Set<number>; mtimeMs: number }

async function readLedgers(io: Io, root: string): Promise<Ledger[]> {
  const ledgers: Ledger[] = []
  for (const dir of await io.list(`${root}/${SDD_DIR}`)) {
    if (dir.kind !== 'dir') continue
    const path = `${root}/${SDD_DIR}/${dir.name}`
    const entry = (await io.list(path)).find(e => e.name === 'progress.md')
    const ledger = entry && parseLedger((await io.read(`${path}/progress.md`)) ?? '')
    if (ledger) ledgers.push({ ...ledger, planPath: toRepoRelative(root, ledger.planPath), mtimeMs: entry.mtimeMs })
  }
  return ledgers
}

function ledgerCompleted(ledgers: Ledger[], planPath: string): { hasLedger: boolean; completed: Set<number> } {
  const mine = ledgers.filter(l => l.planPath === planPath)
  return { hasLedger: mine.length > 0, completed: new Set(mine.flatMap(l => [...l.completed])) }
}

export async function latestLedgerPlan(
  io: Io,
  root: string,
  sinceMs: number,
): Promise<{ planPath: string; at: number } | null> {
  const newest = (await readLedgers(io, root))
    .filter(l => l.mtimeMs > sinceMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  return newest ? { planPath: newest.planPath, at: newest.mtimeMs } : null
}

const recordKey = (key: string, planPath: string) => `plan:${key}:${planPath}`

export async function fallbackPlan(io: Io, root: string, key: string): Promise<string | null> {
  const ledgers = await readLedgers(io, root)
  const plans = (await io.list(`${root}/${PLANS_DIR}`))
    .filter(e => e.kind === 'file' && e.name.endsWith('.md'))
    .map(e => `${PLANS_DIR}/${e.name}`)
    .sort()
    .reverse()

  for (const planPath of plans) {
    if (((await io.get(recordKey(key, planPath))) as PlanRecord | undefined)?.isFinished) continue
    const tasks = parsePlan((await io.read(`${root}/${planPath}`)) ?? '')
    const { hasLedger, completed } = ledgerCompleted(ledgers, planPath)
    const done = doneTasks(tasks, completed)
    if (tasks.length > 0 && done.size < tasks.length && (hasLedger || done.size > 0)) return planPath
  }
  return null
}

export async function buildSnapshot(
  io: Io,
  s: { root: string; key: string; id: string },
  planPath: string,
  activeMs: number,
): Promise<Snapshot | null> {
  const tasks = parsePlan((await io.read(`${s.root}/${planPath}`)) ?? '')
  if (tasks.length === 0) return null

  const { hasLedger, completed } = ledgerCompleted(await readLedgers(io, s.root), planPath)
  const done = doneTasks(tasks, completed)
  if (!hasLedger && done.size === 0) return null

  const key = recordKey(s.key, planPath)
  const rec = recordFlips((await io.get(key)) as PlanRecord | undefined, done, activeMs, s.id)
  const isDone = (n: number) => rec.done.includes(n)
  const remaining = tasks.filter(t => !isDone(t.n)).length

  await io.set(key, remaining === 0 ? { ...rec, isFinished: true } : rec)
  if (remaining === 0) return null

  return {
    planPath,
    planName: planName(planPath),
    tasks: tasks.map(t => ({ n: t.n, name: t.name, isDone: isDone(t.n) })),
    eta: etaRange(rec.durationsMs, remaining),
    currentElapsedMs: rec.mark?.sessionId === s.id ? activeMs - rec.mark.activeMs : null,
  }
}
