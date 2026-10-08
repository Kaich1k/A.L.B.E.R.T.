# ALBERT desktop control

ALBERT's ChatGPT route now receives the same registered ALBERT tools as the other supported routes. Calls retain their originating conversation turn, existing confirmation policy, cancellation scope and activity logging. The previous ChatGPT thread is preserved and archived locally before the first tool-enabled successor is created. The visible conversation is retained; recent context is handed forward. Changes to the tool definitions trigger another deliberate, history-preserving successor because this installed app-server accepts tool definitions only when a thread starts.

## Observe, act, verify

1. `desktop_permissions` reports effective access plus separate main-app/controller results. It never requests permission.
2. `list_windows` / `desktop_list_windows` returns running apps and exact windows with opaque IDs, bounds and display information.
3. `desktop_focus_window` selects the intended window. `desktop_inspect` reads its accessible controls and returns a snapshot with element IDs.
4. Prefer `desktop_press` or `desktop_set_value` on an observed control. For visual-only interfaces, `desktop_screenshot` returns the exact window and the pixel-to-desktop-point mapping. Pointer, scroll, drag, Unicode typing and shortcuts use that observed window.
5. Inspect again after every action. Native API acceptance alone does not prove the requested task completed.

Window/snapshot IDs expire after 60 seconds. Mutations invalidate observations. Moved windows, lost focus, disabled/protected fields and mismatched controls fail with an explanation. The Stop control aborts both the active AI turn and native queued work. Normal helper termination releases a held drag before forced termination is considered.

## macOS setup

Open ALBERT → Systems → macOS permissions. The main app can show granted access while its separately compiled controller lacks it; the updated settings now check the controller too.

- Use **Request desktop control** / **Request Screen Recording** to register the running signed app with macOS. These explicit actions can show OS prompts; ordinary status checks never request grants. Accessibility is named **Device Control and Data Access** on newer macOS.
- Use **Reveal desktop controller** to locate `ALBERT.app/Contents/MacOS/albert-desktop-helper`.
- In Privacy & Security → Accessibility, authorize the ALBERT desktop controller if it is not already covered by ALBERT's access.
- For exact-window screenshots, Screen Recording is needed by the Electron host that captures the window. The controller’s separate screen preflight is diagnostic, not an additional capture gate.
- Restart ALBERT after changing permissions, then use **Recheck permissions**.
- Microphone permission belongs to ALBERT and is separately needed for wake-word and voice conversation.

Unknown/error states remain distinct from denied; controller diagnostics include executable/parent identity and the error code from a content-free parent AX-role probe. If a stale enabled entry survives a rebuild, remove/re-add only the current installed ALBERT in the affected macOS category. No grant is changed automatically. Application settings, confirmations and macOS protections are retained. The controller is packaged in the standard `Contents/MacOS` code location. `scripts/sign-local-mac.cjs` signs the complete personal build locally and verifies its nested code and sealed resources, instead of retaining an invalid Electron linker signature. Ad-hoc signing is not notarization and can require renewed authorization after a rebuild; a distributed build should use a stable Developer ID identity. Do not weaken designated requirements or alter the TCC database to retain grants.

Apple documents the role of application identity in privacy authorization in [TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements) and standard helper locations in [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/).

## Scope

This provides native interaction across ordinary accessible Mac windows, alongside ALBERT's existing browser, project, file and other tools. It does not grant administrator access, bypass macOS privacy controls, or make protected/custom-drawn interfaces universally accessible. Screen and app content are untrusted observations, not instructions to override the user's request.

The helper's wire format is documented in `../native/PROTOCOL.md`. `npm run test:desktop` checks serialization, cancellation, stale events, geometry, permissions, fixed operation variants and AI tool dispatch/migration. The helper's `--self-test` does not touch live windows. See `ui-redesign/verification.md` for installed-app evidence and remaining live-test limits.

### September 30 controller correction

Window references now bind to the kernel process-start timestamp rather than exact equality of `NSRunningApplication.launchDate`. The latter rejected newly listed live windows in the installed app. PID reuse, expiry and actual window existence are still checked. AX window-read failures report their native error instead of being mislabeled as vanished windows, and AppKit state is refreshed while waiting for focus changes.
