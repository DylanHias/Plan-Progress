import type { PlanTask } from '../types'

const TASK_HEADING = /^###\s+Task\s+(\d+)\s*[:—–-]\s*(.+?)\s*$/
const ANY_HEADING = /^#{1,3}\s/
const CHECKBOX = /^\s*- \[([ xX])\]/
const LEDGER_IDENTITY = /^# SDD ledger\s*[—–-]\s*plan:\s*(.+?)\s*$/
const LEDGER_COMPLETE = /^Task\s+(\d+):\s*complete\b/

export function parsePlan(text: string): PlanTask[] {
  const tasks: PlanTask[] = []
  let current: PlanTask | null = null

  for (const line of text.split('\n')) {
    const heading = TASK_HEADING.exec(line)
    if (heading) {
      current = { n: Number(heading[1]), name: heading[2] ?? '', checkboxes: 0, ticked: 0 }
      tasks.push(current)
      continue
    }
    if (ANY_HEADING.test(line)) {
      current = null
      continue
    }
    const box = current && CHECKBOX.exec(line)
    if (current && box) {
      current.checkboxes += 1
      if (box[1] !== ' ') current.ticked += 1
    }
  }

  return tasks
}

export function parseLedger(text: string): { planPath: string; completed: Set<number> } | null {
  const lines = text.replace(/^\uFEFF/, '').split('\n')
  const start = lines.findIndex(line => line.trim() !== '')
  const [first = '', ...rest] = start < 0 ? [] : lines.slice(start)
  const identity = LEDGER_IDENTITY.exec(first)
  if (!identity?.[1]) return null

  const completed = new Set<number>()
  for (const line of rest) {
    const match = LEDGER_COMPLETE.exec(line)
    if (match) completed.add(Number(match[1]))
  }

  return { planPath: identity[1], completed }
}

export function doneTasks(tasks: PlanTask[], ledgerCompleted: ReadonlySet<number>): Set<number> {
  return new Set(
    tasks
      .filter(t => ledgerCompleted.has(t.n) || (t.checkboxes > 0 && t.ticked === t.checkboxes))
      .map(t => t.n),
  )
}

export function planName(planPath: string): string {
  const base = planPath.split('/').pop() ?? planPath
  return base.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')
}
