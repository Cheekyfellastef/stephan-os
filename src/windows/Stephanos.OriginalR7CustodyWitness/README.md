# Native Windows custody witness SCM host (Goal #3123)

STATUS: SOURCE-ONLY. This is a buildable .NET 8 Windows Service Control
Manager host for the exact original #2962/r7 custody witness. It is NOT the
privileged Windows proof issuer, is NOT installed and cannot release a lease.

## What the code proves

- Fixed service identity: StephanosOriginalR7CustodyWitness
- Fixed historical lease: critical-2962-elastic-goal-r7-lease
- Windows-only, Session-0, non-interactive SCM invocation, no arguments
- Read-only SCM image integrity preflight now requires `PinnedImageSha256`
  (strict lowercase SHA-256 hex in the fixed HKLM service registration) to
  match a freshly hashed on-disk running executable and rejects reparse points
  anywhere in its local path ancestry. Missing/mismatched pins HOLD.
  **This is not a protected trust root**: Windows SCM registry-value ACL
  ownership, image mapped-at-launch identity, original source-writer exclusion,
  old open handles, and independent pinned image provenance still require
  separately qualified OS evidence. No instruction here provisions that key.
- The actual process token must belong to the exact pinned virtual service
  account, or restricted LocalService (S-1-5-19) with the pinned *enabled*
  NT SERVICE SID. Raw groups/deny-only memberships are not sufficient.
- Reject administrator membership, LocalSystem, an interactive user and
  arbitrary service accounts, even if they carry a matching service SID.
- This is a token-isolation source hardening step only, not real Windows
  principal provisioning, ACL enforcement, signer isolation or runtime proof.
- Even after identity passes, startup is refused with
  WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED

The intentionally failing final gate prevents a user account, Core daemon or
unsigned service from presenting a running process as credible custody.
There are no protected keys, receipts, service installer, remote endpoints,
network handlers, read-write access to the source checkout or generic shell.

## Remaining service implementation

1. Independently provision a dedicated Windows service identity and a
   separate, restricted original-source writer identity, without touching
   the original eight uncommitted Battle Bridge checkout entries.
2. With a qualified OS specialist, implement actual machine-level actor
   identification and deny original writers access, including direct,
   WMI/COM, service and Scheduled Task launch routes. Validate durable
   protected audit, actual negative write attempts and trustworthy clock.
   Never use an empty process listing or an ACL string as sole proof.
3. Independently provision the witness Ed25519 private key outside source,
   relay, GitHub and OpenClaw access. Sign ONLY validated native OS evidence,
   not caller-provided booleans. A separate protected operator signer approves
   the exact witness digest and original r7 lease digest.
4. Connect to the already implemented
   stephanos-server/services/legacyOriginalSourceOrphanQuarantineV1.js
   verifier, preserving eligibility-only, historical outcome UNKNOWN and
   denial of direct source or lease authority.
5. Require real independent Windows security specialist review, protected
   merge and a separate explicitly owner-approved privileged installation.
6. Only the canonical original-mission cancellation and compare-and-release
   reconciler can release the exact historical lease; real SELECT, CLAIM,
   PICKUP, BUILD, TEST, MERGE and unattended refill proof follows.

This package intentionally has NO installer or release command. Testing source
or opening a PR is NOT a machine custody receipt, deployment or build proof.

## Binary pin qualification boundary

The new image digest preflight is an intentionally **read-only negative gate**.
It does not install or edit a service or set a registry key. CI may use
synthetic matching digests to prove code paths, but cannot commission real
Battle Bridge identity, registry ACL ownership, signer isolation or source
custody. A commissioning owner must independently verify and protect the
SCM `PinnedImageSha256` registration and running image through a separately
reviewed Windows-admin procedure, with rollback and sealed audit, **before**
this preflight may count as trusted identity. Even after success, the native
host retains `WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED` until
full original-writer containment, protected logging and two signer roots
are qualified. The original R7 lease remains held.
