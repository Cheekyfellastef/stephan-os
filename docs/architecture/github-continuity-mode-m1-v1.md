# Stephanos GitHub Continuity Mode M1

Status: source-only contract, not live

## Goal

Keep Stephanos construction moving when the Battle Bridge is degraded or unavailable.

The Battle Bridge remains the required host for Windows/runtime/GPU/VR work, but its loss must not freeze unrelated source construction, hosted CI, independent review, PR preparation, or any other task that already has a proven non-Windows execution surface.

This slice advances durable construction goal #1637 and composes with mobile recovery goal #1814.

## Architecture

GitHub Continuity Mode sits above the existing `missionControllerCapacityRouterV1`.

It does **not** introduce another scheduler, worker, queue, source writer, merge engine, or execution authority.

The existing router remains authoritative for whether a task can use:

- `CODEX`
- `CHATGPT_GITHUB`
- `FOUNDRY_FORGE`
- `WAIT_FOR_PROVEN_CAPACITY`

Continuity Mode adds only host-failure truth:

```text
Battle Bridge READY
  -> NORMAL

Battle Bridge DEGRADED / UNAVAILABLE / UNKNOWN
  -> keep existing running dispatch ownership
  -> non-Windows work may continue only through an already-proven existing route
  -> Windows/runtime work becomes HOLD_RUNTIME_RECOVERY
  -> #1814 recovery handoff is required
```

## Host health contract

Battle Bridge health is represented by a bounded, expiring receipt:

```text
stephanos.battle-bridge-continuity-health.v1
```

It binds:

- canonical host identity;
- repository;
- exact source head;
- observation and expiry;
- availability;
- bounded capability inventory;
- blockers;
- proof references.

Silence, malformed evidence, or stale health can never become `READY`.

## Task dispositions

Each supplied mission/task receives exactly one disposition:

```text
CONTINUE
PRESERVE_EXISTING_DISPATCH
HOLD_RUNTIME_RECOVERY
HOLD_NO_PROVEN_CAPACITY
HOLD_INVALID_TASK
```

### CONTINUE

The existing mission capacity router already selected a proven route and the task is not blocked by loss of Battle Bridge-only capability.

### PRESERVE_EXISTING_DISPATCH

A canonical running dispatch already owns the mission. Continuity Mode never steals or duplicates a live dispatch. Lease/receipt machinery must separately prove that the prior executor is terminal or reclaimable.

### HOLD_RUNTIME_RECOVERY

The task is Windows-bound and the Battle Bridge is not `READY`. The task is durably held for #1814 recovery instead of being incorrectly rerouted to GitHub.

### HOLD_NO_PROVEN_CAPACITY

The task is source-capable in principle, but no existing build route has a fresh canonical capacity receipt. No progress is inferred.

## Authority boundary

M1 explicitly adds none of these authorities:

```text
sourceMutationAuthorityAdded=false
mergeAuthorityAdded=false
deploymentAuthorityAdded=false
runtimeMutationAuthorityAdded=false
duplicateDispatchAllowed=false
protectedMergeDispatchAllowed=false
```

A later GitHub Continuity execution slice may consume existing source-construction authority only through the same leases/receipts already used by the construction fabric.

Protected merge remains a separate gate. M1 deliberately does not solve the current missing GitHub `workflow_dispatch` mutation by weakening merge governance.

## Relationship to #1814

#1637 GitHub Continuity Mode and #1814 Lifeboat solve different halves of the same incident:

```text
#1637 Continuity Mode
  keeps eligible project work moving while Battle Bridge is unavailable

#1814 Lifeboat
  restores the Battle Bridge without local keyboard/mouse intervention
```

The intended steady-state incident sequence is:

```text
Battle Bridge unhealthy
  -> availability becomes DEGRADED / UNAVAILABLE / UNKNOWN
  -> GitHub Continuity Mode continues eligible work
  -> Windows-only work is held truthfully
  -> #1814 performs bounded remote recovery
  -> Battle Bridge publishes fresh READY health
  -> NORMAL routing resumes
  -> no duplicate dispatch is created
```

## Acceptance path

M1 is complete only as a source contract after focused tests, hosted exact-head proof, and independent review.

The broader #1637 continuity amendment is not production-complete until a real chaos drill proves:

1. Battle Bridge control-plane health is deliberately removed;
2. GitHub continuity becomes active from durable evidence;
3. at least one real source goal advances through source construction, CI, review, and merge-ready state without Battle Bridge participation;
4. Windows/runtime work remains explicitly held;
5. #1814 remotely restores the Battle Bridge;
6. the recovered host rejoins without duplicate jobs or stolen leases.

## Non-goals

This slice does not:

- install or touch Windows;
- restart the Battle Bridge;
- execute #1814 recovery;
- install Podman;
- execute Forge M2/M3;
- merge a PR;
- deploy Stephanos;
- create a second programme controller;
- convert GitHub into a Windows runtime.
