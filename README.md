# A.L.B.E.R.T.

**Artificial Logical Brain and Expressive Remote Terminal** — Mac-side personal AI assistant with a Jarvis-inspired HUD, Claude brain, and local voice.

## Two ways to run

### 1) Development (fast iteration)
```bash
npm install
npm run dev
```
Use this while coding day-to-day. Hot reload, quick feedback.

### 2) Real macOS app (Dock / Spotlight)
```bash
npm run install:app
```
This builds A.L.B.E.R.T. and installs/replaces:

`~/Applications/ALBERT.app`

(The Dock/Spotlight label still shows **A.L.B.E.R.T.** — the folder name stays period-free because Electron breaks if the `.app` name contains dots.)

Then open from Spotlight, Launchpad, or:
```bash
open ~/Applications/ALBERT.app
```

**Update after code changes** (same command — rebuilds and overwrites the app):
```bash
npm run update:app
# same as install:app
```

First launch of an unsigned app: right-click ALBERT → **Open** → Open.  
Or run: `xattr -dr com.apple.quarantine ~/Applications/ALBERT.app`

## Phone companion (native iOS + hybrid sync)

Chat on your phone with Claude anytime. When this Mac is online on the same network (or Tailscale), **memories sync both ways**. Mac tools stay on the desktop for now.

**Primary client:** native Expo app in [`mobile/`](mobile/) → TestFlight.

1. In A.L.B.E.R.T. → **Systems** → enable **Phone companion** → **Save** → **Copy pair info**.
2. On your phone: install the iOS companion (dev or TestFlight), open **Pair**, paste Mac URL + token + Anthropic key → **Test sync**.
3. Dev on this Mac:
   ```bash
   npm run mobile:start
   ```
4. Ship to TestFlight (needs Apple Developer + Expo account):
   ```bash
   cd mobile && npx eas-cli login && npx eas-cli init
   npm run mobile:build:ios
   cd mobile && npx eas-cli submit --platform ios --profile production
   ```
   Details: [`mobile/README.md`](mobile/README.md).

Fallback web UI (optional): `npm run companion:dev` → `http://<mac-ip>:5174`.

| Command | Purpose |
|---------|---------|
| `npm run mobile:start` | Expo dev server for iOS companion |
| `npm run mobile:ios` | Open iOS Simulator |
| `npm run mobile:build:ios` | EAS production iOS build |
| `npm run companion:dev` | Legacy phone PWA on LAN (`:5174`) |
| `npm run companion:install` | Install web companion deps |

## Other scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev window |
| `npm run install:app` | Build + install to `~/Applications` |
| `npm run update:app` | Same as install (refresh installed app) |
| `npm run pack` | Package `.app` into `dist/` only |
| `npm run dist` | Build a `.dmg` installer into `dist/` |
| `npm run typecheck` | TypeScript checks |
| `npm run test:voice` | Deterministic voice reliability regressions |
| `npm run test:providers` | Live Groq/Ollama availability, latency, streaming, and tool smoke test |

## Setup / keys

Paste an **Anthropic** key for Haiku/Opus and/or a **Groq** key for the free QUICK cloud route in
**Systems**. Ollama can run on-device with no service key.
Dashboard: https://platform.claude.com/dashboard

The currently configured Groq Llama bridge retires on August 16, 2026. Enable GPT-OSS 20B (preferred)
or another current model in Groq organization limits before then, or select local Ollama for QUICK.

Global shortcut: **⌘⇧A**.

## Operations system

Open **Operations** to manage persistent missions, steps, approval checkpoints, routines, universal
captures, Focus Mode, and operational health. Use **⌘K** for the global command deck. Albert can also
create and update missions or routines naturally through Comm.

Albert opens with a skippable, session-only system initialization sequence. Choose Minimal, Balanced,
or Cinematic HUD density under **Systems**, and replay or disable the intro there. Use **⌘1–⌘6** to
jump between panels and **⌘⇧Space** for Universal Capture.

Architecture, safety behavior, recovery, and supported schedules are documented in
[`docs/OPERATIONS_SYSTEM.md`](docs/OPERATIONS_SYSTEM.md).
The startup, unified core states, HUD density, motion behavior, and shortcuts are documented in
[`docs/JARVIS_INTERFACE.md`](docs/JARVIS_INTERFACE.md).

The voice failure/recovery contract and regression command are in
[`docs/VOICE_RELIABILITY.md`](docs/VOICE_RELIABILITY.md). The current free/fast model research,
quotas, deprecations, and recommended routing stack are in
[`docs/FREE_AI_ROUTING.md`](docs/FREE_AI_ROUTING.md).

## Auto-updates later

While A.L.B.E.R.T. is changing constantly, `npm run update:app` is the simplest “ship a new build” loop.

When things stabilize, we can add true automatic updates with:
- GitHub Releases + `electron-updater`
- App checks for a new version on launch and installs it

That needs a public/private GitHub repo and release publishing — worth doing once the product shape settles.

## License

MIT
# A.L.B.E.R.T.
