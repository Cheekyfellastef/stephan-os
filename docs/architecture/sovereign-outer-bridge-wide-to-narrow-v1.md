# #2961 Sovereign Outer Bridge: wide rescue first, narrow on evidence

## Problem and working endpoints (12 October 2026)

Verified remote Battle Bridge evidence shows the existing Sovereign Commander
transport and local source/runtime head are live, and the existing Core Daemon
has a fresh heartbeat. The Recovery Mesh wake adapter failed with
`RECOVERY_MESH_WAKE_ADAPTER_FAILED`; original #2962 r7 terminal
worker evidence remains `REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN`.
The five physical controllers were not building. Simply waking the broken
task again or clearing the old lease would not close the chain.

## Wide route, without a second daemon or source writer

```
WORKING END: existing Sovereign Commander / authenticated mailbox
     |
WORKING END: existing single-instance Core Daemon heartbeat (15s)
     |
NEW: nonblocking, single-flight sovereign outer bridge (>=60s)
     |
EXISTING: original #2962 source lease and queue forensics
     |
EXISTING: canonical exact-lease reconciliation authority
     |
HELD until actual source lease proof -> material worker pickup -> two refills
```

The bridge runs inside the already-supervised Core Daemon and does **not**
depend on the blocked Windows Recovery Mesh wake adapter, elastic admission,
an operator chat turn or a GitHub runner. On Core Daemon source-head change the
existing daemon reload mechanism owns restart and source identity. The Core
loop continues to publish regular heartbeats even while rescue forensics are
pending. The separate rescue task is never allowed to create an additional
source writer, scheduler, queue, mission, review principal or lease.

The existing Recovery Mesh path remains available as a fallback; its observer
and the new bridge both delegate any release to the **same**
`releaseSourceMutationLease` canonical operation guard. There is no
independent lease release implementation or source mutation permission.
If the original terminal receipt is absent, the bridge stays HELD, records
the original mismatch and points back to original-owner repair #3023.

## Shrink only after proof

1. `OUTER_BRIDGE_WIDE`: source exact, observations active, #2962 lease held.
2. `OUTER_BRIDGE_NARROWING_LEASE`: canonical exact lease released with
   valid terminal worker proof; **not** worker pickup.
3. `OUTER_BRIDGE_NARROWING_PICKUP`: genuine physical worker pickup receipt.
4. `CANONICAL_REJOIN_READY`: two separately proven unattended refill cycles.

The first source slice intentionally fixes recovery *reach*, not the missing
historical execution receipt. The runtime adapter explicitly supplies
`workerPickupReceiptProven:false` and `unattendedRefillReceiptCount:0`
until a separate source-head-bound physical worker proof adapter is built.
Therefore this initial bridge **cannot claim rejoin or green** merely
because the original lease disappears or a daemon heartbeat is healthy.

During VR gaming, skip optional rescue work; on shutdown or source reload,
stop scheduling new cycles. Public status
`status/sovereign-outer-bridge-current.json` is bounded and HELD; the
existing `status/temporary-sovereign-rescue-lane-current.json` preserves
the canonical triage. Each failed cycle is retried on a bounded minimum
interval, without spawning a new subprocess or waiting for ChatGPT.

## Acceptance after protected merge

- Run `node --test shared/agents/sovereignOuterBridgeV1.test.mjs` and
  the existing Core / #2961 / lease reconciler regressions.
- Independent Windows/core-daemon and lease/security specialist reviews
  must approve the exact commit. No self-review or reviewer policy change.
- Prove protected merged main, Battle Bridge source/Runtime head chain,
  Core Daemon restart on source advance and a fresh
  `sovereign-outer-bridge-current.json` with matching head.
- Prove one actual Core-triggered forensic/reconciliation cycle independently
  of Recovery Mesh wake. Then repair the **original worker recorder** under
  #3023 if still missing, never fabricate or release evidence.
- Only report genuine autonomous building after physical pickup, guarded
  review+merge, deployed runtime proof, and two unattended refill cycles.
