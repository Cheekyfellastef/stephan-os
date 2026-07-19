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

- `ALREADY_IN_MAIN` requires explicit compare evidence showing no commits unique to the PR head.
- `SUPERSEDED` requires a named canonical PR plus patch-equivalence or explicit no-unique-delta evidence.
- `PLACEHOLDER_FAILED` requires both the Codex failure marker and compare evidence proving no unique commits.
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

The command is intentionally read-only. A reconciliation-required exit is expected until every family has a safe disposition.

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

The review coordinator treats comments as evidence only when the comment actor matches the configured trusted coordinator login. Canonical-lane references must identify the PR being evaluated; a controller comment that names another PR as the active lane cannot make the current PR canonical. The latest trusted controller state is authoritative, with comment ID breaking GitHub's second-resolution timestamp ties, so a later queued, superseded, non-canonical or no-longer-active declaration revokes stale positive lane evidence. Every coordination pass scans all open PRs to preserve single-canonical-lane enforcement before a requested PR may advance, and manual PR numbers accept only safe positive decimal digits.

Review receipts are causally ordered as well as head-bound. Every required workflow must have a successful exact-head completion timestamp, an external Codex receipt from the exact authenticated Codex GitHub App identity must be created at or after the latest of those completions, and the durable coordinator receipt must follow that external receipt. Plain-user aliases, lookalike actors and pre-proof or unauthenticated dispatch, receipt and escalation markers are ignored fail-closed.

Every mandatory proof workflow runs for every pull-request head; path filtering may not make a required proof permanently absent. Coordinator mutation also requires the dedicated bounded coordinator secret and refuses the built-in workflow token fallback.
