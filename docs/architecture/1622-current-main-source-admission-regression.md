# #1622 current-main source admission regression

The elastic goal ignition path must bind construction admission to authoritative canonical `main` source truth, not to a stale physical Mission Worker launch environment captured before a protected-main advance.

Observed failure shape: protected `main` advances, the GitHub main-advance signal is emitted, but the physical Mission Worker/controller still carries the prior `STEPHANOS_MISSION_WORKER_HEAD_SHA`. A selected elastic goal can then be held before source construction while the heartbeat previously made that hold look healthy.

The regression in `criticalBacklogConveyorCurrentMainAdmission.test.js` requires the existing conveyor to pass `authoritative.machineryInventory.sourceHead` through capacity routing and elastic dispatch even when the physical worker environment still names the prior head. This is source-only orchestration truth. It grants no runtime mutation, merge, direct-main, arbitrary shell, destructive Git, provider activation, new worker/controller/queue/mailbox/lease plane, or lease seizure authority.

Acceptance remains physical: one real durable goal must cross SELECT -> CLAIM -> non-empty SOURCE_CHANGED -> TESTED -> terminal execution receipt -> exact-head review handoff on current protected main.
