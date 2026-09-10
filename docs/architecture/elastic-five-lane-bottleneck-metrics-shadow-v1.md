# Elastic five-lane bottleneck metrics shadow V1

## Purpose

This additive #1637 M7 slice makes current five-lane width, active lanes, queue pressure,
wait time, resource leases, bottlenecks and the next shadow-only width recommendation
deterministically visible. It does not implement or replace the canonical live routing and
width owner in PR #1999.

The existing #1557 native controller remains the only execution authority. This projection
is inert evidence: it cannot create or retire a lane, acquire or release a lease, dispatch
work, change source or runtime state, merge, deploy, transfer controller authority or cut
over to the five-lane candidate.

## Exact input contract

The projection requires one exact source head/tree, an observation time, a closed width
policy, canonical lane and lease arrays, bounded demand counters, and explicit provider and
resource-pressure booleans. Every lane carries a unique lane ID and correlation ID, a fixed
role and state, exact source identity, queue/wait metrics, provider identity, and declared
resource IDs. Every lease is signature-verified, time bounded, source bound and attached to
a declared lane resource.

Unknown keys, accessors, symbols, sparse/decorated arrays, custom prototypes and hostile
reflection fail closed. Five fixed baseline roles are mandatory:

```text
SOURCE
REVIEW
PROOF
RUNTIME
EXPERIENCE
```

## Metrics and isolation

The output exposes:

```text
currentWidth
healthyWidth
blockedWidth
readyQueueDepth
blockedQueueDepth
criticalPathDepth
oldestQueueAgeMs
maximumWaitTimeMs
activeLanes
activeLeases
bottlenecks
recommendedWidth
nextAction
```

One blocked or paused lane remains visible while four resource-disjoint lanes continue.
Two blocked lanes force `SAFE_HOLD`. Multiple active mutation leases for one resource also
force `SAFE_HOLD`, including two leases claiming the same lane/owner.

Queue age, wait time, lane capacity, stale/expired leases and fleet capacity pressure are
reported with deterministic ordering so repeated observations of the same evidence produce
the same result.

## Shadow width recommendations

Recommendations are evidence only:

```text
SCALE_OUT_CANDIDATE_SHADOW
HOLD_WIDTH_SHADOW
SCALE_IN_CANDIDATE_SHADOW
CONTINUE_RESOURCE_DISJOINT_SHADOW
SAFE_HOLD_SHADOW
```

Healthy non-conflicting demand may recommend width above five. Idle width may recommend
contracting back to five. Capacity pressure or an active cooldown prevents scale-out.
No recommendation grants authority to perform the change.

## Acceptance boundary

This slice proves deterministic M7 bottleneck visibility and false-building rejection only.
It does not prove five baseline lanes are physically online, live elastic width mutation,
Battle Bridge execution, Spotify consumption, closed-chat live acceptance, cutover or
rollback. Those remain separate M5/M6/M8–M10 and exact-authority gates.
