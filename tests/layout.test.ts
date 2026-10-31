import { expect, test } from 'claude-code/testing'

import { fitLine, gradient, rule } from '../hooks/layout'

test('wide: the bar takes what the text leaves', () => {
  const r = fitLine(80, 6, 8, '10–18m', 'Token refresh', false)
  expect(r.text).toBe('  6/8 · 10–18m · Token refresh ▸')
  expect(r.filled + r.empty + r.text.length).toBe(80)
  expect(r.filled).toBe(Math.round((6 / 8) * (r.filled + r.empty)))
  expect(r.text.slice(0, r.countEnd)).toBe('  6/8')
  expect(r.text.slice(r.labelStart)).toBe('Token refresh ▸')
})

test('the label truncates with … before the bar drops under 8', () => {
  const r = fitLine(30, 6, 8, '10–18m', 'Token refresh and more', false)
  expect(r.filled + r.empty).toBe(8)
  expect(r.text.endsWith('… ▸')).toBe(true)
  expect(r.filled + r.empty + r.text.length).toBe(30)
})

test('very narrow: no negatives, bar at least 1, label dropped', () => {
  const r = fitLine(12, 1, 8, 'ETA —', 'Anything', false)
  expect(r.filled + r.empty).toBeGreaterThanOrEqual(1)
  expect(r.filled).toBeGreaterThanOrEqual(0)
  expect(r.empty).toBeGreaterThanOrEqual(0)
  expect(r.text.includes('Anything')).toBe(false)
})

test('expanded ends with ▾', () => {
  expect(fitLine(80, 1, 2, 'ETA —', 'plan', true).text.endsWith(' ▾')).toBe(true)
})

test('rule', () => {
  expect(rule(5)).toBe('─────')
  expect(rule(-1)).toBe('')
})

test('gradient runs from the first stop to the last', () => {
  expect(gradient(0, '#000000', '#ffffff')).toEqual([])
  expect(gradient(1, '#000000', '#ffffff')).toEqual(['#000000'])
  expect(gradient(3, '#000000', '#ffffff')).toEqual(['#000000', '#808080', '#ffffff'])
})
