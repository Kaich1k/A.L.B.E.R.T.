# ALBERT verification — 29 September 2026

This report supersedes the Sep27 report, retained in `verification-20260927-history.md`. All earlier UI archives remain.

## Installed build

Updated `/Users/kai/Applications/ALBERT.app` and relaunched it. Packaged and installed resources match:

- `app.asar`: `f82c02cb62f608458ef51b81c752a0031c692100ee4edd88cabceff5f87711db`
- `albert-desktop-helper`: `3d58b2dd45ce2660c4afbf5f653751dd55e5176553079637c09619dbe699bbf3`

The complete bundle was replaced after preserving a full rollback copy. Speech-worker and icon content is unchanged. The controller now resides in `Contents/MacOS`. The app and nested native code have valid local ad-hoc signatures; `codesign --verify --deep --strict` passes for packaged and installed apps. This is a personal build, not a notarized distribution. The original installed bundle retained an invalid Electron linker signature (`Identifier=Electron`, no sealed resources); the repaired bundle identifies as `com.albert.assistant`.

## Changes

The live blue orb now uses a white-cyan atmospheric rim, broader central blue-white light, curved surface connections and varied luminous hubs. Nodes remain fixed to the rotating sphere and emerge through a continuous depth/limb fade. Rotation is slower. The Workshop, detached mode, moods, speech amplitude, reduced-motion behavior and cleanup remain. The latest user-provided image guided this revision. The final installed Workshop was inspected natively at 1180 × 780 logical pixels; the orb, panel connections, frames and controls fit. The inspected screenshot was displayed inline, not saved to disk. Earlier startup replay and two-size checks remain historical evidence in the Sep27 report.

Voice endpoints now adapt to short, ordinary and long turns (900/1300/1800 ms after silence). Streaming preserves natural clauses and paragraph pauses, protects decimal boundaries and unfinished code fences, and cancels interrupted speech promptly. Obsolete completions cannot alter the new turn's speaking state. Existing local Kokoro / Daniel settings are retained; no paid/cloud provider was added.

Native desktop tools inspect exact windows and controls, focus windows, perform observed actions, set fields, capture exact windows, type Unicode, press shortcuts, scroll, click and drag. Observations expire and mutations invalidate snapshots. Focus changes and stale controls are rejected. Stop terminates pending native work. The ChatGPT route now dispatches ALBERT's registered tools under the existing turn scope and confirmations, with duplicate and stale-call handling. Tool-less conversations are preserved and archived before a tool-enabled successor receives recent context.

## Checks

| Check | Result |
| --- | --- |
| TypeScript checks | Passed |
| Voice regression suite | 70 passed |
| Native desktop / tool bridge / migration / permission tests | 27 passed |
| Interface regression suite | 19 passed |
| Codex regression suite | 18 passed |
| Total automated JavaScript tests | 134 passed, 0 failed |
| Swift helper pure validation | 15 passed; no desktop access |
| Orb simulated Canvas states | 32 passed; finite geometry, frame scheduling and cleanup |
| Production build and macOS packaging | Passed |
| Installed/package resource hashes | Match |
| Bundle and nested-code signature verification | Passed on packaged and installed copies |
| Installed Workshop visual review | Completed on final build |
| Kokoro preview | “Kokoro synthesis + playback verified” on this pass's initial voice build; voice source unchanged in final build |

The orb simulation is not a native performance benchmark. Native frame smoothness and perceived voice quality remain user judgments.

## Live desktop check and permission setup

A tightly scoped ALBERT chat successfully dispatched `desktop_permissions` and `desktop_list_windows` through the real ChatGPT app-server/tool registry, and both calls appeared in Activity. The list operation correctly stopped with `accessibility_required`. The controller reported no Accessibility/Screen Recording access while the main app reported grants. This uncovered the need to check the controller separately; the final Systems page and permissions tool now report effective access and provide Reveal desktop controller / Recheck permissions.

One original ChatGPT history archive and a new tool binding were observed after the live migration; the original conversation remained visible. The test did not alter any external app or send a message to another person.

The user explicitly approved controller Accessibility/Screen Recording and ALBERT Microphone, and completed the first Touch ID request. macOS showed the raw controller enabled, but it still failed its access check. The invalid host signature was then corrected and the helper moved into the standard code location. A fresh real ALBERT chat on the signed build dispatched `desktop_permissions` and correctly reported both host and controller access as off for the repaired identity. Adding the repaired app reached a new macOS Touch ID prompt; the user has been asked to authenticate. Follow-up cross-app actions remain unverified. Do not claim that every Mac app/protected surface is controllable.

The earlier installed voice build entered Listening after successful microphone acquisition and local engine warm-up; the session was explicitly ended. This is confirmed by `ClaudeVoiceSession.start()` awaiting both results before beginning capture. macOS showed ALBERT microphone toggles on, despite the previous Electron status reporting `not-determined`. Live microphone recognition accuracy in the user's room has not been tested, and the newly signed build needs renewed permission validation. No secrets were entered, no OS protections disabled, and no account/model/spending choices changed.

## Rollback and handoff

Selective source backups, the pre-update installed `app.asar`, and a manifest are under `backup/20260928-natural-voice-desktop/`. Files additionally hardened during review have `review-before/` snapshots. The original Classic archive, Sep27 UI/voice backups and Sep26 full application backup remain.

For rollback of the signing/packaging change, quit ALBERT and restore the complete `backup/20260929-signing-before/ALBERT.app` bundle. This preserves the exact previous signature and resource layout. Do not replace only an asar inside a signed bundle, since that invalidates the signature. For the earlier unsigned UI change, the Sep28 asar backup remains available. Preserve user data and history archives. Restore source selectively after comparing later changes; never reset the dirty repository. Large local binaries should stay out of commits.

`cursor-handoff-20260928.md`, `../DESKTOP_CONTROL.md` and `../VOICE_RELIABILITY.md` describe the implementation and remaining validation.

## 2026-09-30 permission and window-identity repair

- Fixed misleading denied/unknown statuses, capture-host permission gating, and added explicit OS request controls and runtime diagnostics.
- Found real OS refusal: controller parent-role probe returned AX error -25211. macOS listed archived ALBERT. Removing and re-adding only ALBERT in Accessibility and Screen Recording, then restarting, resolved it. Final installed build reports Accessibility, Screen Recording and Microphone granted.
- Live test then exposed false stale-window rejection immediately after listing. Replaced NSRunningApplication launch-date equality with kernel process-start identity, preserving PID-reuse checks. Added proper AX read errors and refreshed AppKit state during focus waits.
- Validation: TypeScript passes; 33 desktop tests; 18 native self-tests; stable process identity over 1000 own-process reads and missing PID rejected; packaged and installed signatures verify deep/strict.
- Current app.asar SHA256: e705ec6dffebbfb95b4535fa23eacea34bbcccf4843112511753cc827460024f
- Current native controller SHA256: 3a053650b027a0fc8e24852de6ee0c8a57575427417afa4e609a1a11d37eee5c
- Complete previous apps/source preserved in backup/20260929-permissions-before and backup/20260930-window-identity-before.
- Final installed-app test PASSED: ALBERT freshly listed TextEdit, focused desktop-control-check.txt, inspected, set its text to `ALBERT desktop control verified.`, re-inspected and captured that exact window. CUA independently confirmed exact document text; Activity shows all six native steps succeeded (September 30, 17:13 local). No save command or unrelated mutation was requested.
- Voice check PASSED on this final build: Kokoro reports synthesis + playback verified; voice entered Listening (real microphone acquisition), then was explicitly ended. ALBERT returned to STANDING BY / Voice ready. Real-world transcription accuracy and conversational naturalness still require normal spoken use.
