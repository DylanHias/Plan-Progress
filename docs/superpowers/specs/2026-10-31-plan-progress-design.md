# plan-progress — design

Date: 2026-10-31

## Intent

Dylan keeps typing "progress update" during long Superpowers runs. The questions behind it are always the same: how many tasks are done, what's running and what's next, overall completion, and how long until it's finished. This mod answers them on screen so the question never has to be asked.

## What it is

A Claude Code mod (hooks module, `ui.render` on `AbovePrompt`) that draws a minimal band above the prompt box while the session's master plan has unfinished tasks.

### Collapsed (default)

```
──────────────────────────────────────────────────────────────────────────  ← own full-width rule
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  6/8 · 10–18m · Token refresh ▸
──────────────────────────────────────────────────────────────────────────  ← prompt box's existing rule
❯
```

- A full-width rule above the band, in the same style as the prompt box's top rule.
- One line: progress bar, `done/total` tasks, ETA range, name of the current task, expand toggle.
- **Scales with width.** The rule always spans the band's body width (`e.props.bodyColumns`, which excludes the band's own `[-]` mark). The bar takes the width the text leaves. When space runs short, the current-task name is truncated with `…` first, then the bar shrinks to a minimum of 8 cells.

### Expanded

Clicking the line (a `Button`) or running `/progress` toggles it. Expanded, it lists every task of the master plan:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  6/8 · 10–18m · auth-refactor ▾
  ✓ 1 Extract session store
  ✓ 2 …
  ▶ 7 Token refresh            4m
  ○ 8 Remove legacy cookie
```

- ✓ done, ▶ current (with elapsed active time), ○ not started.
- The header shows the plan name instead of the current task.
- The expanded/collapsed state persists across the session (`$.state`).

### Hidden

Nothing is drawn (`next(e)`) when the session has no master plan or the master plan is complete. Also defer to the engine when `e.props.hasSurvey` is set, as the band example does.

## The master plan

The tracked plan is one Superpowers implementation plan, `docs/superpowers/plans/*.md` under the session's working directory / repo root. It is picked in this order:

1. The plan file this session **writes** (a `Write`/`Edit` `tool.call` to a path matching `docs/superpowers/plans/*.md`). The most recent write wins.
2. The plan this session **starts executing**: a write to an SDD ledger (`.superpowers/sdd/<workspace>/progress.md`) whose first line is `# SDD ledger — plan: <plan file path>`. That names the plan. *(Builder's call, approved: covers the "plan written in one session, run in a fresh one" case.)*
3. Fallback: the newest plan file in `docs/superpowers/plans/` that still has unfinished tasks.

Older plans in the repo are ignored. The master only switches when 1 or 2 fires again.

## Counting tasks

Verified against Superpowers 7.0.0 (`writing-plans`, `subagent-driven-development`):

- **Tasks** are `### Task N: <Name>` headings in the plan file. Total = the number of those headings.
- **Done** (either is enough):
  - the plan's SDD ledger has a `Task N: complete` line, or
  - every `- [ ]` / `- [x]` checkbox under that task's heading is ticked (inline `executing-plans` runs).
- **Current** = the lowest-numbered task that isn't done. **Next** = the one after it.
- The ledger matters more than the checkboxes: SDD doesn't tick plan checkboxes.
- **Finished plans are remembered.** When the mod sees a plan complete, it records the plan path as finished (`$.store`, keyed by repo + plan path), so a later `git clean` that deletes the git-ignored ledger won't bring the plan back as 0%.

- A task with no checkboxes and no ledger line is **not** done. A ledger `Task N: complete` is sticky.

**When to reread** *(my call)*: SDD appends to the ledger with Bash as often as with Write/Edit, so path-matching tool calls would miss updates. Instead, reread the plan and the ledgers after every `tool.call` (any agent; `tool.call` fires for subagents too, with `agentId`) and at `turn.complete`, debounced to at most once per ~2s. The files are small. Step 2 of master selection works the same way: on reread, scan `.superpowers/sdd/*/progress.md` first lines and look for a ledger that is new or changed since the last read and names a plan.

**Paths and keys** *(my call)*: the repo root is the git top-level of `$.session.cwd()`. In an SDD worktree, plans and ledgers are read from the worktree. Finished-plan records and ETA history are keyed by git common-dir + repo-relative plan path, so the main checkout and its worktrees share them.

**Master persistence** *(my call)*: the chosen master is kept in `$.state`, so it survives reloads and `/clear`. A fresh session starts at the fallback, step 3.

## ETA

- Count only **active time**: time while a main-loop turn is running (`turn.start` → `turn.complete` with no `agentId`; subagents run inside it). Time spent waiting on Dylan isn't counted.
- A task's duration is the active time accumulated since the previous task flipped to done *(my call)*. An SDD run is one long turn, so turn boundaries can't delimit tasks.
- When several tasks flip at once (detected in one reread), the accumulated time is split evenly between them *(my call)*.
- Record each task's active duration when it flips to done (`$.store`, per plan), so the history survives reloads and restarts.
- Range = (low and high per-task duration estimate) × tasks remaining, e.g. the 25th–75th percentile of completed tasks. Display as `10–18m`, or `1h20m–2h` above 60 minutes.
- Fewer than 2 completed tasks with timing: show `ETA —`.
- Tasks that were already done before the mod first saw the plan have no timing and are excluded from the estimate.

## Distribution

Dylan wants the same mod on their other machines. The mod folder becomes its own GitHub repo with `.claude-plugin/marketplace.json`, and the README documents `/plugin install plan-progress --marketplace <owner>/<repo>`. Nothing machine-specific goes in the code. Paths are resolved from the session's working directory.

Creating and pushing the repo happens only when Dylan asks (global rule: never push without being asked).

## Goals

- Answer "how many done / what's running / what's next / overall % / how long" at a glance, without asking.
- Minimal: one line plus a rule, and nothing drawn when there's nothing to track.
- Correct for SDD runs (ledger-based), not just inline ones.

## Non-goals

- Aggregating several plans into one bar.
- Viewing progress from another device (phone, other machine).
- A side pane or status-line variant.
- Editing plans or marking tasks done from the UI.

## Anti-goals (failure even if it "works")

- A bar that lies: old or SDD-run plans showing 0% because checkboxes weren't ticked.
- An ETA that counts time Claude spent waiting on Dylan.
- Visual noise: more than two lines collapsed, or drawing when no plan is active.
- Layout breaking at narrow widths (wrapping instead of truncating).

## Constraints

- Claude Code mod API as bundled with this build (2.1.314). Types: `.claude-plugin/types/` once loaded. `claude plugin validate`, `tsc -p`, and `claude plugin test` must pass.
- Terminal surface is the target. Other surfaces (`desktop`, `vscode`) should degrade to the same tree via `$.ui.resolve(e)`, with no surface-specific work.
- TDD per Superpowers. Tests in `*.test.ts(x)` run by `claude plugin test`, seeded with plan and ledger fixtures.

## Left to the builder

- Exact parsing tolerances (heading variants such as `### Task 3 — Name`, nested checkboxes).
- Bar glyphs and colors, provided it matches the mockup's restraint (dim track, accent fill).
- Percentile method for the ETA range.
