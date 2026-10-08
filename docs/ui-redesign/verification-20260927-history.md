# Workshop and voice verification — 27 September 2026

This report supersedes the Sep26 report, retained in `verification-20260926-history.md`. Older saved screenshots depict earlier builds; the current native screenshots were inspected inline and were not saved as image files.

## Installed result

Updated and launched `/Users/kai/Applications/ALBERT.app`. Packaged and installed `app.asar` match SHA-256 `e21e19836dc071df2855bdf677e9ec2d75ae9c2069d3eccd0f44422d6a84d0b8`. Extra-resource speech workers already matched the package and did not need replacement. The app is connected, on Workshop, with its existing conversation loaded and an empty composer. No mission, message, memory edit or source-note write was performed during these checks.

## UI refinement

- Denser fine blue orb threads, smaller nodes and continuous depth/limb fades remove abrupt dot/glint appearance as the sphere rotates. Live Canvas mood behavior, detachment, reduced motion, visibility handling and cleanup remain.
- Startup animates the normal Workshop orb in its dock. Inline Starting/Skip controls and subtle surrounding dimming replace the separate Workshop intro. Replay returns to Home/dock. Real activity or navigation ends the intro; no artificial initialization claims.
- Measured chamfer corners keep a constant size. Four responsive links connect panel edges to the radial controls. Background floor lines are quieter; panel surfaces have greater depth.
- Memory filter remains visible below the map; source content scrolls inside its card and preserves its provider label; conversation excerpts are shorter and disabled Send is clearer.

The same final UI source was inspected at 1180 × 780 and 1512 × 949 logical window sizes before the voice integration. The combined installed build was visually checked again at 1180 × 780: controls fit, links align, the filter/provider label are visible and the orb remains centered. Startup replay and Skip were checked on the UI installation; the same orb accessibility node returned from startup to idle. Automatic completion was also observed. The voice integration did not alter these renderer components.

## Voice changes and evidence

TTS uses conservative adaptive silence trimming to preserve quiet initial/final consonants. Stream scheduling accounts for both retained edge pads and the preceding segment's punctuation pause. Cancellation during synthesis or decoding cannot restart speech through system fallback. Real pre-playback failures still fall back. Kokoro initialization can recover after a failure, and late events from retired workers cannot reset their replacement.

STT gates only the observed speech interval, so a long idle prefix no longer dilutes speech confidence. A padded interval is still supplied to transcription to retain quiet boundaries. Clear short replies can pass with strong normal-listening audio evidence; wake-word and hot-mic defaults remain conservative. Short abandoned bursts reset, polling counts observed elapsed time, and 16 kHz resampling filters frequencies that would otherwise alias into the speech band.

Kokoro / Daniel (UK male), rate 1.06, pitch 1.0, punctuation, microphone sensitivity, wake-word and interruption preferences were preserved. In the final installed app, Systems → Preview voice completed with the visible result **“Kokoro synthesis + playback verified”**, without system fallback. This verifies the local preview path; it is not a subjective audio-quality rating.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run test:voice` | 60 passed, 0 failed |
| `npm run test:interface` | 19 passed, 0 failed |
| `npm run build` | Passed |
| `npx electron-builder --mac dir --publish never` | Passed |
| Final installed resource hash | Matches packaged app |
| Native Kokoro preview | Synthesis + playback verified |
| Native Workshop visual inspection | Passed at two sizes on UI build, repeated after final install |
| Startup replay / Skip / automatic completion | Passed on the same final UI implementation |

The new suites include 10 TTS and 8 STT regression tests: quiet consonants, two-sided pause accounting, cancellation before/after playback-token adoption, legitimate fallback, failed initialization retry, stale-worker isolation, long idle room tone, short replies, noise/click rejection, anti-alias filtering and duration/DC preservation. A separate read-only simulation exercised the actual recording loop with a 240 ms reply after 45 seconds idle across nine onset offsets; each reached endpoint. No physical microphone was used.

Orb continuity and cleanup were also checked in a local Canvas simulation: reduced-motion static rendering, transparent corners, animation/listener/observer cleanup, and continuous fade envelopes passed. Simulated 300 px draw timing averaged 8.04 ms (p95 9.40 ms); this is not a native Electron performance measurement.

## Limits

Live microphone recognition in the user's room and end-to-end conversational voice quality were not tested. No new microphone permission was granted. Real mission execution/cancellation, artifact-store note saves, detached dragging and expanded satellites were not exercised in this pass. Sep26 interaction checks remain historical evidence, detailed in that report. The interface suite includes source-contract checks as well as behavioral tests; it is not a full end-to-end UI suite.

## Backups and handoff

- Original Classic archive retained: `backup/classic-ui-20260924.tar.gz`; Systems → Interface still offers Classic.
- Before this UI pass: `backup/20260927-orb-refinement/`, including source snapshots and `installed-before-refinement.asar`.
- Before voice integration: `backup/20260927-voice-refinement/`, including six existing speech source files, package.json, manifest, and `installed-before-voice.asar` (the refined UI build).
- Earlier full app backup retained: `/Users/kai/Applications/.albert-backups/ALBERT-before-codex-orb-20260926-160037.app`.

For binary rollback, quit ALBERT and restore the chosen resource/app backup without changing user data. Restore source files selectively after comparing later edits; never reset the dirty repository. Keep large local binary backups out of commits.

`cursor-handoff-20260927.md` describes the new baseline and constraints. Cursor provided a read-only layout review in this pass; the reported clipping and frame-distortion findings were addressed. This handoff requests no additional changes on its own.
