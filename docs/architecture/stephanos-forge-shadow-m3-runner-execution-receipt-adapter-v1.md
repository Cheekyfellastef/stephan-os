# Stephanos Forge Shadow M3 Runner Execution Receipt Adapter V1

## Purpose

This source-only adapter closes the truth boundary between the existing deterministic M3 runtime plan and a future separately authorised Battle Bridge runner executor.

It does not install, register, connect or execute a runner by itself. It orchestrates only a fixed host executor supplied by the connected Windows Battle Bridge and refuses to mint the canonical `FORGE_SHADOW_M3_RUNNER_RUNTIME_READY` routing receipt until every planned runner returns a closed-world observation proving exact source identity, immutable artifact identity, the fixed isolation canary, complete teardown and zero residual authority.

The canonical M2 Forge instance is not the M3 execution surface. M2 is deliberately sealed with Actions disabled and must remain that way. For each proof runner, M3 copies the content-addressed M2 backup into a disposable canary-only Forge instance, enables Actions only in that disposable copy, executes the exact canary, then destroys the canary instance and its data. This preserves the M2 security receipt instead of invalidating it to make M3 run.

## Canonical inputs

The adapter accepts exactly:

1. the complete input to `planForgeShadowM3RunnerRuntime()`; and
2. one exact runtime authorization.

The adapter reruns the merged M3 admission and runtime planners. It never accepts a caller-authored object merely claiming that those plans are ready.

The runtime authorization is bound to:

- repository `Cheekyfellastef/stephan-os`;
- exact canonical `main` head and tree;
- the SHA-256 digest of the complete canonical runtime plan;
- execution surface `CONNECTED_WINDOWS_BATTLE_BRIDGE`;
- an explicit issue and expiry time no more than two hours apart;
- `operatorApproved: true`; and
- `m3Only: true`.

No runtime execution is authorised by this source PR. A future live request must carry a newly issued authorization for the then-current merged head, tree and runtime-plan digest.

## Runner observation contract

The host executor is called once for each runner identity derived by the canonical plan. It cannot add runners, rename them or choose different artifacts, labels, boundaries, heads, trees or canaries.

Every returned observation must prove:

- the exact runner, pool and runtime-boundary identity;
- exact source head and tree;
- exact runner-artifact and artifact-set digests;
- installation, repository-scoped ephemeral registration and connection;
- creation of the disposable canary Forge from the exact M2 backup while the canonical M2 service remains sealed and unchanged;
- execution of canary `forge-shadow-m3-isolation-canary-v1` with scenario `EXACT_HEAD_ISOLATION_AND_TEARDOWN`;
- successful canary binding to the same exact head and tree;
- runner unregistration;
- registration-credential destruction;
- workspace and runtime-boundary destruction;
- disposable canary Forge destruction and, for Windows only, destruction of the temporary Hyper-V-internal relay;
- zero residual registration, credential and workspace state;
- no credential logging or persistence;
- no public or Tailscale exposure;
- no canonical-checkout mount, container-socket mount or host-process access;
- no source mutation, Git ref write, merge, deployment or arbitrary-command authority; and
- one or more runner-scoped content-addressed proof references.

Unknown fields and credential-, command-, path-, URL-, shell- or token-shaped fields fail closed.

## Receipt

A successful result emits:

`stephanos.forge-shadow-m3-runner-runtime-receipt.v1`

The receipt includes the exact source head and tree, authorization ID, runtime-plan digest, artifact-set digest, normalized fixed runner observations, immutable proof references, teardown proof, zero-residual-authority proof and its own content digest.

`validateForgeShadowM3RunnerRuntimeReceipt()` revalidates the closed-world shape and content digest so later Forge-aware routing cannot promote a mutated or widened receipt.

The receipt grants no continuing mutation authority. `canCarryRealWork: true` means the exact authorised ephemeral construction path has been proven; each future job still requires fresh bounded execution and teardown.

## Security basis

Forgejo 15 documents that runner credentials are authentication secrets, that repository scope is the tightest registration boundary, and that ephemeral runners are removed after one job. It also requires `forgejo-runner one-job` for ephemeral runners and warns that host execution has no isolation.

The runner process may use host execution only *inside* its already disposable outer boundary: the rootless Linux container or Windows Sandbox VM. Host execution on the canonical Windows Battle Bridge host remains forbidden. The canonical checkout, host container socket, GitHub credentials, public interfaces and Tailscale interfaces are never mapped into either boundary.

The future host executor must therefore implement repository-scoped ephemeral registration and `one-job` execution inside the two canonical runtime boundaries. Host-mode execution, persistent runners and reusable registration credentials cannot satisfy this adapter.

Official references:

- <https://forgejo.org/docs/v15.0/admin/actions/registration/>
- <https://forgejo.org/docs/v15.0/admin/actions/security/>
- <https://forgejo.org/docs/v15.0/admin/command-line/>

## Remaining runtime boundary

This adapter deliberately does not fabricate the platform-specific host evidence it validates. The runtime plan now contains the executable canary-Forge lifecycle and the source tree contains the fixed canary workflow. The next source slice must implement the fixed Linux rootless executor and the isolated Windows proof executor against this lifecycle, then wire the adapter into the existing issue #1507 Battle Bridge mailbox. Only after those source changes merge and sync may a separate exact-head operator authorization request real M3 execution.
