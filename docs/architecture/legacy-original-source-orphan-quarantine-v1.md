# Historical #2962 r7 orphan quarantine readiness (high risk, unreleased)

This is a **source-only read/verification capability** for the *single* known original missing-receipt attempt `critical-2962-elastic-goal-r7-lease`.

Current repository's ordinary original-source quarantine requires a genuine terminal execution receipt, source result pair and authentic source-writer exclusion. Those are not proven historically for r7, so existing canonical release must continue to HOLD.

## Proposed exceptional rule, not a runtime bypass

`authenticateLegacyOrphanQuarantine` checks two independently pinned Ed25519 public keys that must live outside the checkout: a protected Windows machine OS-custody witness and a separate operator authorisation root. The witness must attest to **current** (not historical) source exclusion and actively enforced denial of further writes, including old process identities, WMI/COM, scheduled tasks and source ACLs. The second signer approves that exact evidence digest and lease, without claiming the original execution ever completed. Distinct principals, exact #2962 r7 binding, protected evidence log identity, signed times, and bounded freshness are required. Missing evidence always holds.

Critically, signatures over booleans and timestamps are **only proofs of authenticated assertions**, not independently verified physical Windows behaviour or trusted wall-clock anchoring. A qualified OS specialist must implement and independently verify the privileged witness, protected audit log, actual ACL and process/job inspection, signed anti-replay timestamp and install/permission posture. The operator signing key must not be accessible by that service or the source worker. The source checkout and its observed eight changed files must remain intact.

**No canonical lease release, no cancellation event, no process termination, no privileged service installation and no new worker route are implemented by this bounded module.** The authenticated result explicitly denies release and mutation authority. Later, after qualified specialist approval, this trusted read-only guard may be integrated into an exceptional v2 fence under the existing mission and lease locks. That integration must preserve the original r7 lease digest, durable operator cancellation audit, no active queue, and atomic compare-and-release. Historical outcome stays `UNKNOWN`, never auto-`completed`.

This module cannot on its own restart autonomous builds; real Windows installation, physical quarantine, qualified independent review and canonical lease release are separate remaining gates.

## Guarded integration under the existing mission and lease locks

The single exact #2962 revision-7 owner-approved cancellation command now accepts an explicit `legacyOrphanQuarantineRequested:true` flag. The command remains identity/digest/revision-bound, with no input-supplied receipt, paths, signer or arbitrary process operation. The original mission-store lock and atomic cancellation audit remain mandatory. The exceptional v2 fence stores `historicalExecutionOutcome:UNKNOWN`, not a synthetic terminal receipt. The held r7 history must be verifiably empty (not unreadable or active), the canonical source-execution identity must still come from consumed mission state, all known queues must be idle, OS and operator attestations must be fresh, and the entire lease is re-read for exact CAS before durable cancellation.

Only the existing canonical cancelled-mission lease reconciler can release; its authenticated v2 fence check independently re-reads original history, queues, signed independent evidence and the unique durable operator event under the existing mission lock. If any proof is absent or stale, release HOLD. The new verifier does not supply any historical success, execution, source, deployment or merge authority.

**Production commissioning and qualified high-risk specialist approval are still absent.** A signed claim alone does not verify Windows rights or trustworthy timestamps. This source cannot yet be merged or used to release the lease without real independently trusted OS witness provisioning and specialist review.
