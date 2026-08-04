# A.L.B.E.R.T. iOS Companion

Native Expo app for iPhone — baby-blue HUD. Chat with Claude, on-device voice (wake / take 5 / mute), and **shared Comm + memory** with the Mac companion when online. Ship via **TestFlight**.

## Dev

```bash
# from repo root
npm run mobile:start
# or
cd mobile && npm start
```

Always start from the `mobile/` package (not the Electron repo root). Press `i` for Simulator, or scan the QR with Expo Go.

**Note:** `expo-speech-recognition` is **not in Expo Go**. The app still boots there (Comm / Memory / Pair work); voice shows “needs a dev build.” For wake + STT, use a **dev client or EAS build** (`npx expo run:ios` or `eas build`).

## Pairing (same Albert as Mac)

1. Mac app → **Systems** → enable **Phone companion** → Save → **Copy pair info**
2. Phone → **PAIR** → pick **Anthropic** or **Groq**, paste API key + Mac URL/token → **Test sync**
3. **COMM** and **MEMORY** then merge both ways. **HOME** → Engage Voice / take 5.

Away from home Wi‑Fi: use Tailscale and the Mac’s Tailscale IP as the URL.

## Voice

- Standby: say **“Albert, wake up”**
- Engaged: talk normally; **“take 5”** / **standby** / **end voice** returns to standby
- **Mute** cuts TTS mid-reply

## TestFlight (EAS)

```bash
cd mobile
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

Bundle id: `com.kai.albert.companion`
