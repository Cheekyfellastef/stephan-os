# Stephanos Durable Memory (Typed Records)

## Module
- `shared/runtime/stephanosMemory.mjs`.

## Durable honesty
- Persistence remains browser/origin-local (`localStorage`) unless a real server adapter is introduced.
- This does **not** claim cross-device shared sync.

## Typed record contract
Every durable record is normalized to:
- `id` (+ namespace key)
- `schemaVersion`
- `type`
- `source`
- `scope`
- `summary`
- `payload`
- `tags`
- `importance`
- `createdAt`
- `updatedAt`
- `retentionHint`
- `surface`

## Governed record families
Supported baseline families include:
- `operator.preference`
- `operator.goal`
- `ai.decision`
- `ai.summary`
- `tile.event`
- `tile.result`
- `workspace.state`
- `route.diagnostic`
- `truth.contradiction`
- `law.violation`
- `simulation.result`
- `continuity.note`

## Gateway helper
- `createStephanosMemoryGateway(memory, options)` provides normalized write paths:
  - `persistTypedRecord(...)`
  - `persistEventRecord({ name, data })`
- Goal: avoid ad hoc memory write shapes in AI/tile/runtime modules.
