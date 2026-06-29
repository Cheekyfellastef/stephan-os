# Ignition Concierge Status Routing V1

This source-only slice supports #1281 by defining a deterministic routing contract for Battle Bridge ignition status.

Startup and recovery status should be routed into shared workspace and dashboard/splash packets instead of visible PowerShell walls.

Focused proof command:

```bash
node --test shared/agents/ignitionConciergeStatusRouting.test.mjs
```

Scratch execution from connector-fetched source passed 6/6 tests.

Battle Bridge repo-mounted proof is still required before merge.
