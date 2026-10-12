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
