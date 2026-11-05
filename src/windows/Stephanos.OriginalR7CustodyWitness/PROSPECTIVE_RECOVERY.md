# Current processing-claim recovery binding

ProspectiveProcessingClaimContext supplies the input binding missing from the
retired R7 fixed host profile. It captures bounded mission/processing-claim bytes,
rejects duplicate JSON fields and mismatched mission/grant/payload/branch/source
identities, binds the consumed pickup event and exact original claim digest, and
computes a domain-separated recovery-attempt digest. Its constructor is private;
returned data never aliases caller buffers. It supports current elastic missions
without relabeling the retired critical-2962/r7 attempt.

This is preparation within the existing native recovery owner. It opens no path,
creates no keys, invokes no signer, changes no principal, and emits no positive
custody or quarantine authority. The existing SCM startup refusal and legacy
fixed signing profile remain intact. No production operation has been enabled
by making a boolean true.

## Actual production callgraph and missing producer

The real consumer is authenticateProspectiveOrphanQuarantine in
stephanos-server/services/legacyOriginalSourceOrphanQuarantineV1.js. It verifies
separate pinned Ed25519 witness/operator roots, purpose-separated signatures,
freshness, exact current mission/claim/source and independent operator approval.
quarantineUnknownProcessingClaim in prospectiveUnknownProcessingClaimService.js
rechecks the exact processing bytes and empty canonical receipt histories under
existing mission/source guards before durable cancellation and byte-preserving
quarantine. The context parser does not replace those guards or that authenticator.

The intended producer chain is:

1. Authenticated canonical storage/mission lock captures current claim bytes and
   consumes this context; its ContextDigest is input binding, not adoption proof.
2. An independently admitted native custody owner proves actual old-source
   capabilities/re-entry exclusion and retains protection through consumption.
3. Its isolated witness signer attests the exact current tuple from native proof;
   the separately authenticated operator approves that witness digest.
4. Existing canonical consumer revalidates signatures, history, freshness, queues,
   mission revision and original bytes before it may quarantine this one claim.
5. The existing worker/controller independently admits and physically picks up
   the subsequent productive build. Quarantine alone is not pickup or completion.

Steps 2 and 3 remain UNIMPLEMENTED/UNCOMMISSIONED in the delivered service.
OriginalR7FixedSigningHostProfile.PreflightProductionWitness has no adopted-policy
or complete-custody source. Program.OnStart still refuses physical commissioning.
The laboratory R7NativeQualification filter has no production enrollment, issuer,
complete source estate or independent signer. The separate canonical-mailbox
native evidence host also refuses unqualified production; it is not an available
substitute signer for a processing claim. Test keys or signed caller booleans
cannot fill any of these gaps.

For current critical-1574-elastic-goal, the original r5 action is still unresolved.
Capturing its revision6 mission and exact claim bytes does not prove exclusion.
The original r5 source remains bound to its captured original head and historical
execution outcome remains UNKNOWN. Retired2962r7 is not an active prerequisite.

## Required boundary before attended host execution

Do not request installation/root enrollment as if this source already implements
an issuer. No currently prepared one-shot attended host command can produce the
missing authority: the producer implementation and independent native tests are
still missing. Qualification requires an independently admitted disposable Windows
NTFS target and actual callback/lifecycle/old-capability evidence, then a separately
reviewed current-claim production owner/signing implementation. No driver load,
UAC, reboot, service activation, signing root or security-principal expansion is
authorized by this preparation. A compiled test harness is not a commissioned
producer.

Protected source review has a separate current dependency: reviewer-repair PR3395
contains the current contract corrections but trusted main's pre-artifact tests
fail before a qualifying immutable review artifact exists. Preserve the real
approval-boundary self-change finding. The fixed PR1581 compatibility cannot be
reused. A governance owner must resolve that trusted-reviewer bootstrap with an
explicitly qualified source-defined amendment; neither this owner nor its context
parser may manufacture an artifact or bypass protected exact-head integration.


## Native producer-preparation slice

ProspectiveNativeScopeCapture now obtains and retains an actual Windows read
handle for the context's worktree. It checks directory/reparse/delete/link shape,
normalized final path, NTFS filesystem and the real volume serial plus128-bit
file ID, and binds that identity to ContextDigest. VerifyRetainedIdentity uses
the same live handle; Dispose closes it. It makes no recursive containment,
signer or quarantine claim. The host service has not been activated.

Owned Windows regressions prove root rename refusal while the handle lives,
rename success after close, distinct native identities and disposed-use refusal.
They also prove child-file creation STILL SUCCEEDS under the retained directory.
That counterexample is deliberately required: this collector cannot serve as the
old-source physical exclusion witness. All temporary move/delete targets are
checked against the exact owned UUID fixture under the system temporary root.

The new test project is invoked in the existing native Windows workflow, not a
new worker or controller. Its optional owned-input diagnostic accepts a local
copied bundle only in the test executable; it is not added as a production
command or arbitrary path operation to the fixed SCM service.

Primary APIs: [native file identity](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex),
[normalized final path](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew),
[filesystem by handle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationbyhandlew).

In-source fixture action IDs and paths are synthetic. Actual current claim bytes,
native IDs and local diagnostic bundles are never part of this source package.
