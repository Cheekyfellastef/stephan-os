---
name: redeem-banked-codex-reset
description: Redeem exactly one approved banked Codex rate-limit reset at the meter-aware governor's chosen time through an authenticated Remote Codex browser session.
---

# Redeem one banked Codex reset

Use this skill only when the Shared Agent Workspace contains a fresh, schema-valid action with:

```text
operation=REDEEM_BANKED_CODEX_RATE_LIMIT_RESET
finalVerdict=CODEX_BANKED_RESET_ACTION_READY
executionSurface=REMOTE_CODEX_AUTHENTICATED_BROWSER
fixedUiActionOnly=true
```

The action must identify one exact `resetId`, its expiry timestamp, a standing operator policy reference, and the latest safe execution time.

## Purpose

Banked resets are scarce, expiring capacity. Redeem the earliest-expiring reset only when the Meter-Aware Builder Mesh has proven all of the following:

- Codex is meter-stalled or at the conservative near-empty threshold;
- useful Codex-suitable work is queued and exceeds remaining capacity;
- no Codex task is active;
- the natural meter reset is not imminent;
- the selected reset is unexpired;
- the standing operator policy explicitly permits automatic redemption.

## Execution-surface preflight

This skill is valid only in an authenticated Codex app or Codex Remote browser surface that can see the current profile and usage summary. A GitHub `@codex` task, cloud checkout, ordinary shell, or detached browser is not a substitute.

Before interacting with the UI:

1. Re-read the current meter and reset list.
2. Confirm the selected reset is still the earliest-expiring available reset.
3. Confirm its displayed expiry matches the action packet.
4. Confirm no Codex task is currently active.
5. Confirm the action has not already produced a completion receipt.
6. Confirm the current time is before `latestSafeExecutionUtc`.

If any value differs, press nothing and return `BLOCKED_RESET_UI_MISMATCH` with a sanitized observation receipt.

## Fixed UI action

Use only the normal Codex profile and usage-summary controls:

```text
profile menu
→ usage summary / reset count
→ matching earliest-expiring reset
→ redeem/apply reset
```

Press exactly one reset control exactly once. Do not choose a later-expiring reset while an earlier one remains available. Do not navigate to unrelated account, billing, security, cookie, session, or credential surfaces.

Generic browser automation is forbidden. Do not execute arbitrary JavaScript, inspect or export cookies, read credentials, copy tokens, or reuse the browser session for another action.

## Revalidation before pressing

Immediately before the press, fail closed when:

- useful queued demand disappeared;
- the meter is no longer blocked or near empty;
- the natural reset moved into the configured imminent window;
- the selected reset expired;
- another participant already redeemed a reset;
- the standing policy is absent, expired, or mismatched.

## Proof after pressing

Capture only bounded, sanitized proof:

- meter state before redemption;
- reset count and selected expiry before redemption;
- confirmation that one reset was applied;
- meter state after redemption;
- reset count after redemption;
- timestamp and correlation ID.

Publish a durable Shared Workspace completion receipt before dispatching new Codex work. The receipt must state whether the meter increased and whether the selected reset disappeared from the bank.

## Failure outcomes

Return one exact blocker and press nothing further:

```text
BLOCKED_RESET_ACTION_MISSING
BLOCKED_RESET_POLICY_MISSING
BLOCKED_RESET_ACTION_EXPIRED
BLOCKED_RESET_UI_MISMATCH
BLOCKED_RESET_ALREADY_REDEEMED
BLOCKED_RESET_NATURAL_REFRESH_IMMINENT
BLOCKED_RESET_ACTIVE_CODEX_TASK
BLOCKED_RESET_CONFIRMATION_NOT_PROVEN
```

Never repeat the press after an uncertain response. An uncertain result requires observation and reconciliation, not another click.
