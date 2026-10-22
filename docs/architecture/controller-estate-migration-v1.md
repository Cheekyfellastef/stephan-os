# Controller Estate Migration V1

Issue: #2122 — Lossless Controller Retirement and Estate Migration V1

## Outcome

A controller that owns unfinished durable work may not be disabled, retired, superseded or consolidated until its complete estate has a proven successor mapping.

Controller retirement is a control-plane migration. It is not evidence that the owned goals are cancelled or complete.

## Canonical seam

This source slice adds a pure fail-closed contract beside the existing programme authority and Shared Workspace machinery. It does not create another scheduler, controller, queue, goal database, lease service, receipt store or runtime executor.

The contract is implemented in:

- `shared/agents/controllerEstateMigrationV1.mjs`
- `shared/agents/controllerEstateMigrationV1.test.mjs`

It is intentionally read-only and authority-free. A later bounded integration slice may compose these pure decisions into the existing canonical controller lifecycle and Shared Workspace publishers.

## Migration ledger

`buildControllerEstateMigrationLedgerV1(...)` inventories predecessor-owned estate and verifies every unfinished item has exactly one successor mapping.

The ledger preserves, where present:

- durable goal / issue / PR / branch / mission identity;
- canonical owner;
- active writer / source lease identity;
- acceptance criteria;
- priority and continuation rules;
- provider/task-class continuation requirements;
- authority boundaries;
- resource scopes;
- proof references;
- operator-ready apron state and zero-capacity semantics.

Terminal work may remain unmapped. Unfinished work may not.

A migration is `READY_FOR_RETIREMENT` only when there are zero mapping blockers and zero unmapped unfinished items.

## Fail-closed retirement gate

`assessControllerRetirementV1(...)` permits predecessor disablement only when:

1. the migration ledger is valid and `READY_FOR_RETIREMENT`;
2. `unmappedCount === 0`;
3. the successor controller is enabled;
4. the predecessor is still active at the pre-retirement gate.

This prevents the sequence that caused the September 2026 migration defect: disabling a predecessor first and attempting to reconstruct its responsibilities afterward.

The pure contract itself grants no automation-disable authority. It only produces the evidence-backed decision that an existing lifecycle owner may consume.

## Active leases and writers

An unfinished item with an active source/resource lease must preserve the exact current writer owner. Migration cannot silently seize, transfer or reassign the writer merely because controller ownership changes.

The successor mapping must explicitly state that the active lease is preserved and bind the same writer identity.

## Operator-ready apron work

`OPERATOR_READY_PARKED` work remains parked through migration and must continue to consume zero builder capacity.

A controller change must not:

- turn parked work back into an occupied construction slot;
- discard its exact evidence packet;
- silently treat waiting-for-operator state as completion;
- lose drift-watch continuation rules.

## Provider and authority continuity

Provider-specific continuation constraints are part of the owned estate. If a goal requires provider-neutral review, a specialist task class, a runtime verifier, or another qualified route, migration must preserve that requirement.

Safety and authority boundaries also migrate. Consolidation cannot silently widen merge, runtime, provider, credential, spending, filesystem or command authority.

## Post-retirement reconciliation

`reconcilePostRetirementEstateV1(...)` reconstructs successor inventory after retirement and verifies each migrated unfinished item remains present and is one of:

- selectable/buildable;
- still parked at an explicit gate;
- terminal;
- explicitly externally blocked.

A missing, duplicated, owner-drifted or otherwise unschedulable item becomes:

`ORPHANED_REPAIR_REQUIRED`

This makes post-migration loss visible as machinery debt rather than allowing it to disappear silently.

## Shared Workspace projection

`buildControllerRetirementSharedProjectionV1(...)` provides a bounded read-only projection for later publication through existing Shared Workspace machinery. It exposes:

- predecessor and successor controller IDs;
- migration ID/status;
- estate, mapped, terminal and unmapped counts;
- retirement decision;
- post-retirement reconciliation state;
- orphaned count.

It explicitly grants no controller-disable, source-mutation, merge or runtime authority.

## Deterministic regression coverage

The V1 tests cover:

- complete lossless migration;
- one omitted unfinished goal;
- one omitted acceptance criterion;
- duplicate successor ownership;
- active WIP with outstanding writer/lease identity;
- approval-ready parked work preserving zero-capacity semantics;
- provider-specific continuation requirements;
- successor-not-enabled retirement failure;
- unresolved-mapping retirement failure;
- successful post-retirement reconstruction;
- missing post-retirement work becoming `ORPHANED_REPAIR_REQUIRED`;
- authority-free Shared Workspace projection.

## Next integration slice

After this pure source contract is admitted, the smallest next step is to compose it into the existing canonical controller lifecycle / Mission Scheduler / Shared Workspace surfaces so that every future disable/supersede/consolidate operation must present a valid migration ledger and post-retirement receipt.

Do not build another controller-retirement scheduler or truth plane.

## Authority boundary

This V1 source slice provides migration classification only.

It does not:

- disable or enable an automation;
- seize or release a lease;
- mutate source outside its own branch;
- create/close/merge another PR;
- deploy or mutate Battle Bridge/OpenClaw/Forge/Windows runtime;
- activate a provider, credential or spending path;
- grant protected merge authority.
