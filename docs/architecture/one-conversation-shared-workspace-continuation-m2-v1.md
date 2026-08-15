# One Conversation Shared Workspace Continuation M2 V1

Parent product goal: #1630
Product umbrella: #1776

## Purpose

Advance the merged One Conversation Surface M1 continuity contract into the existing #1506/#1290 Shared Workspace `MESSAGE` path without creating another conversation bus, participant, store, scheduler, dispatcher, worker, mailbox, runtime executor or provider transport.

This is a source-only continuation codec. It proves how one already-current M1 continuity projection can become a bounded continuation request and how one destination acceptance can become a read-only continuation receipt. It does not write a Shared Workspace record, create a destination thread, execute a conversation, mutate a runtime or claim cross-device continuity.

## Exact source base

This lane was started only after fresh ownership reconciliation proved that the earlier implementation request on #1630 had received a Codex usage-limit terminal response and had created neither its reserved branch nor a pull request.

The same canonical M2 lane was then repinned to:

```text
repository = Cheekyfellastef/stephan-os
base/main = 87a85f3a89c4d144c88986404594e4a2773791ca
base tree = efbec7d846633c1094543711386a251eb938f037
branch = agent/one-conversation-shared-workspace-continuation-m2-v1
merged M1 source blob = 294b13f91255d5f27ca58062a3d7c7551f87abcd
```

No duplicate branch, PR, participant or implementation owner was created.

## Exact estate

The M2 lane adds exactly three files:

1. `shared/agents/oneConversationSharedWorkspaceContinuationV1.mjs`
2. `shared/agents/oneConversationSharedWorkspaceContinuationV1.test.mjs`
3. `docs/architecture/one-conversation-shared-workspace-continuation-m2-v1.md`

No existing file is modified.

## Canonical machinery reused

The adapter imports and calls the merged M1 `planCrossSurfaceContinuationV1()` planner. The M1 projection remains the authority for current continuity, source thread identity and source proof evidence.

The adapter also reuses the existing Shared Workspace record contract:

```text
schemaVersion = shared-agent-workspace-record.v1
kind = stephanos.shared_workspace.record.message
```

Every produced request or acceptance object must pass the existing `validateSharedWorkspaceRecord()` validator before it is considered source-ready.

The adapter exports no filesystem writer, workspace publisher, network call, provider API, mailbox operation, scheduler, dispatcher, worker or runtime executor.

## Continuation request

`createOneConversationContinuationRequestV1()` accepts exactly:

- a retained M1 projection;
- exact `fromSurface` and `toSurface` identities;
- one canonical request timestamp;
- canonical owner `#1630`;
- optional bounded request proof references.

It calls `planCrossSurfaceContinuationV1()` against a trusted evaluation clock before producing any request. A blocked, stale, conflicting or otherwise invalid M1 plan cannot be converted into a Shared Workspace request.

The request preserves the exact five continuity identities:

```text
stephanosIdentityVersion
operatorRelationshipContextRef
intentId
missionId
memoryAuthorityRef
```

It also retains:

- exact source surface;
- exact destination surface;
- exact source thread;
- canonical M1 source proof refs;
- the known destination thread and its M1 proof refs when already proven;
- an explicit `destinationThreadCreationRequired` flag when no destination thread is yet proven;
- request correlation lineage.

The packet carries references only. It has no unrestricted transcript field, raw prompt/response field, local path, shell command, credential or provider token field.

## Destination proof semantics

A continuation request never turns a desired destination thread into a fact.

When M1 already proves a destination thread, the request carries that exact thread and its canonical M1 destination proof refs. Any acceptance for another thread is rejected.

When M1 has no destination thread, the request records only that destination-thread creation still requires proof. A later acceptance must provide one exact destination thread, one current canonical observation timestamp and one or more bounded proof refs before the codec may produce a read-only continuation receipt.

The acceptance remains an existing-kind Shared Workspace `MESSAGE`; constructing it is still planning/source state and is not a Workspace write.

## Content-addressed lineage

Request and acceptance message identities are derived from canonical data-only payloads using SHA-256. A retained message identity with different semantic content therefore fails recomputation rather than becoming a conflicting replay.

The request `correlationId` is its own content-addressed request ID. The acceptance `correlationId` must point to that exact request. The read-only receipt binds both message IDs, both surfaces, all five continuity identities, source and destination threads, and the exact source/destination proof inventories.

Caller-supplied request proof refs may augment the request record but can never replace the canonical M1 source proof refs.

## Hostile-input boundary

Every public input is recursively descriptor-snapshotted before routing, hashing, serialization or iteration. The snapshotter uses own-property descriptors and rejects unsafe structures without reading accessor values.

It fails closed on:

- accessor-backed values;
- functions and own `toJSON` functions;
- symbol keys;
- sparse or widened arrays;
- custom object or array prototypes;
- reserved prototype-shaping keys;
- non-finite numbers;
- excessive depth, node count, array size, string size or serialized size;
- revoked or otherwise uninspectable proxies.

All route and lineage decisions consume only the inert captured snapshot.

## Freshness and timestamps

Production evaluation uses the host clock. Tests may inject an exact clock only under Node's test context.

Request and destination observation timestamps must be canonical ECMAScript ISO strings, within the fixed future-skew boundary and within the one-hour current-record window. Stale, future-dated or out-of-range timestamps fail closed.

## Authority boundary

Every request, acceptance and receipt keeps these capabilities false:

```text
sourceMutationAllowed=false
commandExecutionAllowed=false
approvalAllowed=false
mergeAllowed=false
deploymentAllowed=false
runtimeMutationAllowed=false
accountMutationAllowed=false
providerMutationAllowed=false
spendingAllowed=false
```

The authority source remains the already-governed task and approval contracts. The codec does not create authority by itself.

## Focused proof

The bounded product proof is:

```bash
node --check shared/agents/oneConversationSharedWorkspaceContinuationV1.mjs
node --test shared/agents/oneConversationSurfaceV1.test.mjs shared/agents/oneConversationSharedWorkspaceContinuationV1.test.mjs
git diff --check
```

The new tests cover:

- `CHATGPT_WEB -> BATTLE_BRIDGE_DESKTOP` continuation request;
- a newly proven destination thread;
- an already-known exact destination thread;
- deterministic/idempotent content identity;
- conflicting replay rejection;
- substitution of every continuity identity;
- request/correlation/surface/thread tampering;
- stale and future source/destination evidence;
- missing and unsafe proof evidence;
- canonical M1 proof retention;
- top-level and nested authority smuggling;
- accessors and `toJSON` with zero caller-code execution;
- symbols, cycles, sparse arrays, custom prototypes and revoked proxies;
- validation through the existing Shared Workspace record contract;
- absence of transcript, secrets, credentials, local paths, shell content and provider tokens.

Hosted exact-head workflows and independent semantic review remain authoritative after publication.

## Acceptance boundary

This M2 source can only become merge-ready after exact-head hosted proof, independent review and review-thread reconciliation are clean, followed by a separate protected exact-head merge authorization.

A future live acceptance step must separately prove that the existing #1506/#1290 runtime path transported a real continuation request and destination acceptance without Stephan acting as courier. That future step must bind exact served/runtime evidence and is not claimed here.

No merge, deployment, install, Shared Workspace write, runtime mutation, external account action, spending action or physical-device action is performed by this slice.
