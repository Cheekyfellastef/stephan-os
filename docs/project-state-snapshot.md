# Stephanos Project State Snapshot (2026-03-29)

Purpose: quick-load sheet for future debugging and implementation passes.

## Major system layers/modules

- **Launcher shell:** root `index.html` + `main.js` + command deck + workspace.
- **Shared runtime guardrails:** `shared/runtime/**` (laws, truth engine, adjudication, reality sync, memory/continuity).
- **Live Stephanos UI source:** `stephanos-ui/src/**` (Mission Console and runtime-facing app UX).
- **Generated runtime artifact:** `apps/stephanos/dist/**`.
- **Backend services:** `stephanos-server/**` (provider routing, memory endpoints, provider integrations).
- **Build/verify/serve guard scripts:** `scripts/build-stephanos-ui.mjs`, `scripts/verify-stephanos-dist.mjs`, `scripts/serve-stephanos-dist.mjs`.

## Current architectural truth model

- Launcher shell truth and Mission Console/runtime truth are intentionally separate.
- Entry semantics are intentionally separated (`launcherEntry`, `runtimeEntry`, `launchEntry`, compatibility `entry`).
- Runtime route/provider truth is adjudicated in shared runtime status/adjudicator layers and projected to UI.
- Laws/truth/reality sync are distinct surfaces with complementary roles.

## Current durable memory model

- Session/UI layout memory: `stephanosSessionMemory`.
- Durable records/API contract: `stephanosMemory`.
- Continuity context/event rollup: `stephanosContinuity`.
- Current durability is origin-local; cross-device sync remains future adapter work.

## Current routing model

- Session/device context determines eligible route candidates.
- Hosted/non-local sessions must not execute loopback truth.
- Home-node route requires backend + UI launchability truth.
- Dist fallback remains valid, explicit fallback state.

## Current provider model

- Provider lifecycle keeps stage distinctions: requested vs selected vs executable.
- Provider readiness depends on route + backend semantics, not preference alone.
- Fallback provider usage must stay explicit in diagnostics/UI labels.

## Known rough edges

- Legacy compatibility fields still exist and can be misused if contributors bypass canonical truth adapters.
- Multi-surface diagnostics can drift if new UI code recomputes truth independently.
- Hosted/local parity remains sensitive to path/base/memory-context mistakes.
- Durable memory is not yet server-synchronized across devices.

## High-risk regression areas

1. Entry field collapse or wrong launch resolution order.
2. Build/source/served truth gate weakening to “reuse healthy process.”
3. Session-boundary poisoning (localhost values used in hosted contexts).
4. Provider stage collapse in UI/diagnostics.
5. Import-structure regressions in launcher-critical modules.

## Recommended first inspection points for future triage

1. `AGENTS.md` and `docs/stephanos-system-model.md`.
2. `shared/runtime/stephanosLaws.mjs` (active invariants).
3. `shared/runtime/runtimeStatusModel.mjs` + `runtimeAdjudicator.mjs`.
4. `system/apps/app_validator.js` + command deck/workspace launch path.
5. Build/serve/verify scripts and dist metadata markers.
6. `docs/known-failure-patterns.md` for symptom-to-cause mapping.
