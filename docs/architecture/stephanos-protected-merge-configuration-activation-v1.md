# Stephanos protected-merge configuration activation v1

## Purpose

This source-only contract validates the closed-world shape of the configuration claimed to have unblocked the protected personal-repository merge evidence path on 2026-08-12. It is deliberately fail-closed: the claim is not activation proof unless an immutable receipt from a pre-existing, independently verifiable provider surface attests the live observation. No qualifying provider receipt currently exists, so the canonical result is `PROVIDER_PROOF_REQUIRED`. The contract does not mint evidence, a token, call GitHub, dispatch a workflow, approve an environment, merge a pull request, mutate a ruleset, or grant runtime authority.

The admission base is exact main `ba10365b0c873398ebccc397f64358c7a01fb8cf`, tree `f14ed0410a57ba07ca96b1c2ff1a11fcc5b7513d`. Run `31583116255`, attempt `1`, is preserved as a terminal failed same-base dispatch and must never be rerun.

## Exact live identity

- repository owner: `Cheekyfellastef`
- repository: `stephan-os`
- GitHub App name: `Stephanos Ruleset Proof Reader`
- GitHub App slug: `stephanos-ruleset-proof-reader`
- GitHub App ID: `4547243`
- installation ID: `152662199`
- repository selection: selected repositories only
- selected repository estate: exactly `Cheekyfellastef/stephan-os`
- repository permissions: exactly Administration write plus mandatory Metadata read
- event subscriptions: none
- pending installation permission update: false

Ruleset `20640195` remains active with no bypass actors. Its sole required status check is `protected-merge-source-proof`, bound to GitHub Actions integration ID `15368`.

## Provider-anchored provenance

The configuration claim is not admissible from source constants, a source-authored signing key, or a self-selected signature. The zero-input evidence factory and source-authored public-key trust anchor have both been removed. A future admissible envelope would need an immutable receipt whose provider surface predates and is outside this PR's source-author authority, and whose independently retrievable payload attests the live repository, App, installation, permission, selected-repository, event, pending-update, main, ruleset, integration and failed-run observation.

The pre-existing Independent Merge Security Review artifact for head `b1d7e9819dc975dc750fb0d7a41ccffb565ee95e` is immutable and independently retrievable, but it attests source review rather than the live GitHub configuration observation. The validator exact-checks that receipt's repository, observer, run, attempt, artifact, archive digest, payload hash, source head, base and observation identity, then still returns `PROVIDER_PROOF_REQUIRED`. Relabeling that receipt as a live-configuration attestation is rejected. This prevents source review from being widened into configuration authority.

The known source-review-only receipt is:

- workflow run `31592716405`, attempt `1`;
- artifact `9139766493`, `stephanos-independent-review-31592716405-attempt-1`;
- archive digest `sha256:03984ddf408ca7a1a5eb559f748c16be43b905d59cda54193f6e6fc8d2d6e147`;
- payload SHA-256 `619c10ccf7aa18852737dfcc3a69c2c3f996cc1dbafcec02e07c4b1a2991c599`;
- reviewed head `b1d7e9819dc975dc750fb0d7a41ccffb565ee95e` and base `ba10365b0c873398ebccc397f64358c7a01fb8cf`.

That artifact remains review evidence only. Until a separate provider publishes independently verifiable live-observation proof, this contract must not claim activation.

## Permission and transport separation

GitHub requires the installation-level Administration write grant to return the complete configuration evidence used by the protected merge boundary. That installation grant is not transport authority. The source-controlled configuration-proof transport remains limited to `GET`, a null request body, redirect rejection, one exact repository, canonical paginated active-main rules, and positive-ID ruleset details. Credentials remain protected-environment, job-local values and may not be persisted, logged, artifacted, or forwarded between jobs.

The activation contract therefore binds both truths independently:

1. the live App installation has the exact grant required to retrieve complete evidence; and
2. the executor can exercise that credential only through its existing closed-world read transport.

## Fail-closed boundary

`validateOperatorProtectedMergeConfigurationActivation` never throws on caller-controlled evidence. A bounded cycle-detecting canonical JSON inspection runs before any property access or hashing. Cycles, `BigInt`, symbols, functions, `undefined`, non-finite or negative-zero numbers, unsupported prototypes, getters, sparse arrays, hostile inspection traps, excessive depth, excessive nodes and oversized values are rejected without generating a digest. Only dense plain JSON records with data properties can reach the closed-world identity checks.

The current validator returns `valid: false`, `finalVerdict: PROVIDER_PROOF_REQUIRED`, a stable blocker and no evidence digest when external provider proof is absent or insufficient. It also rejects forged provider, repository, observer, run, attempt, artifact, archive digest, payload, head, base or observation identity; wrong or additional repositories, App identities, permissions, events, main identities, ruleset values, bypass actors, required checks, failed-run identities, methods, bodies, redirects, paths, or credential handling claims. Source constants and source-selected keys cannot mint a ready result.

The focused activation suite is part of `stephanos:operator-merge-approval:test`, the command executed by the required `protected-merge-source-proof` workflow. The proof can therefore no longer remain green while omitting these activation invariants.

This source repair does not claim that configuration activation has been proved, and it does not authorize rerunning `31583116255` or merging PR #1762. If the bounded source change is independently reviewed and merged through a separately authorized protected gate, PR #1762 must still be reconciled history-preservingly onto that new exact main and receive fresh exact-head proof before a new protected merge authorization.
