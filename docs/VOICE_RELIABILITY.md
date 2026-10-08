# Voice Reliability

## Reported failure and verified cause

The reported turn did not stall at the three-second pause. The stored transcript and screenshot show that
Whisper and the selected brain both completed; Albert's text reply existed before the UI returned to
Listening. The old streamed TTS queue swallowed synthesis, decode, scheduling, and playback exceptions,
then treated the turn as successful.

Kokoro itself was verified with the exact failed reply and selected Daniel voice through the packaged
Electron runtime: synthesis completed in 1.108 seconds and produced a valid 123,644-byte mono 24kHz WAV
(2.575 seconds of healthy audio). That isolates the failure to renderer playback/recovery.

## Reliability contract

The voice path is now:

`adaptive speech endpoint → trim silence → Whisper → route/model → phrase queue → neural synthesis → decode → playback`

- Short commands use a 900 ms silence tail, ordinary turns 1300 ms, and long turns 1800 ms. Quiet phrase holds remain to avoid cutting off a thought. The captured tail is trimmed before transcription.
- Streamed speech waits for a useful clause; decimal token boundaries and incomplete code fences do not become stray spoken fragments. Paragraph pauses survive streaming.
- Interrupting speech invalidates the old playback epoch, stops host speech, and releases the turn immediately. Old completion callbacks cannot clear the next turn’s speaking state. With barge-in disabled, speaker bleed is not captured as a new user turn.
- Exact adjacent long transcript repetitions are collapsed conservatively.
- Neural synthesis is bounded at 25 seconds per part; Web Audio resume/decode/playback waits are bounded.
- Web Audio declares Speaking only after its rendering clock reaches the scheduled clip, not when a
  wall-clock guess fires; stalled contexts reject instead of pretending playback ended normally.
- Queue failures retain their first fault instead of disappearing.
- If no neural audio started, the complete reply is spoken once through the macOS system voice.
- If an early neural sentence played and a later sentence failed, only the unsaid tail moves to the
  system voice, avoiding both silence and a duplicated reply.
- Cancellation, standby, and barge-in never trigger fallback speech.
- Direct Kokoro speech no longer invalidates its own playback generation token.
- Speaking state begins only when audio actually begins.
- The CPU-heavy Whisper mute watchdog runs only during playback, not while the model/Kokoro is preparing.
- Stale watchdog transcription is generation-guarded and cannot cancel a later turn.
- End Voice during warm-up, microphone acquisition, transcription, or chat invalidates that work; an
  obsolete task cannot resurrect listening or interfere with the next session.
- Native speech must actually start and finish. Missing events are cross-checked against the native
  speaking state, and a hard failure is surfaced instead of reopening the mic over Albert's own voice.
- Current model/provider identity is answered deterministically from the router.

## Verification

Run:

```bash
npm run test:voice
npm run typecheck
npm run build
```

The voice regression suite covers the reported duplicate transcript, conservative non-deduplication,
fallback/cancellation decisions, adaptive tail trimming and endpoint behavior, current-brain question scope, truthful
provider reply formatting, and the Groq retirement cutoff. Systems → Preview voice now distinguishes verified Kokoro playback from a
verified system-voice fallback.


## September 28 installed verification

The installed Kokoro / Daniel preview completed with “Kokoro synthesis + playback verified”. Existing voice settings were retained. Automated capture/streaming/interrupt regressions passed. The installed app entered Listening after successful `getUserMedia` acquisition and local speech-engine warm-up; the test session was then ended. macOS showed microphone access enabled, although the previous unsigned build’s Electron status reported `not-determined`. Live recognition accuracy in the user’s room and subjective Siri-like conversation quality are not claimed. No cloud voice service or paid subscription was added.
