/**
 * One epoch for multi-step computer work.
 * Bumping it invalidates clicks and typing that have not started yet.
 */
let epoch = 0

export function automationEpoch(): number {
  return epoch
}

export function cancelComputerWork(): number {
  epoch += 1
  return epoch
}

export function computerWorkStale(captured: number): boolean {
  return captured !== epoch
}

export function appForTool(name: string, args: Record<string, unknown>): string {
  if (name.startsWith('outlook_')) return 'Outlook'
  if (name === 'find_files' || name === 'read_file' || name === 'list_dir') return 'Finder'
  if (name === 'activate_app' || name === 'open_app') return String(args.name || args.app || 'App')
  if (name.startsWith('desktop_') || name.startsWith('browser_') || name.startsWith('computer_')) {
    return String(args.app || args.browser || 'Desktop')
  }
  return 'Mac'
}

export function approvalRequiredFor(name: string, dangerous: boolean | undefined): boolean {
  return Boolean(dangerous)
}
