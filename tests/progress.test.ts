import { expect, test } from 'claude-code/testing'

import type { PlanRecord } from '../types'
import {
  buildSnapshot,
  detectRepo,
  fallbackPlan,
  isPlanPath,
  latestLedgerPlan,
  toRepoRelative,
  type Io,
  worktreeRoots,
} from '../hooks/progress'

type FakeFile = { text: string; mtimeMs?: number }

// An in-memory repo: absolute path → file. Directories are implied by paths.
function fakeIo(files: Record<string, FakeFile>, git?: { toplevel: string; commonDir: string }) {
  const store = new Map<string, unknown>()
  const io: Io = {
    read: async path => files[path]?.text ?? null,
    list: async dir => {
      const names = new Map<string, 'file' | 'dir'>()
      for (const path of Object.keys(files)) {
        if (!path.startsWith(`${dir}/`)) continue
        const [name = '', ...rest] = path.slice(dir.length + 1).split('/')
        names.set(name, rest.length ? 'dir' : 'file')
      }
      return [...names].map(([name, kind]) => ({
        name,
        kind,
        size: 0,
        mtimeMs: kind === 'file' ? (files[`${dir}/${name}`]?.mtimeMs ?? 0) : 0,
        isLink: false,
      }))
    },
    run: async () =>
      git ? { exitCode: 0, stdout: `${git.toplevel}\n${git.commonDir}\n` } : { exitCode: 128, stdout: '' },
    get: async key => store.get(key),
    set: async (key, value) => void store.set(key, value),
  }
  return { io, store }
}

const PLAN = (n: number, ticked: number[] = []) =>
  Array.from({ length: n }, (_, i) => `### Task ${i + 1}: T${i + 1}\n- [${ticked.includes(i + 1) ? 'x' : ' '}] s\n`).join('\n')
const LEDGER = (plan: string, done: number[]) =>
  [`# SDD ledger — plan: ${plan}`, ...done.map(n => `Task ${n}: complete`)].join('\n')
const P = 'docs/superpowers/plans'

test('not a git repo: root and key fall back to cwd', async () => {
  expect(await detectRepo(fakeIo({}).io, '/w')).toEqual({ root: '/w', key: '/w' })
})

test('a worktree shares the main checkout key', async () => {
  const { io } = fakeIo({}, { toplevel: '/r/.worktrees/x', commonDir: '/r/.git' })
  expect(await detectRepo(io, '/r/.worktrees/x/sub')).toEqual({ root: '/r/.worktrees/x', key: '/r' })
})

test('a relative common dir resolves against cwd', async () => {
  const { io } = fakeIo({}, { toplevel: '/r', commonDir: '.git' })
  expect(await detectRepo(io, '/r')).toEqual({ root: '/r', key: '/r' })
})

test('toRepoRelative handles absolute, other-worktree and relative paths', () => {
  expect(toRepoRelative('/r', `/r/${P}/a.md`)).toBe(`${P}/a.md`)
  expect(toRepoRelative('/r/.worktrees/x', `/r/${P}/a.md`)).toBe(`${P}/a.md`)
  expect(toRepoRelative('/r', `${P}/a.md`)).toBe(`${P}/a.md`)
})

test('isPlanPath', () => {
  expect(isPlanPath(`/r/${P}/2026-10-31-x.md`)).toBe(true)
  expect(isPlanPath(`/r/docs/superpowers/specs/x.md`)).toBe(false)
})

test('no plans dir: fallback is null and nothing throws', async () => {
  expect(await fallbackPlan(fakeIo({}).io, ['/r'], '/r')).toBe(null)
})

test('fallback picks the newest in-progress plan, skipping complete, finished and unstarted ones', async () => {
  const { io, store } = fakeIo({
    [`/r/${P}/2026-10-01-done.md`]: { text: PLAN(2, [1, 2]) },
    [`/r/${P}/2026-10-05-started.md`]: { text: PLAN(2, [1]) },
    [`/r/${P}/2026-10-10-ledgered.md`]: { text: PLAN(2) },
    [`/r/${P}/2026-10-20-finished.md`]: { text: PLAN(2) },
    [`/r/${P}/2026-10-30-unstarted.md`]: { text: PLAN(2) },
    '/r/.superpowers/sdd/ledgered/progress.md': { text: LEDGER(`${P}/2026-10-10-ledgered.md`, []), mtimeMs: 5 },
  })
  const finished: PlanRecord = { done: [], durationsMs: [], mark: null, isFinished: true }
  store.set(`plan:/r:${P}/2026-10-20-finished.md`, finished)
  expect(await fallbackPlan(io, ['/r'], '/r')).toBe(`${P}/2026-10-10-ledgered.md`)
})

test('a ledger newer than the cutoff wins, an older one is ignored, absolute paths become relative', async () => {
  const { io } = fakeIo({
    '/r/.superpowers/sdd/a/progress.md': { text: LEDGER(`/r/${P}/a.md`, []), mtimeMs: 50 },
    '/r/.superpowers/sdd/b/progress.md': { text: LEDGER(`${P}/b.md`, []), mtimeMs: 200 },
  })
  expect(await latestLedgerPlan(io, ['/r'], 100)).toEqual({ planPath: `${P}/b.md`, at: 200 })
  expect(await latestLedgerPlan(io, ['/r'], 300)).toBe(null)
  expect((await latestLedgerPlan(io, ['/r'], 10))?.planPath).toBe(`${P}/b.md`)
})

test('snapshot merges ledger and checkboxes, then records flips', async () => {
  const files: Record<string, FakeFile> = {
    [`/r/${P}/2026-10-31-x.md`]: { text: PLAN(3, [2]) },
    '/r/.superpowers/sdd/x/progress.md': { text: LEDGER(`${P}/2026-10-31-x.md`, [1]), mtimeMs: 1 },
  }
  const { io, store } = fakeIo(files)
  const s = { key: '/r', id: 's1' }

  const first = await buildSnapshot(io, s, ['/r'], `${P}/2026-10-31-x.md`, 1000)
  expect(first?.planName).toBe('x')
  expect(first?.tasks.map(t => t.isDone)).toEqual([true, true, false])
  expect(first?.eta).toBe(null)
  expect(first?.currentElapsedMs).toBe(0)

  files['/r/.superpowers/sdd/x/progress.md'] = { text: LEDGER(`${P}/2026-10-31-x.md`, [1, 3]), mtimeMs: 2 }
  files[`/r/${P}/2026-10-31-x.md`] = { text: `${PLAN(3, [2])}\n### Task 4: T4\n- [ ] s\n` }
  await buildSnapshot(io, s, ['/r'], `${P}/2026-10-31-x.md`, 61000)
  expect((store.get(`plan:/r:${P}/2026-10-31-x.md`) as PlanRecord).durationsMs).toEqual([60000])
})

test('a plan that has not started yields no snapshot', async () => {
  const { io } = fakeIo({ [`/r/${P}/a.md`]: { text: PLAN(2) } })
  expect(await buildSnapshot(io, { key: '/r', id: 's1' }, ['/r'], `${P}/a.md`, 0)).toBe(null)
})

test('a complete plan is stored as finished and yields no snapshot', async () => {
  const { io, store } = fakeIo({ [`/r/${P}/a.md`]: { text: PLAN(2, [1, 2]) } })
  expect(await buildSnapshot(io, { key: '/r', id: 's1' }, ['/r'], `${P}/a.md`, 0)).toBe(null)
  expect((store.get(`plan:/r:${P}/a.md`) as PlanRecord).isFinished).toBe(true)
})

test('a plan with no task headings, or missing, yields no snapshot', async () => {
  const { io } = fakeIo({ [`/r/${P}/a.md`]: { text: '# Design\n- [x] x' } })
  const s = { key: '/r', id: 's1' }
  expect(await buildSnapshot(io, s, ['/r'], `${P}/a.md`, 0)).toBe(null)
  expect(await buildSnapshot(io, s, ['/r'], `${P}/gone.md`, 0)).toBe(null)
})

test('toRepoRelative prefers the docs marker over the root prefix (nested worktree)', () => {
  expect(toRepoRelative('/r', `/r/.worktrees/x/${P}/a.md`)).toBe(`${P}/a.md`)
})

test('worktreeRoots lists every working tree, main first', async () => {
  const io: Io = {
    ...fakeIo({}).io,
    run: async () => ({ exitCode: 0, stdout: 'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/.worktrees/x\nHEAD def\n' }),
  }
  expect(await worktreeRoots(io, '/r')).toEqual(['/r', '/r/.worktrees/x'])
  expect(await worktreeRoots(fakeIo({}).io, '/r')).toEqual(['/r'])
})

test('an SDD run in a worktree shows: its ledger and plan are read there', async () => {
  const { io } = fakeIo({
    [`/r/${P}/a.md`]: { text: PLAN(2) },
    [`/r/.worktrees/x/${P}/a.md`]: { text: PLAN(2) },
    '/r/.worktrees/x/.superpowers/sdd/a/progress.md': { text: LEDGER(`${P}/a.md`, [1]), mtimeMs: 9 },
  })
  const roots = ['/r', '/r/.worktrees/x']
  expect(await latestLedgerPlan(io, roots, 0)).toEqual({ planPath: `${P}/a.md`, at: 9 })
  const snap = await buildSnapshot(io, { key: '/r', id: 's1' }, roots, `${P}/a.md`, 0)
  expect(snap?.tasks.map(t => t.isDone)).toEqual([true, false])
})

test('a read that fails (not a missing file) leaves the stored record untouched', async () => {
  const { io, store } = fakeIo({
    [`/r/${P}/a.md`]: { text: PLAN(3) },
    '/r/.superpowers/sdd/a/progress.md': { text: LEDGER(`${P}/a.md`, [1]), mtimeMs: 1 },
  })
  const s = { key: '/r', id: 's1' }
  await buildSnapshot(io, s, ['/r'], `${P}/a.md`, 0)
  const before = store.get(`plan:/r:${P}/a.md`)
  const failing: Io = {
    ...io,
    read: async path => {
      if (path.endsWith('progress.md')) throw new Error('EIO')
      return io.read(path)
    },
  }
  await expect(buildSnapshot(failing, s, ['/r'], `${P}/a.md`, 5000)).rejects.toThrow('EIO')
  expect(store.get(`plan:/r:${P}/a.md`)).toEqual(before)
})
