# ALBERT Workshop and voice handoff — 27 September 2026

Codex completed the user's requested refinement in the shared repository and installed the resulting app. Use this implementation as the baseline; read the current files before changing anything. The repository has substantial unrelated uncommitted work. Do not reset, bulk-replace, or discard it.

## Visual baseline

Keep the approved blue Workshop design, live detachable Canvas orb, all existing functional controls, and Classic interface selector. Reference assets remain in `references/`; the approved full concept is `/Users/kai/Documents/Codex/2026-09-12/can/outputs/albert-blue-workshop/albert-blue-workshop.png`. The orb PNG is a visual reference, not a replacement for the live animation.

- `FilamentOrb.tsx`: finer, denser blue filaments and smooth depth/limb fades for lines, nodes, dust and glints. Removed abrupt front/back visibility transitions. Public props, mood behavior, transparency, frame cap, reduced motion and cleanup retained.
- `WorkshopHome.tsx`, `WorkshopConnections.tsx`, `workshop.css`: measured pixel-sized chamfer corners, four responsive panel-to-ring connections, quieter floor grid and deeper panel surfaces. Memory filter stays visible; source details scroll without losing the provider tag; shorter conversation excerpts; clearer disabled Send state.
- `StartupSequence.tsx`, `App.tsx`: Workshop startup animates the existing docked orb, with inline Skip and temporary surrounding dimming. Replay returns to the Hub/dock. No invented initialization milestones. Classic retains its own presentation. Settings wording updated.

## Voice changes

- `ttsAudio.ts` / `tts.ts`: conservative level-relative trimming retains quiet consonants. Stream joins subtract both retained edge pads from the previous segment's intended pause. Explicit cancellation cannot restart speech through system fallback, including cancellation during audio decoding. Genuine pre-playback failures can still fall back.
- `kokoro.ts`: failed initialization is retired and can retry; old-worker events cannot reset a replacement.
- `audio.ts`: windowed-sinc conversion to 16 kHz suppresses aliasing; speech-window extraction keeps boundary padding.
- `claudeVoiceSession.ts` / `voiceGate.ts` / `voiceCommands.ts`: transcription confidence is measured on the observed speech interval rather than long idle room tone. Clear short replies are permitted only with strong normal-listening audio evidence. Hot-mic and wake-word filtering stay conservative. Short abandoned bursts reset cleanly; timing uses observed elapsed time.
- Added `scripts/tts-quality.test.mjs` and `scripts/stt-quality.test.mjs` to `test:voice`.

Kokoro / Daniel (UK male), rate 1.06, existing provider choices and microphone/interrupt preferences were preserved. Do not change accounts, models, provider spending or microphone permissions as part of visual work.

## Verification and rollback

Read `verification.md` for final installation evidence and limits. Typecheck, 60 speech-related tests, 19 interface tests, production build and packaging passed. UI was inspected natively at two window sizes. Startup replay, Skip and completion were checked. Simulated capture-loop checks cover short replies after a long idle period; this is not a live microphone accuracy measurement.

New targeted backups: `backup/20260927-orb-refinement/` and `backup/20260927-voice-refinement/`, each including outgoing installed app resources. Original Classic archive and Sep26 full-app backup remain. Binary rollback requires quitting ALBERT and restoring the selected backup without touching user data. Source rollback must be targeted and preserve later changes.

This handoff requests no further edits or reinstall. The existing Cursor agent provided a read-only layout review during this pass; its findings about clipped content and distorted frame corners were addressed. Await the user's next revision before changing this baseline.
