# Sovereign Skill Conjurer V1

Canonical owner: [#2573 — Goal: Make Sovereign Commander absorb every Remote Commander capability](https://github.com/Cheekyfellastef/stephan-os/issues/2573).

## What exists

The existing canonical parity reconciler reads evidence of Remote Commander
operations, deduplicates by semantic capability, and compiles remaining
`BUILDABLE_GAP` observations into the existing Sovereign Commander plan.
It now also emits `skillForgeCandidates` into the same
`sovereign-commander-capability-parity-current` Shared Workspace **status**
record. No new daemon, scheduler, data store, approval queue, or remote transport.

For each gap, the proposal contains a stable skill ID, permission/risk posture,
observed evidence count, its least-privilege primitive, a reusable recipe
sequence, rollback expectation, test requirements, and the route through
the single canonical #2573 source-building goal.

The proposal's state is **DRAFT**, and `constructionAdmissionAllowed`,
`activationAllowed`, `executionAllowed`, `approvalInherited` and
`automaticCapabilityConstructionAllowed` are all **false**. Source
construction only proceeds through already-qualified and separately
authorised existing build/lease/review machinery. This status record is not
a new admission mechanism.

## Capability lifecycle

1. Observe a missing semantic ability through canonical Remote Commander
   capability parity telemetry. Do not call a paid remote service solely to
   create a learning signal.
2. Build a proposal from the existing bounded primitives. Reuse an existing
   action before considering a new one; no arbitrary shell, broad process
   control, credentials or open-ended filesystem surface is introduced.
3. Keep one canonical owner under #2573, not a new goal or scheduler per skill.
   Existing mission and lease identity must be preserved.
4. Prepare source and deterministic, negative-permission and evidence-retention
   tests in the canonical source-construction lane. This draft alone is not
   authority to execute even a seemingly benign recipe.
5. Obtain independent exact-base/head review, applicable operator approval,
   passing GitHub checks and the existing protected merge gate.
6. After an authorised merge/sync, refresh the admitted runtime and prove the
   action on Battle Bridge using an exact-head terminal receipt, not a queue
   acknowledgement or an old static test.
7. The next parity reconciliation may record a proven transition; only proven
   parity becomes Flywheel learning. An unproven code change is not a new
   Sovereign capability.

## Where to inspect

Read `capabilityCompiler.skillForgeCandidates` within the Shared Workspace
status file `status/sovereign-commander-capability-parity-current.json`.
The existing Skill Forge tile remains a separate **proposal-only** UI; this
source change does not claim that the tile displays live candidates, performs
review, or activates a skill. A future presentation adapter may consume
these packets but must not create a second approval state.

This V1 compiles parity gaps observed from Remote Commander. It is not yet a
general autonomous plugin authoring/execution system or proof of zero external
usage meters. Extending the same compiler to new capability sources must
preserve the canonical owner, source identity, bounded permissions and
independent runtime proof.

## Fail-closed invariants

- Drafts with forbidden shell, credential export, force-push, destructive Git
  or PC restart semantics are explicitly marked `BLOCKED`. A risky label
  cannot make those powers available.
- Local queue paths, private mission IDs, credentials and raw process output
  are not copied into proposed skill packets.
- A published packet never inherits merge, approval, runtime mutation,
  scheduler, lease, or arbitrary command authority.
- Provider/meter outage means reroute eligible *existing* build work through
  a qualified meter-free provider, never bypass specialist review or wait
  indefinitely on a known exhausted provider.
- Do not claim new runtime capabilities until the actual guarded tool is
  installed, the connected tool catalog refreshed, and its terminal live
  proof verified.
