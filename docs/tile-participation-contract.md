# Tile/App Participation Metadata Contract

## Purpose
Give tiles/modules a structured way to declare AI/continuity/event participation without breaking existing launcher behavior.

## Discovery-normalized fields
`system/apps/app_discovery.js` now preserves optional manifest fields:
- `capabilities: string[]`
- `eventsPublished: string[]`
- `eventsConsumed: string[]`
- `memoryUsage: string`
- `continuityParticipation: string`
- `aiAddressable: boolean`
- `participation: object`

All fields default to safe/minimal values when absent.

## Compatibility
- Existing manifests remain valid.
- Existing launch semantics are unchanged.
- Metadata is additive and can be incrementally adopted by tiles.

## Recommended manifest snippet
```json
{
  "name": "Ideas",
  "entry": "index.html",
  "capabilities": ["notes", "brainstorm"],
  "eventsPublished": ["tile.result"],
  "eventsConsumed": ["ai.intent.received"],
  "memoryUsage": "reads operator.goal, writes tile.result",
  "continuityParticipation": "active-tile-focus",
  "aiAddressable": true
}
```
