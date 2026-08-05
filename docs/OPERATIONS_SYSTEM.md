# Albert Operations System

## What is implemented

The Operations panel is a persistent personal operations layer backed by Albert's SQLite database.

- **Missions:** Create, prioritize, start, pause, complete, archive, and inspect durable objectives.
- **Steps:** Add steps and toggle verified completion; mission progress is recalculated automatically.
- **Situation brief:** Builds a live summary from priority missions, blocks, approvals, routines, and captures.
- **Approval Inbox:** Consequential actions can be staged with an impact preview and approved or declined.
- **Routines:** Supports `HH:MM`, `daily at HH:MM`, `every N minutes`, and `every N hours`.
- **Safe scheduler:** A due routine creates a reviewable mission and local notification. It does not silently
  execute external side effects.
- **Universal Capture:** Stores notes, tasks, ideas, URLs, receipts, and references for later filing.
- **Focus Mode:** Mission-specific local countdown with a deliberately reduced interface.
- **Project Pulse:** Summarizes blocks, open loops, step verification, and local/privacy boundaries.
- **Command deck:** `⌘K` navigates the app and exposes the major operational surfaces.
- **Agent tools:** Albert can create/list/update missions, add/complete steps, arm routines, stage approvals,
  and capture thoughts during chat or voice conversations.
- **Memory provenance:** Memories expose source, confidence, last recall, and optional expiry fields.

## Safety behavior

The scheduler prepares work; it does not autonomously send, publish, purchase, delete, or execute a tool.
Those actions remain behind the existing tool boundary. The `approval_request` agent tool creates a durable
Approval Inbox item and explicitly performs no external action.

Approving an item currently advances its associated mission from `approval` to `active`. It does not replay
an arbitrary deferred tool call. This is intentional: a replay engine needs signed, expiring action payloads
and tool-specific verification before it can be safe.

## Persistence

Tables added to `albert.sqlite`:

- `missions`
- `mission_steps`
- `routines`
- `approvals`
- `captures`
- `operation_events`

Migrations are additive and run through `CREATE TABLE IF NOT EXISTS` plus guarded memory-column additions.
Existing messages, memories, activity, settings, and companion state are preserved.

## Recovery snapshot

The complete pre-expansion source snapshot is:

`backups/albert-pre-operations-expansion-2026-08-05.tar.gz`

SHA-256:

`13570b398bb95e35a6fc58780ba3ca00da39934efbfe684aa345dff0680b66b4`

It excludes dependency and build-output directories (`node_modules`, `out`, `dist`) and `.git`, but includes
the working source/configuration state—including uncommitted files—at the start of the expansion.

To inspect without overwriting the current tree:

```bash
restore_dir="$(mktemp -d /tmp/albert-restore-check.XXXXXX)"
tar -xzf backups/albert-pre-operations-expansion-2026-08-05.tar.gz -C "$restore_dir"
```

## Known integration boundaries

Calendar, email, meeting transcription, finance, travel pricing, HomeKit, and third-party notifications need
provider credentials or OS permissions that are not present in this repository. The product surfaces and
safe mission/routine/approval substrate are implemented, but those connectors should be added individually
with least-privilege scopes rather than simulated.

Artifact versioning and replayable approvals likewise remain substrate-level concepts. Albert's existing
project/file tools already produce auditable output, but a dedicated artifact database and signed deferred
action envelope are the appropriate next implementation steps.

## Verification

Run:

```bash
npm run typecheck
npm run build
```

Then launch `npm run dev`, open **Operations**, and exercise mission, routine, capture, focus, and approval
flows. The command deck is available globally with `⌘K`.

## Interface controls

- `⌘K`: Open the global command deck.
- `⌘1` through `⌘6`: Jump directly between Home, Comm, Operations, Memory, Activity, and Systems.
- `⌘⇧Space`: Open Universal Capture from anywhere in the app.
- `Escape`: Skip the startup sequence or close an active overlay.

Systems includes three HUD density levels. Minimal keeps essential state, Balanced adds context, and
Cinematic enables the full instrumentation layer. Performance mode independently pauses ambient motion.
The startup sequence plays once per renderer session, can be disabled, and can be replayed from Systems.
