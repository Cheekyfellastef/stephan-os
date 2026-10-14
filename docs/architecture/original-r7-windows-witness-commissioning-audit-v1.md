# Original r7 independent Windows custody witness: commissioning audit V1

Parent: #2961, original attempt #2962 revision 7. This design deliberately keeps **diagnostics**, **physical Windows custody**, **cryptographic approval** and **canonical lease reconciliation** separate.

## Scope of this PR

- Add `scripts/windows/audit-original-r7-witness-commissioning-readonly.ps1`: fixed no-argument Windows PowerShell 5.1 census for service `StephanosOriginalR7CustodyWitness`, the exact `critical-2962-elastic-goal-r7-lease` process-candidate count, and number of Stephanos scheduled tasks. It emits one redacted JSON observation. It does not emit command lines, PIDs, accounts, private paths, tokens or public/private key data.
- Add `shared/agents/originalR7WitnessCommissioningAuditV1.mjs`: strict bounded-time, exact-identity projection of that observation into explicit gaps. A running service and zero visible process candidates **never grant** an OS exclusion witness, actual signer, lease release, source mutation, operator approval or real building.
- Tests cover absent/stopped service, unknown inventory, forged/caller-supplied privilege flags, stale/mismatched identities and prohibited Windows mutations.

The audit is **not an independent witness service**. It cannot prove all writers stopped, negative write tests, WMI/COM/task denial or enforce an ACL. Its precise purpose is to identify the outstanding native host commissioning steps without accidentally accepting untrusted inventory as a privileged receipt. This code has no installer, signer or source change under the original r7 custody lease.

## Actual native witness service required next

The real production component must be a **separately installed and protected Windows service**, outside the Stephanos source tree, with one narrowly commissioned SID and an OS-protected signing key that neither source builder nor Core daemon can read or invoke freely.

Required provisioning and independent assurance:

1. Preserve the real Battle Bridge checkout and all eight previously observed dirty entries. Capture exact source identity, original `r7` lease digest and custody history from the canonical mission/lease store with immutable timestamps. Do not infer old execution success from current process state.
2. On a separately authorised protected Windows session, commission `StephanosOriginalR7CustodyWitness` under its own dedicated service principal with least privilege and enforce protected audit log / configuration ACLs. Its signer key must be outside the repository, GitHub, relay, source-worker, OpenClaw and user-writable locations. Prove the actual token SID, service executable identity, permissions and inability of ordinary source writers to use its key.
3. Independently identify the **exact original source writer principals**, all direct descendants and eligible out-of-job launch routes. Enforce prospective denial at the OS boundary: exact original worktree ACL, job/process ownership, scheduled task and service re-entry, WMI/COM and direct starts. Verify with actual negative attempts for each applicable route and a positive control showing that unrelated Stephanos and gaming remain functional. If any original principal can still mutate source, refuse attestation.
4. Repeat the physical checks after a bounded observation interval with trustworthy Windows event/audit instrumentation; bind the non-spoofable evidence log and deny-policy digest, exact lease/mission/execution ID, worktree, branch, head and current timestamp. Fail closed if a route is unobservable, protection expires, checkout changes unexpectedly, or proof depends solely on process count or boolean flags.
5. Only after **independent security specialist review of the actual service code, signer isolation and host ACLs**, allow the protected service to create an Ed25519 OS witness signature domain `stephanos.legacy-orphan-os-witness.v1\0` with the exact claims required by `stephanos-server/services/legacyOriginalSourceOrphanQuarantineV1.js`. Never allow the caller to provide allegedly observed booleans or signing keys.
6. A distinct protected operator signer, independent of the witness service and source worker, reviews the exact evidence digest, approves **quarantine original execution only**, and signs under `stephanos.legacy-orphan-operator-approval.v1\0`. Neither signature is a reconstructed historical completion receipt. Keep private keys, trusted public-key pins, and protected evidence files outside checkout and mailbox.
7. Existing `authenticateLegacyOrphanQuarantine`, exact mission/store lock, durable cancellation audit and lease CAS reconciler must all verify the latest evidence. An authenticated **eligibility-only** witness cannot release the lease by itself. Only the existing canonical cancellation/reconciler may do so, with a separate scoped operator approval.
8. Following legitimate release, prove real work selection, claim, **physical pickup**, source edits, tests, protected merge, deployment and two unattended refill cycles. Independent Seed Canopy and Rescue Island remain separate and should operate on disjoint unclaimed work while this repair proceeds.

## Acceptance before live commissioning

- Independently reviewed Windows service source, pinned executable bytes, dedicated service SID, auditable least-privilege host deployment, isolated keys and negative tests for all writer-reentry routes.
- Machine-sourced, independently protected evidence for actual Windows ACL denial and out-of-job writer non-access. No raw paths, tokens or PIDs in public receipts.
- Independent signing roots: signer cannot use operator key, operator cannot use witness service key, worker cannot use either.
- Signed current original-r7 bound attestation accepted by existing verifier with `eligibilityOnly=true`, `leaseReleaseAuthority=false`, historical outcome `UNKNOWN`. Stale/replayed/mismatched records rejected.
- No new generic executor or controller, no source checkout mutation, no force-push, no unqualified service installation, no skipped specialist/protected approval.

## Status boundary

This PR builds a **first read-only commissioning audit**, not the privileged service. The source can merge only after independent review; no Windows task/service/ACL installation should run from this change. The original lease remains on HOLD until the *separate* actual native issuer, operator signing and canonical reconciliation are verified.
