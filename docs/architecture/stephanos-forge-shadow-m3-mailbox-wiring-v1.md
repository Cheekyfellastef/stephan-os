# Stephanos Forge Shadow M3 Mailbox Wiring V1

Status: source-built, runtime-unproven

## Purpose

This slice completes the source path from issue #1507's one canonical Battle Bridge mailbox to Forge M3 artifact preparation and fixed proof execution. It adds no worker, poller, mailbox, issue, or execution lane.

The two operations are deliberately separate because preparation performs network downloads, a fixed Windows source build, and immutable cache writes, while proof execution installs short-lived runners, registers them against a disposable Forge, runs the exact canary, and tears everything down. Each action receives its own durable terminal mailbox receipt and operator-approved command.

## Operation 1: prepare artifacts

`PREPARE_FORGE_SHADOW_M3_ARTIFACTS`

The accepted command adds only:

- exact canonical main tree;
- distinct observation identity; and
- `m3Only=true`.

The handler binds repository, main head, tree, request identity, observation identity, actual execution time, operator approval, and M3-only scope into `prepareForgeShadowM3RunnerArtifacts`. Version, URLs, paths, signing key, toolchain, build flags, artifacts, and cache identity remain fixed in source.

Success is written to the existing canonical receipt directory under the mailbox's Windows-safe filename. The result contains the exact two resolver-compatible artifact observations and truthful cache receipt required by the next operation.

## Operation 2: execute M3 proof

`EXECUTE_FORGE_SHADOW_M3`

The accepted command adds only:

- exact canonical main tree;
- durable M2 and artifact-preparation request IDs;
- distinct runtime-authorization identity;
- exact runtime-plan digest;
- plan/authorization issue time;
- runtime expiration no more than two hours later and no later than command expiration; and
- `m3Only=true`.

The handler reads both referenced receipts from the one existing canonical mailbox receipt root. Regular-file, size, JSON, schema, request, operation, DONE-state, source-head/tree, envelope, and verdict identities are checked before either receipt is used. M2's canonical planner then independently revalidates the full sealed-M2 result, including head/tree parity, immutable backup, disabled Actions, no registered runner, no credential use, and readiness for M3.

The runner pools are not caller-authored. Source fixes exactly:

- three rootless ephemeral Linux construction runners; and
- one Windows Sandbox proof runner.

Artifact digests come only from the accepted preparation receipt. The canonical admission and runtime planners are replayed, and their computed runtime-plan digest must equal the operator-authorized digest in the command before the fixed executor can be created.

## Execution and receipt boundary

The runtime authorization passed to `executeForgeShadowM3RunnerPlan` is reconstructed from the accepted mailbox command with:

- exact repository, head, tree, plan digest, authorization identity and time window;
- fixed execution surface `CONNECTED_WINDOWS_BATTLE_BRIDGE`;
- explicit operator approval; and
- M3-only scope.

The existing execution adapter and fixed executor still enforce every runner identity, artifact digest, disposable-canary lifecycle, repository-scoped ephemeral registration, exact canary, teardown, proof reference, canonical-M2 immutability, and zero-residual-authority postcondition.

The terminal mailbox receipt preserves M3 head, tree, referenced prerequisite request IDs, authorization ID, plan digest, plan time and runtime expiration. It continues to deny arbitrary shell, destructive Git, credential export, arbitrary browser automation, live OpenClaw update, merge and deployment authority.

## No runtime claim

This source slice does not post either command and does not prepare, install, register, connect, execute, merge, or deploy anything live. Actual preparation requires a merged exact-main checkout and a fresh owner-authored operation-1 command. Actual runner proof additionally requires valid current M2/preparation receipts and a fresh owner-authored operation-2 command whose exact plan digest matches canonical replanning.
