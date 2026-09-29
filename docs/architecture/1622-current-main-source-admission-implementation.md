# Implementation pin

The production repair stays inside the existing critical backlog conveyor core.

Inside `ensureCriticalBacklogMission`, authoritative `machineryInventory.sourceHead` is validated before the physical Mission Worker readiness gate. A programme `HOLD` may still admit/select an elastic mission only when every blocker is a narrowly allowlisted worker-heartbeat/runtime-freshness blocker and the scheduler remains fail-closed clear with elastic capacity RUNNING.

That worker-only `HOLD` does **not** publish a Mission Worker action. It emits a bounded held ignition with zero dispatch, preserves canonical source revision A and the stale-worker blocker, and lets the merged #2243 heartbeat park only that lane while already-admitted provider-neutral source work and unrelated lanes can continue.

Any non-worker programme blocker remains fail-closed. Missing/invalid authoritative source head also remains fail-closed. No runtime mutation, merge, direct-main, arbitrary shell, destructive Git, provider activation, new controller/worker/queue/mailbox/lease plane, or lease seizure authority is added.

Required regression: canonical main A plus stale worker B under a real `HOLD` must admit against A, retain the runtime blocker, publish zero worker actions, surface the lane as held/continuable, and prove a non-worker `HOLD` cannot enter elastic source admission.