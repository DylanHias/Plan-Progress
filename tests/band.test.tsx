import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Snapshot } from '../types'

const BAND = {
  plugin: 'plan-progress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const SNAP: Snapshot = {
  planPath: 'docs/superpowers/plans/2026-10-31-auth-refactor.md',
  planName: 'auth-refactor',
  tasks: [
    { n: 1, name: 'Extract session store', isDone: true },
    { n: 2, name: 'Token refresh', isDone: false },
    { n: 3, name: 'Remove legacy cookie', isDone: false },
  ],
  eta: null,
  currentElapsedMs: 240000,
}

// Answers chosen state keys from `seed`; the kit's own memory answers the rest.
function seedState(on: On, seed: Record<string, unknown>) {
  on('state.get', (_, e, next) =>
    e.plugin === 'plan-progress' && e.key in seed ? { value: { value: seed[e.key], version: 1 } } : next(e),
  )
}

test('collapsed: a rule and one line sized to the band', async ($, on) => {
  seedState(on, { snapshot: SNAP })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /^─+$/ }))?.text).toBe('─'.repeat(60))
  const line = await ui.find({ key: 'toggle' })
  expect(line?.text).toMatch(/1\/3 · ETA — · Token refresh ▸$/)
  expect(line?.text.length).toBe(60)
  expect(await ui.find({ type: 'Text', text: /✓ 1/ })).toBeUndefined()
  await ui.unmount()
})

test('expanded: one row per task with its mark', async ($, on) => {
  seedState(on, { snapshot: SNAP, isExpanded: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ key: 'toggle' }))?.text).toMatch(/auth-refactor ▾$/)
  expect(await ui.find({ type: 'Text', text: /✓ 1 Extract session store/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▶ 2 Token refresh\s+4m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /○ 3 Remove legacy cookie/ })).toBeDefined()
  await ui.unmount()
})

test('pressing the line expands it', async ($, on) => {
  seedState(on, { snapshot: SNAP })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: /✓ 1/ })).toBeDefined()
  await ui.unmount()
})

test('no snapshot: the engine draws the band', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('a survey takes the band', async ($, on) => {
  seedState(on, { snapshot: SNAP })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>survey</Text>
  })
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true }, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /survey/ })).toBeDefined()
  await ui.unmount()
})

test('a hot reload keeps the session and its active time', async ($, on) => {
  mock.clock(on, { now: 9000 })
  seedState(on, {
    session: { id: 's1', startedAt: 0, root: '/r', key: '/r' },
    active: { accumulatedMs: 5000, since: null },
  })
  const writes: string[] = []
  on('state.set', (_, e, next) => {
    writes.push(e.key)
    return next(e)
  })
  on('command.register', () => ({ value: { command: 'progress' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: true })
  expect(writes.includes('session')).toBe(false)
  expect(writes.includes('active')).toBe(false)
})

test('subagent turns do not move active time', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const writes: string[] = []
  on('state.set', (_, e, next) => {
    writes.push(e.key)
    return next(e)
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: '', turnId: 't1', agentId: 'a1' })
  expect(writes.includes('active')).toBe(false)
})

test('writing a plan file makes it the master', async ($, on) => {
  mock.clock(on, { now: 1000 })
  seedState(on, { session: { id: 's1', startedAt: 0, root: '/r', key: '/r' } })
  const masters: unknown[] = []
  on('state.set', (_, e, next) => {
    if (e.key === 'master') masters.push(e.value)
    return next(e)
  })
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Write', file_path: '/r/docs/superpowers/plans/2026-10-31-x.md', content: '' })
  expect(masters).toEqual([{ planPath: 'docs/superpowers/plans/2026-10-31-x.md', at: 1000 }])
})
