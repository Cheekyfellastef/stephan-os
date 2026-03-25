# Core Truth vs Runtime Truth (Stephanos)

## Why this split exists
Stephanos continuity is multi-device, but route execution is device-local. We now enforce:

- **Core Truth** = persistent, syncable user/session/project truth.
- **Runtime Truth** = per-device adjudicated execution truth, computed fresh each session.

This prevents stale localhost assumptions, route drift, and provider/route state mixing across devices.

## Core Truth (persistent/shared)
Core truth is persisted through `shared/runtime/stephanosSessionMemory.mjs`.

Examples:
- provider preference intent (`provider`, `routeMode`, fallback settings)
- saved provider draft config (portable fields)
- workspace/subview/UI layout preferences
- working/project memory and command history
- manual home-node preference (when non-loopback-valid)

## Runtime Truth (ephemeral/device-local)
Runtime truth is adjudicated by `shared/runtime/runtimeStatusModel.mjs` and emitted as `runtimeTruth` + `finalRouteTruth`.

Examples:
- session kind and device context
- route candidate evaluations + preference order
- selected route and winner reason
- backend/UI reachability
- requested/selected/executed provider
- fallback-active/fallback-route-active
- provider eligibility by current route reachability

## Anti-patterns (now guarded)
- Persisting route winners/targets/reachability into session memory.
- Treating localhost targets as portable across hosted/LAN sessions.
- UI recomputing route/provider semantics from mixed projections instead of canonical runtime truth.
- Treating dist/static availability as backend/live-route truth.

## Invariants
1. Core truth persistence drops runtime-only root fields before writing storage.
2. Runtime adjudication is centralized in `createRuntimeStatusModel`.
3. UI route/provider labels must project from canonical runtime truth (`runtimeTruth`/`finalRouteTruth`) via `buildFinalRouteTruthView`.
4. Runtime truth is inspectable and guardrailed; it is not restored from durable storage.

## Operator debugging guidance
1. Open Status panel and inspect Runtime Truth fields (session kind, selected route, provider stages, reachability).
2. Confirm `Session Restore Decision` for any dropped loopback settings on hosted/LAN sessions.
3. Verify fallback and provider eligibility separately from backend health.
4. If route appears wrong, inspect `routeDiagnostics` + guardrail messages; do not trust stale persisted assumptions.

## Extending safely
When adding fields:
- Ask: “is this shared intent/state or device-local execution fact?”
- Shared intent belongs in Core Truth schema.
- Device-local execution facts belong in Runtime Truth and must be recomputed, never persisted.
- If uncertain, default to Runtime Truth and only persist explicit user intent.
