# Battle Bridge Supervisor V1 Runbook

## Scope

Battle Bridge Supervisor V1 is a source-controlled supervision contract for GitHub issue #1291. It supervises these services only:

- Stephanos UI
- Backend
- Mission Worker
- OpenClaw Gateway

The supervisor publishes structured runtime truth into the Shared Agent Workspace. It is not a process manager.

## Safety boundaries

V1 must never:

- execute arbitrary shell or PowerShell;
- kill a process;
- perform a real restart;
- dump environment variables, secrets, tokens, credentials, or `.env` contents;
- write generated `apps/stephanos/dist/**` output;
- claim browser/UI health without separate proof.

Recovery in V1 is restart intent plus a recovery receipt only.

## State model

Service states:

- `UNKNOWN`
- `STOPPED`
- `STARTING`
- `READY`
- `DEGRADED`
- `FAILED`
- `RECOVERING`

Recovery states:

- `NONE`
- `REQUESTED`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`

## Publication flow

1. Build the service registry with `buildBattleBridgeServiceRegistry()`.
2. Publish a heartbeat with `createBattleBridgeHeartbeat()`.
3. Publish per-service health with `createBattleBridgeHealthRecord()`.
4. Publish restart intent and recovery receipts with `createBattleBridgeRecoveryReceipt()`.
5. Publish the status envelope to Shared Agent Workspace with `publishBattleBridgeSupervisorStatus()`.
6. Use `simulateBattleBridgeSelfHeal()` for deterministic tests only.

## Shared Agent Workspace routes

The contract advertises these workspace-relative routes:

- `status/battle-bridge-supervisor.json`
- `events/battle-bridge-supervisor.ndjson`
- `receipts/battle-bridge-supervisor-recovery.json`

These are structured event/receipt targets, replacing a visible PowerShell wall with hidden workspace events.

## Future extension points

Real Battle Bridge recovery should add source-controlled adapters that consume restart intent receipts and remain approval-gated. A future adapter may implement service-specific restart mechanics, but only after adding explicit contracts, operator approval rules, browser proof requirements for UI claims, and deterministic verification for each service.
