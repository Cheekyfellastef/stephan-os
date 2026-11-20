# Codex Banked Reset Operator Policy V1

## Standing operator intent

Stephan authorizes Stephanos to prepare automatic redemption of one banked Codex rate-limit reset when the Meter-Aware Builder Mesh proves the fixed policy conditions below.

This standing policy does not authorize arbitrary account interaction, browser use, purchases, upgrades, billing changes, credential access, or repeated reset presses.

## Allowed action

```text
REDEEM_BANKED_CODEX_RATE_LIMIT_RESET
```

## Required conditions

All conditions must be true at execution time:

- the current meter observation is fresh and high-confidence;
- Codex is meter-stalled or at the conservative near-empty threshold;
- useful Codex-suitable queued demand exceeds remaining capacity;
- no Codex task is active;
- the natural reset is not imminent;
- the selected banked reset is the earliest-expiring available reset;
- the displayed expiry matches the action packet;
- no completion receipt already exists;
- the fixed action has not expired.

## Execution boundary

Remote Codex may use only the authenticated Codex profile and usage-summary controls needed to apply the selected reset.

It must press exactly one matching reset control once and then stop.

## Required proof

```text
meter-before
selected-reset-id-and-expiry
single-redemption-confirmation
meter-after
remaining-reset-count
completion-receipt
```

## Fail closed

Any mismatch, uncertain response, active task, imminent natural reset, stale observation, missing policy, expired action, or already-consumed reset blocks the action.

```text
OPERATOR_POLICY_CODEX_BANKED_RESET_V1
FIXED_ACTION_ONLY
NO_GENERIC_BROWSER_AUTOMATION
NO_CREDENTIAL_OR_BILLING_ACCESS
```
