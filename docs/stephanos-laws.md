# Stephanos Laws (Constitutional Layer)

Stephanos Laws are a durable architectural-law system that now exists in three synchronized forms:

1. **Repository law**: this doc, `docs/stephanos-guardrails-v2.md`, and AGENTS policy.
2. **Runtime law**: `shared/runtime/stephanosLaws.mjs` (machine-readable structured law objects).
3. **Human-visible law**: launcher-shell “Laws of Stephanos” section rendered from the runtime law source.

If these layers drift, the implementation is incomplete.

## Machine-readable law source

- Source of truth: `shared/runtime/stephanosLaws.mjs`
- Runtime renderer: `shared/runtime/renderStephanosLawsPanel.mjs`
- Launcher mount: `index.html#stephanos-laws-mount`
- Launcher wiring: `main.js` via `renderStephanosLawsPanel()`

Every law object includes:

- `id`
- `title`
- `shortStatement`
- `fullDescription`
- `category`
- `invariantType`
- `operatorImplication`
- `engineeringImplication`
- `relatedFiles`
- `testCoverageHint`
- `severity`
- `status`

## Layered architecture North Star

Stephanos is expected to evolve with explicit layers:

### Layer 1 — Universal entry truth
- Hosted/root landing page (`/`) is the universal doorway and launcher shell.
- It stays tile-first and stable.
- It is not the full brain of Stephanos.

### Layer 2 — Shared system truth
- Shared runtime/state contracts carry identity, continuity, memory, route context, and durable preferences.
- This layer is deeper truth than one launcher route.

### Layer 3 — Runtime embodiment truth
- Device/runtime embodiments can differ (desktop, tablet, phone, local node, hosted shell, etc.).
- Embodiment differences must still preserve one Stephanos identity and law model.

## Law categories

Current law categories:
- `entry`
- `routing`
- `runtime`
- `state`
- `build-truth`
- `diagnostics-boundary`
- `compatibility`
- `cross-device-architecture`

## Operator usage

Use the laws as your North Star when diagnosing regressions:

1. Open the **Laws of Stephanos** section in launcher shell and identify violated law IDs.
2. Check the law’s `relatedFiles` and `testCoverageHint` to focus investigation.
3. Re-run build/verify gates for build-truth laws.
4. Treat violations as architecture policy breaks, not cosmetic drift.

## Coding-agent usage

Any coding agent editing launcher/runtime/routing/build-truth paths must:

1. Read `shared/runtime/stephanosLaws.mjs` first.
2. Preserve law invariants and categories.
3. Update laws/docs/tests together if behavior or policy changes.
4. Reference applicable law IDs in targeted guard logs where helpful.


## Reality Sync rationale (stale-screen lies)

- A green launcher UI can still be stale if a newer build/source truth exists but the screen has not reconciled.
- Constitutional requirement: runtime-visible Truth Panel must show `displayed truth` vs `latest detected truth`, stale/current state, and refresh trigger reason.
- Reality Sync must be explicit, operator-visible, and loop-guarded; never silent infinite refresh.
- The System Panel toggle (`Reality Sync / Auto Truth Refresh`) controls automatic reconciliation while preserving stale-state visibility.
- When localhost process truth drifts (marker/MIME/source-parity mismatch), supervised ignition restart handoff is allowed; if handoff is unavailable, Truth Panel must continue to report restart-required state.

## Operator panel ergonomics law application

- Runtime/operator popup panels are movable but remain within viewport bounds after restore.
- Panel coordinates and collapse states are persisted in shared session-memory layout state.
- Collapse affordance uses the same Stephanos knob pattern across panels for consistency with existing system controls.
- Laws panel and Build Proof panel are now in this same operator-panel family (draggable, knob-collapsible, resettable, and toggleable from System Panel popup).

## Memory architecture layer (durable continuity substrate)

- UI/session layout memory remains in `shared/runtime/stephanosSessionMemory.mjs`.
- Durable Stephanos memory lives in `shared/runtime/stephanosMemory.mjs` and exposes a shared AI/tile API:
  - `createRecord` / `saveRecord`
  - `getRecord`
  - `listRecords`
  - `updateRecord`
  - `deleteRecord`
- Current truth boundary is explicit: localhost + hosted each persist durable memory via the same contract, but cross-device sync requires a future server adapter.
- See `docs/stephanos-memory-architecture.md` for v1 adapter model and usage contract.

## Failure class spotlight: launcher import-structure regressions

- A prior launcher outage (Friday, March 27, 2026) was caused by duplicate import declarations in `modules/command-deck/command-deck.js`.
- Symptom pattern: diagnostics/laws still render, while launcher tiles vanish and module loader reports a syntax/module-load failure.
- Constitutional response: treat import-structure violations as law breaks and block with `npm run stephanos:guard:imports` during verify.

If an edit changes invariant-sensitive behavior and no law/tests/docs changes accompany it, the pass is incomplete.
