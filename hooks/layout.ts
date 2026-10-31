const BAR_MIN = 8

export function fitLine(
  cols: number,
  done: number,
  total: number,
  etaText: string,
  label: string,
  isExpanded: boolean,
): { filled: number; empty: number; text: string; countEnd: number; labelStart: number } {
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

  // offsets into `text`: the count ends, the label (or the tail) starts
  const countEnd = `  ${done}/${total}`.length
  const labelStart = head.length + (labelPart ? ' · '.length : 0)

  return { filled, empty: bar - filled, text, countEnd, labelStart }
}

export function rule(cols: number): string {
  return '─'.repeat(Math.max(cols, 0))
}

// n hex colors stepping evenly from `from` to `to` (both '#rrggbb').
export function gradient(n: number, from: string, to: string): string[] {
  const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [a, b] = [rgb(from), rgb(to)]
  return Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? i / (n - 1) : 0
    return '#' + a.map((c, k) => Math.round(c + (b[k] - c) * t).toString(16).padStart(2, '0')).join('')
  })
}
