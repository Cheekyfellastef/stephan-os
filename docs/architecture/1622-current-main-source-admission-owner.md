# Ownership

Canonical goal: #1622 — Wire guarded implementation pickup into the existing Stephanos dispatch machinery.

This branch owns only the current-main source-admission defect in the existing critical backlog conveyor. It does not own #2237 observability, #1978 OpenClaw specialist governance, Forge commissioning, product work, protected merge, or Battle Bridge runtime mutation.

One writer for the production seam: `stephanos-server/services/criticalBacklogConveyorServiceCore.js`. Reuse this lane for that defect and do not create another source-admission branch or PR while it is open.
