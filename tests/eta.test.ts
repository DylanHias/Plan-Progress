import { expect, test } from 'claude-code/testing'

import { etaRange, formatElapsed, formatEta, recordFlips } from '../hooks/eta'

test('first sight is a baseline: no durations', () => {
  expect(recordFlips(undefined, new Set([1, 2]), 5000, 's1')).toEqual({
    done: [1, 2],
    durationsMs: [],
    mark: { sessionId: 's1', activeMs: 5000 },
    isFinished: false,
  })
})

test('one flip records the active time since the mark', () => {
  const r0 = recordFlips(undefined, new Set([1]), 1000, 's1')
  expect(recordFlips(r0, new Set([1, 2]), 61000, 's1').durationsMs).toEqual([60000])
})

test('two flips at once split the time evenly', () => {
  const r0 = recordFlips(undefined, new Set(), 0, 's1')
  expect(recordFlips(r0, new Set([1, 2]), 120000, 's1').durationsMs).toEqual([60000, 60000])
})

test('a mark from another session records nothing and re-baselines', () => {
  const r0 = recordFlips(undefined, new Set([1]), 999999, 'old')
  const r1 = recordFlips(r0, new Set([1, 2]), 1000, 's2')
  expect(r1.durationsMs).toEqual([])
  expect(r1.mark).toEqual({ sessionId: 's2', activeMs: 1000 })
})

test('done is sticky: a task vanishing from doneNow stays done', () => {
  const r0 = recordFlips(undefined, new Set([1, 2]), 0, 's1')
  expect(recordFlips(r0, new Set([1]), 10, 's1').done).toEqual([1, 2])
})

test('no change keeps the mark where it was', () => {
  const r0 = recordFlips(undefined, new Set([1]), 1000, 's1')
  expect(recordFlips(r0, new Set([1]), 50000, 's1').mark).toEqual({ sessionId: 's1', activeMs: 1000 })
})

test('etaRange needs two durations', () => {
  expect(etaRange([60000], 3)).toBe(null)
})

test('etaRange is p25..p75 times the tasks remaining', () => {
  expect(etaRange([60000, 120000, 180000, 240000, 300000], 2)).toEqual({ lowMs: 240000, highMs: 480000 })
})

test('formatEta', () => {
  expect(formatEta(null)).toBe('ETA —')
  expect(formatEta({ lowMs: 600000, highMs: 1080000 })).toBe('10–18m')
  expect(formatEta({ lowMs: 4800000, highMs: 7200000 })).toBe('1h20m–2h')
  expect(formatEta({ lowMs: 20000, highMs: 50000 })).toBe('1m')
})

test('formatElapsed', () => {
  expect(formatElapsed(240000)).toBe('4m')
  expect(formatElapsed(30000)).toBe('<1m')
})
