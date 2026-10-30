# #1622 current-main source admission regression

The elastic goal ignition path must bind construction admission to authoritative canonical `main` source truth, not to a stale physical Mission Worker launch environment captured before a protected-main advance.

Observed failure shape: protected `main` advances to A while the physical Mission Worker still reports prior head B. Programme authority correctly reports `HOLD`, but that runtime hold must not erase canonical source truth or prevent scheduler-backed source admission from being prepared.

The regression in `criticalBacklogConveyorCurrentMainAdmission.test.js` therefore uses a real worker-caused `HOLD`: admission/select occurs against authoritative main A, A is retained as `sourceRevision`, the stale-worker blocker stays visible, capacity routing and Mission Worker publication are not invoked, and ignition is surfaced with zero dispatch as `MISSION_WORKER_RUNTIME_NOT_READY`. A second hostile case proves a non-worker `HOLD` cannot enter elastic source admission.

Merged #2243 remains responsible for work-conserving continuation: a held ignition is parked rather than becoming a programme-wide stop, and already-admitted provider-neutral source work can still be drained by the existing heartbeat. No runtime mutation, merge, direct-main, arbitrary shell, destructive Git, provider activation, new worker/controller/queue/mailbox/lease plane, or lease seizure authority is granted.

Acceptance remains physical: one real durable goal must cross SELECT -> CLAIM -> non-empty SOURCE_CHANGED -> TESTED -> terminal execution receipt -> exact-head review handoff on current protected main.