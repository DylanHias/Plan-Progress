# How plan-progress works

This is the internals of the mod, for anyone changing it. For what it does and how to install it, see the [README](../README.md). The original intent and decisions are in [the design spec](superpowers/specs/2026-10-31-plan-progress-design.md).

## Shape

plan-progress is a Claude Code mod: a hooks module (`hooks/register.tsx`) named by `hooks/hooks.json`. It does all of its I/O through the engine's `$` interface, because a hooks module has no Node or DOM.

```
 tool.call ─┐                                   ┌─ ui.render (AbovePrompt)
 turn.*    ─┼─▶ refresh() ─▶ $.state.snapshot ──┤    draws rule + line (+ rows)
 session.* ─┘      │                            └─ /progress, click → isExpanded
                   ▼
          progress.ts (Io) ── parse.ts, eta.ts
                   │
        $.fs · $.process (git) · $.store
```

- **Events feed it.** Tool calls, turn starts and ends, and session start trigger a `refresh`.
- **`refresh` builds a `Snapshot`.** It holds the plan name, task rows, ETA and the current task's elapsed time, and is written to `$.state`.
- **The render hook draws.** It only reads `$.state`. It never does I/O and never writes, which the engine requires. A write to `snapshot` redraws the band.

## Modules

| File | Pure? | What it owns |
| --- | --- | --- |
| `parse.ts` | yes | `parsePlan` (task headings + checkboxes), `parseLedger` (identity line + `Task N: complete`), `doneTasks`, `planName` |
| `eta.ts` | yes | `recordFlips` (per-task durations from active time), `etaRange` (p25..p75 × remaining), `formatEta`, `formatElapsed` |
| `layout.ts` | yes | `fitLine` (bar width and label truncation for a given width), `rule` |
| `progress.ts` | no (via `Io`) | `detectRepo`, `worktreeRoots`, `latestLedgerPlan`, `fallbackPlan`, `buildSnapshot`, `ioFrom($)` |
| `register.tsx` | no | hooks, `$.state` atoms, `refresh`, the band's tree |

`progress.ts` takes a small injected `Io` (`read`, `list`, `run`, `get`, `set`) rather than `$`. The test kit's `$` takes event-shaped arguments, so this is what lets the tests run against an in-memory repo. `ioFrom($)` is the real adapter.

## State

Declared in `types/index.d.ts` under `PluginState['plan-progress']`. These values live for the session and survive hot reloads.

| Key | Holds |
| --- | --- |
| `session` | `{ id, startedAt, root, key }`: the repo root and the git common dir, as the cross-worktree key. Created lazily, and only once git has answered. |
| `master` | `{ planPath, at }`: the plan being tracked, and when it was chosen. |
| `active` | `{ accumulatedMs, since, open }`: the active-time clock and the open turn ids. |
| `snapshot` | What the band draws, or `null` to draw nothing. |
| `isExpanded` | The expand toggle. |

`$.store` keeps one record per plan across sessions, keyed `plan:<git common dir>:<repo-relative plan path>`. Each record is a `PlanRecord`: `{ done, durationsMs, mark, isFinished }`.

## Picking the master plan

1. **A plan this session writes.** A successful `Write`/`Edit` on `docs/superpowers/plans/*.md` (`tool.call`, checked after `next`; denied or errored calls are ignored).
2. **A plan whose ledger this session starts.** On every refresh, each worktree's `.superpowers/sdd/*/progress.md` is listed. A ledger modified after the current master's `at` (or after session start) makes the plan it names the master.
3. **Fallback.** With no master, the newest plan (by filename, across all worktrees) that's in progress and not marked finished.

"In progress" means a ledger names the plan or at least one task is done, and not every task is done.

## Counting

- **Tasks** are `### Task N: Name` headings. The separator may be `:`, `—`, `–` or `-`.
- **Done** means the ledger has `Task N: complete`, or the task has at least one checkbox and all of them are ticked.
- **Done is sticky.** It's recorded in the store, so a ledger line that disappears later doesn't un-finish a task.
- **Finishing.** When every task is done the record gets `isFinished: true`, and the band hides. The fallback never picks that plan again, even if its ledger is later deleted.
- **Which copy of the plan.** It's read from the worktree that holds its newest ledger. This matters because an inline run ticks checkboxes there.

## Timing

- **Active time** runs while at least one turn is open. That covers the main loop and background subagents alike: `turn.start` adds a `turnId` and `turn.complete` removes it. Gaps with nothing open, such as time waiting on you, don't count.
- **Per-task durations.** `recordFlips` compares the done set with the stored one. Newly done tasks share the active time since the stored `mark` equally, then the mark moves.
- **Marks from another session** measured a different clock, so they re-baseline instead of recording.
- **First sight.** The first time a plan is seen, its record is only a baseline and records no durations.

## Refreshing

- **When.** Every `tool.call` (any agent) refreshes, debounced to once per 2 s. Every main-loop `turn.complete` refreshes, and so does `session.start`.
- **Absent versus broken.** `ioFrom` treats a path as absent only when `$.fs.exists` says it's missing. Any other read or list failure throws.
- **Failures keep the last view.** `safeRefresh` catches the failure, keeps the last snapshot on screen, and logs the reason once per load (`$.ui.log`). A flaky read never gets recorded as "nothing done".

## Drawing

- **The band is a column.**
  - The rule: a `Text` in the theme's `promptBorder` color, sized to `bodyColumns`.
  - A `plain` `Button` (so the terminal draws no `[ ]`) holding three `Text`s: filled bar (`suggestion`), empty track (`inactive`), and the text.
  - When expanded, one `Text` per task.
- **Nothing wraps.** Every `Text` uses `wrap="truncate-end"`.
- **Yielding.** The hook passes to `next(e)` when there's no snapshot or a survey holds the band.

## Testing

`claude plugin test .` runs `tests/*.test.ts(x)` in the engine's own environment:

- **`parse` / `eta` / `layout`:** pure function tests.
- **`progress`:** an in-memory `Io` with fake files, git output and store, covering worktrees, absolute ledger paths, failing reads, unstarted, finished and malformed plans.
- **`band`:** mounts the `AbovePrompt` component on the terminal surface and drives hooks through the kit's `$`. It stubs the engine beneath with `on('fs.read' | 'process.run' | 'turn.complete' | …)` and seeds `$.state` through a `state.get` hook.

Type-check with `tsc -p .` once the engine has laid `.claude-plugin/types/` (it does that the first time it loads the mod).
