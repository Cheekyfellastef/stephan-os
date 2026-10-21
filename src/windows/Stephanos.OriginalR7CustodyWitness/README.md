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
  The preflight first rejects an ordinary apphost/adjacent-DLL build: the
  witness must be the entry assembly and both it and managed core must have
  empty `Assembly.Location`, as in a self-contained single-file bundle.
  The `WitnessSingleFile` publish profile bundles managed payload and native
  runtime libraries; native libraries are extracted by .NET at execution.
  **This is not a protected trust root**: Windows SCM registry-value ACL
  ownership, image mapped-at-launch identity, original source-writer exclusion,
  old open handles, and independent pinned image provenance still require
  separately qualified OS evidence. No instruction here provisions that key.
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

This native witness host has no privileged commissioning, signing or lease-release command. Testing source or opening a PR is NOT a machine custody receipt, deployment or build proof.

## Binary pin qualification boundary

The new image digest preflight is an intentionally **read-only negative gate**.
An ordinary `dotnet build` output cannot pass it, even with a matching apphost
digest: changing the adjacent managed witness DLL would leave that digest
unchanged. Build the candidate bundle with `dotnet publish
src/windows/Stephanos.OriginalR7CustodyWitness -p:PublishProfile=WitnessSingleFile`.
The profile targets Windows x64; this is a build operation, not an installer.
Hosted tests execute the linked native adapter in both ordinary and bundled
processes, then place an invalid adjacent DLL beside the bundle and repeat.
The genuine service bundle is also built and rejects CLI invocation.
The bundle guard is a necessary packaging check, not proof that all loaded
code came from a protected file. The runtime's extracted native libraries,
DLL search, process environment/startup hooks, mapped-at-launch identity and
installation directory still require independently reviewed OS protection.
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

This witness host still has **no privileged commissioning, signing or lease-release command**. A separate reviewed Windows Stage-B staging recipe is proposed at `scripts/windows/stage-original-r7-witness-candidate.ps1`. It is not connected to public GitHub mailbox or autonomous actions.

## Stage B staging candidate (not commissioning)

The staging entry point requires Windows PowerShell **5.1 Desktop**, rather than assuming a newer native-argument binder has identical behavior. Its fixed SCM create invocation omits the password option for the virtual account and preserves literal image-path quotes. A Windows test extracts that exact invocation and sends it through the real 5.1 native binder to a harmless argument receiver; it verifies the complete argument vector without registering or starting any service. This is argument-marshalling proof only: the actual elevated SCM creation, registry readback and partial-failure behavior still require separately approved host proof.

The proposed PowerShell recipe is read-only by default and verifies an exact local filename, strict operator-provided SHA-256, no adjacent managed DLL/config sidecars, stable non-reparse ancestors and absence of an existing witness service or installation directory. Under the separate explicit `-Stage` switch it requires an already elevated interactive administrator and PowerShell ShouldProcess confirmation. It may copy only that local binary to a fixed new Program Files location, register the **fixed witness as disabled (SCM Start=4)** under its own virtual service account, set restricted service SID, restrict binary/directory read/write ACLs and set a preliminary image digest. It **never starts the service**, grants auto-start, impersonates a writer, changes source permissions or invokes the lease reconciler.

The supplied SHA-256 is NOT independent code provenance: an operator could provide a matching hash for an untrusted file. Windows packaging, signing, loaded module/native extraction identity, registry key and ACL immutability, service-account correctness, time-of-check races, original-writer tokens, old handles, WMI/COM/services/tasks, continuous audit and separate Ed25519 trust roots all require independent Windows security review and actual physical proof before installation or final commissioning. The recipe returns only a local, redacted `R7_STAGE_B_DISABLED_SERVICE_STAGED_NOT_COMMISSIONED` candidate receipt; if partially failed it leaves explicit `R7_STAGE_B_PARTIAL_ARTIFACTS_REQUIRE_REVIEW` and does not silently delete a service or directory.

**Do not execute `-Stage` until the new recipe has passed exact-head Windows/security specialist review, protected merge, approved immutable binary provenance and explicit operator-scoped Battle Bridge admin authorization.** An installed disabled service is not custody or proof. The original `WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED` OnStart gate and `critical-2962-elastic-goal-r7-lease` HOLD remain mandatory.

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

## Executable payload custody boundary

The retained source-only Windows package uses the self-contained win-x64
`WitnessSingleFile` profile, matching the SCM bundled-payload gate. Its EXE
digest covers the bundled managed witness, access-probe and .NET assemblies.
Packaging rejects adjacent DLLs and executes the exact delivered EXE with
`--inspect-bundle-only`: exit 0 means this retained process passes the existing
assembly-layout predicate AND the production image-length/digest evaluator
with a self-computed, explicitly untrusted digest. Exit 4 denies an unbundled
layout; exit 5 denies image readback/size/digest shape. The image remains bounded
at 128 MiB, accommodating the self-contained untrimmed win-x64 runtime. Hosted
Windows tests also reject an oversized image. This fixed diagnostic reads only
its own layout/bytes and never invokes SCM, registry, signing or custody.
The package also verifies that other unapproved CLI invocation fails closed.

This does not establish independently protected digest provenance, extracted
native-library/configuration integrity, whole-source exclusion, or signer custody.
OnStart still refuses commissioning. Stage B/C needs independently qualified
Windows review and separate privileged installation/physical evidence before
any signed witness can be eligible; historical outcome remains UNKNOWN.
