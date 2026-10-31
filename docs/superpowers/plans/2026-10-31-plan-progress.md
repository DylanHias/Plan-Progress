# plan-progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that draws a one-line, width-scaling progress band (with its own rule and a per-task expand) above the prompt for the session's master Superpowers plan.

**Architecture:** Three pure modules (`parse.ts`, `eta.ts`, `layout.ts`) hold all logic and are unit-tested. `progress.ts` does the I/O through `$.fs` and `$.process` and produces a `Snapshot`. `register.tsx` wires the hooks: `tool.call` and `turn.*` feed it, `$.state` holds the snapshot, and an `AbovePrompt` `ui.render` hook draws it.

**Tech Stack:** TypeScript hooks module on the Claude Code 2.1.314 mod API (`claude-code`, `claude-code/testing`). No npm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-plan-progress-design.md`

## Global Constraints

- Mod name `plan-progress`. Repo at `~/plan-progress` (remote `origin` = `https://github.com/DylanHias/Plan-Progress.git`, branch `main`), symlinked into the session's dev-mods folder for hot reload.
- API authority: `.claude-plugin/types/claude-code/index.d.ts` (engine-written once loaded). Before that, `/private/tmp/claude-501/bundled-skills/2.1.314/0843da1d64041e41b088812547713560/plugin-authoring/types/claude-code.d.ts`. Grep it for the name at hand. Don't guess signatures.
- Every task ends green on `claude plugin validate .`, `claude plugin test .`, and `tsc -p .`.
- No npm dependencies. The module has no DOM/Node: all I/O goes through `$`.
- Tasks are `### Task N: <Name>` headings. The ledger is `.superpowers/sdd/<workspace>/progress.md`, first line `# SDD ledger — plan: <path>`, completions `Task N: complete`.
- Collapsed band = exactly 2 rows (rule + line). Hidden = `next(e)`, also whenever `e.props.hasSurvey`.
- Bar min width 8 cells. Rule glyph `─`, bar glyph `━`, toggle `▸`/`▾`, rows `✓` `▶` `○`, separator ` · `, ETA unknown `ETA —`.
- Width source: `e.props.bodyColumns`. Text in the band uses `wrap="truncate-end"` so nothing wraps.
- Debounce rereads to at most one per 2000 ms.
- ETA needs ≥ 2 timed tasks. Range = p25..p75 of task durations × tasks remaining.
- Never commit/push without Dylan's go-ahead (see handoff note).

## Review Focus

1. **Session cwd isn't a git repo, or has no `docs/superpowers/plans/`:** band hidden, no thrown hook, no transcript error line. Test in Task 4.
2. **Plan with no `### Task` headings** (a design doc in the wrong folder, a half-written plan): treated as no plan, never `0/0`. Test in Task 1.
3. **Ledger names the plan by absolute path, or from inside a worktree:** still matches the repo-relative plan. Test in Task 4.
4. **Very narrow band (`bodyColumns` 12):** no wrap, no negative widths, bar still ≥ 1 cell. Test in Task 3.
5. **Hot reload mid-run** (`session.start` runs again): active time and the session mark are not reset. Test in Task 5.

---

### Task 1: Scaffold + plan/ledger parsing

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx` (stub), `types/index.d.ts`, `tsconfig.json`
- Create: `hooks/parse.ts`
- Test: `tests/parse.test.ts`

**Interfaces:**
- Produces (in `types/index.d.ts`, exported):
  - `type PlanTask = { n: number; name: string; checkboxes: number; ticked: number }`
  - `type TaskRow = { n: number; name: string; isDone: boolean }`
  - `type Snapshot = { planPath: string; planName: string; tasks: TaskRow[]; eta: { lowMs: number; highMs: number } | null; currentElapsedMs: number | null }`
  - `type PlanRecord = { done: number[]; durationsMs: number[]; mark: { sessionId: string; activeMs: number } | null; isFinished: boolean }`
  - `PluginState['plan-progress']`: `{ snapshot: Snapshot | null; isExpanded: boolean; master: { planPath: string; at: number } | null; active: { accumulatedMs: number; since: number | null }; session: { id: string; startedAt: number; root: string; key: string } | null }`
- Produces (in `hooks/parse.ts`):
  - `parsePlan(text: string): PlanTask[]`
  - `parseLedger(text: string): { planPath: string; completed: Set<number> } | null`
  - `doneTasks(tasks: PlanTask[], ledgerCompleted: ReadonlySet<number>): Set<number>`
  - `planName(planPath: string): string`

- [ ] **Step 1: Write the manifest files**

`plugin.json`: `{ "name": "plan-progress", "version": "0.1.0", "description": "Progress band for the session's Superpowers plan", "types": "./types/index.d.ts" }`. `hooks.json`: `{ "modules": ["./register.tsx"] }`. `register.tsx`: `export const register: Register = () => {}`. `tsconfig.json`: extends `./.claude-plugin/types/tsconfig.json` (see SKILL.md "WHERE THE TYPES ARE"). Run `claude plugin validate .` and expect no errors.

- [ ] **Step 2: Write the failing tests** in `tests/parse.test.ts` (kit: `import { test, expect } from 'claude-code/testing'`; pure calls inside the body)

```ts
const PLAN = `# X Plan\n\n## Global Constraints\n- [ ] not a task box\n\n### Task 1: Extract session store\n- [x] **Step 1**\n- [x] **Step 2**\n\n### Task 2 — Token refresh\n- [x] a\n- [ ] b\n\n### Task 3: Docs only\n`
test('parsePlan', () => {
  expect(parsePlan(PLAN)).toEqual([
    { n: 1, name: 'Extract session store', checkboxes: 2, ticked: 2 },
    { n: 2, name: 'Token refresh', checkboxes: 2, ticked: 1 },
    { n: 3, name: 'Docs only', checkboxes: 0, ticked: 0 },
  ])
})
test('plan without task headings is empty', () => expect(parsePlan('# Design\n- [ ] x')).toEqual([]))
test('parseLedger', () => {
  const l = parseLedger('# SDD ledger — plan: docs/superpowers/plans/a.md\nTask 1: complete (abc123)\nTask 2: fix round 1\nTask 3: complete\n')
  expect(l?.planPath).toBe('docs/superpowers/plans/a.md')
  expect([...l!.completed]).toEqual([1, 3])
})
test('ledger without identity line is null', () => expect(parseLedger('Task 1: complete')).toBe(null))
test('doneTasks: ledger OR all ticked; zero boxes is not done', () => {
  expect([...doneTasks(parsePlan(PLAN), new Set([2]))].sort()).toEqual([1, 2])
})
test('planName strips date and .md', () => expect(planName('docs/superpowers/plans/2026-10-31-auth-refactor.md')).toBe('auth-refactor'))
```

- [ ] **Step 3: Run tests, expect FAIL** — `claude plugin test .` → fails on missing `../hooks/parse`.

- [ ] **Step 4: Implement `hooks/parse.ts`.** Task heading regex `^###\s+Task\s+(\d+)\s*[:—–-]\s*(.+?)\s*$`. A task's checkboxes are lines matching `^\s*- \[([ xX])\]` until the next `^#{1,3}\s` heading. Boxes before the first task are ignored. Ledger completion regex `^Task\s+(\d+):\s*complete\b`. Identity line regex `^# SDD ledger — plan:\s*(.+)$` (line 1 only).

- [ ] **Step 5: Run tests, expect PASS;** then `claude plugin validate .` and `tsc -p .` clean.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat: scaffold mod and parse plans and SDD ledgers"`

---

### Task 2: ETA bookkeeping and formatting

**Files:**
- Create: `hooks/eta.ts`
- Test: `tests/eta.test.ts`

**Interfaces:**
- Consumes: `PlanRecord` from `types/index.d.ts`.
- Produces:
  - `recordFlips(rec: PlanRecord | undefined, doneNow: ReadonlySet<number>, activeMs: number, sessionId: string): PlanRecord`
  - `etaRange(durationsMs: readonly number[], remaining: number): { lowMs: number; highMs: number } | null`
  - `formatEta(eta: { lowMs: number; highMs: number } | null): string`
  - `formatElapsed(ms: number): string`

- [ ] **Step 1: Write the failing tests** in `tests/eta.test.ts`

```ts
test('first sight is a baseline: no durations', () => {
  const r = recordFlips(undefined, new Set([1, 2]), 5000, 's1')
  expect(r).toEqual({ done: [1, 2], durationsMs: [], mark: { sessionId: 's1', activeMs: 5000 }, isFinished: false })
})
test('one flip records active time since the mark', () => {
  const r0 = recordFlips(undefined, new Set([1]), 1000, 's1')
  expect(recordFlips(r0, new Set([1, 2]), 61000, 's1').durationsMs).toEqual([60000])
})
test('two flips at once split evenly', () => {
  const r0 = recordFlips(undefined, new Set(), 0, 's1')
  expect(recordFlips(r0, new Set([1, 2]), 120000, 's1').durationsMs).toEqual([60000, 60000])
})
test('a mark from another session records nothing, re-baselines', () => {
  const r0 = recordFlips(undefined, new Set([1]), 999999, 'old')
  const r1 = recordFlips(r0, new Set([1, 2]), 1000, 's2')
  expect(r1.durationsMs).toEqual([]); expect(r1.mark).toEqual({ sessionId: 's2', activeMs: 1000 })
})
test('ledger done is sticky: a task vanishing from doneNow stays done', () => {
  const r0 = recordFlips(undefined, new Set([1, 2]), 0, 's1')
  expect(recordFlips(r0, new Set([1]), 10, 's1').done).toEqual([1, 2])
})
test('etaRange needs two durations', () => expect(etaRange([60000], 3)).toBe(null))
test('etaRange p25..p75 × remaining', () => expect(etaRange([60000, 120000, 180000, 240000, 300000], 2)).toEqual({ lowMs: 240000, highMs: 480000 }))
test('formatEta', () => {
  expect(formatEta(null)).toBe('ETA —')
  expect(formatEta({ lowMs: 600000, highMs: 1080000 })).toBe('10–18m')
  expect(formatEta({ lowMs: 4800000, highMs: 7200000 })).toBe('1h20m–2h')
  expect(formatEta({ lowMs: 20000, highMs: 50000 })).toBe('1m')   // equal ends collapse
})
test('formatElapsed', () => { expect(formatElapsed(240000)).toBe('4m'); expect(formatElapsed(30000)).toBe('<1m') })
```

- [ ] **Step 2: Run, expect FAIL** — `claude plugin test .`

- [ ] **Step 3: Implement `hooks/eta.ts`.** Percentile is linear interpolation on sorted values (`p25` of the 5 above = 120000, `p75` = 240000). Minutes are `Math.ceil`, minimum 1. Under 60m both ends share one `m` suffix. At or over 60m each end is `XhYm`, dropping `0m`. `isFinished` is set by the caller (Task 4), never by `recordFlips`, which copies it through.

- [ ] **Step 4: Run, expect PASS;** `tsc -p .` clean.

- [ ] **Step 5: Commit** `git add hooks/eta.ts tests/eta.test.ts && git commit -m "feat: ETA bookkeeping and formatting"`

---

### Task 3: Line layout for any width

**Files:**
- Create: `hooks/layout.ts`
- Test: `tests/layout.test.ts`

**Interfaces:**
- Produces:
  - `fitLine(cols: number, done: number, total: number, etaText: string, label: string, isExpanded: boolean): { filled: number; empty: number; text: string }`, where `text` is everything right of the bar, starting with two spaces: `  6/8 · 10–18m · Token refresh ▸`
  - `rule(cols: number): string` (`'─'.repeat(max(cols, 0))`)

- [ ] **Step 1: Write the failing tests**

```ts
test('wide: bar takes what text leaves', () => {
  const r = fitLine(80, 6, 8, '10–18m', 'Token refresh', false)
  expect(r.text).toBe('  6/8 · 10–18m · Token refresh ▸')
  expect(r.filled + r.empty + r.text.length).toBe(80)
  expect(r.filled).toBe(Math.round((6 / 8) * (r.filled + r.empty)))
})
test('label truncates with … before the bar drops under 8', () => {
  const r = fitLine(30, 6, 8, '10–18m', 'Token refresh and more', false)
  expect(r.filled + r.empty).toBe(8)
  expect(r.text.endsWith('… ▸')).toBe(true)
  expect(r.filled + r.empty + r.text.length).toBe(30)
})
test('very narrow: no negatives, bar ≥ 1, label dropped', () => {
  const r = fitLine(12, 1, 8, 'ETA —', 'Anything', false)
  expect(r.filled + r.empty).toBeGreaterThanOrEqual(1)
  expect(r.empty).toBeGreaterThanOrEqual(0)
  expect(r.text.includes('Anything')).toBe(false)
})
test('expanded uses ▾', () => expect(fitLine(80, 1, 2, 'ETA —', 'plan', true).text.endsWith(' ▾')).toBe(true))
test('rule', () => { expect(rule(5)).toBe('─────'); expect(rule(-1)).toBe('') })
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `hooks/layout.ts`.** Fixed part = `  ${done}/${total} · ${eta} · ` + ` ${toggle}`. Bar = `cols − fixed − label.length` if that is ≥ 8. Otherwise truncate the label to `cols − fixed − 8` chars, ending in `…` (drop the label and its leading ` · ` when that budget is < 2). If the bar is still < 8, it takes `max(1, cols − text.length)`. Lengths count UTF-16 code units. Every glyph used is single-width.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** `git add hooks/layout.ts tests/layout.test.ts && git commit -m "feat: width-fitting band line"`

---

### Task 4: Reading the repo: master plan and snapshot

**Files:**
- Create: `hooks/progress.ts`
- Test: `tests/progress.test.ts`

**Interfaces:**
- Consumes: `parsePlan`, `parseLedger`, `doneTasks`, `planName` (Task 1); `recordFlips`, `etaRange` (Task 2); types from Task 1.
- Produces:
  - `const PLANS_DIR = 'docs/superpowers/plans'`, `const SDD_DIR = '.superpowers/sdd'`
  - `detectRepo($: Api, cwd: string): Promise<{ root: string; key: string }>`. `root` = `git rev-parse --show-toplevel`. `key` = absolute `git rev-parse --git-common-dir` with any trailing `/.git` removed. On a non-zero exit: `{ root: cwd, key: cwd }`.
  - `toRepoRelative(root: string, path: string): string` (absolute under root → relative; a path containing `/docs/superpowers/plans/` from another worktree → from `docs/` on; relative → unchanged)
  - `isPlanPath(path: string): boolean` (matches `/(^|\/)docs\/superpowers\/plans\/[^/]+\.md$/`)
  - `latestLedgerPlan($: Api, root: string, sinceMs: number): Promise<{ planPath: string; at: number } | null>`: the ledger with the greatest `mtimeMs > sinceMs` whose identity line parses
  - `fallbackPlan($: Api, root: string, key: string): Promise<string | null>`: newest by filename (date prefix, then name) among plans whose store record isn't `isFinished` and that have ≥ 1 task not done
  - `buildSnapshot($: Api, s: { root: string; key: string; id: string }, planPath: string, activeMs: number): Promise<Snapshot | null>`. It reads the plan plus every ledger naming it, merges the completed sets, calls `recordFlips`, and writes the store record at key `plan:${key}:${planPath}`. When all tasks are done it sets `isFinished: true` and returns `null`. It returns `null` for a missing plan or one with 0 tasks. `eta` = `etaRange(durationsMs, remaining)`. `currentElapsedMs` = `activeMs − mark.activeMs` when the mark is this session's, else `null`.
  - (`Api` is the `$` type the module's hooks get; take its name from the types file.)

- [ ] **Step 1: Write the failing tests.** Stub the engine beneath with `on('process.run', …)`, `on('fs.list', …)`, `on('fs.read', …)`, `on('store.get', …)`, `on('store.set', …)` from an in-memory map, each answering `{ value }`. Missing files throw.

```ts
test('not a git repo: root and key fall back to cwd', …)            // process.run → { exitCode: 128 } ⇒ { root: '/w', key: '/w' }
test('worktree shares the main checkout key', …)                    // common-dir '/r/.git', toplevel '/r/.worktrees/x' ⇒ key '/r'
test('toRepoRelative handles absolute, other-worktree and relative', () => {
  expect(toRepoRelative('/r', '/r/docs/superpowers/plans/a.md')).toBe('docs/superpowers/plans/a.md')
  expect(toRepoRelative('/r/.worktrees/x', '/r/docs/superpowers/plans/a.md')).toBe('docs/superpowers/plans/a.md')
  expect(toRepoRelative('/r', 'docs/superpowers/plans/a.md')).toBe('docs/superpowers/plans/a.md')
})
test('no plans dir: fallback null, nothing thrown', …)               // fs.list rejects ⇒ null
test('fallback skips finished and complete plans, picks newest', …)  // 3 plans: 2026-10-01 complete, 2026-10-20 finished in store, 2026-10-10 open ⇒ 2026-10-10
test('ledger newer than session start wins; older ignored', …)       // mtime 50 vs sinceMs 100 ⇒ null; mtime 200 ⇒ its plan, repo-relative
test('snapshot merges ledger + checkboxes and records flips', …)     // tasks 1..3, ledger completes 1, task 2 all ticked ⇒ rows done [T,T,F]; second call with ledger +3 at activeMs+60000 ⇒ store record durationsMs [60000]
test('complete plan: isFinished stored, snapshot null', …)
```

Write the bodies out with concrete fixtures. The comments above give each test's inputs and expected values.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `hooks/progress.ts`.** Use `$.process.run(['git','rev-parse','--show-toplevel','--git-common-dir'], { cwd })` (one call, two lines). The common dir may come back relative: resolve it against `cwd`. Ledgers: `$.fs.list(`${root}/${SDD_DIR}`)` → each dir's `progress.md`, with mtime from the list entry of that dir's listing. Every fs call is wrapped so a rejection means "absent".

- [ ] **Step 4: Run, expect PASS;** `tsc -p .` clean.

- [ ] **Step 5: Commit** `git add hooks/progress.ts tests/progress.test.ts && git commit -m "feat: master plan selection and snapshot"`

---

### Task 5: Hooks, band and /progress

**Files:**
- Modify: `hooks/register.tsx` (replace stub)
- Test: `tests/band.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: the loaded mod. State refs are `{ plugin: 'plan-progress', key: <name> } as const` with `atom(ref, initial)`. The initials: snapshot `null`, isExpanded `false`, master `null`, active `{ accumulatedMs: 0, since: null }`, session `null`.

Behaviour (each line is one hook; all non-render work in handlers, never in `ui.render`):
- `session.start`: if the `session` state is `null`, set it to `{ id: String(now), startedAt: now, ...detectRepo(e.cwd) }`. A reload keeps the existing value. Register the command `{ name: 'progress', description: 'Expand or collapse the plan progress band' }`. Then refresh.
- `turn.start` with no `e.agentId`: `active.since = now`. `turn.complete` with no `e.agentId`: `accumulatedMs += now − since`, `since = null`, then refresh (not debounced).
- `tool.call` (any agent): `const r = await next(e)`. If the tool is `Write`/`Edit` and `isPlanPath(file_path)`, set `master = { planPath: toRepoRelative(root, file_path), at: now }`. Then a debounced refresh. Return `r`.
- refresh: `ledger = latestLedgerPlan(root, master?.at ?? session.startedAt)`. If the ledger is newer than `master`, it becomes `master`. `planPath = master?.planPath ?? fallbackPlan(...)`. `snapshot = planPath ? buildSnapshot(...) : null`, where activeMs = accumulated + (since ? now − since : 0). Write the `snapshot` state.
- `command.run` for `progress`: toggle `isExpanded`. Return `{ text: '' }`, or the shape the types require for a silent command (check `CommandRunResult`).
- `ui.render` `{ component: 'AbovePrompt' }`: when `hasSurvey` or the snapshot is `null`, return `next(e)`. Otherwise the tree is a column: `Text dimColor wrap="truncate-end"` holding `rule(bodyColumns)`, then a `Button key="toggle"` (onPress toggles `isExpanded`) containing the bar (filled `━` in an accent color, empty `━` dim) and `fitLine(...).text`. The label is the current task's name collapsed and `planName` expanded. When expanded, one `Text` per task follows: `  ✓ 1 Name` done (dim), `  ▶ N Name   <formatElapsed>` current (elapsed only when `currentElapsedMs` isn't null), `  ○ N Name` waiting.

- [ ] **Step 1: Write the failing tests** (mount `{ plugin: 'plan-progress', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19 }, … } }`. Complete the props from the `AbovePrompt` type. Seed state through `on('state.get', …)` as in the example `pane.test.tsx`.)

```ts
test('collapsed: rule + one line, 60 cols, terminal', …)   // seed snapshot 6/8 eta null; expect Text matching /^─{60}$/ and /6\/8 · ETA — · Token refresh ▸$/; no ✓ rows
test('expanded: one row per task with marks', …)            // seed isExpanded true ⇒ rows /✓ 1 /, /▶ 7 Token refresh\s+4m/, /○ 8 /
test('press toggles expand', …)                             // ui.find Button key toggle → press → ✓ rows appear
test('no snapshot or survey: engine draws', …)              // like pane.test.tsx's third test
test('hot reload keeps active time and session id', …)      // seed session {id:'s1',…} and active {accumulatedMs: 5000}; run $.session.start again ⇒ state.set never writes session; active unchanged
test('subagent turns do not move active time', …)           // turn.start/complete with agentId ⇒ active unchanged
test('writing a plan file makes it the master', …)          // $.tool.call({ tool:'Write', file_path:'/r/docs/superpowers/plans/2026-10-31-x.md', content }) ⇒ master.planPath 'docs/superpowers/plans/2026-10-31-x.md'
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `hooks/register.tsx`** per the behaviour list. Debounce = module variable `lastRefreshAt`. A reload resetting it is fine.

- [ ] **Step 4: Run, expect PASS;** `claude plugin validate .` and `tsc -p .` clean.

- [ ] **Step 5: Manual check in this session.** The mod hot-reloads at turn end. In `~/plan-progress` itself (this plan is a real master), confirm the band shows `n/6`, that clicking it or running `/progress` expands it, and that resizing the terminal re-fits the rule and the bar. Then note in the ledger what you saw.

- [ ] **Step 6: Commit** `git add hooks/register.tsx tests/band.test.tsx && git commit -m "feat: progress band, expand toggle and /progress"`

---

### Task 6: Install on other machines

**Files:**
- Create: `.claude-plugin/marketplace.json`, `README.md`

**Interfaces:**
- Consumes: the finished mod.

- [ ] **Step 1: Write `marketplace.json`**: a marketplace named `plan-progress` with one plugin entry `{ "name": "plan-progress", "source": "./" }`. Check the exact schema in reference.md under "Sharing a mod" before writing.
- [ ] **Step 2: Write `README.md`**: what it shows (2 lines, the mockup from the spec), install `/plugin marketplace add DylanHias/Plan-Progress` then `/plugin install plan-progress@plan-progress` (exact form per reference.md "Sharing a mod"), `/progress`, and how the master plan is chosen.
- [ ] **Step 3: Verify**: run `claude plugin validate .`, `claude plugin test .`, `tsc -p .`, all clean. Run `mcp__plugin-authoring__scan_secrets` over the folder (load it via ToolSearch) and expect no findings.
- [ ] **Step 4: Commit** `git add .claude-plugin/marketplace.json README.md && git commit -m "docs: install instructions and marketplace"`. Creating the GitHub repo and pushing happen only when Dylan asks.
