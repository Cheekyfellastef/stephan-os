# Starfield VR Operator Evidence V1

## Purpose

This contract gives Stephanos a single read-only product view of the remaining Starfield VR proof ladder without creating another launcher, runtime worker, headset executor, scheduler, mailbox, source registry, or implementation owner.

It belongs to product goals #1769 and #1595 under umbrella controller #1776. Construction-owned runtime proof remains construction-owned. Physical Quest 3 acceptance remains an explicit operator action.

## Evidence planes

The planner keeps three evidence planes separate:

1. **Source**: the Starfield VR source baseline and deterministic launch policy are bound to one exact 40-character Git head.
2. **Runtime**: in-game transition, overlay/dashboard observability, save rollback, and failure/remediation require external runtime receipts bound to the same exact head and a named runtime identity.
3. **Physical**: Quest 3 headset acceptance, controller/seated anchoring, and comfort/responsiveness require explicit operator receipt identities and may never be inferred from source or runtime state.

A missing source plane yields `PRODUCT_SOURCE_GAP`. Complete source evidence with missing runtime proof yields `CONSTRUCTION_RUNTIME_GAP`. Complete runtime evidence with missing physical proof yields `OPERATOR_PHYSICAL_TEST_REQUIRED`. `EVIDENCE_COMPLETE` means only that a complete, structurally valid supplied evidence set exists. It is not a live, installed, deployed, safe-to-merge, or safe-to-launch claim.

## Fail-closed rules

- Every supplied receipt must be `PASS` and bound to the exact assessed head.
- Unknown, duplicate, accessor-bearing, sparse, exotic, oversized, malformed, or cross-head evidence fails closed.
- Runtime evidence requires an explicit runtime identity.
- Physical evidence requires `deviceId: quest-3` and an explicit operator receipt identity.
- The contract cannot launch Starfield, install software, write saves, deploy, merge, approve, or mutate runtime state.
- The generated operator test plan is observation-only and exists only for missing physical fronts after the assessment has reached that plane.

## Relationship to existing Starfield and VR work

This is an evidence-convergence layer only. Existing Starfield VR orchestration, launch policy, reference catalogue, VR Research, Battle Bridge/runtime proof, save protection, overlay work, and Quest acceptance remain authoritative in their existing lanes. Their receipts may be referenced here once available; their implementation is not duplicated.

## Operator boundary

No physical-headset test is requested merely because this source contract exists. Stephanos should surface the Quest 3 test only after exact-head source evidence and construction-owned runtime evidence are complete and the only remaining blocker class is `OPERATOR_PHYSICAL_TEST_REQUIRED`.
