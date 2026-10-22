# Sovereign high-risk review candidate V1 (#1574)

## Purpose

Provide meter-free review preparation for large or high-risk source changes
without pretending a local Ollama model is an independent security specialist.
The immediate blocked work is #3047, the emergency #2962 lease rescue lane.
PR #3005 merged the standard-risk Sovereign Reviewer, but its 12 KiB cap and
explicit high-risk refusal prevent it from handling #3047.

This slice retains that V1 refusal without modifying its approval semantics.

## Delivered code

- shared/agents/sovereignHighRiskReviewCandidateV1.mjs: a bounded
  256 KiB full-diff parser, exact changed-path estate check, SHA256-bound
  full-diff and candidate packet identity, UTF-8 line-preserving chunks of
  at most 6 KiB, and mandatory sequential coverage of every chunk.
- Each local read-only model reply must bind the exact chunk ID and SHA256,
  the exact changed path and bounded P0/P1/P2 findings; omitted chunks,
  oversized lines, binary/renamed changes, contradictory verdicts, invalid
  evidence or changed source identity fail closed.
- scripts/sovereign-high-risk-advisory-v1.mjs --once: reuses the existing
  fixed Git execution boundary, requires exact checked-out source HEAD,
  branch, clean tree and ancestor base, and invokes local Ollama on localhost.
  Publishes a bounded HELD status via the Windows-capable writeAtomicJson
  Shared Workspace writer rather than the V1 Linux-only stable FD writer.
  No raw patch or model output is published to the status record.
- Deterministic tests include a 30 KiB patch, multi-file coverage, bad
  replies, no-authority guarantees, incomplete evidence, and safe publication.

## Crucial review/merge boundary

Successful advisory completion means only:

HIGH_RISK_LOCAL_CANDIDATE_READY -> PENDING_INDEPENDENT_SPECIALIST_ATTESTATION.

It does NOT mean qualified specialist review; authenticated independent
reviewer identity; an accepted provider-neutral specialist receipt; GitHub
security-review check success; operator merge approval; source lease release;
or runtime deployment.

The model's claimed reviewer session is not authentication. It cannot be
promoted into the provider-neutral qualified review contract by this module.
Changes to review/security/lease/Windows authority still require the
pre-existing qualified independent security/specialist gate. This PR modifies
the reviewer itself; it cannot use its own output to approve itself.

## Remaining system work

1. Independently qualify an actual sovereign high-risk specialist through
   an existing trusted reviewer and verifier: exact source/head/base/tree
   proof, independent principal, full-path coverage, audit, and protected
   approval-gate interoperability. No self-proclaimed local identity.
2. Repair the GitHub installation 403 on the existing hosted independent
   review under #2954, without weakening branch protection.
3. Prove Battle Bridge synced exact reviewed source and published a fresh
   sovereign-high-risk-advisory-3047.json HELD status. This source PR itself
   is neither installed nor daemonized on Battle Bridge.
4. After an independently approved merge, prove #3047 rescue live and
   collect real #2962 lease/re-entry and two unattended refill receipts.

## Focused tests

node --test shared/agents/sovereignHighRiskReviewCandidateV1.test.mjs scripts/sovereign-high-risk-advisory-v1.test.mjs

Never mark autonomous builder recovery green from advisory evidence alone.

## Execution and reviewed-content custody continuation

The supported high-risk candidate entry is now the independently installed
`scripts/sovereign-high-risk-advisory-launcher-v1.mjs --once`. It reuses the
canonical exact-commit loader: authenticate and capture the complete closed
module graph before candidate imports, including the Git verifier and transitive
workspace modules. The advisory implementation remains an importable library;
direct source-checkout invocation returns HOLD without inference/publication.
The launcher, loader, Git boundary and OS binaries are an externally protected
installed-parent prerequisite. A writable copy cannot certify its own trust.
The canonical coverage projection points at this launcher. No new scheduler,
qualification identity, signer or authority is introduced.

Both review commits and the complete base/head tree estate are hash-verified.
Every changed old/new blob is captured and hash-verified, and a bounded conservative
unified diff is derived in memory. Ordinary Git diff is not a content trust
root. Unsupported/binary/oversize content holds; nothing is silently truncated.
The reviewed-object closure hash binds the source packet. This shared reader is
also used in the #3090 native high-risk snapshot correction. The standard reader separately authenticates the same raw-object invariant.

One independently observed installed-model digest is pinned for the entire
advisory. Every adapter chunk receipt binds that digest, chunk ID and content
hash; a replacement between chunks holds. The digest is retained in each
reviewed-chunk record, candidate evidence, final packet hash and status summary.
The tag is also reobserved after the complete run. These remain unqualified
observations, not independent model provenance or signer enrollment.

Real fixture tests substitute entry, Git verifier and transitive module bytes
before launch; none evaluate. A reviewed non-executable Git blob is corrupted
only while read and restored immediately: authentication still refuses it.
Multi-chunk digest substitution, absent receipt binding, source drift and
no-authority regressions remain fail-closed. Hosted Linux validates the complete
POSIX snapshot/governor fixtures; Windows runs the actual object/loader fixtures
and portable contracts. No live model inference, installation or R7 change is
part of these tests.

### Direct-consumer execution custody continuation

Native Windows calibration and coverage intake now use the same independently
protected installed-parent launcher as high-risk advisory. Their public entries
import no candidate snapshot or diff implementation. The launcher authenticates
the complete fixed native/coverage/advisory engine graph from raw exact-commit
objects before ESM evaluation, including the authenticated diff reader and all
transitive imports. Only fixed entry identifiers are admitted; no caller path,
module, command or preload option is accepted. Private Commander remote output
projection also executes inside that immutable graph.

The #3090 source lineage is integrated into this candidate so that native digest
addressing, total deadline, base-bound readback and original WSL/Commander loader
fixes remain intact. #3090 itself remains unchanged. Unit tests import engine
libraries as test subjects; production/public CLI entries use the trusted parent.
The protected installation closure now includes those public entries, common
launcher, serialized loader, Git boundary and OS binaries. An ordinary writable
copy cannot establish that trust. No installation or signer enrollment is claimed.

Real temporary Git fixtures exercise each route with hidden entry, Git verifier,
diff reader and transitive workspace substitutions. The public coverage/native
CLIs are exercised too; hostile bytes never evaluate. Clean coverage must still
produce its bounded candidate scope. Windows/Linux exact-head CI runs these
fixtures and native deadline/digest tests. All results retain no authority.
