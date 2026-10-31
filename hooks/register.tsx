import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Active, Master, SessionInfo, Snapshot } from '../types'
import { formatElapsed, formatEta } from './eta'
import { fitLine, rule } from './layout'
import { buildSnapshot, detectRepo, fallbackPlan, ioFrom, isPlanPath, latestLedgerPlan, toRepoRelative } from './progress'

const snapshot = atom({ plugin: 'plan-progress', key: 'snapshot' } as const, null as Snapshot | null)
const isExpanded = atom({ plugin: 'plan-progress', key: 'isExpanded' } as const, false)
const master = atom({ plugin: 'plan-progress', key: 'master' } as const, null as Master | null)
const active = atom({ plugin: 'plan-progress', key: 'active' } as const, { accumulatedMs: 0, since: null } as Active)
const session = atom({ plugin: 'plan-progress', key: 'session' } as const, null as SessionInfo | null)

const REFRESH_EVERY_MS = 2000

async function refresh($: EngineInterface): Promise<void> {
  const s = await read($, session)
  if (!s) return
  const io = ioFrom($)
  const now = await $.clock.now()

  let current = await read($, master)
  const ledger = await latestLedgerPlan(io, s.root, current?.at ?? s.startedAt)
  if (ledger) {
    current = ledger
    await update($, master, () => ledger)
  }

  const planPath = current?.planPath ?? (await fallbackPlan(io, s.root, s.key))
  const a = await read($, active)
  const activeMs = a.accumulatedMs + (a.since === null ? 0 : now - a.since)
  const next = planPath ? await buildSnapshot(io, s, planPath, activeMs) : null
  await update($, snapshot, () => next)
}

export const register: Register = on => {
  // A module variable: a reload resetting it only costs one early refresh.
  let lastRefreshAt = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'progress', description: 'Expand or collapse the plan progress band' })
    // A reload runs session.start again: keep the session it already has.
    if (!(await read($, session))) {
      const now = await $.clock.now()
      const repo = await detectRepo(ioFrom($), e.cwd)
      await update($, session, () => ({ id: String(now), startedAt: now, ...repo }))
    }
    await refresh($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, active, a => ({ ...a, since: now }))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, active, a => ({
        accumulatedMs: a.accumulatedMs + (a.since === null ? 0 : now - a.since),
        since: null,
      }))
      lastRefreshAt = now
      await refresh($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const now = await $.clock.now()

    if ((e.tool === 'Write' || e.tool === 'Edit') && isPlanPath(e.file_path)) {
      const s = await read($, session)
      if (s) await update($, master, () => ({ planPath: toRepoRelative(s.root, e.file_path), at: now }))
    }
    if (now - lastRefreshAt >= REFRESH_EVERY_MS) {
      lastRefreshAt = now
      await refresh($)
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
        <Button key="toggle" onPress={() => update($, isExpanded, v => !v)}>
          <Text color="suggestion">{'━'.repeat(line.filled)}</Text>
          <Text color="inactive">{'━'.repeat(line.empty)}</Text>
          <Text wrap="truncate-end">{line.text}</Text>
        </Button>
        {expanded &&
          snap.tasks.map(t =>
            t.isDone ? (
              <Text dimColor wrap="truncate-end">{`  ✓ ${t.n} ${t.name}`}</Text>
            ) : t === current ? (
              <Text wrap="truncate-end">
                {`  ▶ ${t.n} ${t.name}`}
                {snap.currentElapsedMs !== null ? `   ${formatElapsed(snap.currentElapsedMs)}` : ''}
              </Text>
            ) : (
              <Text dimColor wrap="truncate-end">{`  ○ ${t.n} ${t.name}`}</Text>
            ),
          )}
      </Box>
    )
  })
}
