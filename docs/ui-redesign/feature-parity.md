# Workshop feature parity

Workshop reuses the existing panels, store, and IPC handlers. It does not add a second voice session or a second settings store.

| Existing feature | Handler / data | Workshop location | Verification |
| --- | --- | --- | --- |
| Home brief, objective, voice, brain | `HomePanel`, `getOperations`, store | Hub when no area is open; Classic Home unchanged | Hub captured live; Classic Home not opened this pass |
| Talk / voice / wake | `toggleVoice`, `ClaudeVoiceSession`, `WakeWordListener` | Hub Talk, composer mic, floating Talk | One session; wake still arms from `App.tsx` |
| Conversation, images, purge, voice stack | `ConversationPanel` | Talk destination; hub composer reuses `sendChat` + image attach | Open Talk; hub draft/attachments persist across remount |
| Operations, missions, approvals, routines, capsules, artifacts | `MissionsPanel`, `getOperations`, `updateMission` | Missions destination; hub arc reads the selected record | Hub Hold/Reactivate/Cancel only write mission SQL state. `updateMission` has no runner. Global **Stop current work** is separate and only armed when `busy` |
| Memory search, list, graph, edit | `MemoryPanel`, `buildMemoryGraph` | Memory destination; hub draws only real graph edges | Inspect/Edit set `selectedMemoryId` / `memoryEditRequested` |
| Activity history, refresh, clear | `ActivityPanel` | Activity destination; hub chips show the latest real entry | Open Activity; tool logs are not labeled as Active source |
| Systems, models, voice, phone, personality | `SettingsPanel` | Settings destination, including Classic/Workshop selector | Switch shells; chats remain |
| Computer browser | `showComputer`, `getComputerState`, `onComputerChanged` | Computer destination and Active source / Open browser | Source follows tab-change events, not a one-time snapshot |
| Command palette and shortcuts | `CommandPalette` | Hub search dispatches ⌘K; shortcuts unchanged | ⌘K and ⌘1–⌘6 |
| Floating orb drag, pin, click-through, roam | `AmbientHud`, `miniHud.ts` | Same window; filament orb; expand resizes within the work area | Drag, pin, Talk, Memory (`showWindow('memory')`), Open workspace |
| Approvals and dangerous-tool confirms | Existing tool policy | Unchanged | Restyle does not flip `confirmDangerousTools` |
