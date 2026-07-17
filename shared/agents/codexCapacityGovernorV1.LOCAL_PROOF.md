# Local deterministic proof

```text
node --test shared/agents/codexCapacityGovernorV1.test.mjs shared/agents/meterAwareCodexDispatcher.test.mjs shared/agents/codexCapacityDashboardProjection.test.mjs
```

Result before publication:

```text
14 tests
14 passed
0 failed
```

Syntax proof:

```text
node --check shared/agents/codexCapacityGovernorV1.mjs
node --check shared/agents/meterAwareCodexDispatcher.mjs
node --check shared/agents/codexCapacityDashboardProjection.mjs
```

All passed.

This is source and deterministic-policy proof only. It does not claim that an authenticated Remote Codex browser has observed the live meter or redeemed a real banked reset.
