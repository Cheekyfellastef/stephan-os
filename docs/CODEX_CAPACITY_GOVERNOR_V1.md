# Codex Capacity Governor V1

## Mission

Treat Codex capacity as a scarce, measurable implementation budget rather than a binary available/unavailable switch.

Stephanos should:

- observe the current Codex meter and natural reset time;
- record banked rate-limit resets and their individual expiry times;
- learn how much meter different task classes consume;
- preserve capacity reserves for exact-head review, emergency repair, and Windows runtime proof;
- route zero-cost work to ChatGPT plus GitHub, OpenClaw, Local AI, or the Battle Bridge;
- dispatch Codex only when the next task fits inside safely schedulable capacity;
- predict the effect of Codex constraints on verified capability delivery speed;
- surface the result through a human-readable dashboard projection.

## Source components

```text
shared/agents/codexCapacityGovernorV1.mjs
shared/agents/meterAwareCodexDispatcher.mjs
shared/agents/codexCapacityDashboardProjection.mjs
.codex/skills/redeem-banked-codex-reset/SKILL.md
```

## Meter observation

A meter observation records:

```text
observedAtUtc
remainingPercent
availability
naturalResetAtUtc
bankedResets[]
source
confidence
```

The observation is sanitized. It never contains cookies, tokens, credentials, browser-session material, or arbitrary account data.

## Consumption learning

Every completed Codex task should produce a capacity receipt containing:

```text
taskClass
model
executionSurface
filesInspected
filesChanged
durationMinutes
repairIterations
meterBeforePercent
meterAfterPercent
observedConsumptionPercent
outcome
capabilityValue
```

The cost model uses observed P50 and conservative P80 consumption by task class. Until enough samples exist, deterministic conservative defaults are used.

## Routing policy

Codex is reserved for work where it creates disproportionate value:

- focused specialist repair;
- multi-module implementation;
- one necessary exact-head review;
- Windows runtime work that cannot be completed through bounded Battle Bridge machinery.

The following should normally avoid Codex:

- status polling;
- unchanged-head re-review;
- architecture and planning that ChatGPT can perform;
- deterministic GitHub operations;
- local health and proof checks;
- trivial source changes that ChatGPT plus GitHub can complete safely.

## Capacity reserves

V1 protects:

```text
10% emergency repair
8% exact-head review
7% Windows runtime proof
```

These are initial policy values. They should later adapt from observed demand and successful task history.

## Banked reset policy

Banked resets are consumed in earliest-expiry order.

A reset is eligible for automatic redemption only when:

- a standing operator policy authorizes the fixed action;
- Codex is meter-stalled or at the conservative near-empty threshold;
- useful Codex-suitable queued demand exceeds remaining capacity;
- no Codex task is active;
- the natural reset is not imminent;
- the selected reset is unexpired and still matches the UI;
- no completion receipt already exists.

The governor does not assume that applying a reset preserves unused allowance. It therefore defaults to holding resets while meaningful current capacity remains.

Remote Codex may perform only this fixed action:

```text
REDEEM_BANKED_CODEX_RATE_LIMIT_RESET
```

It presses exactly one matching reset control once, captures bounded before/after proof, and publishes a completion receipt before any new Codex dispatch.

## Stack velocity

Only verified capability slices count toward movement up the stack. A slice should eventually require:

- merged source;
- deterministic proof;
- runtime acceptance when required;
- Shared Workspace publication;
- Goal Dashboard visibility;
- capability-registry discovery.

V1 forecasts:

```text
current verified slices/week
estimated slices/week without Codex
estimated slices/week after planned OpenClaw uplift
current primary constraint
confidence
```

This is a planning signal, not false precision. Confidence remains low until sufficient verified history exists.

## Guardrails

- No arbitrary browser automation.
- No cookie, credential, token, or session access.
- No reset press without a valid standing policy.
- No repeated press after an uncertain UI response.
- No Codex status polling.
- No automatic merge.
- No exact-head approval bypass.
- No fabricated meter or task-consumption data.
- Unknown capacity remains unknown and blocks dispatch.

## Acceptance marker

```text
METER_AWARE_BUILDER_MESH_V1_SOURCE_READY
CODEX_CAPACITY_IS_MEASURED_AND_FORECAST
ZERO_COST_ROUTES_ARE_PREFERRED
BANKED_RESETS_ARE_EXPIRY_AWARE_AND_BOUNDED
STACK_VELOCITY_IS_PROJECTED_FROM_VERIFIED_SLICES
```
