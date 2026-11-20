# UNATTENDED_READY certificate V1

This source-only certificate implements the acceptance projection owned by #1858,
**Closed-Chat Autonomy Maturity and UNATTENDED_READY V1**.

It does not create another controller, scheduler, queue, worker, reviewer, lease
plane, runtime authority surface or merge path. It consumes durable evidence from
the existing #1556/#1557/#1637/#1947 machinery and reports one bounded fleet state:

```text
UNATTENDED_READY
UNATTENDED_DEGRADED
UNATTENDED_NOT_READY
SAFE_HOLD
```

## Ready means proven, not optimistic

`UNATTENDED_READY` is emitted only when all required controllers are fresh,
active, exact-source-bound and individually ready, and every required proof is
current and exact-source-bound.

Required proof classes are:

- scheduler continuity;
- queue/lease integrity;
- qualified execution capacity;
- deterministic proof route;
- independent review route;
- durable resume checkpoint;
- one real native goal cycle;
- event-driven capacity refill;
- stalled/orphan recovery;
- provider failover;
- approval-lane isolation;
- operator STOP propagation;
- Battle Bridge recovery readiness;
- Battle Bridge cleanliness;
- operator-attention delivery.

A missing core continuation proof produces `UNATTENDED_NOT_READY`. Missing
resilience evidence may produce `UNATTENDED_DEGRADED` while safe independent
work continues. Authority contradiction, duplicate mutation ownership, duplicate
readiness proof identity, controller `SAFE_HOLD`, or a proven operator STOP
propagation violation produces `SAFE_HOLD`.

## Freshness

The certificate deliberately rejects stale evidence. Fast-moving runtime evidence
has short freshness windows, while behavioural drills such as provider failover
and stalled-lane recovery may remain valid for up to one day. Every accepted proof
is still bound to the exact source head supplied to the certificate.

That makes protected-main movement visible: a readiness claim cannot stay green
merely because an old canary once passed.

## Authority boundary

The projection grants no source mutation, runtime mutation, controller mutation,
merge, deployment, credential, spending or lease-seizure authority.

It reports whether the already-authorised Stephanos machinery has proved the
conditions required to run unattended. It never creates those permissions itself.

## Intended live acceptance

The decisive #1858 sequence remains external evidence, not a synthetic fixture:

```text
SELECT eligible durable goal
-> CLAIM canonical lease
-> SOURCE_CHANGED
-> TESTED
-> terminal execution receipt
-> exact-head review handoff
-> RELEASE
-> SELECT NEXT without another operator/chat prompt
```

The live certificate should only become `UNATTENDED_READY` after that sequence,
restart/resume, provider-loss, stalled-lane recovery, approval-lane isolation,
Battle Bridge recovery/cleanliness and operator STOP propagation have all produced
fresh durable proof.
