# UI rollback

The Classic interface remains in the app. Workshop is a second shell over the same state.

## Snapshot

- Recorded commit: `9497f174007541304ab3a6edf0caf84d2a224947` (`main`)
- Working tree at backup time included uncommitted voice, Codex, and computer-control edits. Those edits are inside the archive.
- Archive: `docs/ui-redesign/backup/classic-ui-20260924.tar.gz`
- Contents: `src/renderer/src`, `src/renderer/index.html`, `src/shared/types.ts`, `src/main/config.ts`
- Excluded: `node_modules`, `dist`, `out`, `.git`, secrets, and user data

## Restore the archived UI files

From the repository root:

```bash
tar -xzf docs/ui-redesign/backup/classic-ui-20260924.tar.gz
npm run typecheck
bash scripts/install-app.sh --relaunch
```

That overwrites the archived paths with the pre-Workshop copies. Review `git diff` before committing.

## Use Classic without restoring files

Systems → Interface → Classic. The setting key is `interfaceStyle`. Conversations, voice, and other preferences stay put. Only the shell changes.
