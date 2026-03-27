# Stephanos Continuity Core

## Canonical live continuity service
- Module: `shared/runtime/stephanosContinuity.mjs`.
- Runtime service name: `stephanosContinuity`.
- Window exposure: `window.stephanosContinuity`.

## What continuity stores (live, shared operating truth)
- Session markers (`continuityId`, surface mode, route kind).
- Active surface/workspace/tile context.
- Operator task/focus summaries.
- Truth/laws high-level visibility and reality-sync enablement.
- Recent significant event references (rolling window).

## What continuity does NOT store
- Full durable historical logs (belongs to `stephanosMemory`).
- Full UI layout details (belongs to `stephanosSessionMemory`).
- Raw rendered DOM state (surface-only, non-canonical).

## Event integration
- Continuity service subscribes to wildcard event bus envelopes.
- Normalizes important events into continuity recent-events stream.
- Updates active workspace/tile state on `workspace:*` / `tile.*` signals.
- Supports selective persistence via memory gateway allowlist.

## Embodiment boundary
- Continuity model is surface-agnostic and shared-directional.
- Durable backing remains origin-local browser storage today.
- Hosted/localhost contexts may vary in route/availability while sharing the same continuity contract.
