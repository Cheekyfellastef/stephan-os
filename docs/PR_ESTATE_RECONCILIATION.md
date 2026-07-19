# PR Estate Reconciliation

Issue: #1558

Stephanos treats every open pull request as governed mission state. An open PR may not remain an unowned branch-shaped ghost.

## One family, one canonical lane

Each capability family has exactly one canonical survivor. Other members must be proven as one of:

- already contained in current `main`;
- fully superseded by the canonical survivor;
- carrying unique work that must be transplanted;
- a failed placeholder with no unique branch delta;
- waiting for a documented live acceptance or exact-head operator approval gate.

Similarity is discovery evidence, not closure evidence. A shared title, task link or changed-file overlap can place PRs into a family, but it cannot by itself prove that one PR is safe to close.

## Fail-closed evidence rules

- `ALREADY_IN_MAIN` requires explicit comparison with `main` showing no commits unique to the PR head; containment in another base branch is not mainline evidence.
- `SUPERSEDED` requires a named canonical PR plus patch-equivalence or explicit no-unique-delta evidence.
- `PLACEHOLDER_FAILED` requires both the Codex failure marker and compare evidence proving no unique commits.
- Prepared snapshots must state both PR state and comparison base explicitly; missing values are never synthesized as `open` or `main`.
- Unknown branch state, missing compare evidence or conflicting canonical candidates yields `AMBIGUOUS_REVIEW_REQUIRED`.

## Usage

From a prepared snapshot:

```text
npm run stephanos:pr-estate:reconcile -- --input tmp/open-prs.json --repository Cheekyfellastef/stephan-os --output tmp/pr-estate-ledger.json --human-output tmp/pr-estate-report.md
```

From authenticated GitHub CLI, including branch-to-main compare evidence:

```text
npm run stephanos:pr-estate:reconcile -- --from-gh --compare --repository Cheekyfellastef/stephan-os --output tmp/pr-estate-ledger.json --human-output tmp/pr-estate-report.md
```

The command is intentionally read-only. A reconciliation-required exit is expected until every family has a safe disposition. GitHub collection requests one overflow sentinel and refuses to certify an estate above its 1,000-record bound.

## Cleanup protocol

1. Generate the ledger against all open PRs.
2. Work one capability family at a time.
3. Select the canonical survivor only after branch-to-main and branch-to-canonical comparison.
4. Transplant unique work into that survivor.
5. Run source tests and any required Battle Bridge acceptance at the exact canonical head.
6. Add a durable closure comment to each terminal PR naming its canonical replacement or mainline proof.
7. Close superseded, contained, or failed PRs. Do not delete branches until recovery evidence is durable.
8. Regenerate the ledger and require convergence.

## Completion

The estate is controlled when every open PR is canonical, waiting on a real gate, or terminally disposed with evidence, and no capability family has more than one active implementation lane.

## Exact-head review coordination

The review coordinator treats comments as evidence only when the comment actor matches the configured trusted coordinator login. Canonical-lane references must grammatically identify the PR being evaluated; mentions of replaced PRs do not disqualify the actual canonical subject. The latest trusted controller state is authoritative, with comment ID breaking GitHub's second-resolution timestamp ties, so a later queued, superseded, non-canonical or no-longer-active declaration revokes stale positive lane evidence. Every coordination pass scans all open PRs to preserve single-canonical-lane enforcement before a requested PR may advance, refuses to act on a pagination-truncated estate, and accepts only safe positive decimal manual PR numbers.

Review receipts are causally ordered as well as head-bound. Every required workflow must have a successful exact-head completion timestamp, an external Codex receipt from the exact authenticated Codex GitHub App identity must be created strictly after the latest of those completions, and the durable coordinator receipt must follow that external receipt. Same-second issue comments are ordered by comment ID; a same-second review and issue comment are incomparable and fail closed until a later durable receipt exists. Plain-user aliases, lookalike actors and pre-proof or unauthenticated dispatch, receipt and escalation markers are ignored fail-closed.

Every mandatory proof workflow runs for every pull-request head; path filtering may not make a required proof permanently absent, and successful runs are bound to their source-controlled workflow paths rather than display names alone. Coordinator mutation also requires the dedicated bounded coordinator secret and refuses the built-in workflow token fallback.
