# Autonomous Failure Sentinel M2 Recovery Handoff V1

## Purpose

This M2 slice advances #1509 and #1557 by connecting the pure Autonomous Failure Sentinel M1 planner from PR #1832 to the already-governed #1814 Battle Bridge recovery outcome **without** creating a second controller, scheduler, recovery queue, mailbox, runtime executor or authority plane.

M2 is deliberately stacked on #1832. It consumes M1's exact output and produces, at most, one deterministic **handoff candidate**. It does not submit, attest, queue or execute that candidate.

## Governing invariant

```text
OPERATOR_FIRST_DISCOVERY_OF_MACHINE_DETECTABLE_FAILURE_IS_ACCEPTANCE_FAILURE
```

If M1 proves that Battle Bridge continuity is unhealthy and a current exact-head recovery route exists, M2 turns that already-proven proposal into one idempotent #1814 handoff identity while preserving ongoing source work through canonical GitHub Continuity.

## Canonical flow

```text
existing GitHub Continuity M1 evidence
  -> Autonomous Failure Sentinel M1 (#1832)
  -> Autonomous Failure Sentinel M2 handoff adapter
  -> one inert #1814 handoff candidate
  -> existing owner-authenticated #1814 request/attestation path
  -> existing recovery machinery
  -> fresh post-action receipt
  -> sentinel reevaluation
```

The M2 adapter owns only the third line.

## Handoff candidate

A candidate is content-addressed from:

```text
repository
exact source head
recovery goal #1814
M1-selected fixed recovery action
```

That identity is intentionally stable across repeated observation of the same exact-head/action condition so retries cannot create a second recovery candidate merely because the observation loop runs again.

The candidate retains:

```text
schemaVersion
handoffId
repository
sourceHead
recoveryGoalIssue=1814
action
createdAtUtc
proofRefs
status=CANDIDATE_READY
operatorFirstDiscoveryDefect
preserveRunningDispatchOwnership=true
ownerRequestRequired=true
githubAttestationRequired=true
executionAllowedByThisAdapter=false
```

Every mutation/authority flag remains false.

## Duplicate suppression

M2 accepts an optional retained handoff observation only for deduplication.

- an exact active `CANDIDATE_READY`, `SUBMITTED`, `ACCEPTED` or `RUNNING` handoff owns recovery and suppresses a new candidate;
- malformed, authority-bearing or identity-conflicting handoff evidence causes `SAFE_HOLD`;
- an exact terminal handoff does not automatically create a retry. It requires the terminal recovery receipt to be reconciled back through M1 before another recovery cycle can begin;
- M1's existing exact-head recovery-dispatch evidence remains authoritative. If M1 reports that an existing dispatch owns recovery, M2 emits nothing.

M2 therefore cannot race the existing #1814 path or manufacture a replacement owner.

## Source continuity boundary

When recovery is required, M2 reports:

```text
sourceContinuityDisposition=PRESERVE_CANONICAL_GITHUB_CONTINUITY
```

This is a read-only disposition, not a dispatch grant. Existing #1637/#1830 scheduler/router and execution-grant machinery continues to own any source-work routing. M2 never creates its own source queue, worker or lease.

## Recovery action boundary

Recovery action selection remains entirely inside M1's closed-world priority:

```text
PROBE_BATTLE_BRIDGE
WAKE_CANONICAL_RECOVERY_MESH
WAKE_CANONICAL_MAILBOX
```

M2 has no caller-selectable command, executable, path, URL, Scheduled Task, PowerShell, shell, restart, Git operation or mailbox operation.

A candidate cannot substitute for:

- the owner-authenticated #1814 request;
- the GitHub-hosted owner attestation;
- a recovery-capability receipt;
- a runtime executor receipt;
- a fresh post-action recovery receipt.

## Data-only boundary

The complete public M2 input is captured before routing or hashing.

The adapter requires closed-world plain data and rejects:

- accessors without invoking their values;
- functions and own `toJSON` hooks;
- sparse or custom arrays;
- custom prototypes;
- symbols;
- cycles;
- reserved prototype-shaping keys;
- non-finite numbers;
- oversized collections/strings;
- revoked or uninspectable proxies;
- unknown top-level orchestration or authority fields.

After capture, only the frozen snapshot is supplied to M1.

## State projection

M2 exposes only these bounded states:

```text
NORMAL
HANDOFF_CANDIDATE_READY
EXISTING_HANDOFF_OWNS_RECOVERY
WAITING_FOR_RECOVERY_RECEIPT
WAITING_FOR_PROVEN_RECOVERY_ROUTE
SAFE_HOLD
```

These states describe source-level handoff readiness. They are not claims that the Battle Bridge was probed, woken, recovered or made healthy.

## Authority invariant

The M2 result always keeps:

```text
ownerRequestMayBeForged=false
githubAttestationMayBeForged=false
queueWriteAllowed=false
recoveryExecutionAllowed=false
sourceMutationAllowed=false
mergeAllowed=false
deploymentAllowed=false
runtimeMutationAllowed=false
arbitraryCommandAllowed=false
arbitraryPathAllowed=false
arbitraryExecutableAllowed=false
destructiveGitAllowed=false
pcRestartAllowed=false
```

The candidate itself carries the same zero-authority boundary.

## Focused proof

```bash
node --check shared/agents/autonomousFailureSentinelHandoffV1.mjs
node --test shared/agents/autonomousFailureSentinelV1.test.mjs shared/agents/autonomousFailureSentinelHandoffV1.test.mjs
```

The M2 suite covers:

- healthy no-op behavior;
- deterministic #1814 candidate creation;
- inherited M1 recovery-action priority;
- repeated-observation identity stability;
- active exact-handoff deduplication;
- terminal handoff reconciliation hold;
- M1 existing-dispatch ownership;
- stale/missing recovery route hold;
- operator-first discovery accounting;
- authority-smuggling rejection;
- top-level and nested accessor rejection;
- own `toJSON`, custom prototype, sparse-array and revoked-proxy rejection;
- complete zero-authority output.

## Next bounded slice

After M1 and M2 source acceptance, the next slice may bind this inert handoff candidate to the **existing** periodic observation and durable #1814 request-admission surface. That later slice must still prove exactly one recovery owner, owner authentication, GitHub attestation, queue idempotency, post-action receipt reconciliation and no interference with unrelated source work.

No merge, deployment, Windows/Battle Bridge mutation, recovery execution, OpenClaw mutation, Podman/Forge execution, service restart or PC restart is authorized by M2.