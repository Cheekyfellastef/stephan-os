# Protected READY review failure recovery V1

This contract continues the existing protected READY and exact-head review lane. It does not create a second reviewer, READY transition, merge path, approval source or runtime authority.

## Closed-world recovery identity

The repeated recovery failures were reviewed as one structural contract rather than three local exceptions. One closed-world identity must cross every boundary: the real GitHub compare response proves the original base, merge base, ordered commit tip and changed-file span; recovery qualification preserves the historical owner packet, patch and independent-review base while separately pinning both live PR reads to the continuity-proved current base; and the canonical protected-merge consumer accepts exactly one ordinary lifecycle proof or one recovery proof, never both. The compare API does not promise a top-level `head_commit`, so the ordered final commit plus the separately fetched single-parent correction commit bind the tip. Ordinary exact-head qualification remains strict and unchanged.

Regression coverage therefore uses the actual compare response shape without an invented `head_commit`, exercises recovery qualification with an advanced live base while retaining the historical review bindings, and passes the resulting recovery proof through the real personal-repository check validator. This is the property-level guard for the shared invariant; no boolean waiver or duplicate consumer is permitted.

## Prevention before READY

Before a draft pull request is changed to READY, the protected producer must read the complete exact-head changed-file inventory and API diff, rerun the unchanged deterministic engine and, when it emits findings, validate the existing exact owner escalation against the producer's selected independent review. The producer must reread the same head, tree, base, owner command and draft state around those reads. Missing, expired, edited, ambiguous or differently bound qualification holds the draft. A later lifecycle run repeats the same checks; the preflight is not a review receipt or merge authority.

The file count and every bounded page must match both live PR snapshots. The fixed diff transport requests identity encoding and requires HTTP 200, the diff media type, no Content-Range, normal stream completion and matching Content-Length when present. It bounds bytes while reading and applies the same deadline to fetch and body reads. Git's existing read-only `apply --numstat -z` parser validates the unchanged patch's full hunk structure; its complete filename and per-file addition/deletion estate must match the authenticated API rows, including renamed, binary and mode-only files. No patch is applied and no recount or unsafe-path option is permitted. An interrupted or syntactically incomplete prefix cannot become preflight input. Before the sole review dispatch, the original selected independent evidence, full input and owner qualification are checked again, followed by a fresh one-use run inventory.

The existing READY caller completes its read-only target and mailbox-rotation checks before this final preflight. The producer reads the owner before its last complete thread inventory, then synchronously checks that same owner's expiry before returning. The caller immediately invokes its existing fixed READY mutation, without another awaited policy or identity read in between. This removes the known asynchronous freshness windows; it does not claim that GitHub reads and mutation are one atomic transaction. The existing post-mutation identity and artifact checks still apply.

The closed correction source inventory contains the original twelve recovery files plus `scripts/dispatch-protected-merge-from-mailbox.mjs`, whose ordering is part of this same transition. No Control Tower skipped-check policy is added by this correction.

## One failed-tuple recovery

Recovery is eligible only when all of the following are proved from live GitHub records and immutable artifact bytes:

1. The canonical READY producer succeeded once at attempt 1, performed the actual draft-to-READY transition and published one valid handoff.
2. Exactly one normal protected READY review run exists for that handoff tuple. It is attempt 1, terminal failure, and its one `exact-head-review` job failed only at `Review ready head with the unchanged engine and qualified escalation`.
3. The lifecycle receipt upload was skipped, no lifecycle receipt artifact exists, and exactly one SHA-bound diagnostic artifact exists. Its archive binds the original handoff context, complete input, changed-file list and API patch.
4. Re-executing the unchanged engine over those preserved bytes produces only source-qualifiable P2 findings. A P0, P1, different P2 class, changed input or different patch digest remains terminal HOLD.
5. One fresh unedited owner escalation binds the original repository, PR, head, base, API patch SHA-256 and all five selected independent-review fields. Its scope remains `exact-head-review-only`; it grants no approval or merge authority.
6. The selected independent run, attempt, job, artifact metadata, archive digest and sealed payload are reread and remain exactly the selection in the immutable READY handoff.

No failed-job rerun, second normal dispatch, attempt-number exception, run deletion, draft reset, artifact overwrite or owner-window renewal is recovery evidence.

## Canonical continuation

The recovery execution is a distinct owner-qualified `issue_comment` operation of the existing `stephanos-exact-head-review.yml` workflow and the existing engine. The fresh exact-head escalation comment is both the immutable qualification and the event identity; it is not a workflow rerun or a second READY dispatch. The sealed receipt includes the failed run ID and original handoff digest, so it cannot match or replace the normal lifecycle run. It runs once at attempt 1 from protected current main, validates the failed run and artifact before review reads, then seals one recovery receipt that references rather than rewrites the failed record.

If protected main advanced while the PR head stayed frozen, stale-base continuity is admissible only when the collector proves the complete, non-truncated base-to-current-main commit and changed-file span and that whole span is disjoint from every file in the preserved PR input. The final current-main commit must be the recovery correction itself, with one parent and an exact changed-file set contained by the closed recovery-controller source allowlist. This preserves intervening protected main history without pretending it is part of the correction. The live PR must remain open, non-draft, same-repository, same branch, exact frozen head and tree, and mergeable into the current main snapshot. Any overlap, truncated history, non-tip correction or unrelated file in the correction commit requires the normal head/base refresh and fresh review; it cannot use recovery.

The final protected merge still requires a new exact operator merge approval against the then-current protected main and all ordinary current-main checks. Historical READY recovery cannot supply that approval.

## Recovery receipt and collector

The sealed recovery receipt must bind, at minimum:

- original PR, branch, head, tree and base;
- READY producer run, handoff artifact and handoff payload digest;
- failed review run, attempt, job and diagnostic artifact archive digest;
- preserved input patch and changed-file digests;
- unchanged engine receipt and exact qualifying finding set;
- owner escalation comment ID and immutable body digest;
- selected independent run, attempt, artifact ID, archive digest and payload digest;
- recovery run, attempt, trusted source SHA and current-main continuity span;
- observed current PR head, tree, draft, mergeability and current base head.

The collector accepts either one ordinary successful lifecycle receipt or one failed-attempt-1 plus one valid recovery receipt. It rejects zero, both, duplicates, reruns, later pending/failed runs, ambiguous artifacts, changed GitHub state, overlapping source continuity and any receipt that hides the original failure.

## Existing held tuple

PR `#3407` is the motivating preserved tuple: head `e84a62a1721e73d495e47828ae0dfa18a38cb2a9`, tree `d2a8a724c9ec5c32d91b0b2b543ef22bf3f4ab0e`, base `d2e74846d0624d39e3fe7dc284e6d668fcf96626`, READY producer `42083115164`, failed review `42083220755`, diagnostic artifact `13442192786`, patch SHA-256 `5be4e37586dc0fdfed845426f005bca294b8e1fc7e7ed2799a0e362645acd48e`, and selected independent review `42061347090` attempt 1 / artifact `13432316911`. These values are evidence for that tuple, not reusable constants or a hard-coded allowlist.
