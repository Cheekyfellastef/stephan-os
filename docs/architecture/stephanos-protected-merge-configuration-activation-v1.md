# Stephanos protected-merge configuration activation v1

## Purpose

This source-only contract validates a detached-signature-bound live observation of the exact configuration that unblocked the protected personal-repository merge evidence path on 2026-08-12. It is an immutable activation proof and a deliberately main-changing review boundary after failed workflow run `31583116255`. It does not itself mint evidence, a token, call GitHub, dispatch a workflow, approve an environment, merge a pull request, mutate a ruleset, or grant runtime authority.

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

## Live-observation provenance

The configuration claim is not admissible from source constants alone. The zero-input evidence factory has been removed. An accepted envelope must carry the exact authenticated, TLS-verified live observation completed at `2026-08-12T11:30:58.556Z` across the GitHub ruleset, installation, App identity and App-permission surfaces. Its observer is read-only and external to the source contract.

The envelope is cryptographically bound by a detached Ed25519 signature. The verifier contains only the public key; the one-time private signing key was not retained or published. The signature covers the complete observation and provenance core, so a caller cannot substitute another observer, time, capture surface, repository, App value, ruleset value, failed run, transport claim or artifact identity. Replaying the one exact historical observation is allowed; manufacturing a new observation is not.

The provenance also binds the immutable independent review of the original exact source head:

- workflow run `31591316347`, attempt `1`;
- artifact `9139216442`, `stephanos-independent-review-31591316347-attempt-1`;
- archive digest `sha256:aec8620dc9e21a3cbf823bd641cede05a6872c341a2976c22cd1cc25eae3828f`;
- payload SHA-256 `f65acf7914bd1da17320438b3ac9f99f9207d357f8ed98bfdec906bb71236075`;
- reviewed head `5ac8a414c38400f7ff631cc3842bb79150b1c400` and base `ba10365b0c873398ebccc397f64358c7a01fb8cf`.

That artifact proves independent review identity; it is not substituted for the live observation. The detached signed receipt and immutable review artifact are separate required provenance layers.

## Permission and transport separation

GitHub requires the installation-level Administration write grant to return the complete configuration evidence used by the protected merge boundary. That installation grant is not transport authority. The source-controlled configuration-proof transport remains limited to `GET`, a null request body, redirect rejection, one exact repository, canonical paginated active-main rules, and positive-ID ruleset details. Credentials remain protected-environment, job-local values and may not be persisted, logged, artifacted, or forwarded between jobs.

The activation contract therefore binds both truths independently:

1. the live App installation has the exact grant required to retrieve complete evidence; and
2. the executor can exercise that credential only through its existing closed-world read transport.

## Fail-closed boundary

`validateOperatorProtectedMergeConfigurationActivation` accepts one canonical closed-world, signed evidence envelope. It rejects unsigned, self-issued, stale, malformed, widened or mismatched provenance; wrong receipt, run, attempt, artifact, archive digest or payload hash; and wrong or additional repositories, App identities, permissions, events, main identities, ruleset values, bypass actors, required checks, failed-run identities, methods, bodies, redirects, paths, or credential handling claims. Authoritative arrays must be dense and exact; sparse values are invalid rather than normalized.

The focused activation suite is part of `stephanos:operator-merge-approval:test`, the command executed by the required `protected-merge-source-proof` workflow. The proof can therefore no longer remain green while omitting these activation invariants.

This proof does not authorize rerunning `31583116255` or merging PR #1762. After this activation layer is independently reviewed and merged through a separately authorized protected gate, PR #1762 must be reconciled history-preservingly onto that new exact main and receive fresh exact-head proof before a new protected merge authorization.
