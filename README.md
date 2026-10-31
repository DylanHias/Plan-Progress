# plan-progress

A Claude Code mod that answers "progress update?" without asking. While a [Superpowers](https://github.com/obra/superpowers) implementation plan is being executed, it draws a two-line band above the prompt:

```
──────────────────────────────────────────────────────────────────────────
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  6/8 · 10–18m · Token refresh ▸
```

- **Bar and count:** tasks done out of the plan's total.
- **ETA:** a range from the time finished tasks took, counting only time Claude was working (not time waiting on you). It shows `ETA —` until two tasks have finished.
- **Current task:** the first unfinished one.

The rule and the bar scale with the terminal width. Click the line, or run `/progress`, to expand it into one row per task (✓ done, ▶ running, ○ waiting).

## Which plan it tracks

The plan in `docs/superpowers/plans/` that this session writes, or the one whose SDD ledger (`.superpowers/sdd/*/progress.md`) it starts. Otherwise the newest plan that's in progress. A task counts as done when the ledger says `Task N: complete`, or when all of its checkboxes are ticked. The band only shows once execution has started, and it hides when the plan is finished.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install plan-progress --marketplace DylanHias/Plan-Progress
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install plan-progress --marketplace DylanHias/Plan-Progress
```

## Develop

```
claude plugin validate .
claude plugin test .
```
