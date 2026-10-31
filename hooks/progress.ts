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

// A missing path is the normal "no plan here" case and reads as absent; any other failure throws,
// so a flaky read never gets recorded as "nothing done".
export function ioFrom($: EngineInterface): Io {
  const absentOrThrow = async (path: string, error: unknown) => {
    if (await $.fs.exists(path)) throw error
  }
  return {
    read: path =>
      $.fs.read(path).then(
        text => (typeof text === 'string' ? text : null),
        async error => (await absentOrThrow(path, error), null),
      ),
    list: path => $.fs.list(path).catch(async error => (await absentOrThrow(path, error), [])),
    run: (argv, cwd) => $.process.run(argv, { cwd }),
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

// SDD runs in a worktree, so its ledger and plan live there, not in the session's root.
export async function worktreeRoots(io: Io, root: string): Promise<string[]> {
  const { exitCode, stdout } = await io.run(['git', 'worktree', 'list', '--porcelain'], root)
  if (exitCode !== 0) return [root]
  const trees = stdout
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length))
  return [root, ...trees.filter(t => t !== root)]
}

export function toRepoRelative(root: string, path: string): string {
  const docs = path.indexOf('/docs/superpowers/')
  if (docs >= 0) return path.slice(docs + 1)
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

export function isPlanPath(path: string): boolean {
  return /(^|\/)docs\/superpowers\/plans\/[^/]+\.md$/.test(path)
}

type Ledger = { planPath: string; completed: Set<number>; mtimeMs: number; root: string }

async function readLedgers(io: Io, roots: readonly string[]): Promise<Ledger[]> {
  const ledgers: Ledger[] = []
  for (const root of roots) {
    for (const dir of await io.list(`${root}/${SDD_DIR}`)) {
      if (dir.kind !== 'dir') continue
      const path = `${root}/${SDD_DIR}/${dir.name}`
      const entry = (await io.list(path)).find(e => e.name === 'progress.md')
      const ledger = entry && parseLedger((await io.read(`${path}/progress.md`)) ?? '')
      if (ledger) {
        ledgers.push({ ...ledger, planPath: toRepoRelative(root, ledger.planPath), mtimeMs: entry.mtimeMs, root })
      }
    }
  }
  return ledgers
}

function ledgersFor(ledgers: Ledger[], planPath: string) {
  const mine = ledgers.filter(l => l.planPath === planPath).sort((a, b) => b.mtimeMs - a.mtimeMs)
  return { mine, completed: new Set(mine.flatMap(l => [...l.completed])) }
}

// The plan as the run sees it: in the worktree of its newest ledger, else the first tree that has it.
async function readPlan(io: Io, roots: readonly string[], mine: Ledger[], planPath: string) {
  for (const root of mine[0] ? [mine[0].root, ...roots] : roots) {
    const text = await io.read(`${root}/${planPath}`)
    if (text !== null) return parsePlan(text)
  }
  return []
}

export async function latestLedgerPlan(
  io: Io,
  roots: readonly string[],
  sinceMs: number,
): Promise<{ planPath: string; at: number } | null> {
  const newest = (await readLedgers(io, roots))
    .filter(l => l.mtimeMs > sinceMs)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
  return newest ? { planPath: newest.planPath, at: newest.mtimeMs } : null
}

const recordKey = (key: string, planPath: string) => `plan:${key}:${planPath}`

export async function fallbackPlan(io: Io, roots: readonly string[], key: string): Promise<string | null> {
  const ledgers = await readLedgers(io, roots)
  const names = new Set<string>()
  for (const root of roots) {
    for (const e of await io.list(`${root}/${PLANS_DIR}`)) {
      if (e.kind === 'file' && e.name.endsWith('.md')) names.add(`${PLANS_DIR}/${e.name}`)
    }
  }

  for (const planPath of [...names].sort().reverse()) {
    if (((await io.get(recordKey(key, planPath))) as PlanRecord | undefined)?.isFinished) continue
    const { mine, completed } = ledgersFor(ledgers, planPath)
    const tasks = await readPlan(io, roots, mine, planPath)
    const done = doneTasks(tasks, completed)
    if (tasks.length > 0 && done.size < tasks.length && (mine.length > 0 || done.size > 0)) return planPath
  }
  return null
}

export async function buildSnapshot(
  io: Io,
  s: { key: string; id: string },
  roots: readonly string[],
  planPath: string,
  activeMs: number,
): Promise<Snapshot | null> {
  const { mine, completed } = ledgersFor(await readLedgers(io, roots), planPath)
  const tasks = await readPlan(io, roots, mine, planPath)
  if (tasks.length === 0) return null

  const done = doneTasks(tasks, completed)
  if (mine.length === 0 && done.size === 0) return null

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
