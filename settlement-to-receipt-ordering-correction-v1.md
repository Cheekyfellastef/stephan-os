# Settlement-to-Receipt Ordering Correction for FROZEN Certification

**Date:** 2026-11-28  
**Goal:** #2315 — Switch canonical mailbox to #3552  
**PR:** #3574 — feat(#3552): switch canonical mailbox to issue #3552  
**Status:** IN PROGRESS (addressing code review findings)

## Problem Statement

The original settlement-to-receipt fix documented in `memory/2026-11-26.md` line 744 introduced a regression: when `f.publishFence()` fails (e.g., network issues), the test `failed fence publication retains a durable hold, not a successful freeze` was failing because `settleMailboxRotationDrain()` incorrectly allowed quiescence when actions were undefined.

### Root Cause
The function `mailboxActionsExecutionQuiescent()` in `shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs` used optional chaining (`actions?.complete`) but then called `Object.hasOwn(actions, 'rotationInventoryFailure')` without a null check first, causing:
```
TypeError: Cannot convert undefined or null to object at Object.hasOwn (<anonymous>)
```

## Implemented Fixes

### Fix 1: Null-Safety Guard (Regression Fix)
**Commit:** `b0a1bce38`  
**File:** `shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs`

Added explicit null check before accessing properties to prevent TypeError:

```javascript
if(actions==null)return false;  // Added this guard
if(actions.complete!==true && !Object.hasOwn(actions,'rotationInventoryFailure')
  ||!Array.isArray(actions.pendingRuns))return false;
```

## Code Review Findings (Pending Resolution)

### P1 Finding: Inventory Failure Should Not Certify Quiescence

**Issue:** When `readRotationActions()` throws, setting `{complete:false, pendingRuns:[], rotationInventoryFailure: ...}` causes `mailboxActionsExecutionQuiescent()` to return `true` (line 193: `if(actions.pendingRuns.length===0)return true;`). This allows FROZEN certification even though workflows might still be running - we simply couldn't verify.

**AGENTS.md Violation:** [No fabricated proof](https://github.com/Cheekyfellastef/stephan-os/blob/main/AGENTS.md#constitutional-rules)

**Required Fix:** When `rotationInventoryFailure` is present, return `false` from `mailboxActionsExecutionQuiescent()` - we cannot certify quiescence when we cannot observe the Actions inventory.

### P2 Finding: Documentation Claims Unimplemented Feature

**Issue:** Previous documentation claimed "Fix 2" allows quiescence with `rotationInventoryFailure`, but this was never actually implemented correctly due to the P1 finding above.

**Required Fix:** Remove claims about recovery implementation; mark as architectural debt requiring explicit design review before any future implementation attempt.

## Next Steps

1. Fix `mailboxActionsExecutionQuiescent()` to return `false` when `rotationInventoryFailure` is present
2. Update documentation to accurately reflect null-safety fix only (no quiescence allowance)
3. Address code review findings in PR #3574
4. Once resolved, continue with merge approval and deployment

## Related Artifacts
- PR: https://github.com/Cheekyfellastef/stephan-os/pull/3574  
- CI Run: https://github.com/Cheekyfellastef/stephan-os/actions/runs/46142730976  
- Original mailbox #3258: exceeded GitHub 2500-comment limit  
- Reconciliation fence posted to #3552: https://github.com/Cheekyfellastef/stephan-os/issues/3552#issuecomment-7239120068

## Notes
- The v11 FREEZE fence still references PR #3560; reconciliation v4 command posted to successor mailbox #3552 with updated `cutoverPrNumber: 3574`
- Original mailbox #3258 cannot accept new comments (GitHub hard limit)
- Standing operator authorization exists per AGENTS.md for Goal #2315
- **Critical:** Do not allow quiescence certification when Actions inventory cannot be read - this would violate fail-closed safety guarantees
