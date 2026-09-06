# Stephanos Autonomous Failure Sentinel M1

Status: source-only planner, not live runtime proof

## Goal

Advance durable goals #1509 and #1557 by closing the detection gap exposed by the 2026-08-16 Battle Bridge incident.

The governing acceptance invariant is:

> OPERATOR_FIRST_DISCOVERY_OF_MACHINE_DETECTABLE_FAILURE_IS_ACCEPTANCE_FAILURE

Stephan remains at intent, judgment and protected approval. Detecting a stale or unhealthy Stephanos control plane, preserving running work, selecting a bounded diagnostic/recovery handoff and waiting for its receipt are automation responsibilities.

## Build on existing machinery

M1 creates no scheduler, worker, mailbox, recovery plane, owner-authored recovery request, Windows executor or second truth store.

It consumes the already-merged GitHub Continuity M1 contract from #1637 and hands recovery toward the existing #1814 recovery surfaces. Existing mission dispatch ownership remains authoritative.

## Detection contract

The sentinel accepts only:

- exact repository identity;
- exact current source head;
- canonical current GitHub Continuity evidence;
- a short-lived exact-head recovery-capability receipt when a bounded recovery handoff is possible;
- optional existing recovery-dispatch evidence;
- optional operator/automation observation timestamps used only to measure whether the operator discovered the failure first.

Battle Bridge health other than `READY`, or a continuity state other than `NORMAL`, is a machine-detectable failure condition.

A continuity plan that widens source, merge, deployment, runtime, duplicate-dispatch or protected-merge authority is rejected.

## Automatic response

When a failure is detected the planner requires two parallel responses while preserving existing owners:

1. `sourceDiagnosticLaneRequired=true` so GitHub/source diagnosis can continue independently;
2. `runtimeRecoveryHandoffRequired=true` so the canonical recovery system can be engaged when an exact-head closed-world route is proven.

The initial qualified recovery vocabulary is deliberately tiny and ordered by least consequence:

1. `PROBE_BATTLE_BRIDGE`
2. `WAKE_CANONICAL_RECOVERY_MESH`
3. `WAKE_CANONICAL_MAILBOX`

A read-only probe wins whenever it is qualified. A wake is proposed only if the probe is not qualified and the wake itself is present in a current exact-head recovery-capability receipt.

The planner itself cannot execute the proposal. It grants no Windows mutation authority and cannot manufacture the owner-authored #1814 mobile request or its GitHub attestation.

## Duplicate and drift handling

If an active recovery request already owns the exact current source head, the sentinel enters `WAITING_FOR_RECOVERY_RECEIPT` and creates no second proposal.

If active recovery evidence is malformed or bound to another source head, the sentinel enters `SAFE_HOLD`.

If no current exact-head recovery capability exists, the sentinel enters `WAITING_FOR_PROVEN_RECOVERY_ROUTE`. Silence is never recovery proof.

## Operator-first discovery metric

`operatorFirstDiscoveryDefect=true` when:

- a machine-detectable failure exists;
- an operator-observed failure timestamp exists; and
- automated detection is absent or occurred later.

This flag grants no authority. It is an acceptance signal that the unattended monitoring/repair system failed to notice the problem soon enough.

## Authority boundary

Every result keeps these false:

```text
sourceMutationAuthorityAdded=false
mergeAuthorityAdded=false
deploymentAuthorityAdded=false
runtimeMutationAuthorityAdded=false
arbitraryCommandAuthorityAdded=false
duplicateRecoveryDispatchAllowed=false
```

A recovery proposal additionally requires:

```text
useExistingCanonicalRecoverySurfaceOnly=true
freshPostActionReceiptRequired=true
dispatchAllowedByThisPlanner=false
ownerAuthoredRequestMayBeForged=false
arbitraryCommandAllowed=false
arbitraryPathAllowed=false
arbitraryExecutableAllowed=false
destructiveGitAllowed=false
pcRestartAllowed=false
```

## M1 acceptance tests

Deterministic regressions prove:

- healthy exact-head continuity remains `NORMAL`;
- unknown/degraded Battle Bridge truth is detected;
- read-only probe is preferred over wake;
- a qualified Recovery Mesh wake can be proposed when probe is unavailable;
- existing exact-head recovery ownership suppresses duplicate dispatch;
- active recovery on another head causes `SAFE_HOLD`;
- operator-first discovery becomes an explicit acceptance defect;
- automation-first discovery does not;
- missing automated detection with operator observation is a defect;
- authority-widened continuity evidence fails closed;
- stale or wrong-head recovery capabilities cannot create recovery authority;
- no owner-authored mobile request, arbitrary command, destructive Git or PC restart can be manufactured by this layer.

## Follow-on wiring

After M1 source acceptance, the next bounded slice should wire this pure planner into the existing periodic Stall Sentinel / Autonomous Build Continuity observation loop and existing #1637 scheduler/router queues. That wiring must emit one idempotent recovery handoff and consume receipts from #1814 without creating a second scheduler or recovery executor.

A later unattended acceptance must deliberately stop or stale a recoverable Battle Bridge component and prove that Stephanos detects it, begins bounded recovery and records the event before the operator discovers it.
