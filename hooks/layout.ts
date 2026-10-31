const BAR_MIN = 8

export function fitLine(
  cols: number,
  done: number,
  total: number,
  etaText: string,
  label: string,
  isExpanded: boolean,
): { filled: number; empty: number; text: string } {
  const head = `  ${done}/${total} · ${etaText}`
  const tail = ` ${isExpanded ? '▾' : '▸'}`

  let labelPart = label ? ` · ${label}` : ''
  if (cols - head.length - labelPart.length - tail.length < BAR_MIN) {
    const budget = cols - head.length - tail.length - BAR_MIN - ' · '.length
    labelPart = budget >= 2 ? ` · ${label.slice(0, budget - 1)}…` : ''
  }

  const text = head + labelPart + tail
  // shortcut: below ~20 columns the text itself overflows; the Text truncates it.
  const bar = Math.max(1, cols - text.length)
  const filled = total > 0 ? Math.round((done / total) * bar) : 0

  return { filled, empty: bar - filled, text }
}

export function rule(cols: number): string {
  return '─'.repeat(Math.max(cols, 0))
}
