/**
 * Tools the QUICK tier must never reach: arbitrary shell and AppleScript.
 * Codex / Anthropic keep those; everyone else gets project and file work.
 */
export const QUICK_TOOL_DENY = new Set(['run_shell', 'run_applescript'])

/** Names the gap-close tests expect to stay on the QUICK allowlist. */
export const QUICK_REQUIRED_TOOLS = [
  'list_project_files',
  'read_project_file',
  'write_project_file',
  'read_file',
  'write_file',
  'apply_patch',
  'mission_create'
]
