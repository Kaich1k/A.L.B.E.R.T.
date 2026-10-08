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

## Workshop correction snapshot (2026-09-24)

A second dated copy of the files this correction edited lives at:

`docs/ui-redesign/backup/20260924-workshop-correction/`

It includes a `manifest.txt` with the working-tree status at backup time. Restore those individual files from that folder if this correction goes wrong. It does **not** contain later main-process, voice, or computer-control work, and it does not replace the original Classic archive.

The original 06:27 snapshot copied renderer files only.

Main / preload / shared recoverables were added later, with their provenance written in `backup/20260924-workshop-correction/RECONSTRUCTION.txt`:

- `src/main/computer/tabs.ts` — true pre-edit copy, taken immediately before the main-window `computerChanged` broadcast. Not HEAD.
- `src/main/ipc/handlers.ts`, `src/preload/index.ts`, `src/shared/api.ts`, `src/shared/types.ts` — reconstructed by reversing only the correction’s `open_panel` / `showWindow(panel)` edits. They keep the uncommitted voice/computer-control work from 06:27. They are not later post-correction copies and not HEAD.

Do not restore HEAD over these paths if you need that uncommitted work. The Classic archive still does not contain later main-process changes.
