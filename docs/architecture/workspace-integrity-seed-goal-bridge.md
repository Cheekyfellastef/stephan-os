# Workspace Integrity Seed Goal Bridge

## #2903 — Connect workspace-integrity seed pressure to canonical Flywheel goal admission

This goal connects the existing `workspace-integrity-provenance` seed to the existing Durable Flywheel goal machinery.

The only permitted route is:

`seed growth pressure -> Shared Workspace capability-gap event -> flywheelLearningGoalBridgeService -> flywheelCanonicalGoalAdmissionService -> existing goal conveyor`.

This change must not add a controller, queue, scheduler, merge path, approval bypass, or new authority surface. The event is evidence only. Existing canonical admission and protected mutation/merge rules remain authoritative.

Acceptance proof:
- no pressure event when the seed is not planted or its pressure is current;
- one stable, deduplicated event identifies the first unproved integrity rung;
- the existing learning-goal bridge recognizes the event as actionable;
- production-authorized reconciliation may create/admit one bounded child goal;
- proof for a rung causes later cycles to advance to the next missing rung instead of reopening the completed gap.
