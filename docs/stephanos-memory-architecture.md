# Stephanos Memory Architecture (v1)

Stephanos now separates **UI/session memory** from **durable Stephanos memory** and exposes a shared API that AI systems and tiles can use without inventing one-off storage paths.

## 1) UI/session memory (existing)

Source of truth:
- `shared/runtime/stephanosSessionMemory.mjs`

Purpose:
- panel visibility toggles
- panel positions + collapse state
- operator layout/session preferences
- short-lived runtime continuity fields

Scope:
- browser/session continuity
- layout + operator ergonomics
- not the durable AI/tile memory substrate

## 2) Durable Stephanos memory (new substrate)

Source of truth:
- `shared/runtime/stephanosMemory.mjs`

Runtime registration:
- `main.js` registers `stephanosMemory` via service registry
- global bridge for runtime integrations: `window.stephanosMemory`

Record schema:
- `namespace`
- `id`
- `type`
- `title`
- `payload`
- `createdAt`
- `updatedAt`
- `source`
- `surface`
- `tags`

## 3) Access contract (AI + tiles)

Shared API:
- `createRecord` / `saveRecord`
- `getRecord`
- `listRecords`
- `updateRecord`
- `deleteRecord`

Contract intent:
- AI agents can store notes/insights in named namespaces.
- Tiles/apps can persist generated artifacts through the same contract.
- Runtime code can query/tag records consistently across features.

## 4) Localhost vs hosted behavior

v1 adapter model is explicit:
- default adapter: browser local storage (`stephanos.durable.memory.v1`)
- `surfaceMode` reports detected context (`localhost` or `hosted`)
- both localhost and hosted use the same API shape with separate local persistence domains

Important limitation (honest boundary):
- v1 does **not** provide cross-device/server sync yet.
- continuity is durable per surface/origin, not globally synchronized.
- adapter boundary is now in place for future server-backed sync without breaking API consumers.

## 5) Architectural distinction from laws/truth/reality sync

- **Laws**: constitutional invariants and policy.
- **Truth**: operational reality snapshot + contradictions.
- **Reality Sync**: stale/current reconciliation behavior.
- **Memory**: retained records and continuity substrate.

