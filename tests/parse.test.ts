import { expect, test } from 'claude-code/testing'

import { doneTasks, parseLedger, parsePlan, planName } from '../hooks/parse'

const PLAN = `# X Plan

## Global Constraints
- [ ] not a task box

### Task 1: Extract session store
- [x] **Step 1**
- [x] **Step 2**

### Task 2 — Token refresh
- [x] a
- [ ] b

### Task 3: Docs only
`

test('parsePlan reads task headings and their checkboxes', () => {
  expect(parsePlan(PLAN)).toEqual([
    { n: 1, name: 'Extract session store', checkboxes: 2, ticked: 2 },
    { n: 2, name: 'Token refresh', checkboxes: 2, ticked: 1 },
    { n: 3, name: 'Docs only', checkboxes: 0, ticked: 0 },
  ])
})

test('a plan without task headings is empty', () => {
  expect(parsePlan('# Design\n- [ ] x')).toEqual([])
})

test('parseLedger reads the identity line and completions', () => {
  const ledger = parseLedger(
    '# SDD ledger — plan: docs/superpowers/plans/a.md\nTask 1: complete (abc123)\nTask 2: fix round 1\nTask 3: complete\n',
  )
  expect(ledger?.planPath).toBe('docs/superpowers/plans/a.md')
  expect([...(ledger?.completed ?? [])]).toEqual([1, 3])
})

test('a ledger without its identity line is null', () => {
  expect(parseLedger('Task 1: complete')).toBe(null)
})

test('done is ledger OR all ticked, and zero boxes is not done', () => {
  expect([...doneTasks(parsePlan(PLAN), new Set([2]))].sort()).toEqual([1, 2])
})

test('planName strips the date prefix and .md', () => {
  expect(planName('docs/superpowers/plans/2026-10-31-auth-refactor.md')).toBe('auth-refactor')
})

test('the ledger header tolerates a BOM, leading blank lines and a plain dash', () => {
  expect(parseLedger('﻿\n# SDD ledger - plan: docs/superpowers/plans/a.md\nTask 2: complete')?.planPath).toBe(
    'docs/superpowers/plans/a.md',
  )
  expect(parseLedger('\n\n# SDD ledger – plan: x.md\nTask 2: complete')?.completed.has(2)).toBe(true)
})
