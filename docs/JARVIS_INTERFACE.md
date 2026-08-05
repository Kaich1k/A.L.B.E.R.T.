# Jarvis Interface Layer

Albert's cinematic interface is designed as operational feedback rather than ornamental animation.

## Startup sequence

The startup sequence waits for settings, chat history, and activity hydration before it appears. It plays
once per renderer session and can be skipped with the visible control or `Escape`. Systems can disable or
replay it. Reduced-motion preferences collapse the sequence to a short crossfade; Performance Mode uses a
shorter, lower-GPU path.

The sequence reports renderer and configuration state. It deliberately does not invent network latency,
claim that an API is reachable, or call a configured route “secure” without a real probe.

## One Albert core

Home and Comm share `AlbertCore`, so the assistant has one visual identity. State is represented exactly:

- **Idle:** slow ambient instrumentation.
- **Wake armed:** illuminated cardinal sensors without pretending a conversation is active.
- **Connecting:** acquisition pulse.
- **Listening:** brighter cyan receive ring.
- **Thinking:** faster segmented computation arc.
- **Speaking:** bright cyan/white response core; red remains reserved for faults and destructive actions.
- **Fault:** red is reserved for an actual error state.

## Information layers

- The bottom system bus preserves voice, route, objective, approval, and clock context on every panel.
- Home exposes the current objective, decisions requiring human authority, and latest audited operation.
- Activity includes live neural telemetry derived from the existing store and APIs.
- Tool and routing events appear briefly at the top as status announcements.
- Operations supports deep links from the command deck into Missions, Approvals, Routines, Focus, and
  Universal Capture.

## Density and performance

HUD density and animation performance are independent controls:

- **Minimal:** core and essential status only.
- **Balanced:** compact status and useful context, without flank diagnostics.
- **Cinematic:** full ambient grid, diagnostics, and instrumentation.
- **Performance Mode:** pauses ambient core/ring motion and uses the low-power startup path.

Animations pause while the window is hidden. `prefers-reduced-motion` suppresses continuous motion and
smooth transitions regardless of density.

## Keyboard controls

- `⌘K`: command deck
- `⌘1–⌘6`: panel navigation
- `⌘⇧Space`: Universal Capture
- `Escape`: close overlays / skip startup

Focus rings, dialog semantics, focus containment/restoration, live-region status, descriptive controls,
and improved microtext contrast are included for keyboard and assistive-technology users.
