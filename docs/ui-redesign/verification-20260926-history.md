# Workshop verification — 26 September 2026

This report supersedes the earlier installation report, preserved in `verification-20260924-history.md`. Earlier screenshots in this folder show earlier builds and are not evidence of the final orb.

## Installed result

Installed and launched `/Users/kai/Applications/ALBERT.app`. Final packaged app resources match the installed resources (SHA-256 `d6c0b17a2247334304bd8ca205f2698f831b791155ff7e89349ab7bb52e2b07c`). Workshop is selected, the composer is empty, and no live mission was started.

The final native screenshot was inspected in the Codex conversation at 2360 × 1560 physical pixels. It shows the loaded, connected Workshop: blue filament orb, readable radial hints, separated memory labels, clear idle controls, and the source empty state without a blank thumbnail. A file copy of this screenshot was not saved; do not label older screenshot files as this build. This is an implementation guided by the approved concept, not a claimed pixel match.

## Changes in this pass

- Replaced the rigid triangular orb mesh with animated curved filaments, luminous nodes, layered blue volume and a compact white core. Shared live Canvas remains in use for docked and floating presentations, with mood handling, transparency, reduced-motion behavior and cleanup preserved.
- Corrected individual radial label/hint anchors, aligned the orb rim, dimmed empty mission arcs, and retained all six existing navigation handlers.
- Enlarged the memory node hit regions and spaced labels while preserving named keyboard-operable nodes, selected state and focus indication.
- Source-note saves now use a per-source session cache. Pending and completed writes suppress duplicates; late failures remain with the source they belong to and can be retried. Leaving and returning to the Hub retains this state.
- Renamed the top action to “Search commands…” to accurately describe the command palette. Simplified the empty source card.
- Added the transparent orb reference PNG and its generation prompt under `references/`.

## Verification

| Check | Result |
| --- | --- |
| `npm run typecheck` on final source | Passed |
| `npm run test:interface` on final source | 19 passed, 0 failed |
| `npm run build` | Passed |
| `npx electron-builder --mac dir --publish never` | Passed |
| Final app launch and visual inspection | Passed; live blue orb and real conversation/status loaded |
| Memory selection → Edit | Correct Languages/stack editor opened and focused; cancelled unchanged |
| Unsent draft → Missions → Hub | Draft retained, then cleared without sending |
| Missions navigation | Operations opened with all nine tabs present |
| Detach → Snap back | Main orb dock emptied and then restored |
| Classic → Workshop | Both shells activated; conversation retained; Workshop restored |
| Idle mission controls | Hold, Stop current work and Cancel mission disabled; Open Missions available |

The interaction checks above were run on the first direct installation of this pass. The final installation only increased orb contrast/core size and simplified the source-card appearance; its loaded Workshop was visually checked again. No message was sent, memory edited or mission mutated.

The interface suite contains both behavioral helper tests and source-pattern checks. The three new source-note tests exercise pending duplicate suppression and later visits, source-specific late failure/retry, and stable subscription snapshots. They do not prove artifact-store integration on their own. Independent source review found no concrete regression in this cache integration, radial text positioning or memory hit regions.

## Not exercised in this pass

- Real mission execution, Hold/Reactivate/Cancel, or busy Stop interruption.
- Live microphone capture, speech playback or voice interruption.
- A real source-note save into the artifact store; concurrency/retry/duplicate logic was tested independently.
- Physical dragging of the detached orb or the expanded satellite layout. Detach/return was observed through native UI.
- A new small-window screenshot after the final polish. Text anchors were checked geometrically and the current native window was inspected; earlier size checks remain historical evidence only.

## Backups and rollback

- Original Classic archive retained: `backup/classic-ui-20260924.tar.gz`.
- Source snapshot before this pass: `backup/20260926-1557-codex-orb/` (targeted renderer files and package.json, with manifest). The new source-note helper/tests are listed in the manifest.
- Full outgoing installed app: `/Users/kai/Applications/.albert-backups/ALBERT-before-codex-orb-20260926-160037.app`.
- First direct build resources before the final visual polish: `backup/20260926-1557-codex-orb/app-before-final-polish.asar`.

Use the persisted Systems → Interface selector to return to Classic. For a binary rollback, quit ALBERT and restore the backed-up app without touching its user data. For source rollback, compare and restore only this pass's targeted files; do not reset the dirty repository or overwrite later unrelated changes. Keep large binary backups local rather than committing them accidentally.

## Cursor coordination

The existing “CSS unknown property warning” Cursor agent is still showing an out-of-usage notice. The final pass was completed directly in the shared repository. See `cursor-handoff-20260926.md` for assets, implementation constraints and remaining validation boundaries.
