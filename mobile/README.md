# A.L.B.E.R.T. Mobile

A.L.B.E.R.T. Mobile is the native iPhone, iPad, and Android companion for the Mac app. It is useful on its own and can optionally establish an authenticated, two-way link with a Mac running A.L.B.E.R.T.

## What works without a Mac

- Cloud AI chat through Anthropic, Groq, or an automatic route when both keys are configured
- Voice wake, dictation, interruption, spoken replies, and explicit standby controls while the app is active
- Durable Comm history, editable memory, captures, missions, mission steps, and routine definitions
- Offline-first editing: local changes survive relaunches and queue until a paired Mac is reachable
- Responsive HUD layouts for phones and tablets, reduced-motion mode, startup diagnostics, and visible error/retry states

A Mac is not required to launch or use the app. AI replies still require internet access and a provider API key. Routine definitions can be prepared on the phone, but scheduled automation is executed by the Mac runtime after synchronization.

## What the Mac link adds

Protocol v2 synchronizes Comm, memory, missions and steps, routines, approvals, and captures in both directions. It also brings the Mac activity timeline to the phone for visibility. Durable delete markers prevent removed records from reappearing after an offline edit, and a serialized outbox protects edits made while a sync is in flight.

Each phone enrolls once with the temporary token shown by the Mac. The phone then stores a revocable, per-device credential; the enrollment token is discarded after a successful link. The Mac can revoke an individual phone from **Systems**.

## Requirements

- Node **22.13.1** (the version in `.nvmrc`; Node 23 is not supported by React Native 0.86)
- npm and either Xcode/CocoaPods, Android Studio, or an Expo/EAS account
- An Anthropic and/or Groq API key for AI replies
- A custom development or release build for speech recognition
- For Mac sync: the current Mac app, awake and running, with **Phone companion** enabled

The native identifiers are:

- iOS bundle ID: `com.kaichik.albert`
- Android application ID: `com.kaichik.albert`
- Expo project: `kaichik/albert`

## Install and verify

Run commands from this `mobile/` directory. Starting Expo from the Electron repository root can resolve the wrong project configuration.

```bash
cd mobile
nvm use
npm ci
npm run preflight
```

`preflight` runs TypeScript, all deterministic reliability suites, Expo dependency compatibility, and resolved app-config validation. The individual checks are:

```bash
npm run typecheck
npm test
npm run check:deps
npm run config
npm run doctor
npm run export:ios
npm run export:android
```

`doctor` consults Expo's current compatibility service and therefore needs network access. Native exports are written under ignored `.export-test/` directories.

## Use a native development build

`expo-speech-recognition` contains native code and is not part of Expo Go. Expo Go is suitable only for a limited UI/data preview; do not use it to validate voice, permissions, or release-grade LAN behavior.

### EAS development build on a physical iPhone

```bash
cd mobile
npx eas-cli login
npx eas-cli device:create
npm run build:dev:ios
npm start
```

Install the build from the EAS link, open it once, then select the running development server. The iOS device and development machine normally need to be able to reach each other.

### iOS Simulator

```bash
npm run build:simulator:ios
npm start
```

The simulator is useful for layout and state testing. Microphone, speech recognition, local-network prompts, interruption, and audio routing must also be tested on a physical iPhone.

### Local native iOS build

```bash
npx expo run:ios --device
npm start
```

This requires Xcode signing. The generated `ios/` directory is intentionally ignored because the project uses Expo continuous native generation.

### Android development build

```bash
npm run build:dev:android
npm start
```

The current SDK targets Android API 36, where LAN access remains implicit through the internet permission. Before a future upgrade to target API 37 or newer, add and request Android's `ACCESS_LOCAL_NETWORK` runtime permission.

## Configure the standalone phone

1. Open **Systems → Phone brain**.
2. Choose **Auto**, **Anthropic**, or **Groq**.
3. Enter the corresponding provider key or both keys for cross-provider automatic fallback.
4. Choose a model route and press **Save configuration**.
5. Open **Comm** to type, or engage voice from **Home**.

Provider keys and Mac credentials are stored with SecureStore using device-only accessibility. Comm, memory, Operations, activity metadata, drafts, and the sync queue are stored locally with AsyncStorage. Messages are sent directly to the selected AI provider and, when paired, to the Mac you configured; there is no A.L.B.E.R.T. cloud relay.

## Pair with the Mac

1. On the Mac, open **Systems → Phone companion**, enable the service, save, then choose **Copy pair info**.
2. On the phone, open **Systems → Mac link** and choose **Paste pair info**.
3. Verify the Mac URL. Prefer the supplied `http://<mac-name>.local:<port>` address on the same trusted network; never use `localhost` or `127.0.0.1` on the phone.
4. Choose **Enroll & sync**. Accept the iOS local-network prompt if it appears.
5. Confirm the link shows **SECURE**, protocol **V2**, no pending mutations, and a recent sync time.

Automatic sync runs when configured and retries safely after temporary network failures. Manual sync remains available in **Systems** and **Memory**. The phone remains fully usable when the Mac sleeps or leaves the network.

For access away from the home network, use a private tunnel such as Tailscale and the Mac's tunnel address. Do not expose the companion port directly to the public internet. Device credentials authenticate requests, but plain `http://` LAN traffic is not transport-encrypted; use a trusted LAN, an encrypted private tunnel, or an HTTPS reverse proxy.

To unlink, choose **Unpair** on the phone. If the Mac is offline during that action, also revoke the phone from the Mac's device list when it is next available.

## Voice behavior

- **Standby:** say “Albert, wake up” while the app is active.
- **Engaged:** speak normally. A short silence finalizes the utterance and sends it once.
- **Interrupt:** tap the voice control while A.L.B.E.R.T. is speaking.
- **Standby commands:** “take five,” “standby,” or “end voice.”
- **Mute commands:** “mute,” “quiet,” or “stop speaking.”

Voice sessions are deliberately foreground-only. iOS and Android do not permit a general-purpose app to provide an unrestricted, always-listening background hotword service. Locking the device or backgrounding the app suspends recognition; returning to the app restores the configured state. On iPhone, spoken output can be inaudible when the hardware silent switch is enabled.

## Build and distribute

EAS uses Node 22.13.1 for every profile:

| Profile | Purpose |
| --- | --- |
| `development` | Physical-device dev client with native voice modules |
| `development-simulator` | iOS Simulator dev client |
| `preview` | Internally distributed production-like build |
| `production` | Store/TestFlight build with remote auto-incremented build numbers |

Preview builds:

```bash
npm run build:preview:ios
npm run build:preview:android
```

Production and submission:

```bash
npm run build:ios
npm run submit:ios
npm run build:android
npm run submit:android
```

The iOS App Store Connect app ID is already configured in `eas.json`. With `appVersionSource: "remote"`, EAS owns the production build number/version code after initialization; the values in `app.config.ts` remain useful for local native builds.

## Troubleshooting

### Voice is unavailable

- Confirm this is a development, preview, TestFlight, or store build—not Expo Go.
- In **Systems**, request/check voice permission. Both microphone and speech recognition must be allowed on iOS.
- Return the app to the foreground, end voice, and engage it again.
- Use a physical device before diagnosing microphone or recognition behavior.

### A.L.B.E.R.T. hears an utterance but never answers

- Wait for the visible listening state, speak once, then pause briefly.
- Check Comm for a provider error or rate limit; failed prompts remain available for retry.
- Confirm the selected provider has a valid key and that its selected model is currently available.
- If Auto is selected, cross-provider fallback requires both provider keys.

### Text appears but no speech plays

- Confirm **Speak replies** is enabled and the rate is not at an extreme.
- On iPhone, turn off silent mode and raise media volume.
- Tap voice once to interrupt a stuck speech session, then re-engage.

### Mac link is offline

- Keep A.L.B.E.R.T. running on the Mac and re-enable **Phone companion** if necessary.
- Put both devices on the same non-isolated Wi-Fi network; guest networks often block peer traffic.
- Use a URL copied from Mac Systems, not the Mac's loopback address.
- On iOS, enable **Settings → Privacy & Security → Local Network → A.L.B.E.R.T.**
- Check the macOS firewall and any VPN routing rules.
- For **AUTH FAULT**, unpair and enroll again with a fresh one-time token.

### Metro or native modules are stale

```bash
npm ci
npm start
```

If a native dependency or app config changed, rebuild the development client; restarting Metro alone cannot update native code.

### Node engine warnings

Run `nvm use` from `mobile/`. React Native 0.86 rejects Node 23; the project and EAS profiles are pinned to Node 22.13.1.

## Release checklist

Before sending a build to testers or a store:

- Run `npm run preflight`, `npm run doctor`, both native export commands, and `npm audit --omit=dev`.
- Exercise cold launch, font fallback, reduced motion, rotation, large text, and small/large device layouts.
- Test typed chat, voice after silence, interruption, provider timeout/rate-limit recovery, and an invalid API key.
- Test first enrollment, foreground auto-sync, offline edits, reconnect, simultaneous phone/Mac edits, deletes, purge, device revocation, and a sleeping Mac.
- Test iOS permission denial/re-enable and Android microphone denial/re-enable on physical devices.
- Verify App Store/Play privacy disclosures match the selected AI providers and optional Mac synchronization.
- Increment the marketing version for a new public release; EAS auto-increments store build numbers.

## Platform permission rationale

- **Microphone:** foreground voice conversations and commands.
- **Speech recognition:** convert foreground speech into text.
- **Local network (iOS):** connect directly to the user's paired Mac.
- **Local cleartext (Android):** permit a user-selected HTTP companion endpoint on a private LAN; cloud AI endpoints continue to use HTTPS.

No photo library, contacts, location, Bluetooth, background-audio, or tracking permission is requested.
