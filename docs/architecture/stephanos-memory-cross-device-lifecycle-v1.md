# Stephanos Memory Cross-Device Lifecycle Evaluation V1

## Outcome

This contract creates the deterministic source proof shape for #1645's live cross-device memory acceptance. It evaluates evidence after lifecycle actions have happened; it does not perform a write, read, correction, forget, delete, tombstone write, Shared Workspace mutation or device action.

## Required six-step lifecycle

A passing evaluation requires exactly one authority-confirmed evidence-bearing event for each stage, in strict chronological order:

1. `WRITE_CONFIRMED` — device A establishes the original canonical digest;
2. `READ_CONFIRMED` — distinct device B observes that exact digest;
3. `CORRECT_CONFIRMED` — device B supersedes it with a distinct corrected digest;
4. `READ_CORRECTED` — device A observes the corrected digest;
5. `FORGET_CONFIRMED` — device A forgets the corrected truth with no retained content or future influence;
6. `TOMBSTONE_OBSERVED` — device B sees the content-free, non-influential tombstone state.

This A→B→A→B topology proves propagation in both directions instead of allowing six receipts from one device to masquerade as cross-device continuity.

## Fail-closed truth

The evaluator holds or fails when:

- the lifecycle is incomplete or duplicates a required stage;
- any receipt lacks shared/operator-confirmed authority;
- any stage lacks bounded evidence references;
- timestamps do not increase strictly;
- both device identities are not distinct or the required bidirectional topology is broken;
- a read digest differs from its preceding canonical write/correction;
- correction does not identify both the prior and new digest;
- forget targets the wrong digest, retains content or permits future influence;
- the final tombstone retains content or permits influence.

The evaluator accepts only metadata and digests; memory payloads are not part of the proof packet.

## Live acceptance boundary

A source-level `PASS` proves only that a supplied evidence packet is internally coherent. #1645 remains incomplete until a separately governed live round actually performs the six lifecycle stages across two real supported devices/surfaces and binds each observation to durable evidence.

## Authority boundary

All mutation and execution authority remains false, including memory writes, correction/forget/delete, tombstone writes, Shared Workspace mutation, device mutation, commands, approvals, merge, deployment and runtime changes.
