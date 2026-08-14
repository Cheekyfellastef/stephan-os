# Stephanos Forge Shadow M3 Runner Execution Receipt Adapter V1

## Purpose

This source-only adapter closes the truth boundary between the existing deterministic M3 runtime plan and a future separately authorised Battle Bridge runner executor.

It does not install, register, connect or execute a runner by itself. It orchestrates only a fixed host executor supplied by the connected Windows Battle Bridge and emits `FORGE_SHADOW_M3_RUNNER_CONSTRUCTION_PROVEN` with `canCarryRealWork: false` only after every planned runner returns a closed-world observation proving exact source identity, immutable artifact identity, the fixed isolation canary, complete teardown and zero residual authority. That receipt is historical construction-and-teardown proof, not current runtime-ready capacity, and is never routable as authority to carry work.

## Canonical inputs

The adapter accepts exactly:

1. the complete input to `planForgeShadowM3RunnerRuntime()`; and
2. one exact runtime authorization containing a canonical operator-approval receipt.

The adapter reruns the merged M3 admission and runtime planners. It never accepts a caller-authored object merely claiming that those plans are ready.

The runtime authorization and its closed-world approval receipt are bound to:

- repository `Cheekyfellastef/stephan-os`;
- exact canonical `main` head and tree;
- the SHA-256 digest of the complete canonical runtime plan;
- execution surface `CONNECTED_WINDOWS_BATTLE_BRIDGE`;
- an explicit issuance and expiry time no more than two hours apart;
- issuer `STEPHANOS_OPERATOR_APPROVAL_GATE` and decision `APPROVED`;
- an authorization-scoped immutable `proofs/operator-approvals/...` reference;
- a SHA-256 content digest covering the complete approval receipt;
- `m3Only: true`.

The approval receipt repeats the repository, head, tree, runtime-plan digest, authorization ID, execution surface, issue time and expiry. The adapter additionally requires a host-owned `STEPHANOS_OPERATOR_APPROVAL_VERIFIER`; that verifier must independently resolve the immutable approval proof and return a closed-world verification bound to the receipt digest and every execution identity. The verifier is an adapter dependency, never mailbox input. Missing, caller-forged, widened, mismatched, stale, replayed or content-digest-invalid approval evidence is rejected before either host executor is invoked. The adapter also validates the final prefixed receipt ID during preflight so a syntactically valid but oversized authorization ID cannot cause host work whose resulting receipt would be inadmissible.

No runtime execution is authorised by this source PR. A future live request must carry a newly issued authorization for the then-current merged head, tree and runtime-plan digest, and the connected Battle Bridge must supply its separately trusted immutable-proof verifier and durable atomic authorization reserver. A caller cannot satisfy either boundary by supplying another receipt-shaped object.

After independent approval verification and before the first runner invocation, the host-owned reserver must atomically reserve the authorization ID exactly once. Its closed-world attestation binds the reservation ID, derived receipt ID, approval digest, repository, head, tree, runtime-plan digest and trusted reservation time. A failed execution still consumes the authorization; retry requires a new operator authorization. Concurrent or sequential reuse is rejected before host mutation, preventing multiple runtime executions and conflicting evidence under one receipt identity.

## Runner observation contract

The adapter first proves that the canonical plan contains exactly the one Linux review runner and one isolated Windows proof runner supported by the routing receipt. Any wider otherwise-valid admission estate is rejected before approval verification or host execution; work cannot run successfully and then become unreceiptable. The host executor is called once for each supported runner identity. It cannot add runners, rename them or choose different artifacts, labels, boundaries, heads, trees or canaries. Each call receives a fresh invocation identity. Both the observation and termination acknowledgement must echo that invocation identity and the authorization identity, and the observation start must be no earlier than the trusted clock captured immediately before that invocation. Cached, replayed and cross-runner observations therefore fail closed.

Every returned observation must prove:

- the exact runner, pool and runtime-boundary identity;
- Forge service `stephanos-forge-shadow` at listener `127.0.0.1:3340`;
- repository-scoped registration bound exactly to `Cheekyfellastef/stephan-os`;
- the planned one-time-contained registration mode plus Forgejo `one-job` execution;
- a runner-scoped content-addressed registration proof included in the aggregate proof estate;
- exact source head and tree;
- exact runner-artifact and artifact-set digests;
- installation, repository-scoped ephemeral registration and connection;
- execution of canary `forge-shadow-m3-isolation-canary-v1` with scenario `EXACT_HEAD_ISOLATION_AND_TEARDOWN`;
- successful canary binding to the same exact head and tree;
- runner unregistration;
- registration-credential destruction;
- workspace and runtime-boundary destruction;
- zero residual registration, credential and workspace state;
- no credential logging or persistence;
- no public or Tailscale exposure;
- no canonical-checkout mount, container-socket mount or host-process access;
- no source mutation, Git ref write, merge, deployment or arbitrary-command authority; and
- one or more runner-scoped content-addressed proof references.

Each runner may return at most eight unique proof references. Because the canonical estate contains exactly two runners, the aggregate receipt accepts at most sixteen; a valid pair of eight-reference runner observations cannot execute successfully and then fail solely at receipt construction. Every authority-bearing array is closed-world as well as dense: its only own keys are `length` and the complete zero-based index estate, and every element must be a primitive string before it can enter an inert projection. Boxed strings and caller-owned objects are rejected rather than retained behind a frozen array shell. Every authority-bearing record is checked with its complete `Reflect.ownKeys()` estate as well, so enumerable, non-enumerable, named, symbolic, sparse or otherwise widened authority fails closed even when its projected values and content digest appear valid.

Every executor call receives a separate termination-proof gate before host work starts and must settle with exactly an observation and the same closed-world acknowledgement. The adapter materializes the returned observation once into an inert frozen projection; lifecycle timing, observation validation and quarantine classification all consume that same projection, so stateful accessors cannot present different teardown states to those decisions. Only an exact, identity-bound acknowledgement with successful termination and teardown assertions, a trusted non-future timestamp inside the invocation deadline, and ordering after every safely parsed lifecycle-completion boundary can open the gate. Both `teardownCompletedAtUtc` and `completedAtUtc` independently raise the acknowledgement floor; a malformed or hostile value in one cannot erase a safely parsed later boundary in the other. The boundary is preserved even when another observation predicate rejects that observation, so rejection can never lower the acknowledgement floor back to invocation start. Malformed, widened, mismatched, stale, future-dated or false candidates are retained only as blockers; they do not consume the gate, and the adapter remains pending until a later valid acknowledgement arrives.

The canonical runtime plan requires teardown within 300 seconds and quarantine on teardown failure. One teardown-policy assessment both emits every teardown blocker and classifies the corresponding observation as quarantine-required; terminal-return gating cannot diverge from validation. Missing or malformed teardown times, ordering violations, deadline overruns, incomplete destruction or non-zero residual state therefore switch the gate to a separate quarantine-proof channel. A normal termination acknowledgement cannot satisfy that channel. Terminal blocked return requires a later exact authorization-, invocation- and runner-bound acknowledgement with `quarantined: true`, `quarantineAcknowledged: true`, reason `TEARDOWN_POLICY_VIOLATION` and a content-addressed quarantine proof path containing those same runner, authorization and invocation identities. Missing, partial, replayed, wrong-identity or malformed quarantine evidence leaves the adapter pending.

Every post-dispatch failure path is subordinate to that gate. If execution rejects, fulfills with a malformed result, returns invalid observation or acknowledgement evidence, throws while a hostile fulfilled value is inspected, crosses the live deadline, or the trusted settlement clock throws, the adapter requests abort and cannot return a terminal blocked result until valid teardown proof is available. Proxy traps, nested getters, cyclic structures and trusted-clock exceptions are normalized to blocked evidence rather than escaping the lifecycle boundary: before dispatch they block execution, while after dispatch they cannot escape the termination-proof gate. A fresh trusted clock is captured after settlement; neither settlement, observation completion nor termination acknowledgement may exceed the computed live deadline, and termination acknowledgement cannot predate observation completion. The live executor deadline is the earlier of authorization expiry or one hour after the trusted invocation start. At that deadline the adapter requests abort and also awaits executor settlement, so a non-cooperative executor or missing valid acknowledgement keeps the adapter pending rather than publishing `runtimeMutation: false` while host authority is unknown.

Unknown fields and credential-, command-, path-, URL-, shell- or token-shaped fields fail closed.

## Receipt

A successful result emits:

`stephanos.forge-shadow-m3-runner-runtime-receipt.v1`

The receipt includes the exact source head and tree, artifact-set digest, fixed runner identities, immutable proof references, teardown proof, zero-residual-authority proof and its own content digest. Its identifier is derived from the validated authorization ID.

`validateForgeShadowM3RunnerRuntimeReceipt()` materializes one inert receipt projection, revalidates its complete own-key estate, dense arrays and content digest, and returns only that deeply frozen projection. Later Forge-aware routing therefore never receives the caller-owned object or rereads stateful accessors that could promote a mutated or widened receipt. Its exported inspection boundary is total: hostile proxies, getters, cyclic records and other caller-controlled inspection failures return `receipt-inspection-failed` rather than throwing into a router or adjudicator.

The receipt grants no continuing mutation authority. Its verdict is `FORGE_SHADOW_M3_RUNNER_CONSTRUCTION_PROVEN` and `canCarryRealWork` is always `false`: it records only that the exact authorised ephemeral construction-and-teardown path succeeded historically. It never represents current runtime-ready capacity and cannot route a future job; each future job requires fresh bounded execution and teardown.

## Security basis

Forgejo 15 documents that runner credentials are authentication secrets, that repository scope is the tightest registration boundary, and that ephemeral runners are removed after one job. It also requires `forgejo-runner one-job` for ephemeral runners and warns that host execution has no isolation.

The future host executor must therefore implement repository-scoped ephemeral registration and `one-job` execution inside the two canonical runtime boundaries. Host-mode execution, persistent runners and reusable registration credentials cannot satisfy this adapter.

Official references:

- <https://forgejo.org/docs/v15.0/admin/actions/registration/>
- <https://forgejo.org/docs/v15.0/admin/actions/security/>
- <https://forgejo.org/docs/v15.0/admin/command-line/>

## Remaining runtime boundary

This adapter deliberately does not fabricate the platform-specific host evidence it validates. The next source slice must implement the fixed Linux rootless executor and the isolated Windows proof executor, then wire this adapter into the existing issue #1507 Battle Bridge mailbox. Only after those source changes merge and sync may a separate exact-head operator authorization request real M3 execution.
