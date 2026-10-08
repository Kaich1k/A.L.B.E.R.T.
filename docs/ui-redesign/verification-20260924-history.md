# Workshop correction — verification

Recorded 2026-09-24 after `bash scripts/install-app.sh` plus a relaunch with `--remote-debugging-port=9222` (hub pass, Memory editor-reveal, then this draft-merge / TIFF / busy-attach install). Installed app: `~/Applications/ALBERT.app`. Left open on the Workshop hub at **1512×949**.

Backups were not rewritten: `docs/ui-redesign/backup/20260924-workshop-correction/` and `docs/ui-redesign/backup/classic-ui-20260924.tar.gz` are still the earlier snapshots. Unrelated voice / computer-control work was not reverted.

Approved reference: `/Users/kai/Documents/Codex/2026-09-12/can/outputs/albert-blue-workshop/albert-blue-workshop.png`. This pass is at a nearby desktop size, not a pixel overlay.

## Build

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run test:interface` | 16 passed (includes Groq ≠ Gemini `workshopLink`, deferred draft-image merge, TIFF fallback) |
| `npm run test:voice` | 42 passed (voice, speech-text, turn-interrupt, computer-control) |
| `electron-vite build` + `electron-builder --mac dir` | Passed; app relaunched |

## Screenshots (actual running app)

| File | What it shows |
| --- | --- |
| `workshop-hub.png` | Hub at 1512×949 after the tour; 620×620 ring; Active source is `about:blank` |
| `workshop-hub-open.png` | Same hub after this install, left as the frontmost Workshop view |
| `workshop-hub-draft-merge.png` | Hub composer during the live race: newer text **B** plus the 1×1 PNG thumb |
| `workshop-hub-return.png` | Hub after Classic → Workshop restore |
| `workshop-hub-final.png` | Hub after detach/drag/Memory/dock; orb parked again |
| `workshop-small.png` | Hub resized to **1280×800**; ring **512×512**; no sector/status collision |
| `workshop-talk.png` | Comm Link after a Talk **sector click** |
| `workshop-missions.png` | Operations (`⌘3`) |
| `workshop-memory.png` | Memory constellation (`⌘4`); real `buildMemoryGraph` edges only |
| `workshop-memory-edit.png` | Hub → Languages/stack → Edit: list scrolled so that editor is on-screen |
| `workshop-memory-from-orb.png` | Memory after the detached-orb Memory path |
| `workshop-activity.png` | Activity (`⌘5`); `update_app` logs live here, not on Active source |
| `workshop-settings.png` | Systems (`⌘6`) |
| `workshop-classic.png` | Classic sidebar shell after Interface → Classic |
| `workshop-palette.png` | ⌘K command palette |
| `workshop-computer.png` | Computer sandbox with the `about:blank` tab |
| `workshop-float-orb.png` | Detached filament orb; transparent, no rectangular plate |

## Visual — measured in the live window

- **Desktop 1512×949:** center ring is **620×620**. That fills the 44% column instead of a ~500px floating pie.
- **Small 1280×800:** ring **512×512**. Side columns stay readable. Status stays in the lower opening. Computer / Activity do not collide with it.
- Sectors are chamfered SVG cards with circular icon wells, 16px labels, and wrapped hints. Lower cards read **Computer / Browse tools** and **Activity / History** (no overlapping single-line overflow).
- Globe is a large filament orb with a cyan rim. Idle. No mic-live implication.
- Status (“Standing by / Voice ready / Stop current work”) sits in the lower opening. Voice input is a separate bar under it. Activity chips are a footer row.
- Header is a full-width top rail: brand, search field, **Connected** (ChatGPT is signed in).
- Hub composer uses icon buttons: Attach image, Talk, and a 42px Send. Not Img/Mic/Send text chips.
- Panel frames are chamfered SVG outlines with a cyan heading marker. Body text is bright.
- Idle content is honest: no invented EEG mission, no fake selected destination. Computer is not drawn selected. Mission steps (when present) are ordered left-to-right from the record.

Not claimed: pixel match to the approved PNG. The reference still has richer lighting, broader lower cards, and a full-bleed composer. This build is the same shell with real data, not that illustration.

## Functional — run in the installed app

| Check | Result |
| --- | --- |
| Sector click Talk | Opened Comm Link. Hub button / `⌘1` returned home. |
| Sector keyboard Enter | Focused Memory and dispatched Enter; Memory panel opened. |
| Classic ↔ Workshop | Systems Interface → Classic showed the sidebar shell. Switching back restored Workshop, conversation, and the unsent hub draft. |
| Memory Inspect | Hub row “Other active/past proje…” → Inspect opened Memory on that selection. |
| Memory Edit | Hub Languages/stack → Edit opens that row’s editor, **scrolled into view and focused** (`workshop-memory-edit.png`). Cancelled without saving. |
| Memory refresh | Refresh after Edit keeps the same textarea focused and does not jump `scrollTop`. Handoff reveal is one-shot (`memoryRevealId`). |
| Unsent draft round-trip | Typed `unsent draft 1790263703007` in the hub, opened Talk, returned home; text still there. Survived Classic as well. Visible in `workshop-small.png` before it was cleared. |
| Image attach / remove | Attached a 1×1 PNG via the hub file input. Thumb appeared; draft text stayed. Clicking the thumb removed it. **Not sent.** This install also kept newer text **B** when the image finished after **A** (`workshop-hub-draft-merge.png`). |
| Active browser tab | Codex opened `about:blank` (“Blank probe”) on the prior install; Workshop Active source switched immediately. Computer tabs are in-memory: that probe was already gone before this install, and this binary still has none. Active source is the honest empty state. |
| Detach orb | Dock went empty (`is-empty`). |
| Orb drag | `hudDrag` start/move/end moved the HUD from `y=1533` to `y=1653`. |
| Orb Memory | Detached orb called the same `showWindow('memory')` path as the Memory satellite; Memory panel opened (`workshop-memory-from-orb.png`). |
| Dock | Snap back parked the filament orb in the hub again. |
| Stop current work | Control is present and disabled while idle. **Not invoked** — no live turn was interrupted. |
| Mission Hold / Reactivate / Cancel | Visible, disabled (no mission record). **Not clicked** on a real row. Independent of Stop current work. |

## Functional fixes included in this install

1. **Stop current work** uses `src/main/agent/stopWork.ts` — the same sequence as `CommandOrControl+Shift+.`: `supersedeChatTurn`, `cancelComputerWork`, `cancelKokoroSynthesis`, Codex/Cursor interrupt, `done` to every window. Exposed as `window.albert.stopCurrentWork()`. Mission record buttons do not call it.
2. **Failed send restore** uses a shared draft `{ text, images, rev }`. Restore runs only when `draftCache.rev` is still the revision cleared by that send.
3. **`workshopLink`** uses `configuredProvider()` (Groq local stays Groq). **Connected** only after verified ChatGPT `signedIn`. Other brains show **Configured** or **Offline**. Runtime test covers Groq vs Gemini vs ChatGPT.
4. **Hub paste** uses `filesFromClipboard` / items / `readClipboardImage`. `addFiles` returns the accepted count. Zero accepted (TIFF / rejected types) still calls `readClipboardImage`. Attachments merge through `mergeDraftImages` onto the latest cached text — not a captured `draft` inside a React updater. Typing uses `setDraftText` so it keeps those images.
5. **Computer subscribe** registers `onComputerChanged` first and ignores a snapshot if an event already incremented `computerGen`. Main window receives the all-windows broadcast.
6. **Memory Edit handoff** sets a one-shot `memoryRevealId`. After the list editor mounts, that row `scrollIntoView`s and the textarea is focused with `preventScroll`. Later `memories` refreshes do not reuse the reveal, so they cannot steal focus or jump the list.

## Codex-observed checks (01:42 build)

Codex inspected the installed 01:42 binary independently (no edits). Recorded here as observed, then re-run on this follow-up build:

| Check | Codex on 01:42 | Re-run after this install |
| --- | --- | --- |
| Missions radial button | Opened Operations; all **nine** tabs present | Same: missions, approvals, routines, capture, focus, pulse, capsules, artifacts, theater |
| Unsent hub draft → Missions → Hub | Test text survived, then cleared, never sent | Same: `codex-missions-draft-keep` still in the composer after Missions → Hub, then cleared |
| Classic / Workshop via persisted Interface selector | Both shells activated; conversation remained | Same: Classic sidebar on, then Workshop hub restored |
| Hub Languages/stack → Edit | Editor created for that memory, but the page stayed scrolled at the first rows so the editor was off-screen. Codex cancelled without changes and restored Workshop. | **Fixed.** Languages/stack editor is in view (textarea `top=480`, `bottom=568` in a 949-tall window), focused, list `scrollTop=3247`. Refresh kept focus and scroll. Cancelled without saving. |
| Computer `about:blank` as Active source | Opened a temporary `about:blank`; Workshop immediately showed it as Active source. Left the tab open. | Probe tab did not survive the install quit (in-memory). This binary: `tabs=[]`, Active source “No source open”. Close of only that probe was a no-op — it was already gone. |

## Not run / blocked

| Check | Why |
| --- | --- |
| Pixel match to the approved PNG | Not claimed. |
| Hold / Reactivate / Cancel on a real mission | No mission existed. |
| Stop current work while `busy` | Would cancel a live turn. Control only proven idle/disabled. |
| Physical HID mouse on sectors / HUD | This environment cannot post System Events clicks (no assistive access). Sector click, keyboard Enter, settings switch, composer, Computer tab, detach/dock, and `hudDrag` were driven in the installed renderer. |
| Expanded HUD satellite layout | Synthetic pointer events did not flip React `expanded` while the HUD was docked. Memory was opened through the satellite’s `showWindow('memory')` handler after detach. The collapsed detached orb was captured (`workshop-float-orb.png`). |
| Outbound mail / destructive tools | Not run, as required. |

## Honesty

The earlier “small flat pie in a 500px hole” is gone in the installed 1512×949 window: the ring is 620px, sectors carry icon wells and wrapped hints, status sits in the opening, and the composer/header read as chrome rather than leftover chips. Functional gaps from the last review (stop sequence, draft revision, Groq vs Gemini, paste/items, computer snapshot races) are in this build and were exercised where doing so did not send a message or destroy data.

It is still not the approved illustration. Classic, drafts, Computer `about:blank`, detach/dock, and Memory Inspect/Edit were run on this binary. Mission-record clicks and a busy Stop were not. Codex’s Languages/stack Edit scroll bug is fixed in this install and was re-checked live.

## Draft-merge / TIFF / busy-attach pass (this install)

Code-review findings included before this binary:

| Finding | What shipped |
| --- | --- |
| Stale `writeDraftCache(draft, kept)` after `await` inside a React updater | Shared `mergeDraftImages` / `setDraftText` write the module cache **outside** updaters. Merge keeps the latest cached text; typing keeps the latest cached images. |
| `ingestPaste` returned on any `files.length`, skipping native fallback | `addFiles` returns accepted count. Zero accepted still runs `readClipboardImage`. |
| Conversation Image enabled while `busy`, but attach bailed on `busy` | Next-draft attachments: Image / paste / drop / file input allow `busy`, still block `voiceLive`. |
| Tests were source-regex only | `scripts/draft-images.test.mjs`: deferred read + newer text **B**; typing after merge keeps the image; zero-accepted TIFF asks for native fallback. |

Live on this binary (CDP, no message sent):

- Typed **A**, attached a 1×1 PNG, immediately replaced the field with **B** while `FileReader` ran. Composer showed **B** and one thumb (`workshop-hub-draft-merge.png`).
- Missions sector → Operations → Hub. **B** and the thumb were still there. Then cleared; never sent.
- Active source is the honest empty state (“No source open”). `getComputerState()` is `{ tabs: [], activeTabId: null }`.
- Codex’s temporary `about:blank` / “Blank probe” tab was **already gone** on the pre-install session (Computer tabs are in-memory and the earlier process had none). After this install it was still absent. Close was attempted for `about:blank` / “Blank probe” only; **zero tabs matched**, so nothing else was closed.

Conversation attach-while-busy was not fired against a live turn (would send or interrupt). The Image control is enabled whenever voice is idle, and `addFiles` no longer returns early for `busy`.
