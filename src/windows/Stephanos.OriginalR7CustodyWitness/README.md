# Native Windows custody witness SCM host (Goal #3123)

STATUS: SOURCE-ONLY. This is a buildable .NET 8 Windows Service Control
Manager host for the exact original #2962/r7 custody witness. It is NOT the
privileged Windows proof issuer, is NOT installed and cannot release a lease.

## What the code proves

- Fixed service identity: StephanosOriginalR7CustodyWitness
- Fixed historical lease: critical-2962-elastic-goal-r7-lease
- Windows-only, Session-0, non-interactive SCM invocation, no arguments
- The actual process token must belong to the exact pinned virtual service
  account, or restricted LocalService (S-1-5-19) with the pinned *enabled*
  NT SERVICE SID. Raw groups/deny-only memberships are not sufficient.
- Reject administrator membership, LocalSystem, an interactive user and
  arbitrary service accounts, even if they carry a matching service SID.
- A fixed Windows service Parameters registry value, PinnedImageSha256, may
  be checked against the bytes of the currently launched image. This is a
  necessary local digest comparison, not independent attestation of the pin:
  the service's registry DACL and image/ancestor mapping require separate OS
  review. Missing/invalid pin, unreadable image, changed bytes or alias fail
  closed. No setter, installer, source-controlled pin or signing key is provided.
- This is a token/image-integrity source hardening step only, not real Windows
  principal provisioning, ACL enforcement, signer isolation or runtime proof.
- Even after identity passes, startup is refused with
  WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED

The intentionally failing final gate prevents a user account, Core daemon or
unsigned service from presenting a running process as credible custody.
There are no protected keys, receipts, service installer, remote endpoints,
network handlers, read-write access to the source checkout or generic shell.

## Native old-writer negative-open probe integration (source only)

The native witness host now references the already independently source-tested
`Stephanos.OriginalR7DaclReadback` library and exposes an internal
`OriginalR7WriterAccessPreflight.ObserveSingleTarget` adapter. It asks the OS
kernel for separate DATA/APPEND/WRITE_DAC/WRITE_OWNER opens under one retained,
unmodified Windows token and refuses missing, filtered, bypass-capable or
mismatched tokens and unstable object identity. No writer token acquisition,
production SID selection, network or CLI trigger, physical enforcement or
signer is added. The source-only adapter always rejects claims of authenticated
original provenance, whole-tree/old-handle/relaunch exclusion, audit, signing
and lease authority, even if one target's negative opens are observed.

The existing SCM host deliberately does **not** invoke this adapter at start:
no independent authority currently supplies the original r7 token. A runner
Windows user token cannot stand in for that historical identity.

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

## Bounded original-token multi-file negative-open survey (source only)

`OriginalR7WriterScopePreflight.ObserveBoundedFiles` adds a fixed-limit,
read-only ordinary-file enumeration and individual native OPEN_EXISTING
DATA/APPEND/WRITE_DAC/WRITE_OWNER access-denial observations using the retained,
unmodified original-token handle supplied by a separate qualified OS security
owner. It rejects reparse points, noncanonical paths, unknown ownership/token
state, missing files, incomplete traversal and all over-budget surveys. It does
not traverse through junctions, create or edit source entries, or publish paths,
SIDs or handles.

Even a fully denied bounded sample means **sample only**. It is not a
whole-source witness because directory create rights, unsampled/replaced
objects, other actors, existing writable mappings/handles, task/service/WMI/COM
re-entry, historical outcome, audit and two independently protected signers
remain unproven. The service does NOT invoke this survey from SCM OnStart and
the public mailbox CANNOT supply the original token or scope. A CI runner's
identity remains untrusted; source tests verify fail-closed gates only.

## Bounded original-token directory rights probe (source only)

`OriginalR7DirectoryRightsPreflight.Observe` makes actual Windows
OPEN_EXISTING rights requests under an independently supplied retained OS
token: FILE_ADD_FILE, FILE_ADD_SUBDIRECTORY, FILE_DELETE_CHILD, WRITE_DAC
and WRITE_OWNER. It never creates, deletes, renames, writes or changes an
ACL. Unavailable/wrong tokens, noncanonical paths, reparse ancestors,
unstable directory identity and unknown Win32 errors fail closed.

Even all five denied rights establish only a single-directory/token
snapshot, not historic original identity, complete source containment,
old handle revocation, alternate tokens, re-entry, protected audit or
signatures. The SCM service does not invoke this helper and the remote
mailbox has no way to call it. No installer, signing or lease authority
is added. Native tests touch only a disposable Windows CI directory.

## Ancestor-junction race fix

A qualified-reviewer P2 identified that checking an ancestor's attributes
without retaining its handle allows an attacker to substitute a junction
between write-rights opens. The directory preflight now holds native handles
to the target and **every ancestor without DELETE sharing** throughout all
five original-token requests, checking each normalized final OS path and
object type, then verifying the same target object again. Any failure is a
bounded HOLD, never positive custody proof. This is still source-only and
has no protected Windows signing, installation or lease authority.
