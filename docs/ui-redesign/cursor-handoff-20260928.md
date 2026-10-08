# ALBERT handoff — 28 September 2026

Continue from the current shared source, not an older render or generated replacement. The repository includes substantial unrelated uncommitted work. Do not reset it. The user-approved blue Workshop shell, existing functional controls, Classic selector and older backups remain.

## Voice

The local Kokoro / Daniel configuration is preserved. Speech endpoints now adapt to utterance length (900/1300/1800 ms silence); existing phrase holds remain. Streamed text waits for useful clauses, protects decimal token boundaries and incomplete code fences, and preserves paragraph pauses. Interrupted playback invalidates its epoch and host speech promptly; stale callbacks cannot clear the new turn. With interruption disabled, speaker output is not accumulated as user speech. These changes build on the Sep27 audio trimming, streaming fallback and recognition improvements.

## Computer tools

`native/DesktopHelper.swift` and `src/main/computer/native{Desktop,Transport}.ts` provide exact-window AX inspection/actions, bounded pointer operations and Unicode keyboard input. Compile with `npm run build:desktop`; production build includes this step. The compiled resource is ignored by Git and included by the packager.

`src/main/codex/{dynamicTools,toolThreads,service}.ts` connect the ChatGPT route to ALBERT's registry using this installed app-server's dynamic tools protocol. Old tool-less threads are preserved, backed up and succeeded only on the next user turn. Recent history is carried forward. Do not resume old threads with unsupported dynamicTools parameters or silently clear chat history.

Use fresh observations, exact window IDs and observed element IDs. Actions invalidate snapshots. Cancellation ends queued native work and rejects late tool responses. Keep existing confirmations; do not change accounts, OS permissions, shell scope, or provider spending as part of UI work.

Live testing caught a real permission mismatch: main-app grants did not authorize the native controller. Settings now display effective controller access and offer Reveal desktop controller / Recheck permissions. See `../DESKTOP_CONTROL.md` for setup. Do not report broad desktop control as verified until the controller has been authorized and the installed-app smoke test passes.

## Orb

The latest user reference is `/var/folders/jc/m993kg217s7650ls1q11z27h0000gn/T/codex-clipboard-ca3a544f-8512-418d-befc-fa89f66af97f.png`: white-blue central glow, luminous cyan rim, a fine curved web and varied small star-like nodes. Keep the live animated Canvas and continuous depth/limb fades. The image is an appearance reference, not a static animation replacement.

## Verification / rollback

Read `verification.md` for final counts, hashes and live results. This pass is backed up under `backup/20260928-natural-voice-desktop/`. Original Classic and prior full-app backups remain. Restore binaries only with ALBERT quit, preserve user data, and restore source selectively after comparing later edits. This handoff requests no further autonomous changes.

## Sep29 packaging follow-up

The old installed bundle failed code-signature verification and still identified as Electron. The complete personal build is now locally ad-hoc signed by `scripts/sign-local-mac.cjs`; the desktop helper lives in `Contents/MacOS`. Every package and install validates the complete signature. Do not patch asar files inside the installed signed bundle: package and replace the whole app. A complete pre-signing rollback bundle is at `backup/20260929-signing-before/ALBERT.app`. Permissions may need renewal after ad-hoc rebuilds. No TCC database or designated requirements were weakened. See verification.md for the live permission state.
