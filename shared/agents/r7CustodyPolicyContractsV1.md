# R7 custody authority contract proposals (unadopted)

Owner: #3123 — Goal #2961 child: commission protected Windows r7 custody witness and independent signer.
Existing PR #3178 — Goal #3123: align disabled Windows witness staging with protected registry pins.
Parent: #2961. Existing original mission-worker ownership and original r7 lease are unchanged.

These source contracts define reviewable proposed evidence, not new trusted issuers.
The validators return no adoption, enrollment, signature issuance, host execution or
lease authority, even for correctly signed structurally valid proposals. No host
loader, listener, operation or signing endpoint is registered by this change.

## Existing adoption and authority path

The repository owner is Cheekyfellastef in directOperatorIntentStandingAuthorityV1.
Bounded design/source/tests/publication intent is separate from new sensitive trust.
Actual source-policy adoption is the existing independent exact-head/base specialist
review followed by operator-merge-approval-gate.yml with its protected
operator-merge-approval environment and exact head/tree/base/independent-review
artifact binding. qualifiedSpecialistReviewV1 pins the existing authenticated Codex
GitHub App for Windows-authority review. An engineer, AI title or administrator
readiness does not replace either identity.

The existing sourceArtifactEscrowContinuityV1/sourcePublicationContinuityV1 route can
preserve exact artifacts and select a capable transport, but explicitly returns
mutationAllowed false and is not source-owner admission. Programme authority's
claimSourceMutationLease rejects a different owner with
SOURCE_MUTATION_LEASE_ALREADY_OWNED and stale exact ownership with
SOURCE_MUTATION_LEASE_STALE_REQUIRES_RECONCILIATION. No new claim is requested here.
temporarySovereignLeaseRescueV1 returns isolatedSourceRepairPreparationOnly true,
sourceMutationAllowed false, newWriterAllowed false and protectedMergeAllowed false.
Those are specific boundaries, not a statement that GitHub publication is unavailable.

The existing operator inbox route accepts only action/commandId/requestFingerprint/
reason for an already projected decision. recordOperatorApprovalDecision rejects
a missing card with DECISION_NOT_FOUND; it cannot create a policy adoption, enroll
a signer or execute commissioning. operatorAutomationLayer's current decision-kind
allowlist contains MERGE_APPROVAL, CODEX_DISPATCH_APPROVAL, SERVICE_RESTART_APPROVAL,
PROOF_REQUEST and BLOCKER_UNBLOCK; no R7 custody-policy-adoption kind is admitted.
Existing Sovereign fixed actions contain no commissioning/key-enrollment operation.
Do not post an invented approval card, use a proof request as a trust grant, or
treat owner-authored discussion text as protected environment approval.

The pre-execution originalSourceCustodyCommissioningService verifies an already
protected distinct root and issuer through machine-configured paths/pins. It is
not an adoption/provisioning API and cannot backdate a historic r7 enrollment.
The root custodian must be independently authenticated by the real host trust
procedure; this proposal defines neither an actual SID nor a new trusted key.
No independently admitted R7 policy-adoption/provisioning executor is established.

Publication continuity for this preparation: pending review does not freeze the
existing branch indefinitely. A changed complete source candidate may advance the
SAME branch non-force when actual authenticated actor, scoped publication admission,
canonical branch ownership and exact parent/tree checks permit it. Preserve prior
review requests, mark old-head evidence stale and require one genuinely fresh
exact-head/base review after publication. No duplicate new-head request precedes
publication. The rescue preparation projection alone is not publication admission.
The authenticated repository owner and current PR author match in the connected
GitHub route; use the existing native publication scope/request preflight and actual
operator source intent. Publication grants no policy adoption, merge, host execution,
key enrollment or original-source lease claim. Reconcile against the true shared
ancestor so overlapping native test/README changes retain registry protections.

## Shared exact bindings and evidence semantics

Each closed-world contract requires repository, parent/capability, original
mission/lease/revision/digest, consumed source execution, original branch/head,
worktree path and native identity digest. Candidate binding includes existing
branch/PR, current base, source head/tree, exact image, bundle and manifest.
Issuer role, SPKI key digest, enrollment, adopted-policy and current-revocation
digests are references to independently authenticated evidence, never authority
created by the proposal. Request/command/nonce, strict millisecond UTC times,
a maximum five-minute validity and evidence freshness bound prevent ambiguous
interpretations. replayKey is only a deterministic key: a future admitted consumer
must reserve it atomically in protected durable state before any consequential
operation, reject reuse/conflict, and reread lease/candidate/clock/revocation.

| Field or group | Required authentic producer | Cannot substitute |
| --- | --- | --- |
| original mission/revision/lease digest | Existing canonical programme/mission lock and exact consumed-action record | A request body, lease expiry, acquisition time as execution time |
| sourceExecutionId | readOriginalSourceExecutionIdV1 consumed-action identity used by originalSourceAttemptFenceService | Invented historical PID or reconstructed terminal receipt |
| worktree/native identity | Retained native volume/file identity under admitted source-scope inspection | Name-only path, alias, caller digest |
| candidate source/base/tree | Exact GitHub repository/branch/PR readback and protected source admission | Prior-head clean review |
| image/bundle/manifest | Reviewed build provenance plus retained-handle byte readback on fixed image | Unsigned historical CI package or package existence |
| issuer/enrollment/policy/revocation | Independently controlled, admitted owner/root configuration and authenticated lifecycle records | Self-supplied public key, signature, administrator status |
| evidence digest/producer/time | Domain-bound signed facts from an admitted observation producer; independently checked subject/scope | Caller booleans, file hash alone, current envelope wrapping old facts |
| request/command/nonce/current validity | Existing trusted intake, protected replay store and authenticated clock policy | A fresh retry identity or wall clock alone |

## 1. Exceptional writer enrollment and prospective estate

legacyOriginalSourceOrphanQuarantineV1 explicitly accepts prospective exclusion with
historical outcome UNKNOWN and no reconstructed receipt. It does not require a
historical PID, FILETIME or historical process-enrollment record. Those inputs
belong to the selected native process-bound diagnostic adapter, not a universal
additional prerequisite of the exceptional verifier. The consumed source execution's
revision is also independent of held lease revision7: an authentic r1 action remains
r1 and must never be renamed r7. Compare the exact canonical consumed identity.

The proposal supports AUTHENTICATED_HISTORICAL_ENROLLMENT when authentic original
process evidence exists; PID and FILETIME are exact and unmodified-token provenance
must be independently established. It also supports PROSPECTIVE_COMPLETE_ESTATE
with no historical PID: enroll actual current source-capable principals and prove
the complete relevant capability estate rather than guess the historical account.
A structurally valid assertion remains unverified and unadopted.

Every claimed complete prospective scope must correlate independent evidence for
native source boundary, all equivalent source-write-capable principal/privilege
rights, existing writable handles/mappings, detached/out-of-Job writers,
direct/service/task/WMI/COM re-entry, actual negative write/denial proof, ongoing
containment/audit and queue quiescence. Include alternate/linked tokens, enabled or
disabled bypass privileges, ownership/security rewrite capabilities and the agents
able to relaunch under another token. A scoped sample or missing inventory does
not cover an estate. Unknown/incomplete coverage is explicit HOLD and cannot be
converted into an authenticated original-principal claim.

Authenticated boot evidence can be a basis for destruction of pre-boot kernel
objects; it is not exclusion of post-boot writers. A boot-based proposal requires
kernel-instance identity, independently supported latest possible pre-boot writer
upper bound, new kernel-start lower bound, authenticated clock provenance,
re-entry-fence timing, and fresh complete post-boot writer/handle/mapping disposition.
The bounds must not overlap. Lease acquisition is not execution time. Uptime
arithmetic, a zero-process snapshot, absence of Security4688, an empty task listing
or a changed PID cannot establish these facts. No reboot or process stop is
requested. If post-boot scope/continuity cannot actually be established, HOLD.

The existing legacy verifier is unchanged. Under its present semantics, authentic
complete prospective exclusion can preserve UNKNOWN without historical PID recovery.
A weaker claim such as incomplete estate accepted because history is absent would
change semantics and needs a separate explicit authority-owned policy decision;
this proposal rejects that shortcut.

## 2. Fixed Windows commissioning executor admission

The proposed scope is a closed-world set of fixed disabled-stage/readback/
prospective-commissioning recipe identifiers. These identifiers are proposed
contract values, not registered tools. Actual use needs separately adopted code,
a registered fixed executor and fresh admission from its entitled authority.

Bind the executor role/profile, fixed witness service SID and independent operator
signer SID, separated from enrolled source-worker principals. The executor may use
the operator SID or an already admitted fixed privileged service route; a third
account and an S-1-5-21-only executor restriction are NOT inherited requirements. Bind original enrollment,
complete candidate, independently authenticated specialist artifact, protected
source admission, exact operator consent, admitted executor identity, fixed recipe,
physical test and recovery plan. No arbitrary commands/arguments, guessed target,
automatic rollback, source lease mutation or reinterpreting SOURCE_CONSTRUCTION
capacity as SCM/ACL/key authority. On partial failure preserve disabled state and
auditable artifacts; further recovery needs its own exact admitted operation.
Physical commissioning is not canonical release.

## 3. Independent signing custody, provisioning, rotation and revocation

Require distinct witness/operator Ed25519 SPKI identities, separate Windows
principals. The separately protected operator/root may also act as commissioning
root; it must differ from the witness/service root, but a third key/root is NOT
required. Reuse of the witness/operator key through different PEM encoding is
not independence. Pin reviewed provider
implementation and protected storage policy outside worker/source access. No
specific native provider is silently selected: actual implementation/provenance,
access controls and lifecycle executor must pass specialist/adoption/host gates.

Witness signing is limited to the canonical legacy witness domain and to its own
fresh complete native observations plus protected durable audit/continuity.
Operator signing is separately limited to the operator domain and exact witness,
lease/request/command approval. No sign-any-payload interface, source-worker key
access or operator use of the witness key. Merely possessing a signature proves
neither physical facts nor an entitled issuer.

Provision starts epoch one without predecessor. Rotation/revocation require
predecessor custody digest, advancing epoch and disabled old signing authority
retained for audit; verifier pins, key status and revocation snapshot must be
changed through the independently authenticated lifecycle procedure. The static
proposal validator checks record shape, not actual monotonic durable state; the
future admitted lifecycle consumer must atomically compare predecessor/epoch,
publish/recheck revocation and stop issuance through both old and new paths on
uncertainty. No key is generated or provisioned by this production module.
Tests generate ephemeral in-memory keys only.

### Creation precedes enrollment and requires actual custody

The fixed inactive-root owner purpose is now bound end to end through the
existing protected issuer and native OS authentication. It is separate from
peer-only enrollment and is not a native custody producer. The source-only
internal adapter is not a registered CLI or remote commissioning operation.

Creating final-path seeds while a source-capable administrative actor still
has access is not a safe preparatory step. A later access fence cannot undo a
possible copy of the seed or creator memory. The current seed DACL retains
SYSTEM/Administrators control, so an old writer in that estate must first be
actually excluded or transitioned through an admitted maintenance procedure.
No fixed seed write is connected to the new purpose and no durable provisioning
attempt is claimed. Authentication alone remains insufficient to create or
promote usable roots.

The remaining physical producer must join actual maintained creation custody
with the one-use, exact-purpose owner/native-OS grant. It must keep source
dispatch held, dispose of existing source capabilities, prevent privileged or
alternate-token re-entry, maintain the audit and create independently controlled
keys within that same protected interval. A proposed type, a complete-looking
inventory, a boolean or an always-held command does not implement that producer.

## Precise remaining principal/interface boundary

The three definitions now exist as source with schemas, semantic checks and tests.
They are not authority-owned adoption. The entitled source decision is the existing
repository owner's protected environment approval of an exact independently
reviewed published candidate. The entitled host trust decision is the independent
root custodian's authenticated commissioning/lifecycle procedure bound to that
adopted policy and a registered fixed host executor. Neither the current inbox
decision endpoint nor source-only native capacity exposes this host decision.
No canonical API response is being fabricated and no global capacity failure is
claimed. The next positive implementation must consume authentic adopted evidence;
this coordinator cannot declare its own proposal/pin trusted.

## Inherited controls versus explicit proposal choices

| Relationship | Inheritance or proposal |
| --- | --- |
| Separate witness/operator Ed25519 roots and Windows SIDs | Existing legacyOriginalSourceOrphanQuarantineV1 two-root/two-principal contract |
| Commissioning root distinct from service and isolated source worker | Existing originalSourceCustodyCommissioningService; operator/root may be the operator signing root |
| Installer/executor may share operator SID or use an already admitted fixed service route | No extra account required; actual fixed profile still independently admitted |
| Fixed service SID shape and service-name binding | Existing OriginalR7CustodyWitness fixed virtual SID/effective-service identity preflight; schema syntax alone is no SID readback |
| Source-worker principal separation | Existing commissioning service and original-source custody goal; proposed complete estate must be authentic, not guessed accounts |
| Five-minute proposal/evidence bound | Explicit proposed envelope limit aligned with legacy attestation freshness; not policy adoption |
| Epoch/predecessor/revocation lifecycle and protected replay reservation | Explicit proposed lifecycle contract needing qualified adoption/implementation, not a claim the present host already enforces it |

Initial preparation accidentally overrestricted sourceExecutionId to r7 and
introduced third-account/third-root constraints. Those are corrected here.
Regressions preserve canonical consumed r1 execution against r7 relabeling, allow
the operator to be the admitted executor, allow fixed service executor SID shapes
and allow the operator/root to serve the commissioning role while still requiring
the witness key/SID to remain separate. None of these tests enrolls a principal.

## Independent review corrections

Authenticated historical enrollment never substitutes for complete correlated
prospective estate evidence. Both complete enrollment modes require complete
correlated handle/mapping, detached-writer, re-entry and continuity scope; an
incomplete historical-mode proposal is rejected without authority. The JSON
schema also requires claimed-complete scope for both complete modes.

The read-only witness SID cannot be the commissioning executor SID. The executor
may still be the operator SID or another actually admitted fixed route; this does
not require a third account or third signing root. Schema shape alone is
insufficient: the semantic principal/evidence checks remain mandatory.

### Digest identity invariant after independent review

Review of e4174c1 identified that evidence producer-enrollment placeholders could
pass the selected-field zero check. The structural correction defines every
schema-declared SHA/digest/nonce identity as nonzero in the shared hex schema,
including each evidenceDigest and producerEnrollmentDigest, candidate/issuer
bindings, boot-boundary references and a non-null lifecycle predecessor.
The local shape validator and all three exported JSON Schemas apply that same
definition; the selected-field list is removed. A traversal test mutates every
declared digest field in every proposal and re-signs each invalid wire, proving
that neither structural validity nor the signature wrapper admits placeholders.

This is input integrity only. A nonzero hash is not correlated producer evidence,
issuer enrollment, host policy adoption, native custody or authority. Existing
correlation, principal separation, fixed identity, freshness and independent
protected-adoption requirements remain mandatory. Complete historical enrollment
still requires complete prospective estate, and the executor remains separate
from the read-only witness.

### Shared evidence-reference model after structural review

The source-defined `evidenceRef` type annotates producer/enrollment, adopted
policy/revocation, original execution/estate, process-token, boot/scope,
commissioning review/source/consent, signing custody/audit/approval and lifecycle
predecessor references in all three schemas. One semantic traversal resolves
every present reference against the same fresh evidence-digest index. Duplicate
digests with different record identities are ambiguous and rejected. A new
reference cannot be added to one contract while silently missing a branch-local
correlation check. Exported-schema annotations are documentation for JSON Schema
clients; the shared semantic validator remains mandatory.

Source/tree/image/bundle/manifest/lease/native identity and public-key hashes,
and provider/recipe/test/recovery/storage-policy content pins, remain content
identities. A content hash is not implicitly a producer's evidence record.
Expected original/candidate binding and actual admitted provenance checks remain
separate. Complete prospective-scope references are checked when completeness
is claimed; an explicit incomplete/UNKNOWN proposal still requests a decision
and grants no custody. A missing historical PID is not reconstructed.

Producer-enrollment correlation is only a declared reference edge. A matching
record, a fresh timestamp, a valid signature, or a cycle of matching declarations
cannot authenticate a root or enroll a producer. Actual independently adopted
issuer/producer policy and native proof remain required outside this preparation.

Traversal regressions mutate every declared reference in normal, historical
process, boot-boundary, rotation and revocation variants, then re-sign the invalid
wire. Ambiguous digests, missing producer references and stale records are
rejected. All adoption, execution, signing and lease authority remains false.
