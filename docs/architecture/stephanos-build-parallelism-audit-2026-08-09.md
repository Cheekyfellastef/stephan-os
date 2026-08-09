# Stephanos build parallelism audit — 2026-08-09

## Audited identity

- Repository: `Cheekyfellastef/stephan-os`
- Exact audited `main`: `3a230d521c62d7b01454ca0fbe97340441c3a39d`
- Governing goal: #1637, Elastic Five-Lane Build Fabric and Signed Authority Records V1
- This slice changes source planning, monitoring and hosted proof concurrency only. It grants no merge, deployment, runtime mutation, approval, provider-switching or arbitrary-command authority.

## Bottlenecks found and widened

| Surface | Audited bottleneck | Repair in this slice |
| --- | --- | --- |
| Bounded construction controller | Default capacity was four (`DEFAULT_MAX_LANES = 4`) | Default capacity now derives from the canonical five-lane minimum; the existing atomic reservation and ownership-conflict checks remain authoritative |
| Mission Scheduler V1 | More than one otherwise-valid active lane produced `MULTIPLE_ACTIVE_LANES` and blocked the whole portfolio | Up to policy-bounded resource-disjoint active lanes remain authoritative; missing scope, duplicate resource ownership and width overflow fail closed; ready work exposes a resource-scoped parallel candidate batch |
| Build Concierge V9 | Multiple active lanes were blocked solely by count and only one modeled execution lane was surfaced | Explicitly scoped active lanes and candidates can fill the elastic admission width; conflicting, unscoped and overflow candidates remain held; the projection still executes no command or dispatch |
| Monitor Multiplexer | Handler concurrency defaulted to four while the programme baseline is five | Default bounded handler concurrency is five; the existing maximum of sixteen, timeouts, isolated handler failure and durable notification rules remain intact |
| Build Stephanos UI workflow | Routing, runtime, surface, VR and build/verify work all ran sequentially in one job | Five independent exact-head jobs now run concurrently: scheduler, runtime guardrails, surface/ignition, VR research, and build/verify; stateful suites remain serial inside their isolated job |

## Canonical elastic-width behavior

- Healthy running baseline: five lanes.
- Policy maximum: sixteen lanes for this V1 source contract.
- Width increases only for ready independent work with available executor capacity.
- Parallel admission requires explicit resource identity.
- A resource can have only one active owner.
- Capacity contradictions, malformed scopes, sparse inventories and unsafe resource identifiers fail closed.
- Capacity projection is advisory and grants no mutation authority.

## Serialization that must remain

These are not throughput defects. They are the smallest authority-bearing shared resources and must remain serialized unless a stronger proven protocol replaces them.

- exact-head review mutation for one PR;
- merge or ref update of `repo:Cheekyfellastef/stephan-os:main`;
- one Battle Bridge live checkout/runtime mutation owner;
- one Edge/browser proof session for the same experience resource;
- atomic construction-lane reservation for the final capacity slot;
- append ordering for one Shared Workspace JSONL stream;
- one generated `apps/stephanos/dist` artifact writer inside a build job;
- the current Critical Backlog Conveyor, whose ordered missions encode prerequisite order rather than independent work.

Unrelated PRs, goals, monitors, proof families and resource scopes may proceed concurrently around those boundaries.

## Audited follow-up boundaries

`automatedCodexDispatcher.mjs` still selects one ready record with `find()`. It is not widened in this slice because it performs a real provider dispatch and its V1 queue records do not yet carry a trusted signed resource lease or executor-capacity receipt. Parallelizing that call from caller-supplied booleans would create duplicate-provider and duplicate-writer risk. It should be widened only after #1637's signed recoverable lease contract is the authority input.

The Vite build itself remains one writer because all stages materialize the same exact-head dist artifact. The latency repair is to run independent proof families beside it, not to create competing dist writers.

## Reusable invariant

> Parallelize independent preparation and proof; serialize only the exact authority-bearing resource being mutated.

This invariant replaces the legacy global rule that Stephanos may have exactly one active implementation lane.
