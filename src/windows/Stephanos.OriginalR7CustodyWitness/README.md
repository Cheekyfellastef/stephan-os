# Native Windows custody witness SCM host (Goal #3123)

STATUS: SOURCE-ONLY. This is a buildable .NET 8 Windows Service Control
Manager host for the exact original #2962/r7 custody witness. It is NOT the
privileged Windows proof issuer, is NOT installed and cannot release a lease.

The same fixed executable now also has the purpose-bound, one-shot
`--authenticate-owner-peer-only` operation described in
[the native owner peer operation](#native-owner-peer-operation).
It retains an ephemeral recipient, displays the exact protected run/fingerprint,
obtains a genuine local OS authentication factor and independently verifies the
encrypted owner credential's signature and exact first run attempt. This source
has not been admitted or invoked against real credentials. It cannot provision
roots or authorize custody/release; the SCM startup refusal remains intact.

### Separate inactive-root purpose and the creation boundary

The source now distinguishes the existing peer-only purpose from
`PROVISION_INACTIVE_R7_SIGNING_ROOTS_ONLY`. The latter uses the separate fixed
audience prefix `stephanos:r7:inactive-first-root-provisioning:v1:` throughout
native pairing, the protected workflow summary, owner approval, signed issuer
audience and encrypted delivery. A peer-only approval cannot be relabeled as
permission to provision roots. Both purposes retain the same permit schema;
the complete validated audience determines the operation, not a caller flag.

The new internal authentication adapter additionally parses the complete exact
permit and retains the fixed installed executable and its directory ancestry.
It rechecks canonical identity, image bytes and the original validity window
before joining actual issuer authentication with the live native OS decision.
The parsed permit and matching image are not independent source provenance,
protected loaded-module evidence or source-writer exclusion. The in-process
grant cannot be serialized, reconstructed from public data or used twice.

This adapter is deliberately **not registered as a production CLI command**.
Its only terminal result after successful authentication is
`R7_INACTIVE_ROOT_PURPOSE_AUTHENTICATED_CREATION_CUSTODY_REQUIRED`; no seed,
durable provisioning attempt, ACL, service or lease is changed. It must not be
invoked merely to ask for credentials while the necessary enforcement is absent.
The existing peer-only CLI and the unconditional SCM refusal remain unchanged.

Permanent inactive seeds must not be created first and promoted after a later
fence. If a source-capable administrator or process could read the new seed or
its creator's memory at creation, later protection cannot establish that the
key was never copied. The fixed storage policy currently permits SYSTEM and
Administrators full control; that policy alone does not isolate keys from a
source actor with those capabilities. Fresh files and exclusive file handles
do not dispose of another process's privilege, injection or relaunch routes.

The substantive missing implementation is a native maintenance transaction
that establishes and retains the actual source-role/commissioner separation,
disposes of old capabilities and prevents re-entry **before** usable signing
material exists. Its scope must come from the authentic source estate. A
controlled, independently authenticated maintenance boot can supply destruction
of pre-boot kernel objects only when relaunch denial and complete current
post-boot exclusion are also established. No automatic reboot, account change,
process termination or inferred historical identity is provided here.

Portable verification now includes the exact new cross-language pairing vector
(899 bytes, SHA-256 `4bb41bf002c2631316e413587d60ed20cf8e99d42d027610479961c5983587ba`),
cross-purpose substitution and caller-constructed grant refusal, and
`--provisioning-source-schema-only` in the **test executable**. That test mode
checks closed-world canonical permit bytes, exact original/review bindings,
nonzero hashes and expiry while preserving consumed r1 identity against held
lease revision7. It supplies no native Windows proof.

The credential API binding uses fixed absolute OS modules and verifies actual
mapped module names before calling their retained exports. A System32 search
attribute alone is insufficient in the pinned .NET8 single-file runtime; see
the [Microsoft compatibility note](https://learn.microsoft.com/dotnet/core/compatibility/interop/10.0/native-library-search).
The owned single-file fixture copies the genuine OS DLL beside the app and into
a temporary working directory. Separate cold children compare attribute-only
and fixed loading without any real account logon or password dialog. Local
.NET8.0.32 reproduced application-directory loading in the control, while the
fixed child loaded System32. Other contexts report the actual control origin;
no unreproduced control is labeled a red/green result.

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
  separately qualified OS evidence. The separately reviewed Stage-B `-Stage`
  branch does modify that key's owner/DACL and image pin under an interactive
  administrator. Those are staging mutations, not custody qualification.
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
The native service host has no protected signing keys, credible custody
receipts, self-installing capability, remote endpoints, network handlers,
read-write access to the source checkout or generic shell.

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

### Service registration protection prerequisite

`OriginalR7RegistryProtection` reads owner and DACL from the same retained
registration-key handle used for image pin/configuration reads, using Windows
`RegGetKeySecurity`. The descriptor must have protected inheritance, an
Administrators or SYSTEM owner, exactly one explicit unconditional full-control
ACE each for SYSTEM and Administrators, and one read-only KEY_READ ACE for the
fixed service SID. Missing, NULL, empty, inherited, callback, generic-rights,
duplicate, unknown or more-permissive descriptors fail closed. After hashing
the binary, a second descriptor sample must exactly match the first.

The native `OriginalR7RegistryProtection` check is a **read-only prerequisite**,
not protected provenance or effective access proof. Separately, the Stage-B
`-Stage` branch DOES mutate the fixed HKLM registration key: after disabled
SCM creation it sets an Administrators owner and protected DACL for SYSTEM,
Administrators and the fixed service SID, then writes and reads
`PinnedImageSha256`. The default service key must not be assumed to pass.
This privileged staging requires separate explicit operator approval and
is neither continuous custody nor source-writer exclusion. A separately
reviewed commissioning procedure remains required. Parent-key replacement, already-open write handles, privileged
administrators, service-object DACL/control rights, registry links, runtime
modules, audit/signers and continuous original-writer isolation remain separate
requirements. Two matching samples cannot prove continuing protection.

The existing Windows SCM test executable now exercises adversarial synthetic
descriptors and actual read-only native descriptor decoding through an HKCU
handle, including a closed handle failure. These tests never modify registry
permissions, install a service or authenticate the original R7 writer.

API contracts: [RegGetKeySecurity](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-reggetkeysecurity)
and [registry key rights](https://learn.microsoft.com/en-us/windows/win32/sysinfo/registry-key-security-and-access-rights).

### Remaining commissioning work

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

The candidate now also aligns registry staging with the native reader's strict
descriptor prerequisite. Only after disabled SCM creation, in the existing
interactive administrator/ShouldProcess branch, it opens the fixed existing
64-bit HKLM service registration. It sets Administrators ownership and a
protected DACL containing exactly explicit SYSTEM/Administrators full-control
and the resolved fixed service SID's KEY_READ ACEs, with no inheritance. It
checks the raw descriptor through the retained key handle before and after
writing/reading the image pin, then samples the named key again before a
positive staging result. No token privilege is enabled, key created, caller
path accepted or service started. Failure retains the disabled partial-stage
HOLD. PowerShell 5.1 tests execute the pure descriptor helpers on synthetic
hostile ACLs; those tests do not install or change HKLM permissions.

These are sampled registration-shape checks. They do not prove effective
access by the original writer, parent-key replacement denial, old-handle
revocation, continuous containment, binary provenance or protected signing.
This expanded staging candidate requires a fresh qualified exact-head
Windows/security review before any physical staging; earlier staging review
does not cover these new registry writes.

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

## Durable audit journal implementation candidate (not commissioned)

`OriginalR7AuditJournal` implements bounded, exact-request-bound native audit
framing, sequence and digest chaining, synchronous disk flush and retained-handle
readback. Torn tails, changed bindings, noncanonical/duplicate JSON, clock
rollback and invalid lifecycle transitions fail closed. An I/O failure poisons
the instance; existing journal records cannot be resumed after process restart.
There is no automatic truncation, rotation or continuity reconstruction.

`OriginalR7AuditStorage` can open only an independently preprovisioned fixed
ProgramData audit file under the exact virtual witness identity in Session 0.
It retains native path ancestors without delete sharing, rejects reparse/name
aliases and multiply linked files, reads owner/DACL from retained handles and
requires an explicit protected three-principal allow-only policy. The service
gets directory read/traverse and file read/append, without overwrite, deletion,
owner or DACL rewrite rights. It creates no directory/file and changes no policy.

The native tests exercise actual append-only Windows handles, disk flush and
readback, denied truncation, write sharing, native names and hard links using
disposable files. Synthetic ACL tests and ordinary user fixtures are not a
commissioned production root. A chained digest is not an independent signature;
clock ordering is not trusted wall-clock anchoring. Package provenance, existing
mapped handles, whole-source/re-entry exclusion, protected provisioning and
separate signers remain independent requirements. The SCM startup gate is
unchanged: this candidate is not called from OnStart and cannot release r7.

## Isolated observation-session and request-consumer candidate

The prepared OriginalR7ObservationSession joins the existing durable audit journal
to real process-bound read-only native probes. It snapshots at most eight canonical
target challenges for one PID/creation-time/SID tuple, limits the session to thirty
seconds, hashes the exact plan and each indexed observation, and returns a checkpoint
only after durable journal append/readback. Invalid identity/path shapes, duplicate
targets, writable/unknown/bypass/owner results, a changed process, probe failure,
deadline/clock loss, audit failure and restart attempts fail closed. Fault or Stop
is terminal. Disposal records cancellation when possible; it never releases custody.

Challenge inputs are diagnostic assertions, not authentic historical original-writer
enrollment. Synthetic probe seams exist only for internal tests and cannot grant
authority. Even a complete negative sample has OriginalPrincipalProvenanceAuthenticated,
PhysicalContainmentProven, ContinuousExclusionProven, IndependentSignatureProven and
LeaseReleaseAuthorized fixed false. No signer, claim issuer, source mutation,
process-control endpoint or service-start route is introduced. The unconditional
WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED startup refusal remains unchanged.

The isolated existing Shared Workspace relay now invokes the bounded
r7-commissioning-inbox-reconciliation consumer for the existing R7 request shape.
It validates the closed-world diagnostic packet, reads the exact durable inbox,
serializes duplicate handling with the existing operation-lock primitive, writes
one correlated diagnostic receipt and reads it back. Changed inbox/receipt content,
write/read failures and conflicting retries do not reconcile successfully. A resumed
delivery may reuse only the stored timestamp; all other identity/payload fields
must match. Already-completed delivery can receive its missing diagnostic receipt
without resubmitting the request or rewriting delivery receipts. Other relay behavior
retains its existing path.

This consumer emits HELD only. It has no host-admission issuer, does not create an
operator-approval card and never invokes a Windows executor. It does not translate
a review URL, SID, administrator flag or caller boolean into trust. Its explicit
remaining contracts are documented in the separate private candidate proof:
historical-writer enrollment issuance, candidate-specific Windows executor admission,
and independently controlled witness/operator signer provisioning. Diagnostic
receipt persistence is neither delivery of a commissioned service nor lease release.

Focused native execution: pass --observation-session-only to the test executable.
This runs the new disposable-file/process observation tests while retaining the
previously recorded audit-suite evidence. The full normal test entry point also
includes the new session tests.

## Software signature implementation preparation

The internal pinned Ed25519 primitive, untrusted retained-stream material session,
and fixed unadopted host-profile parser are described in
[SIGNING_PROVIDER_PROVENANCE.md](SIGNING_PROVIDER_PROVENANCE.md). Focused public-key
fixture tests use the unchanged canonical Node verifier. They do not enroll or
read production keys or issue physical witness receipts. The production startup
refusal and complete physical/independent-signing prerequisites remain in force.

## Native metadata and replacement-sharing observations

`OriginalR7ProtectedKeyMetadata` separates passive metadata readback from real
Windows data-access sharing. A metadata-only file handle does not exclude other
writers or replacement. Internal disposable material fixtures request read-data
access and verify conflicting write/delete opens are rejected; no production
material API exists. The fixed service-context observer never reads key data.

Audit and metadata paths share `OpenPinnedDirectory`, which requests list-directory
read access and retains no-delete sharing. Actual disposable directory-renaming
tests exercise this same operation. Missing directory permissions cause HOLD;
the implementation does not grant them. File identity, link count and descriptor
readback are bounded observations, not proof of existing writable mappings,
credential revocation, complete re-entry exclusion or independently enrolled roots.

`OriginalR7CommissioningOwnerContext` observes the current primary Windows token,
process creation time, SID, session and elevation. It never equates these facts
with human consent, authenticated repository ownership or an admitted executor.
The focused `--key-metadata-only` tests and full native test entry point cover
these observations using disposable files and public fixture bytes only.


## Native owner peer operation

This source adds a one-shot operation to the existing fixed witness executable:
`--authenticate-owner-peer-only`. It is a delivery-peer authentication operation,
not an operational signer or a commissioning service. The existing SCM startup
refusal remains unconditional. The source is not admitted on Battle Bridge.
Before actual invocation, the whole exact source/package needs independent
Windows security review and protected approval of the proposed endpoint policy.

The native process retains one ephemeral RSA recipient and its original
five-minute window. Redirected standard input is a closed, byte-bounded JSON
line protocol. It accepts no file paths, endpoint URLs, commands, SIDs, adopted
policy flags, plaintext credentials or replacement native decisions. Standard
output carries public challenges, transcript/fingerprint and bounded results.

The lines, in order, are:

1. `begin-owner-peer` with `permitSha256` and `expectedMain` strings.
2. `pair-protected-run` with canonical `runId` and `runAttempt: "1"` strings.
3. `authenticate-displayed-peer` with the exact displayed `peerFingerprint`.
4. `consume-owner-envelope` with `encryptedEnvelope`, the compact JWE.

Each line has an `operation` string and exactly the fields listed above. The
third line only requests the actual Windows transaction; it cannot attest
consent. The native dialog displays the full protected-run URL, fingerprint,
expiry and narrow scope. The current implementation supports the current local
SAM operator with a fresh interactive password authentication. Domain/AAD,
Hello, smartcard, another account, cancellation or unsupported providers hold.
No authentication dialog or real account logon is performed by fixture tests.

The protected workflow separately prepares the same fingerprint before its
owner-environment decision. Only the exact purpose/fingerprint approval history
enrolls this ephemeral peer. Its producer emits ciphertext for the retained key.
The native consumer separately requires its opaque, private OS decision, current
native actor, original challenge, GitHub signature/profile, expected main and
the exact signed run and first attempt. Error, replay, expiry, changed actor or
cross-run input consumes or closes the session without an authenticated result.
Input waits are bounded; the native credential-provider call has no hard
cancellation guarantee and cannot refresh an expired challenge.

An authenticated result proves these peer factors only. It never adopts host
policy, provisions either signing root, establishes old-handle/mapping or
whole-estate exclusion, installs/starts the service, signs custody evidence or
releases R7. Those operations require their actual admitted native callgraph and
independent proof. A serialized success result cannot stand in for that proof.

The proposed protected R7 workflow is retained as the inactive
`docs/architecture/r7-protected-owner-workflow-proposal.yml.txt` template.
The live owner workflow and merge validator remain at protected main. Native
CI tests the template but does not install it or issue credentials. A subsequent
independently admitted source-policy change must precede producer activation.

The intended subsequent commissioning path remains unfinished. In particular,
the seed-creation transaction currently has owned-fixture entry points only;
source exclusion, fixed-policy OS adoption, crash/orphan handling, protected
audit and live independent signers have not been commissioned. The original
lease must remain held until those gates and the canonical owner CAS pass.


# R7 retained capability observation preparation

This private component observes explicitly supplied retained Windows x64
subjects. It does not enumerate the global process/handle/section estate,
authenticate original source identity, establish zero writers, enforce a
continuous fence, sign a witness or authorize lease release. The production
service remains uncommissioned.

The process/token and native target identity readers are the existing R7
adapters. Shared principal identity/mutation digests reuse the canonical
privilege-aware stamp, including actual bounded privilege inventory; there is
no second TOKEN_STATISTICS implementation. The primary-only reader is not
silently broadened to impersonation tokens. Unknown or changed metadata
invalidates continuity, including privilege removal that leaves inconsistent
kernel statistics.

The canonical stamp now also binds the bounded actual group, restricting-SID
and capability-SID inventory digest, with native statistics checked again
after collection. A pure native inventory layer has no callback into the
stamp or high-level observer, avoiding recursion. All three sorted inventories
preserve full attribute bits and duplicate restricting SIDs. Enabled,
disabled and deny-only membership remain distinct. The separate observer
samples twice and uses the same canonical primary identity. Real owned
restricted-token coverage preserves the same group count while observing
different group/restriction metadata. No eligible nonmandatory enabled group
was present for AdjustTokenGroups; that optional case is zero, not a pass.
There is no real populated AppContainer capability-token positive case, and
the primary-only helper still rejects impersonation tokens. Native calls have
no hard deadline, and twice-read metadata is not atomic continuous custody.

The observation adapter receives retained process/file handles, expected
PID/creation/SID and at most16 existing handle values and16 view addresses.
DuplicateHandle never uses CLOSE_SOURCE. Actual granted rights and the native
file identity are read through the same duplicate, followed by another
duplicate and kernel object comparison. Mapping observations use
VirtualQueryEx/GetMappedFileName without reading process pages. A retained
writable view can survive closure of both its original file and section
handles; real owned fixtures exercise that case and an actual mapped write.
WRITECOPY and read-only views are distinct. PAGE_GUARD is a one-shot alarm;
a guarded READWRITE mapping retains its underlying shared-write capability.
The owned native regression verifies that observation leaves the guard intact
and that explicitly removing the guard on the owned mapping permits a real
shared-file write. The observer never touches subject pages.
A mapped name is not a kernel
backing-file ID: that binding remains explicitly unresolved.

The separate retained-region discovery adapter uses supported Windows Process
Snapshotting with exactly PSS_CAPTURE_VA_SPACE (0x800). It walks region metadata
without a caller-supplied address list, page contents, VA cloning, thread
contexts, object names or section-file-name capture. It binds one retained
native x64 process and its primary token before and after, caps the walk at
16384 rows and two cooperative seconds, and requires successful marker/snapshot
cleanup. Exact PID/creation/SID mismatches yield no rows. Reaching the end of
this one point-in-time region walk does not authenticate backing-file IDs,
handle tables, other processes, detached/re-entry capabilities or continuity.

The initial combined PSS handle/region experiment faulted inside native
PssCaptureSnapshot. Fresh isolated owned-process probes reproduced an access
violation for HANDLES (0x4) and HANDLES/basic/VA_SPACE (0x814), while NONE and
VA_SPACE-only exited normally. This is an observed host qualification failure,
not a claim that the documented API is universally unavailable. The failed
experiment and logs remain separate. The working adapter never requests handle
capture and explicitly reports HandleTableObserved=false. It cannot replace
the missing complete handle-table producer with an empty inventory.

A separate private handle-metadata discovery adapter uses dynamically loaded
NtQueryInformationProcess class51 with a fixed capped x64 buffer. The layout
is sourced from pinned primary phnt commit
53fbbdc5b5d2b08761db1c7b26bfa8c820924356, not inferred from handle numbers.
This is an internal, compatibility-sensitive Windows information class,
not a public API stability guarantee or an admitted complete-estate producer.
The observed Windows10 build19045/System32 ntdll SHA256
36b1a62e4bf6bf7d68458fff6e8a33b39f6527ec6a46e55ecdd12cde83894c8d
is test context, not a self-issued host qualification or protected image pin.
Unknown status/layout/count/reserved fields, truncated buffers, duplicates,
wrong subject or budget expiry return no candidate rows. The adapter reads
metadata only and does not duplicate or close source handles or query names.

Real owned fixtures discover writer candidates without supplying their handle
numbers, then pass bounded chunks through the existing native same-object/file-ID
reader. That positive pipeline finds actual data, WRITE_DAC and WRITE_OWNER
capabilities. Snapshot region candidates similarly find the shared and guarded
writable views without supplied addresses, while preserving the unresolved
backing-file ID. Metadata handle values may be closed/reused immediately after
capture; metadata is never joined directly to an authenticated target or
promoted to retained-object continuity. No successful one-process snapshot
establishes whole-estate completeness, continuous custody or zero writers.

The test-only owned-job fixture creates only this test image, suspended, with
an unnamed kill-on-close single-process job and no breakaway, reads the limits
back and assigns before resuming. A normal child and a deliberately stalled
owned child have actual terminal object readback. A timeout remains a timeout
even when job-close termination reports exit code zero. These are isolation
preparation tests, not an admitted production collector or a universal kernel
hang cancellation guarantee. The fixed native API diagnostic modes are never
called by the normal qualification suite or any production entry.

Primary Windows API references:
- https://learn.microsoft.com/en-us/windows/win32/memory/creating-guard-pages
- https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/ne-processsnapshot-pss_capture_flags
- https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/ns-processsnapshot-pss_va_space_entry
- https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/nf-processsnapshot-psswalksnapshot
- https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/nf-processsnapshot-pssfreesnapshot
- https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess
- https://github.com/winsiderss/phnt/blob/53fbbdc5b5d2b08761db1c7b26bfa8c820924356/ntpsapi.h

SAME_ACCESS duplication temporarily confers the source handle's granted write,
WRITE_DAC or WRITE_OWNER capability on the observing process. No mutation is
performed by observation, but this is not a read-only-capability signing host.
A future admitted commissioning executor/protected disposable collector must
isolate this work from the least-privilege witness/operator signing processes,
close every copied capability before handback and prove cleanup. This does not
require a third signing root or account. It is a process/role boundary.

Two-second checkpoints are cooperative. Native/filesystem calls may block;
this library makes no hard cancellation claim. A real protected caller needs
qualified isolation/watchdog and exact owned-object cleanup before admission.
Any inaccessible, unsupported, stale, unbound or budget-exceeding subject is
incomplete. Successful observation is still bounded sample evidence.

The separate fixture project has only a fixed owned-child mode, an isolated
file, bounded protocol and noninteractive error handling. Its cleanup removes
two known fixture leaves and its empty own directory. It is not a production
cleanup/disposition primitive, and does not prove resistance to a hostile
same-principal parent reparse. No production process, ACL, service, key,
credential, controller or lease is changed by these fixtures.

The earlier isolated SDK first-run banner reported development-certificate
installation. Bounded follow-up found no attributable localhost development
certificate; no before-store snapshot exists, so attribution is uncertain.
No trust, private-key read/export or speculative certificate deletion occurred.
All subsequent qualifications disable development-certificate generation.

The process/thread metadata producer `R7ProcessEstateSnapshot` now obtains the
reported kernel table with bounded class-5 queries. It checks the actual own
process/thread birth fields against separate native calls, retains unknown
birth values and accounts for opaque row bytes by count and digest. A pinned
primary header documents the compatibility-sensitive layout. It does not open
foreign subjects or authenticate their retained identities, credentials, reentry
rights or protected-process scope. Reported rows and parent PIDs are discovery
metadata, never complete estate or original lineage proof. Its dedicated owned
fixture checks malformed geometry, native discovery and owned normal exits.

The new seed-creation transaction creates a fresh protected leaf with its DACL
already present, generates material afterward, flushes and verifies the retained
file, and clears owned buffers. Only owned-fixture entry points currently exist;
there is no admitted production key-creation wrapper. Ambiguous cleanup, extra
hard links, crash/orphan recovery and two-root commissioning remain unresolved
operational gates. Neither this transaction nor the census admits a signer.

The native seed component now also implements a two-root storage transaction
using the existing `OriginalR7AuditJournal`. Its callable entry remains an
explicitly untrusted owned-fixture seam. It reserves one fixed `seed-pair.ndjson`
with `CREATE_NEW`, flushes a source/candidate/native-directory-bound start record
before seed I/O, then flushes each role's verified result and a final pair commit.
It retains and rechecks the created material's file identity, descriptor, length
and derived public identity while creating the other role. Directory or journal
identity/descriptor changes, aliases, pre-existing leaves and concurrent attempts
fail closed. No private seed bytes enter the journal.

Failure preserves the attempt and any verified first key. An existing empty,
torn, faulted or completed reservation is never deleted, overwritten or resumed.
A second-key failure cannot silently regenerate the first key. A durable storage
commit still enrolls neither root, and does not prove creation custody. The
wrapper's ordinary fixture journal storage is not the separately provisioned
protected production audit store. Native custody admission and that fixed store
must be joined before any production entry can be wired.

The Windows seed fixture exercises a real concurrent reservation, first-key
descriptor and journal hard-link tampering, pre-existing second material, partial
second-key failure, replay through the existing audit validator, and twelve
controlled child-process exits inside and between the key writes. Restart
preserves zero/32-byte orphan files without adopting them. These are actual
process-exit tests, not power-loss or complete host-containment qualification.
Production SCM refusal, original ownership and lease CAS remain unchanged.
