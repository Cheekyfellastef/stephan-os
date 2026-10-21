# R7 first-root source evidence resolver proposal

Continuation: #3123 — Goal #2961 child: commission protected Windows r7 custody witness and independent signer.
Source owner: PR #3178 — Goal #3123: prepare audited R7 custody service and authority contracts.

This source preparation implements read-only evidence hydration. It is **not
adopted, wired into the workflow, an authority issuer or live proof**.
It uses the included unadopted `r7FirstRootOwnerIntakeProposalV1.mjs`
packet model. No non-issuing CLI or placeholder workflow job is added.

## Runtime interface and authority boundary

`createR7FirstRootSourceEvidenceResolver({githubReadToken}).resolve(input)`
accepts a token explicitly mapped by a trusted job with read-only repository
permissions. It does not find credentials or read environment variables.
No production invocation or real token was used for these fixtures. The resolver
does not log anything. Factory and packet inputs cannot override HTTPS, headers,
origins, methods, resource paths or validators. All API calls are GET to the
fixed canonical repository; archive redirects use canonical signed-storage
origin/path/query validation with no GitHub token on the storage hop.

The original permit/dispatch/context shape is validated with the real clock.
The input also requires `nativeRecipientSpkiBase64`, exactly matching dispatch
`r7_native_recipient_spki_base64`. The intake computes the raw canonical RSA2048
DER-SPKI hash and binds the three-part audience
`stephanos:r7:first-root-owner-permit:v1:<permitDigest64>:<nonce64>:<recipientSpkiSha256>`.
There is no caller-supplied authentication boolean. Legacy audiences and key,
digest or dispatch substitutions are refused before any GitHub read. A complete
self-consistent replacement challenge remains untrusted: this validates byte
consistency only, not native pickup, freshness, OS consent or host admission.
The result authenticates bounded GitHub observations, never the native challenge
or host authority. Every policy adoption, source mutation, host execution, root
enrollment, token issuance, signer, lease release and approval-card grant remains
false, including the fixture path where all source evidence is valid.

The only positive `sourceAdoptionAuthenticated` case is exact real current main
equal to the actual protected squash commit, source tree, canonical review bytes,
protected owner records and exact source-built package content. This field means
**source provenance readback**, not first-root policy adoption or host enrollment.
The result is always `R7_FIRST_ROOT_SOURCE_EVIDENCE_HELD` because host gates are
separate. Do not pass this object as a caller-supplied authentication boolean to
any native root or signing consumer.

## Existing evidence reused

Independent review uses `validateIndependentReviewWorkflowRun`,
`validateIndependentReviewArtifactSet`, `executePersonalRepositoryArtifactArchiveTransport`,
`extractPersonalRepositoryArtifactZip` and `validateIndependentReviewArtifact`.
It binds repo/owner IDs, workflow definition, exact source/head/tree/base,
run/attempt/jobs, metadata completeness, artifact ID/size/archive hash and payload
hash. A valid bootstrap review with findings is not a clean independent review.

Protected source readback uses the existing protected workflow definition,
job-envelope, protected-environment, owner mailbox actor-handoff and squash
completion validators. It additionally fetches immutable completion comment
author/App/timestamps/body digest, exact run/attempt/jobs, actual owner approval
history, owner-authored mailbox comment/digest and actual Git commit/tree/parents.
It never constructs an approval receipt from asserted `ready` booleans. Approval
history has no attempt discriminator, so this proposed adapter conservatively
holds rerun attempts rather than reusing an earlier environment decision.

Historical mailbox authorization is evaluated at the authenticated source run's
creation time using its actual owner comment. It authorizes that historical
source operation only; it is not a renewed carrier, fresh first-root decision or
host consent. The exact completion comment must come from GitHub Actions Bot ID
41898282 and GitHub Actions App ID15368; unknown App provenance holds.

If main has advanced, real bounded forward ancestry and historical completion
may be observed. Current compatibility and source adoption stay held. No
historical `liveMainRef`, synthetic comparison or pre-merge movement adapter is
fabricated to force a positive post-merge result. Supporting further movement
requires an explicit canonical compatibility model with real file evidence.

Native package provenance consumes the existing `original-r7-scm-preflight.yml`
workflow ID387670512, `native-scm-preflight` job and
`r7-witness-uncommissioned-source-only` artifact. It fetches exact run/attempt/job,
artifact ID/creation time/size/digest and bounded archive bytes. The package
manifest remains `UNSIGNED_UNCOMMISSIONED`, with all host/signing/lease flags
false and historical outcome UNKNOWN. This is hosted CI content provenance.

## Proposed separate locator envelope

The original permit lacks source completion and package locators. Optional
`referencesWire` and `referencesSha256` therefore describe a separately closed,
canonical JSON object, maximum8192 UTF8 bytes, linked by `permitSha256`:

```json
{
  "schemaVersion":"stephanos.r7-source-provenance-references-proposal.v1",
  "permitSha256":"<64hex>",
  "sourceCompletion":{
    "runId":"<positive safe decimal>","runAttempt":"1",
    "commentId":"<positive safe decimal>","commentBodySha256":"<64hex>",
    "authorizationCommentId":"<positive safe decimal>",
    "authorizationCommentSha256":"<64hex>","evidenceSha256":"<64hex>"
  },
  "nativePackage":{
    "runId":"<positive safe decimal>","runAttempt":"<positive safe decimal>",
    "jobId":"<positive safe decimal>","artifactId":"<positive safe decimal>",
    "archiveSha256":"<64hex>","manifestSha256":"<64hex>"
  }
}
```

`candidate.bundleSha256` means the raw package ZIP archive SHA256 in this
unadopted interface. `candidate.manifestSha256` means the raw manifest file bytes
before UTF8 BOM/CRLF decoding; no normalization is used for its digest. Both must
match the locator envelope and fetched bytes. Missing references allow exact
review observation but cannot authenticate the omitted provenance. Current
unmerged PR3178 correctly holds source adoption even if its real package passes.

## Bounds and verification

At most80 HTTP requests, four100-record pages per collection,512KiB JSON bodies,
10-second API fetches,30-second archive fetches and120 seconds overall, further
bounded by the permit's five-minute expiry. No caller `now` override is accepted.
Mutable metadata, run attempts, source/main, comments, owner approval records and
environment are re-read. These are observations, not atomic transactions or CAS.
Any failed resolver check discards positive authentication flags and emits only
bounded fixed error codes, never bearer headers, exception text, signed URLs,
packet contents or raw artifact bodies.

Review ZIP limits remain256KiB unchanged. A separate in-memory native-package
adapter limits ZIP bytes to132MiB, the image to128MiB, manifest to16KiB and notices
to1MiB. It accepts two or three explicitly named regular files, including retained
THIRD_PARTY_NOTICES.txt, stored or bounded deflate entries and signed data
descriptors. It rejects ZIP64, encryption, symlinks, duplicate/unknown/path entries,
overlap/gaps, wrong local/central records, CRC/size/hash mismatches, trailing
compressed bytes, oversized expansion and duplicate/altered manifest fields.
It does not extract files, load assemblies, run a binary or modify disk state.

Offline tests use synthetic records, a non-authentic token, in-memory mocked fetch
and a nonexecutable image. Positive fixtures prove implementation mechanics only,
not a real review/approval/package or Windows commissioning. No specialist review
was requested, no source lease was changed and no native custody authority was
created by this preparation. Before production integration, preserve the existing
independent exact-source specialist and protected operator gates.
