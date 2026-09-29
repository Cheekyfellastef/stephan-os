# Monitor Multiplexer control-plane repair V1

Issue: #2297 — Goal: Make Monitor Multiplexer a canonical Battle Bridge control-plane task

This repair preserves the existing five-task Battle Bridge control-plane reconciler byte-for-byte as `battleBridgeControlPlaneSelfRepairCoreV1.mjs` and layers the merged PR #1639 Monitor Multiplexer scheduled-task install/start step onto the canonical Battle Bridge path.

The wrapper does not add caller-selected task names, executable paths, installer paths, arbitrary shell, source mutation, Git mutation, merge authority, deployment authority, or provider authority. Non-canonical test seams retain the previous five-task behaviour; the canonical Battle Bridge path adds the fixed one-minute `Stephanos Battle Bridge Monitor Multiplexer` task and validates its bounded installer receipt before reporting reconciliation success.
