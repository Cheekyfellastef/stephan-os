# Implementation pin

Smallest intended production change in the existing critical backlog conveyor core:

Inside `ensureCriticalBacklogMission`, after the authoritative programme projection is read and before elastic capacity routing/dispatch, derive the elastic `sourceRevision` from `authoritative.machineryInventory.sourceHead` and require it to be a valid 40-character SHA. Do not derive that revision from `env.STEPHANOS_MISSION_WORKER_HEAD_SHA`.

The physical Mission Worker head remains independently checked by programme/worker heartbeat and runtime proof. It must not be allowed to substitute for canonical-main source truth, and stale physical runtime should remain visible as a separate control-plane/runtime blocker.

Required regression: canonical main A plus stale worker env B must route and dispatch source admission with A, never B. Missing/invalid authoritative source head must still fail closed.
