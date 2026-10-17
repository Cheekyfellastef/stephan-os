# Goal #3123: original r7 Windows native DACL shape readback

This PR adds a non-authoritative **Windows-only** .NET 8 DACL readback library. It is a component for the separate protected witness, not the production service, signed proof issuer, privileged installer or original lease reconciler.

## What is read
- Only when a future trusted service caller supplies an exact target directory and the original source-writer SID, `R7DaclReadback.ObservePolicyShape` reads that directory's live Windows security descriptor.
- It requires a non-reparse-point existing directory, a well-formed SID, the directory not owned by that principal, protected ACL inheritance, and an explicit full-control deny ACE for exactly that original SID, inherited by both containers and files.
- Any failure, missing/invalid path/SID, owner ambiguity or unexpected Windows access error results in an opaque **fail-closed** classification. Neither raw directory paths nor SIDs nor ACE contents are returned.
- Even when a strict structural deny is seen, `PhysicalWriterDenialProven`, `AuthenticatedOsWitness`, `LeaseReleaseAuthorized`, `SourceMutationAuthorized`, and `HistoricalReceiptReconstructed` are **always false**.
- No CLI, service installation, signer, protected key, original-source mutation, task/process action or network endpoint is introduced.

## Tests and what they do not prove
- Windows GitHub Actions runs an isolated .NET native test in a random TEMP directory.
- Uses a synthetic SID not associated with the real original #2962/r7 writer; adds a deny ACE to the **runner's own temporary directory only**. Tests absent, wrong-SID, missing-path and explicit-deny cases.
- CI temporary ACL proof is NOT a negative write attempt by an original Battle Bridge writer, and cannot prove Windows group effective rights, handle reuse, ownership/privilege escalation, WMI/COM or Scheduled Task reentry, continued enforcement, a trusted timestamp, or an independent signer.
- Do not run this test against the real Battle Bridge worktree or change the eight existing modified files/ACLs.

## The required next physical acceptance
The original `critical-2962-elastic-goal-r7-lease` remains in HOLD. A separately provisioned restricted writer principal, independently protected Windows service SID and protected evidence/log roots must be commissioned by the operator, with independent specialist review and an explicit Windows-admin installation approval. Under that controlled identity, execute real negative source-write and restart probes for all applicable entry routes; capture provenance and trust-bound timestamps. Source-worker identities that retain admin, SeTakeOwnership, SeBackupPrivilege or write access via a different account cannot be treated as excluded by this DACL shape check.

Only an independently isolated OS witness may attest actual physical results, and a **different** operator signing root must approve their exact digest. `authenticateLegacyOrphanQuarantine` will treat authentic signed current containment as eligibility only; canonical cancellation and lease CAS remain separate. Real SELECT/CLAIM/PICKUP/BUILD/TEST/merge/refill receipts are still required to establish unattended building.
