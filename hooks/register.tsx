import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Active, Master, SessionInfo, Snapshot } from '../types'
import { formatElapsed, formatEta } from './eta'
import { fitLine, gradient, rule } from './layout'
import {
  buildSnapshot,
  detectRepo,
  fallbackPlan,
  ioFrom,
  isPlanPath,
  latestLedgerPlan,
  toRepoRelative,
  worktreeRoots,
} from './progress'

const snapshot = atom({ plugin: 'plan-progress', key: 'snapshot' } as const, null as Snapshot | null)
const isExpanded = atom({ plugin: 'plan-progress', key: 'isExpanded' } as const, false)
const master = atom({ plugin: 'plan-progress', key: 'master' } as const, null as Master | null)
const active = atom({ plugin: 'plan-progress', key: 'active' } as const, { accumulatedMs: 0, since: null } as Active)
const session = atom({ plugin: 'plan-progress', key: 'session' } as const, null as SessionInfo | null)

const REFRESH_EVERY_MS = 2000
const BAR_FROM = '#3b82f6'
const BAR_TO = '#22c55e'
const CURRENT = '#60a5fa'
const DONE_NAME = '#a1a1aa'

// Created on first need, not only at session.start: /clear starts no session.start, and a git
// that failed to spawn must be retried rather than pinned.
async function ensureSession($: EngineInterface, cwd?: string): Promise<SessionInfo | null> {
  const existing = await read($, session)
  if (existing) return existing
  const now = await $.clock.now()
  try {
    const repo = await detectRepo(ioFrom($), cwd ?? (await $.session.cwd()))
    const created = { id: String(now), startedAt: now, ...repo }
    await update($, session, () => created)
    return created
  } catch {
    return null
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const s = await ensureSession($)
  if (!s) return
  const io = ioFrom($)
  const now = await $.clock.now()
  const roots = await worktreeRoots(io, s.root)

  let current = await read($, master)
  const ledger = await latestLedgerPlan(io, roots, current?.at ?? s.startedAt)
  if (ledger) {
    current = ledger
    await update($, master, () => ledger)
  }

  const planPath = current?.planPath ?? (await fallbackPlan(io, roots, s.key))
  const a = await read($, active)
  const activeMs = a.accumulatedMs + (a.since === null ? 0 : now - a.since)
  const next = planPath ? await buildSnapshot(io, s, roots, planPath, activeMs) : null
  await update($, snapshot, () => next)
}

// Reset by a reload, which only costs one more log line.
let hasLoggedFailure = false

// A failed reread keeps the last good snapshot on screen; the reason is logged once per load.
async function safeRefresh($: EngineInterface): Promise<void> {
  try {
    await refresh($)
  } catch (error) {
    if (hasLoggedFailure) return
    hasLoggedFailure = true
    $.ui.log(`plan-progress: refresh failed, keeping the last view: ${String(error)}`)
  }
}

export const register: Register = on => {
  // A module variable: a reload resetting it only costs one early refresh.
  let lastRefreshAt = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress', description: 'Expand or collapse the plan progress band' })
    // A reload runs session.start again: ensureSession keeps the session it already has.
    await ensureSession($, e.cwd)
    await safeRefresh($)

    return next(e)
  })

  // Active time runs while any turn is open, main loop or a background subagent's.
  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, active, a => {
      const open = a.open ?? []
      return { ...a, open: [...open, e.turnId], since: open.length === 0 ? now : a.since }
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, active, a => {
      const open = (a.open ?? []).filter(id => id !== e.turnId)
      if (open.length > 0) return { ...a, open }
      return { accumulatedMs: a.accumulatedMs + (a.since === null ? 0 : now - a.since), since: null, open }
    })
    if (!e.agentId || now - lastRefreshAt >= REFRESH_EVERY_MS) {
      lastRefreshAt = now
      await safeRefresh($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const now = await $.clock.now()

    const isWritten = ran.deny === undefined && ran.isError !== true
    if (isWritten && (e.tool === 'Write' || e.tool === 'Edit') && isPlanPath(e.file_path)) {
      const s = await read($, session)
      if (s) await update($, master, () => ({ planPath: toRepoRelative(s.root, e.file_path), at: now }))
    }
    if (now - lastRefreshAt >= REFRESH_EVERY_MS) {
      lastRefreshAt = now
      await safeRefresh($)
    }

    return ran
  })

  on('command.run', { command: 'progress' }, async $ => {
    await update($, isExpanded, v => !v)

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || !snap) return next(e)

    const expanded = await read($, isExpanded)
    const { Box, Button, Text } = $.ui.resolve(e)
    const cols = e.props.bodyColumns
    const doneCount = snap.tasks.filter(t => t.isDone).length
    const current = snap.tasks.find(t => !t.isDone)
    const label = expanded ? snap.planName : (current?.name ?? '')
    const line = fitLine(cols, doneCount, snap.tasks.length, formatEta(snap.eta), label, expanded)

    return (
      <Box flexDirection="column">
        <Text color="promptBorder" wrap="truncate-end">{rule(cols)}</Text>
        <Text> </Text>
        <Button key="toggle" plain onPress={() => update($, isExpanded, v => !v)}>
          {gradient(line.filled, BAR_FROM, BAR_TO).map(c => (
            <Text color={c}>█</Text>
          ))}
          <Text color="inactive" wrap="truncate-end">{'░'.repeat(line.empty)}</Text>
          <Text color={BAR_TO} wrap="truncate-end">{line.text.slice(0, line.countEnd)}</Text>
          <Text dimColor wrap="truncate-end">{line.text.slice(line.countEnd, line.labelStart)}</Text>
          <Text wrap="truncate-end">{line.text.slice(line.labelStart)}</Text>
        </Button>
        {expanded && <Text> </Text>}
        {expanded &&
          snap.tasks.map(t =>
            t.isDone ? (
              <Text wrap="truncate-end">
                <Text color={BAR_TO}>{'  ✓'}</Text>
                <Text color={DONE_NAME}>{` ${t.n} ${t.name}`}</Text>
              </Text>
            ) : t === current ? (
              <Text wrap="truncate-end">
                <Text color={CURRENT}>{'  ▶'}</Text>
                <Text bold>{` ${t.n} ${t.name}`}</Text>
                <Text color={CURRENT}>
                  {snap.currentElapsedMs !== null ? `   ${formatElapsed(snap.currentElapsedMs)}` : ''}
                </Text>
              </Text>
            ) : (
              <Text dimColor wrap="truncate-end">{`  ○ ${t.n} ${t.name}`}</Text>
            ),
          )}
      </Box>
    )
  })
}
