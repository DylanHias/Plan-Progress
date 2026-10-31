# plan-progress

A [Claude Code](https://claude.com/claude-code) mod that answers "progress update?" before you ask it.

While a [Superpowers](https://github.com/obra/superpowers) implementation plan is being executed, plan-progress draws a minimal band directly above the prompt. It shows how many tasks are done, what's running, overall completion and how long is left.

```
──────────────────────────────────────────────────────────────────────────
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  6/8 · 10–18m · Token refresh ▸
──────────────────────────────────────────────────────────────────────────
❯
```

## What it shows

| Part | Meaning |
| --- | --- |
| Top rule | Separates the band from the transcript, styled like the prompt box's own line. |
| Bar | Completion of the plan. The filled part is tasks done out of the total. |
| `6/8` | Tasks done / tasks in the plan. |
| `10–18m` | ETA range. `ETA —` until two tasks have finished with timing. |
| `Token refresh` | The task that's running now (the first unfinished one). |
| `▸` / `▾` | Collapsed / expanded. |

The rule and the bar scale with the terminal width. On a narrow terminal the task name is cut short with `…` first, and only then does the bar shrink, down to a minimum of 8 cells. Nothing wraps.

### Expanded

Click the line, or run `/progress`, to see every task in the plan:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  6/8 · 10–18m · auth-refactor ▾
  ✓ 1 Extract session store
  ✓ 2 Session middleware
  …
  ▶ 7 Token refresh            4m
  ○ 8 Remove legacy cookie
```

`✓` done · `▶` running, with its active time so far · `○` waiting. Click again, or run `/progress`, to collapse it.

### When it shows

Only while a plan is **in progress**: execution has started and the plan isn't finished yet. A plan that's written but not started, a finished plan, or a repo without plans draws nothing, and the band stays out of the way.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install plan-progress --marketplace DylanHias/Plan-Progress
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install plan-progress --marketplace DylanHias/Plan-Progress
```

Do this once per machine. The mod has no configuration and nothing machine-specific.

## Usage

There's nothing to do. Use Superpowers as usual (brainstorm → write a plan → execute it) and the band appears once execution starts.

| Command | What it does |
| --- | --- |
| `/progress` | Expand or collapse the band (same as clicking the line). |

## How it decides

- **Which plan:** the plan in `docs/superpowers/plans/` that this session writes, or the plan whose execution ledger this session starts. If there's neither, it uses the newest plan in the repo that's in progress.
- **What's done:** a task counts as done when the execution ledger (`.superpowers/sdd/*/progress.md`) says `Task N: complete`, or when every checkbox under that task is ticked. Subagent-driven runs don't tick checkboxes, so the ledger is what counts there.
- **Worktrees:** ledgers and plans are read from every git worktree of the repo, so runs in `.worktrees/` show up too.
- **ETA:** each task's time is the *active* time since the previous task finished, meaning time while Claude or one of its subagents is working. Time spent waiting on you between turns doesn't count. The range is the 25th–75th percentile of finished tasks, multiplied by the tasks left.

[docs/how-it-works.md](docs/how-it-works.md) covers the internals.

## Known limitations

- If the tracked plan file is deleted or renamed, the band stays hidden until another plan is written or started.
- If an unfinished plan's ledger is deleted (for example by `git clean -fdx`), the plan looks unstarted and the band hides.
- The first task timed after the mod first sees a plan is only partly measured, so the first ETA can be a little short.
- Time spent on a permission prompt or a question in the middle of a turn counts as active time.
- Task headings and checkboxes inside fenced code blocks are counted as if they were real ones.
- The glyphs (`━ ▶ ✓ ○`) assume a terminal that draws them single-width.

## Requirements

- Claude Code 2.1.314 or newer (mods / function hooks are early access and the API may change between releases).
- Superpowers' plan and ledger formats: `### Task N: Name` headings and `# SDD ledger — plan: <path>` ledgers.
- `git` on the PATH, for repo and worktree detection. Without it, the session's folder is used as-is.

## Develop

```
git clone https://github.com/DylanHias/Plan-Progress.git
cd Plan-Progress
claude plugin validate .
claude plugin test .
claude --plugin-dir .        # run a session with the working copy loaded
```

| Path | Responsibility |
| --- | --- |
| `hooks/register.tsx` | Hook wiring, the band's drawing, `/progress` |
| `hooks/progress.ts` | Repo/worktree detection, picking the master plan, building the snapshot (all I/O) |
| `hooks/parse.ts` | Parsing plans and ledgers |
| `hooks/eta.ts` | Per-task timing and ETA formatting |
| `hooks/layout.ts` | Fitting the line to the width |
| `types/index.d.ts` | Shared types and the `$.state` contract |
| `tests/` | `claude plugin test` suites |
| `docs/superpowers/` | The design spec and implementation plan this mod was built from |
