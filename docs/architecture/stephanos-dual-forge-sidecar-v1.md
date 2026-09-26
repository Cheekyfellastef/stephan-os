# Stephanos Dual-Forge Construction Sidecar V1

Issue: #1671

## Purpose

Stephanos should continue using GitHub while adding a self-hosted construction forge beside it. The sidecar increases build, test and review capacity without creating a second merge authority or replacing GitHub as the canonical public ledger.

V1 is a pure source-controlled planning contract. It installs no service, exposes no listener, creates no runner and publishes no branch.

## Authority split

| Capability | GitHub | Stephanos Forge sidecar |
| --- | --- | --- |
| Canonical public `main` | Authoritative | Read-only mirror/shadow |
| Public issues and final PR | Authoritative | Construction projection only |
| Protected final review and merge | Authoritative | None |
| High-volume branches and repair loops | Supported | Primary expansion target |
| Local test and artifact production | Supported | Primary expansion target |
| Force-push to GitHub | Prohibited | Prohibited |
| Runtime/deployment authority | Existing bounded paths only | None by default |

## V1 planner

`shared/agents/dualForgeConstructionSidecarV1.mjs` consumes a bounded snapshot containing:

- exact canonical GitHub `main` head;
- GitHub and Forge construction lanes;
- settled integration packets;
- already-published packet identities;
- one optional active integration packet;
- GitHub API limit, remaining budget, reserve, estimated publication cost and reset time;
- a bounded settle window.

It returns one deterministic decision:

- `DUAL_FORGE_BLOCKED`
- `DUAL_FORGE_BUILDING_IN_PARALLEL`
- `DUAL_FORGE_INTEGRATION_BUSY`
- `DUAL_FORGE_GITHUB_API_BUDGET_HELD`
- `DUAL_FORGE_PACKETS_SETTLING`
- `DUAL_FORGE_PACKET_READY_FOR_GITHUB_PUBLICATION`

The planner cannot execute its selected packet. Publication requires a separate fixed adapter with its own exact-head authorization and receipts.

## Integration-packet contract

A packet is eligible only when it is bound to:

- repository;
- construction lane and surface;
- exact canonical base;
- exact source head and tree;
- bounded changed-file estate;
- bounded proof references;
- explicit dependencies;
- settled timestamp;
- deterministic priority.

The planner rejects stale bases, duplicate packet identities, duplicate head/tree identities, unsafe paths, malformed proof references, unready lanes and mismatched lane/packet identities.

## Parallelism model

Construction is allowed on both surfaces at once. Publication remains serialized.

```text
GitHub lane 1 ─┐
GitHub lane 2 ─┤
Forge lane 1 ──┤
Forge lane 2 ──┼─> settle + deduplicate + reserve API budget ─> one GitHub packet
Forge lane 3 ──┘
```

A higher-ranked packet wins a changed-path conflict. Conflicting lower-ranked packets remain waiting and must be resynchronized or reconciled before publication.

## GitHub API budget

The reserve is protected for final hosted checks, independent review and merge evidence. A packet is held when:

```text
remaining - reserve < estimated publication cost
```

Holding publication does not block construction lanes. The planner returns GitHub's observed reset timestamp as the next eligible review point.

## Rollout

1. Merge and adopt the pure V1 contract.
2. Build a read-only Forgejo shadow in an isolated WSL2/VM/container boundary.
3. Prove Git object and tree parity with GitHub.
4. Add isolated Linux runners and a restricted Windows runner.
5. Build a fast-forward-only publication adapter.
6. Run two goals in shadow mode and compare exact outcomes.
7. Expand sidecar construction capacity while retaining one GitHub integration lane.

## Safety invariants

- no automatic merge or approval;
- no direct `main` write;
- no force-push, rebase, reset, clean, stash or branch deletion;
- no caller-supplied command, executable, path, environment or credential;
- no unrestricted runner on the Battle Bridge host;
- no duplicate scheduler, mission queue, source lease or truth store;
- no claim that local evidence is GitHub acceptance evidence;
- no Forgejo installation or runtime claim from this source slice.

## M2 read-only shadow parity contract

`stephanos.forge-shadow-parity.v1` admits no installation or runtime authority. It can call a future isolated Forge shadow ready only when the observed Git commit and tree equal canonical GitHub exactly, the mirror is fetch-only, writes/public exposure/runner registration are disabled, the service observation is fresh, and a current restorable backup is bound to the same repository head. Drift becomes `FORGE_SHADOW_PARITY_REQUIRED`; missing or stale backup proof becomes `FORGE_SHADOW_BACKUP_REQUIRED`; malformed or authority-bearing evidence fails closed.
