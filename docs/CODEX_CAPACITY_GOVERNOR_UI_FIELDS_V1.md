# Codex Capacity Dashboard fields V1

```text
availability
remainingPercent
safelySchedulablePercent
reservedPercent
naturalResetAtUtc
observedAtUtc
confidence
bankedResetCount
nextResetId
nextExpiryUtc
resetDecision
resetActionReady
queuedCodexDemandPercent
shortfallPercent
queuedZeroCostTasks
nextTaskId
nextTaskP80Percent
selectedRoute
dispatchAllowed
currentSlicesPerWeek
withoutCodexSlicesPerWeek
withOpenClawUpgradeSlicesPerWeek
primaryConstraint
summary
exactNextAction
```

The dashboard projection is read-only. Any reset action remains a separate bounded Remote Codex operation with its own policy and proof receipt.
