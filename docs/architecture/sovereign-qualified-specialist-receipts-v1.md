# Sovereign qualified specialist receipt consumer v1

## Status and ownership

This is a source-level, default-deny receipt consumer for the existing protected
independent-review flow. It grants no enrollment, installation, model, native
runtime, merge or playtest authority. The production enrollment and public-key
artifact registries are empty. A local model, a calibration candidate, a clean
chunk summary, a signed self-description and the tests in this change cannot
qualify a reviewer.

The owner remains issue #1574, **Provider-neutral build and review continuity
when Codex capacity is unavailable**. The explicit provider-admission change
continues PR #2037, **Fail closed on implicit Codex specialist review**, retaining
all five original changed-file semantics. Existing callers may admit the legacy
Codex route only through its existing explicit `codexRequired: true` policy.
The hosted collector supplies `false`; the new native route does not turn that
flag on, invent an opt-in, or replace the existing artifact consumer.

PR #3433, **Goal #1574: bind every Sovereign Reviewer request to a local model
digest**, supplies source prerequisites. Its merge does not install or enroll
reviewer, auditor or witness principals. The Starfield monitor-test source in
PR #3424, **Connect Hybrid / Stephanos VR button to the reviewed monitor test**,
still requires actual qualified review and native commissioning. This consumer
does not start that one-use test or prove playable headset VR.

## Existing authority-bearing call path

The existing trusted `scripts/independent-merge-security-review-v2.mjs` collector
first authenticates the exact PR/head/base and its changed-file inventory. When
a native artifact marker is present, it calls
`captureSovereignSpecialistGitHubSourceV1` using the new fixed-origin read-only
transport. That captures both complete Git tree estates, reconstructs and hashes
every tree, authenticates all changed old/new blobs and invokes the shared
native canonical formatter. The collector passes the resulting source binding
to `adjudicateQualifiedSpecialistReview`.

The native comment consumer requires that live binding. It can remove only the
existing unsupported-surface findings whose complete path estate the qualified
review covers. An absent binding, incomplete source, malformed artifact or
unqualified identity leaves the findings intact. Semantic P1/P2 findings and
the separate approval-boundary bootstrap P0 retain their existing behavior.

An accepted native artifact is embedded in the unchanged
`operatorMergeReviewArtifactV1` immutable result. Its downstream revalidator
checks cryptography and exact head/base but reports
`liveSourceBindingVerified: false` when no newly collected live binding is
supplied. This narrow validity result is not a fresh source fetch or a trusted
workflow receipt. The protected consumer must still authenticate the original
workflow, job, run attempt and archive, exact head/base and existing operator
approval. No pure artifact return value supplies those transport identities.

## Source identity and bounded transport

`authenticated-replacement-hunks-v1` is the native reviewed representation.
`formatAuthenticatedReviewDiffV1` is used by both native capture and the GitHub
adapter. Its result binds the complete changed paths, old/new Git blob IDs and
content digests, modes, canonical diff digest, line count and authenticated
object-closure digest. Trees and commits retain distinct identities.

GitHub's ordinary PR diff may use multiple hunks and different index formatting.
Its digest is recorded only as `githubRawDiffSha256`. It is never compared to
the canonical digest as though the two byte representations were interchangeable.
The GitHub adapter authenticates commit metadata through the exact GitHub API;
it does not describe JSON commit metadata as a reconstructed raw commit object.
It independently reconstructs every raw tree and verifies every changed blob.

Source capture uses one actual 60-second AbortSignal across all requests and
checks the elapsed deadline before returning a result. The new transport admits
only fixed-repository Git commit/tree/blob GETs, exact status 200, exact origin
and response URL, and no redirect. It limits bytes while consuming the stream:
512 KiB commit JSON, 8 MiB complete tree JSON, and bounded base64 blob JSON for
a 2 MiB object. Decoded response bytes retain those caps when Node fetch decodes
gzip/deflate/Brotli. Wire Content-Length equality applies only to unencoded
bodies. Declared wire sizes remain bounded. Stalled, overflowing, malformed and
partial reads cannot return a source binding.

At most 64 changed files, 20,000 entries per tree and a 32 MiB captured object
estate are admitted. The canonical renderer has a 2 MiB bound; this consumer
retains its stricter **1 MiB full diff** limit, further restricted by the enrolled
profile. Unsupported renames, unresolved paths, mode transitions, binary content
and changed nonregular objects remain held. There is no truncation fallback.

## Versioned signed proof contract

The envelope schema is `stephanos.sovereign-qualified-specialist-artifact.v1`.
It has a canonical JSON payload digest and separate domain-separated Ed25519
signatures. It carries no trusted keys, enrollment rules, clock or root selector.
The verifier reads only the protected-source enrollment registry and pinned
public artifacts, following the repository's native custody/auditor-pin model.

| Component | Required binding and independent evidence |
| --- | --- |
| Enrollment | Repository, reviewer/model digest, separate reviewer/auditor/witness principals and keys, device/runtime/custody profiles, qualification for every derived domain, expiry/revocation, commissioning and operator approval references. Empty by default. |
| Reviewer receipt | Exact PR/branch/head/base/trees, complete canonical diff and object estate, domains, nonce, independent session, model digest and clean provider-neutral review receipt. |
| Native custody witness | Actual Windows token/identity readback, separate original implementer, five negative-write targets with Win32 access-denied evidence, direct/task reentry denial, protected signer-store readback, installed-parent and boot/audit evidence. A signed `passed: true` list is rejected. |
| Capability exam | The existing ten ordinary and five privileged challenge receipts, signed by the independently pinned auditor. Privileged evidence digests must match the structured native measurements. The underlying exam remains candidate-only by itself. |
| Model calibration | All ten baseline and thirteen Windows cases passed against current corpus digests, exact model/source/reviewer/session and bounded freshness. The verifier authenticates the auditor's attestation of the summaries and observations digest; it does **not** replay or inspect every raw model response. Retaining and auditing those responses is an issuer obligation. |
| Complete inference execution | Separate witness signature over the entire canonical diff/object closure and changed paths, complete cross-file stage, exact prompt/template, measured context/token budget, bounded model output and normal completion, exact local model selector, aggregate duration and continuous gaming-governor proof. |
| Auditor attestation | Separate auditor signature over the review binding, reviewer signature, native/capability/calibration/execution digests and verdict. The reviewer cannot enroll or audit itself. |
| Replay witness | Separate protected journal reservation tied to the exact review nonce/binding and admitted journal generation. Repeated reads of the same immutable artifact are idempotent; a borrowed nonce/binding/generation is rejected. This consumer does not create or consume a journal entry. |
| Authority self-change | A fourth, separately pinned out-of-band root signs independent policy review of the exact source change. The ordinary reviewer, auditor and witness cannot satisfy this fourth role. |

The execution profile admits either a conservative UTF-8-byte upper bound for
input tokens or an independently pinned tokenizer with evidence for the actual
prompt. Prompt inclusion, input plus reserved output, model context, completion
reason, exact model identity and continuous resource permission must all agree.
There is no acceptance path for isolated chunk-only clean summaries.

## Complete authority closure

`sovereignSpecialistAuthorityClosureV1.json` declares the actual intake,
workflow-entry, receipt consumer, approval/base-binding and transitive module
estate. The parse-only fixture follows static imports and re-exports without
linking or evaluating reviewed modules. It models the existing fixed script
handoffs and byte-pinned Windows switchboards only at their exact inspected
source hashes. Unknown computed dependencies, missing members, extra unresolved
imports and changed fixed interpretations fail the closure proof.

The declaration, proof helper, proof tests and existing review/source-proof
workflows protect themselves. Every declared path has a path-alone hostile test
requiring the fourth root. Case aliases use the same protection on Windows while
source object identities remain byte/case exact. This supplements the existing
bootstrap P0; it does not discharge that independent gate. A future new module
edge must update and independently review this same closure, not append an
unrelated pattern exception to the verifier.

## Native commissioning: existing actions and unimplemented producers

The following is a commissioning inventory, **not a list of commands to run
now**. Only the established guarded owner may perform admitted native actions;
this source change grants no native mutation authority or lease transfer.

| Required step | Existing command/action or exact gap |
| --- | --- |
| Capture exact reviewed source | `captureAuthenticatedReviewDiffV1` and the shared formatter exist. The new GitHub adapter reconstructs the same canonical result from authenticated metadata/tree/blob evidence. These are source proof, not reviewer qualification. |
| Observe local model binding | Existing `observeLocalSovereignOllamaDigestV1` and the high-risk adapter observe/recheck the local digest. No caller-supplied model label substitutes for that observation. |
| Ten-case baseline calibration | Existing fixed `node scripts/sovereign-reviewer-ollama-calibration-v1.mjs --once` flow evaluates the ten-case candidate under its established preconditions and can retain an **unattested** candidate. It does not issue this signed qualification artifact. |
| Thirteen-case Windows calibration | Existing `node scripts/sovereign-windows-review-calibration-v1.mjs --once` uses the installed-parent entry. The registered `sovereign-windows-reviewer-calibration` action selects `--commander-once` under the existing guard. Its result is still a calibration candidate. |
| Generate/install three independent keys and principals | **UNIMPLEMENTED for this signed specialist schema.** No existing admitted action generates and installs this reviewer/auditor/witness identity set or public enrollment record. Ordinary project key generation is not an acceptable substitute. |
| Independently collect/sign Windows custody proof | **UNIMPLEMENTED for this schema.** Existing custody primitives and candidate checks do not produce the separately witnessed five-role negative-write, reentry and protected-store artifact required here. No invented SID or fixture identity is enrolled. |
| Independently audit/calibrate and issue capability receipts | Existing pure calibration/exam validators exist; the independent native auditor issuer for this envelope is **UNIMPLEMENTED**. Signing a candidate without auditing the actual OS/model evidence is not sufficient. |
| Complete cross-file inference at Starfield scale | **UNIMPLEMENTED in the qualified producer.** The existing high-risk advisory admits 256 KiB, 6 KiB chunks, at most 96 chunks, 8,192 model context tokens, 120 seconds per call and a 13-minute installed-parent deadline. It has no complete cross-file pass, durable resume or evidence producer satisfying this execution contract. Raising only a byte cap is insufficient. |
| Reserve and sign replay-safe artifact | **UNIMPLEMENTED for this schema.** No existing admitted producer writes and witnesses the exact protected nonce journal, separate reviewer signature and auditor attestation together. The verifier does not provision those roots or consume a one-use test journal. |
| Publish authenticated public enrollment | **UNIMPLEMENTED commissioning procedure for these records.** It requires retained native evidence, independent security review and real operator approval through the existing owner. This change's production registry stays empty. |
| Publish signed review artifact/comment | **UNIMPLEMENTED native issuer/publisher for this envelope.** The trusted hosted intake can consume an artifact after a real issuer exists; this source change supplies no alternative GitHub mutation, credential or arbitrary dispatch action. |
| Reuse installation after main advances | **UNIMPLEMENTED adoption-proof consumer.** Version 1 requires the witnessed installed head/tree to equal the review base head/tree. An older immutable installation yields `SOVEREIGN_SPECIALIST_INSTALLED_PARENT_UNPROVEN`, even if another runtime component has valid equivalent-closure adoption proof. A later reviewed bridge must verify that proof separately and bind immutable installation identity and current execution identity; neither identity may be relabelled. |

The observed PR #3424 patch estate was already approximately 435 KB before
canonical framing. The unchanged advisory's 256 KiB/8K context is therefore
not an executable qualified route for that review. The new 1 MiB consumer cap
and 2 MiB formatter are representation/validation bounds, not a claim that the
installed model has sufficient context, deadline or gaming-safe capacity.

Commissioning remains open until these actual producers exist, their exact
source is independently reviewed, required native proofs are retained, keys and
principals are independently enrolled, and the existing protected intake accepts
an authentic complete review. None of the missing producers should be reported
as merely “not yet observed.” They are implementation dependencies.

## Validation and delivery boundary

The existing read-only `protected-merge-source-proof` job explicitly runs the
signed-verifier, source-adapter/transport, authority-closure and canonical-renderer
test files. Its runner, trigger, permissions and merge authority are unchanged.
Focused original PR #2037 tests retain positive explicit Codex opt-in cases and
negative implicit-admission cases.

Ephemeral test keys and identities remain inside source-only fixtures. The test
loader replaces the empty enrollment import only in an isolated in-memory module;
production exposes no key or trust-root injection argument. Real temporary Git
objects prove canonical/native equivalence, and hostile streaming transports
prove rejection without full unbounded buffering. These are deterministic source
proofs. Hosted workflow success, installed Windows qualification, original-owner
lease resolution, protected review acceptance and the Starfield monitor playtest
are separate observed milestones.
