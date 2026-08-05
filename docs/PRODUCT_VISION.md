# ALBERT: From Assistant to Personal Operations System

## Product thesis

ALBERT already has the hard foundation: a distinct voice, local/cloud model routing, durable memory,
computer and desktop control, an auditable tool layer, and a phone companion. The next leap is not
“more chat.” It is continuity: ALBERT should understand what Kai is trying to accomplish, keep useful
work moving between conversations, notice meaningful changes, and ask for attention only when a human
decision is actually required.

The ideal product loop is:

**Observe → Brief → Plan → Act → Verify → Remember**

That loop should always remain legible. Every proactive action needs a reason, a status, an audit trail,
and a clear approval boundary.

## North-star experience

At 8:00, ALBERT delivers a 45-second spoken brief: the day’s constraints, changes since yesterday, and
one recommended first move. Kai says, “Handle the release prep and watch the flight price.” ALBERT turns
those into two missions. It runs safe checks immediately, pauses before publishing or purchasing, and
surfaces one compact approval card. By evening, it reports outcomes—not a transcript of effort—and
folds useful lessons into memory.

## Tier 1: Build next

### 1. Missions

A persistent objective layer above individual chats. Each mission has an outcome, plan, state, artifacts,
deadline, budget, risk level, and event log. Missions can be active, waiting, scheduled, blocked, awaiting
approval, or complete.

Why it matters: chat history records conversation; missions record intent and progress. This is the
backbone for every proactive feature below.

First version:

- Create a mission from chat or voice.
- Generate a short editable plan before execution.
- Run one step at a time through the existing tool registry.
- Persist state in SQLite and recover cleanly after restart.
- Show human-readable verification for every completed step.
- Require approval for external side effects, secrets, spending, deletion, and irreversible actions.

### 2. Daily Briefing

A short, ranked situation report rather than a generic dashboard. It should combine calendar, high-signal
messages, active missions, reminders, local weather, and system health, then recommend a first move.

Controls: source toggles, quiet hours, maximum length, spoken/text delivery, and “why am I seeing this?”
on every item.

### 3. Routines

Natural-language automations: “At 6 PM on weekdays, summarize what changed in this repo,” or “When a
flight drops below $320, tell me.” Routines should support time triggers, event triggers, conditions,
actions, quiet hours, retry policy, and escalation.

Avoid building a visual node editor first. A compact sentence-based builder plus a structured preview is
faster, friendlier, and easier to verify.

### 4. Approval Inbox

One queue for decisions that need Kai: submit, send, purchase, delete, publish, share, or grant access.
Each card should show the proposed action, why it is needed, what will change, a diff/preview, and what
happens if declined. Support approve once, edit, decline, and approve a narrowly defined rule.

### 5. Focus Mode

Turn a goal and a time box into an operational session. ALBERT can silence selected notifications, keep a
scratchpad, surface relevant files, capture interruptions, and produce a short wrap-up with the next
starting point. Voice commands such as “park that” and “what was I doing?” make this unusually useful.

## Tier 2: High-value extensions

### Watchtower

Persistent monitors for prices, websites, package tracking, tickets, releases, system health, or project
changes. Alerts should be thresholded and deduplicated. “No change” is logged silently; notification is
reserved for meaningful deltas.

### Memory Graph

Evolve the current fact list into typed, sourced memory: people, projects, preferences, decisions,
commitments, and open loops. Every memory needs provenance, confidence, last-used time, and an expiry or
review policy. Add a visual relationship view and a “what do you know about X?” inspector.

### Universal Capture

A global shortcut and mobile share sheet that accept text, URL, screenshot, file, or voice note. ALBERT
classifies each capture as reference, task, idea, receipt, contact, or memory; proposes a destination; and
lets Kai correct it in one gesture.

### Project Pulse

For configured workspaces: recent changes, failing checks, stale branches, TODO drift, dependency risk,
and a concise “where we left off.” It should generate a session handoff automatically when coding stops.

### Meeting Copilot

Local-first transcription, speaker-aware notes, decisions, action items, and follow-up drafts. Never join,
record, or send without explicit visible consent. Connect decisions and commitments to the memory graph.

### Command Palette

A fast keyboard surface for panels, recent missions, saved commands, model choice, settings, and natural
language actions. This makes the whole product navigable without reaching for the sidebar.

### Notification Triage

Aggregate notifications into critical, next break, and digest. Learn corrections, but keep suppression
rules visible and reversible. This pairs naturally with Focus Mode and the phone companion.

### Artifact Workspace

Missions need outputs: briefs, comparison tables, plans, drafts, images, and code changes. Give artifacts a
first-class viewer with versions, diffs, comments, export, and a clear relationship to their source mission.

## Tier 3: Delight and differentiation

### Ambient HUD

A compact always-on-top mode showing only the orb, current mission, timer, and one-line status. Expand on
hover or hotkey. It should use negligible CPU/GPU and respect full-screen apps.

### Context Capsules

Save a working state—apps, URLs, files, mission, notes, and audio context—then restore it later with
“resume the release session.” Capsules are a practical version of workspace memory.

### Decision Journal

Automatically propose entries when a consequential choice is made: decision, alternatives, rationale,
assumptions, and review date. Later, ALBERT can say which assumptions changed instead of merely recalling
the conclusion.

### Personal API / Webhooks

Authenticated inbound events and outbound actions make ALBERT composable with home automation, CI,
shortcuts, and small personal services. Scope tokens per integration and show every event in Activity.

### Skill Packs

Installable, permission-scoped bundles for travel, finance, home, development, fitness, or study. Each
pack declares tools, data access, prompts, views, and routines. Never let packs silently broaden access.

### Cost and Privacy Console

Per-provider token cost, latency, model routing, local/cloud ratio, stored data, retention, and exports.
Offer a privacy “flight recorder” that answers exactly what left the device and why.

### Voice Interruptions That Feel Natural

Beyond barge-in: “hold that thought,” “short version,” “show me,” “take over the screen,” and “send that
to my phone.” Keep a resumable response stack so an interruption does not destroy the original thread.

### Home and Device Presence

Optional Shortcuts/HomeKit hooks for arrival, departure, sleep, and room context. Presence must be opt-in,
locally represented, and easy to suspend.

## UI concepts

### A. Missions command center — implemented prototype

The new renderer prototype combines the daily situation report, mission list, progress inspector, approval
checkpoint, and routine grid. It is intentionally interactive but uses demo data; no background action is
performed. This validates information hierarchy before a persistence or scheduler layer is built.

### B. Memory constellation

Layout: searchable graph in the center, source/confidence filters on the left, selected entity timeline on
the right. A “memory health” header shows stale, conflicting, and unsourced facts. Default to a readable
list; the graph is a secondary exploration mode, not the only interface.

### C. Approval split view

Layout: queue on the left; impact preview on the right. The preview changes by action type: email preview,
file diff, shell command explanation, calendar delta, or purchase summary. The primary button uses the
specific verb (“Send 1 email”), never a vague “Confirm.”

### D. Focus cockpit

Layout: current outcome and timer at the top, one active artifact in the center, parked interruptions on
the right, and a narrow voice/status rail at the bottom. Everything unrelated disappears until the session
ends.

## Architecture proposal

Add four small services rather than one giant autonomy engine:

1. **Mission service** — persists objectives, plans, steps, artifacts, and events.
2. **Scheduler service** — wakes routines, applies quiet hours, and prevents duplicate runs.
3. **Policy service** — classifies tool risk and decides run, ask, or deny based on explicit grants.
4. **Notification service** — ranks, deduplicates, batches, and routes updates to desktop or phone.

The existing tool registry remains the execution boundary. Mission steps call tools through the same
logged path, never around it. Each step stores input, tool result, human summary, verification, and any
artifact references. A process crash should leave a step in “interrupted,” not “complete.”

Suggested core tables:

- `missions`: outcome, state, priority, deadline, budget, risk, created/updated timestamps.
- `mission_steps`: mission, order, description, state, tool call, verification, retry count.
- `mission_events`: append-only state transitions and user decisions.
- `routines`: trigger, conditions, action template, quiet hours, enabled state.
- `approvals`: proposed action, impact summary, preview, policy reason, expiry, resolution.
- `artifacts`: mission, type, path/URI, version, provenance.

## Safety model

Autonomy should be capability-scoped, not a global “God mode” gradient.

- **Observe:** read-only access; may run automatically within configured sources.
- **Prepare:** can draft and stage changes, but cannot create external effects.
- **Act with approval:** each consequential action needs a human checkpoint.
- **Delegated rule:** a narrow, inspectable rule can auto-approve a specific action and scope.
- **Never delegate:** credentials, disabling security controls, broad destructive operations, and ambiguous
  spending or publication.

Every proactive card should answer: What triggered this? What data was used? What will change? Can it be
undone? Why does it need me now?

## Practical build sequence

### Milestone 1 — Mission substrate

Persist missions and steps, add CRUD IPC, convert the prototype from seed data, and create missions from
Comm. No autonomous looping yet.

### Milestone 2 — Safe runner

Execute one explicit step through the tool registry; add pause/cancel, interruption recovery, verification,
and approval records.

### Milestone 3 — Routines and briefings

Add the scheduler, daily briefing composition, quiet hours, desktop notifications, and phone delivery.

### Milestone 4 — Integrations

Start with calendar and email because they make briefings immediately valuable. Then add reminders/tasks,
weather, and GitHub/project signals. Each connector ships with a least-privilege permission screen.

### Milestone 5 — Intelligence

Add Watchtower, mission decomposition, memory provenance, cost budgets, and learning from accepted/rejected
suggestions. Measure interruption rate and useful outcomes, not number of agent actions.

## Success measures

- Missions completed with no corrective intervention.
- Approval acceptance rate and median time-to-decision.
- Useful brief items divided by total brief items.
- Alerts acted on versus dismissed.
- Time from returning to a project to meaningful work.
- Incorrect or stale memories caught before use.
- Reversible versus irreversible tool actions.
- Local versus cloud execution and cost per completed outcome.

The product should feel calm even when it is doing a great deal. The best version of ALBERT does not
constantly prove it is alive; it preserves attention, produces evidence, and appears precisely when useful.
