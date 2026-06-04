# Flywheel Pane Wiring Audit — 2026-06-03

## Scope
- Audited Stephanos UI source registration before implementation.
- Confirmed `apps/stephanos/dist/**` is generated output and must not be edited as source truth.
- Confirmed existing visible operator panes are registered in `stephanos-ui/src/App.jsx` and rendered through `StephanosSurfacePane`.
- Confirmed pane open/collapse defaults and persisted operator pane order are normalized in `stephanos-ui/src/state/aiStore.js`.

## Implementation decision
- Add Flywheel as a source component under `stephanos-ui/src/components`.
- Reuse `CollapsiblePanel` for collapse/header behavior and `StephanosSurfacePane` via the existing `paneDefinitions` registry.
- Keep V1 data static placeholders with explicit TODOs for a future governed shared-state loader that can read OpenClaw Standalone files safely.

## Shared files targeted for future loader
- `MISSION_STATE.md`
- `CURRENT_THINKING.md`
- `NEXT_ACTION.md`
- `AGENT_NOTES.md`
- `DECISION_LOG.md`
