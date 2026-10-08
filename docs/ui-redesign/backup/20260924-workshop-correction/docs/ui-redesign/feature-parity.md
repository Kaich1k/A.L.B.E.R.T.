# Workshop feature parity

Workshop reuses the existing panels, store, and IPC handlers. It does not add a second voice session or a second settings store.

| Existing feature | Handler / data | Workshop location | Verification |
| --- | --- | --- | --- |
| Home brief, objective, voice, brain | `HomePanel`, `getOperations`, store | Hub when no area is open; Classic Home unchanged | Open Hub; status uses live voice and Codex state |
| Talk / voice / wake | `toggleVoice`, `ClaudeVoiceSession`, `WakeWordListener` | Hub Talk, composer mic, floating Talk | One session; wake still arms from `App.tsx` |
| Conversation, images, purge, voice stack | `ConversationPanel` | Talk destination | Open Talk; composer, attachments, Short version and the other stack actions remain |
| Operations, missions, approvals, routines, capsules, artifacts | `MissionsPanel`, `getOperations`, `updateMission` | Missions destination; hub arc reads the active mission | Open Missions; Pause sets `waiting`, Stop sets `cancelled` |
| Memory search, list, graph, edit | `MemoryPanel` | Memory destination; hub shows real memories | Open Memory; Inspect/Edit navigate there |
| Activity history, refresh, clear | `ActivityPanel` | Activity destination; hub shows the latest real entry | Open Activity |
| Systems, models, voice, phone, personality | `SettingsPanel` | Settings destination, including Classic/Workshop selector | Switch shells; chats remain |
| Computer browser | `showComputer` | Computer destination and Open browser | Opens the existing Computer window |
| Command palette and shortcuts | `CommandPalette` | Hub search dispatches ⌘K; shortcuts unchanged | ⌘K and ⌘1–⌘6 |
| Floating orb drag, pin, click-through, roam | `AmbientHud`, `miniHud.ts` | Same window; filament orb; expand resizes within the work area | Drag, pin, Talk, Open workspace |
| Approvals and dangerous-tool confirms | Existing tool policy | Unchanged | Restyle does not flip `confirmDangerousTools` |
