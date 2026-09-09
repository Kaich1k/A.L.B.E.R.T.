/** Shell that rebuilds/replaces the running Mac app — must not stay a child of ALBERT. */

export function commandLooksLikeSelfUpdate(command: string): boolean {
  const c = command.trim()
  if (!c) return false
  if (/\bnpm\s+run\s+["']?(update:app|install:app|dist|pack)["']?\b/.test(c)) return true
  if (/scripts\/install-app\.sh\b/.test(c)) return true
  if (/\belectron-builder\b/.test(c) && /--mac\b/.test(c)) return true
  return false
}

/**
 * Kai is asking to rebuild/reopen *now*, not “fix X, then reopen”.
 * The Mac host should start the installer without waiting for Codex to spawn npm.
 */
export function utteranceLooksLikeRebuildNow(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (commandLooksLikeSelfUpdate(t)) return true

  const asksUpdate =
    /\bnpm\s+run\s+["']?(update:app|install:app)["']?/.test(t) ||
    /\b(update:app|install:app|update_app)\b/.test(t) ||
    /\b(rebuild|reinstall)\b.{0,48}\b(app|yourself|albert)\b/i.test(t) ||
    /\b(app|yourself|albert)\b.{0,48}\b(rebuild|reinstall)\b/i.test(t) ||
    /\b(reopen|relaunch)\b.{0,32}\b(yourself|the app|albert)\b/i.test(t) ||
    /\b(reopen|relaunch)\s+(me|now)\b/i.test(t)

  if (!asksUpdate) return false

  const deferredFix =
    /\b(then|after that|once (?:you(?:'re| are)? done|finished|you fix))\b/i.test(t) &&
    /\b(fix|change|edit|patch)\b/i.test(t)
  return !deferredFix
}

/** Shell that quits/reopens ALBERT — must use Electron relaunch, not kill. */
export function commandLooksLikeSelfRestart(command: string): boolean {
  const c = command.trim()
  if (!c || commandLooksLikeSelfUpdate(c)) return false
  if (/\b(killall|pkill)\b[^\n]*\bALBERT\b/i.test(c)) return true
  if (/osascript[\s\S]{0,240}tell application[\s\S]{0,80}ALBERT[\s\S]{0,80}to quit/i.test(c)) {
    return true
  }
  if (
    /\bopen\b(?:\s+-a)?\s+['"]?(?:\$HOME|~|\/Users\/[^/\s]+)?\/Applications\/ALBERT\.app['"]?/i.test(
      c
    )
  ) {
    return true
  }
  if (/\bopen\s+-a\s+['"]?A\.?L\.?B\.?E\.?R\.?T['"]?\s*$/i.test(c)) return true
  return false
}
