# Bounded scope

Production source scope is one existing file: `stephanos-server/services/criticalBacklogConveyorServiceCore.js`.

Tests in this lane may cover only the canonical-main source revision selection and fail-closed invalid-source behavior. No new provider route, scheduler, worker, queue, mailbox, lease authority, runtime operation, merge path, deployment path, arbitrary command surface, credential surface, or direct-main path is permitted.
