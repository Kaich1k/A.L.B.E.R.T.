# ALBERT Workshop handoff — 26 September 2026

The user requested continuation of the approved blue Workshop design and a better orb PNG. Cursor reached its usage limit, so Codex completed the current pass directly in the same repository. Read the current files before doing anything; do not overwrite these changes with the earlier geometry implementation.

## Visual references

- Approved main concept: `/Users/kai/Documents/Codex/2026-09-12/can/outputs/albert-blue-workshop/albert-blue-workshop.png`.
- Approved floating concept: `/Users/kai/Documents/Codex/2026-09-12/can/outputs/albert-blue-workshop/albert-blue-floating.png`.
- New orb image: `/Users/kai/Documents/VS/ALBERT/docs/ui-redesign/references/albert-orb-reference-v2.png`.
- Exact image prompt: `references/orb-reference-v2-prompt.txt`.
- Updated geometry: `references/hub-geometry-spec.md`.

The new PNG was generated with the built-in image-generation tool and is 1254 × 1254 RGBA with genuine transparency. It defines blue color, fine filament structure, bright nodes, compact white core and rim lighting. It is a visual reference, not a replacement for the live orb. Keep the animated, stateful, detachable Canvas implementation and existing accessible controls. Do not put a static screenshot in the interface or invent decorative gauges and mission data.

## Completed changes

`FilamentOrb.tsx`: curved animated filaments, node/depth particles, rich blue volume/rim, brighter front strokes and compact core; preserved public props, mood semantics, transparent dock/float rendering, frame cap and reduced-motion/hidden behavior.

`WorkshopHome.tsx` and `workshop.css`: per-line radial anchors and corrected rim, subdued empty mission arcs, larger accessible memory hit regions with spaced labels, accurate command-palette caption, cleaner source empty state.

`chat/sourceNotes.ts` and `scripts/source-notes.test.mjs`: stable per-source external-store snapshots. Pending/completed saves prevent duplicates within the session; errors and retry belong to the correct source, including navigation away and back. Existing general artifact versioning is unchanged. The test command now includes these behavioral tests.

The prior duplicate-drop, memory-filter selection, busy-send Stop label, successful clipboard fallback error-clear and provider-specific source label fixes were preserved. Unrelated voice, routing, mobile and computer changes were not reverted.

## Current status and next work

Final app is installed at `/Users/kai/Applications/ALBERT.app`, left on Workshop. Typecheck, all 19 interface tests, production build and packaging passed. Native memory editor navigation, draft preservation, mission navigation, Classic switching and orb detach/return were checked. The final visual polish was checked in the running app.

Read `verification.md` for precise evidence and limitations. Real mission cancellation, live voice, actual artifact-store save, detached physical dragging and the expanded satellite layout were not established by this pass. Do not report them as verified. Older screenshots in the folder are historical; the final screenshot was inspected inline in Codex but not saved as a file.

Preserve the original Classic archive, persisted Interface selector, targeted source snapshot and full installed-app backup identified in verification.md. This repository has extensive unrelated uncommitted work; never reset, discard or bulk-replace it. No additional changes are requested by this handoff alone. Use the PNG and corrected live implementation as the baseline for the user's next visual revision.
