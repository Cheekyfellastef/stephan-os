# Foundry Parallel Production Acceleration Shared Workspace V1

Parent goal: #1671
Planner dependency: PR #1786 exact canonical-main convergence head `9bc763e957f2a6d2ddcad6873a0f68b2bc4f4037`
Canonical base: `main` at `2917862c8eb4b8ccde12bce7f4da381de2592aef`

## Purpose

Project the existing Foundry acceleration planner's validated recommendation into bounded Shared Workspace status and event records. This slice makes recommendation truth visible without creating a second planner, scheduler, lease authority, provider adapter, writer, publisher, mailbox, worker or dispatch path.

The adapter is source-only and read-only. It exports record constructors but no filesystem publisher. It does not write the Shared Workspace, dispatch a packet, claim a resource lease, execute Forge work, mutate source, register a runner, publish a branch, merge, deploy or alter runtime state.

## Canonical inputs

The adapter imports and calls `planFoundryParallelProductionAcceleration()` directly. It does not accept a caller-supplied planner result and does not reconstruct capacity or Forge authority.

The planner remains responsible for:

- trusted repository, canonical `main` head/tree and clock;
- observing the exact raw `schedulerSource` once into an inert bounded snapshot;
- directly calling the canonical Mission Scheduler builder with the trusted clock and freshness window;
- fresh canonical Mission Scheduler candidate and ACTIVE-resource inventories;
- canonical GitHub and Foundry build-lane capacity validation;
- receipt-bound execution, integration, reliability, rework and slot measurements;
- direct Forge M2/M3 adjudication;
- exact resource-disjointness and positive-net-acceleration checks.

The adapter uses the canonical Shared Workspace record constructors and validator. It does not edit or replace `sharedAgentWorkspaceStore.mjs`.

## Fixed logical identities

```text
participant: foundry-parallel-production-acceleration
status id: foundry-parallel-production-acceleration-current
event kind: foundry-parallel-production-acceleration-recommendation
```

These are record identities only. No status file or event stream is written by this module.

The status ID remains stable so a future separately reviewed publisher can replace the current
projection. Each event ID keeps the fixed event-kind prefix and adds the first 24 hexadecimal
characters of a SHA-256 digest over the complete sanitized slice. The digest therefore binds the
event to its canonical timestamp, repository head/tree and bounded recommendation content. An
identical input is byte-idempotent, while a distinct current recommendation cannot reuse the same
logical event identity.

## Sanitized projection

The projection may expose only bounded recommendation truth:

- planner validity, decision and truth state;
- exact repository, canonical head/tree and observation time from a valid plan;
- GitHub baseline provider identity;
- sorted bounded assignment identities, provider/route/worker identities, resource counts, predicted durations, seconds saved and receipt IDs;
- sorted bounded held-candidate identities and reason codes;
- sorted bounded provider state, queue, slot, duration and receipt IDs;
- bounded Foundry telemetry including canonical M2/M3 receipt IDs;
- truthful total/shown counts and truncation flags;
- total predicted critical-path seconds saved.

It must not project:

- the raw trusted-host context;
- the raw inert scheduler source or a caller-shaped scheduler projection;
- Mission Scheduler portfolios, proof inventories or full resource paths;
- raw build-lane, metrics, M2 or M3 receipts;
- payload digests, authority inventories or proof content;
- commands, arbitrary paths, environment data or secret-like values.

The status record intentionally carries an empty `proofRefs` array rather than copying unreviewed raw proof material. Receipt IDs and exact head/tree identities provide bounded provenance for the recommendation surface; the canonical sources remain authoritative.

## Truth states

```text
BLOCKED
CURRENT_READY
CURRENT_HELD
CURRENT_IDLE
```

`recommendationUsable=true` only when the canonical planner is valid, returns `FOUNDRY_ACCELERATION_READY_MODEL_ONLY`, contains at least one structurally complete assignment, and every projected identifier is compatible with the canonical Shared Workspace validator. Validator-forbidden or otherwise unprojectable identifiers fail the slice closed to `BLOCKED`, clear every assignment/provider/telemetry inventory and cannot survive in either record.

Invalid evidence projects `BLOCKED`, zero assignments and the Unix epoch as its non-current timestamp. Waiting-for-M3, no-positive-gain and other valid held decisions remain visible as `CURRENT_HELD` but never become usable capacity. An empty canonical candidate inventory projects `CURRENT_IDLE`.

No previous READY record is carried forward by these pure constructors.

## Boundedness

The record surface shows at most:

- 16 assignments;
- 16 held candidates;
- 8 provider summaries;
- 12 blocker codes per bounded blocker inventory.

Full total counts and truncation booleans remain explicit. Resource paths are not published; each assignment reports only its complete validated resource count. This avoids turning a display projection into a competing lease inventory.

## Authority boundary

Every produced slice, status record and event record keeps these fields false:

```text
dispatchAllowed
sourceMutationAllowed
branchMutationAllowed
publicationAllowed
mergeAuthority
deploymentAllowed
runtimeMutationAllowed
workspaceWriteAllowed
arbitraryCommandAllowed
```

The module exports no publisher, writer, appender, filesystem adapter or dispatch function. A future publisher or host integration is a separate exact-head-reviewed source slice and must not infer runtime authorization from these records.

## Resource-disjointness

This additive slice owns exactly three new files:

1. `shared/agents/foundryParallelProductionAccelerationSharedWorkspaceV1.mjs`
2. `shared/agents/foundryParallelProductionAccelerationSharedWorkspaceV1.test.mjs`
3. `docs/architecture/stephanos-foundry-parallel-production-acceleration-shared-workspace-v1.md`

It edits none of PR #1786's planner files and none of the active Forge M3 estates in #1737, #1738, #1743, #1744 or #1745.

## Acceptance boundary

Focused tests must prove:

1. READY planner truth becomes a bounded recommendation, not dispatch authority.
2. Status and event records validate through the canonical Shared Workspace validator.
3. blocked, waiting, no-gain and idle decisions cannot become usable capacity.
4. output is deterministic across canonical provider/candidate permutations.
5. assignment and held inventories remain within the canonical scheduler bound with truthful
   totals, shown counts and truncation flags.
6. raw scheduler, receipt, payload, proof and resource-path content is absent.
7. all authority flags remain false.
8. the module exports no publisher, writer, filesystem or dispatch surface.
9. hostile trusted-context observations fail closed without throwing.
10. identical sanitized snapshots produce identical event records, while changed current
    recommendations produce distinct canonical event IDs.

Live paired-capacity production, Shared Workspace writes, mission-worker integration, dispatch and Forge execution remain separate work after the prerequisite source stack reaches canonical `main` and receives its own authorization.
