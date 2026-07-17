# Codex Capacity Governor V1 source index

Primary entrypoints:

```text
createMeterObservation
createTaskConsumptionReceipt
buildTaskCostModel
estimateTaskCost
planBankedReset
forecastStackVelocity
buildCodexCapacityProjection
```

Composition entrypoint:

```text
createMeterAwareDispatchDecision
```

Human projection entrypoint:

```text
buildCodexCapacityDashboardProjection
```

The governor is fail-closed when capacity truth is unknown. It does not redeem resets directly. It prepares one bounded action for the authenticated Remote Codex skill after standing-policy and timing checks pass.
