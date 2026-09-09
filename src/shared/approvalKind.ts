export type ApprovalKind = 'email' | 'diff' | 'purchase' | 'shell' | 'app' | 'file' | 'other'

const RULES: Array<[ApprovalKind, RegExp]> = [
  ['email', /\b(email|gmail|outlook|smtp|inbox|mailto|send this (?:mail|message))\b/i],
  ['diff', /\b(diff|patch|pull request|commit|codex)\b|\b[+-]{3}\s|\b@@ /],
  ['purchase', /\b(buy|purchase|order|checkout|payment|stripe|invoice|\$\d)\b/i],
  ['shell', /\b(shell|terminal|bash|zsh|npm run|git |chmod|sudo)\b/i],
  ['app', /\b(open_app|launch|applescript|click|desktop_|spotify)\b/i],
  ['file', /\b(write_file|delete_file|apply_patch|overwrite)\b/i]
]

export function classifyApprovalKind(input: {
  title?: string
  description?: string
  preview?: string
  risk?: string
}): ApprovalKind {
  const blob = `${input.title || ''} ${input.description || ''} ${input.preview || ''} ${input.risk || ''}`
  for (const [kind, re] of RULES) {
    if (re.test(blob)) return kind
  }
  return 'other'
}

export function approvalKindLabel(kind: ApprovalKind): string {
  if (kind === 'email') return 'Email'
  if (kind === 'diff') return 'Diff'
  if (kind === 'purchase') return 'Purchase'
  if (kind === 'shell') return 'Shell'
  if (kind === 'app') return 'App action'
  if (kind === 'file') return 'File'
  return 'Review'
}
