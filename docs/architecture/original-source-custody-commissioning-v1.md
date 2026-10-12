# Independently commissioned Windows source custody trust root (#2961 / PR #3023)

## Missing production capability

The existing Ed25519 custody receipt verifier does not create receipts. On the real Battle Bridge there is no independent OS-privileged isolated signer, no independently ACL-isolated source-worker service identity, and no authentic original #2962 revision-7 terminal execution receipt. The old lease remains SAFE_HOLD.

This source change adds **only a necessary second cryptographic admission gate**. It does NOT implement a signer, create keys, provision Windows accounts, certify current machine ACLs, certify historical writer exclusion, authorize release, or install/restart anything.

## Commissioning before execution

A qualified, independently permission-restricted operator/root custodian must, outside the repository and outside the source worker:
1. Commission one Windows service issuer SID, one different low-privilege isolated writer SID and a separate operator SID.
2. Verify the original checkout cannot be written by the isolated worker and no out-of-job execution can regain that right; provision a separate isolated workspace and credential-free Git view.
3. Protect the issuer private Ed25519 key from the source worker, and protect the commissioning root private Ed25519 key from both source worker and issuer.
4. Produce a domain-separated root-signed commissioning JSON whose machine-audited policy binds repository, branch, isolated worktree, service and worker SIDs, source issuer public key digest, isolation policy digest, and a bounded validity interval.
5. Persist the root public key, receipt and issuer public key outside the source checkout. Configure exact absolute paths and SHA-256 pins via trusted host service configuration, never a worker-supplied environment.

The new `authenticateSourceCustodyCommissioning` confirms the root/issuer are two distinct Ed25519 public keys, verifies the offline root signature, validates identities and before-execution time interval, and returns **no source/lease/merge authority**. Missing or retroactively commissioned policies fail closed.

## Required next production step

The writer custody verifier now requires this commissioning record as one of its **necessary**, not sufficient, predicates, even for a valid issuer-signed custody record. This is SOURCE-ONLY; no such root or issuer is commissioned on the real Battle Bridge. The actual signer must issue custody receipts solely from service-observed OS process lifecycle and ACL isolation, not accept caller-supplied booleans. Existing Job Object proofs do not cover WMI/COM out-of-job writers. The original historical #2962 r7 attempt **cannot be re-signed retrospectively** as if it were a new isolated execution.

No authority changes are made to the lease reconciler, Core Daemon, mailbox, mission worker or runtime. PR #3023 remains specialist-HELD until qualified reviewer evidence is genuine.
