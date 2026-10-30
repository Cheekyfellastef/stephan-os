# ChatGPT GitHub-first authenticated discovery V1

Owner: #1574 — Provider-neutral build and review continuity when Codex capacity is unavailable.

PR #3120 proved a real independently reviewed protected merge via GitHub without obtaining the blocked original conveyor lease. This next **source-only** rung connects its stateless picker to authenticated GitHub goal identity and complete open-PR source scopes. It is not an automatic source worker.

## Implemented

- `readChatgptGithubGoalEstateV1`: fixed read-only GraphQL query, one target GitHub issue, default-branch SHA, and complete open-PR changed-file inventories, capped at six 40-PR pages and 100 changed files per PR. Each claim retains the observed PR-head SHA and a head-bound reference; a SHA-256 snapshot binds all PR heads and paths, so changed source cannot inherit an earlier inventory fingerprint. Every page is validated for coherent main head, issue identity, PR count, duplicates, and cursor progress. Errors and incomplete scopes hold closed.
- `planChatgptGithubAuthenticatedDiscoveryV1`: feeds GitHub-observed issue/title/head/PR claims into the existing `planChatgptGithubGoalCandidatesV1` selector. An active same-task ChatGPT branch or overlapping PR paths blocks the affected task. No auto-run capability results.
- Independent 14-case Node regression suite covering pagination, exact PR-head and path-bound snapshot digest changes, task/path collision, denied credentials, quota errors, source changes, partial GraphQL responses, unknown physical ownership, unsafe scope and incomplete pagination.

## Crucial separation of GitHub versus Battle Bridge truth

GitHub can authenticate its **own** issue and open PR state. It cannot authenticate whether the original Goal Conveyor, Seed Forge, Rescue Island or another ChatGPT route owns physical local worktrees, source attempts and paths. The adapter therefore exposes `GITHUB_VERIFIED_LOCAL_OWNERSHIP_PENDING`, with mutation/merge/unattended authority **false**. It does not accept an arbitrary task's `VERIFIED_UNCLAIMED` assertions as physical proof.

The existing Sovereign Commander / Shared Workspace custody observer must separately collect and attest source-bound, fresh, physical local ownership across all four routes before any run is admitted. A subsequent protected executor must still re-read current main and source/branch collisions, reserve precisely one task, emit actual pickup/commit receipts and follow independent exact-head review and operator-protected merge. No historical #2962/r7 lease is cleared.

## No new trap

- No new daemon, controller, scheduler, queue, lease owner, polling timer, review gate or publisher.
- One GitHub scan is bounded; quota failure never loops. This code does not poll GitHub itself.
- Incomplete open-PR inventory is **unknown**, not an empty candidate estate.
- No physical/GPU work is initiated; gaming mode remains unaffected.
- One stuck goal does not invalidate a separately evidenced unrelated task, but unknown physical ownership may prevent *that task's mutation*.
- Passing source tests or merging this change must not be reported as automatic goal pickup or delivery.

The next proof after this source merge is a true credential-backed GitHub scan connected to the existing independently authenticated Sovereign local custody observer. Only then can unattended candidate selection be qualified.
