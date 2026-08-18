# Independent Review Complete Review-Estate Fallback V1

## Purpose

Keep the canonical `Independent Merge Security Review` both fail-closed and operational when GitHub's REST pull-request reviews endpoint returns the inconsistent provider error:

```text
404 Not Found
Could not resolve to a node with the global id of 'PR_...'
```

The repair belongs in the one canonical review lane under #1637. Product PRs must not be patched individually and unreadable review evidence must never be translated into an empty review list or a clean verdict.

## Existing machinery reused

- `.github/workflows/independent-merge-security-review.yml`
- `scripts/independent-merge-security-review-v2.mjs`
- `scripts/independent-merge-security-review-with-windows-specialist-v1.mjs`
- `shared/agents/githubReadResilienceV1.mjs`
- immutable independent-review artifacts
- exact PR/head/base/current-main binding
- the existing failed-job-only review retry coordinator

No second reviewer, scheduler, merge gate, provider controller or runtime lane is created.

## Primary REST route

The trusted reviewer remains authoritative and continues to enumerate the complete paginated REST review estate.

It retries only read-only network failures, HTTP `429`, `502`, `503`, `504`, and the exact quoted or unquoted PR-global-ID `404`, within the fixed existing three-attempt budget. Writes are not retried. Every retry is guarded by an exact PR and current-main identity read. Exhaustion writes an immutable `REVIEW_INFRASTRUCTURE_BLOCKED` artifact and leaves the workflow failed.

## Complete GraphQL fallback

A Node preload is installed only inside the trusted `pull_request_target` job. It intercepts only this exact bounded REST request shape:

```text
GET /repos/<owner>/<repo>/pulls/<number>/reviews?per_page=100&page=<1..20>
```

It does nothing for files, diffs, comments, issues, refs, contents, writes, redirects or arbitrary URLs.

When page one returns the specific PR-global-ID `404`, the preload may query GitHub GraphQL by:

```text
repository(owner, name)
  -> pullRequest(number)
  -> reviews(first: 100, after: cursor)
```

The fallback is accepted only when it proves:

- exact repository;
- exact pull-request number and node ID;
- open state;
- exact head branch and SHA;
- exact `main` base and SHA;
- exact current canonical `main`;
- bounded pagination of at most 20 pages;
- stable `totalCount`;
- no duplicate review database or node IDs;
- normalized review IDs remain safe integers;
- normalized state, body, submit time, commit SHA and reviewer login;
- the number of collected reviews equals `totalCount`;
- exact identity remains unchanged before and after collection.

The complete estate is cached only for the current process and projected into the unchanged reviewer's REST-compatible 100-record pages. This handles exact multiples of 100 by returning a final empty page, preserving the existing pagination contract.

The fallback cannot start at page two or later because that would mix a prior REST page with a separate GraphQL pagination estate. Such evidence remains blocked.

## Failure behaviour

If GraphQL, identity, pagination, count or normalization proof is incomplete, the preload returns the original exact REST `404`. The existing reviewer then owns its normal bounded retry and immutable infrastructure-blocked receipt.

Therefore:

```text
REST reviews readable
  -> use complete REST estate

specific REST page-one global-ID 404
  -> prove complete exact GraphQL estate
  -> feed bounded REST-compatible pages to unchanged reviewer

fallback unavailable or ambiguous
  -> bounded retry
  -> immutable REVIEW_INFRASTRUCTURE_BLOCKED artifact
  -> workflow remains failed
```

No failure or silence becomes `[]`. No infrastructure block becomes a clean review.

## Authority boundary

The fallback grants no:

- merge or branch-write authority;
- review submission or comment authority;
- workflow dispatch authority;
- deployment authority;
- Windows, Battle Bridge or OpenClaw authority;
- shell, process, task or executable authority;
- Podman or Forge authority;
- service or PC restart authority.

The GraphQL transport uses an HTTP `POST` only to execute a fixed read query. Repository workflow permissions remain unchanged at `pull-requests: read`, `contents: read`, `actions: read`, and the existing display-comment permission.

## Acceptance tests

Tests prove:

- only the exact REST reviews URL is eligible;
- the real quoted GitHub error is recognized;
- ordinary `404`, other paths and other origins remain ineligible;
- PR node, repository, head, base and current-main drift fail closed;
- GraphQL pages normalize only exact review evidence;
- unsafe IDs, duplicate identities, errors and incomplete pagination fail closed;
- stable total count and exact final count are mandatory;
- an exact multiple of 100 remains pagination-correct;
- workflow permissions do not widen;
- the preload has no Git, shell, merge, runtime or host mutation authority.

## Completion marker

```text
INDEPENDENT_REVIEW_COMPLETE_REVIEW_ESTATE_FALLBACK_V1
EXACT_REST_REVIEWS_REMAIN_PRIMARY
SPECIFIC_GLOBAL_ID_404_HAS_ONE_COMPLETE_GRAPHQL_READ_FALLBACK
PR_NODE_HEAD_BASE_AND_CURRENT_MAIN_REMAIN_EXACT
UNREADABLE_OR_INCOMPLETE_REVIEW_EVIDENCE_FAILS_CLOSED
REVIEW_INFRASTRUCTURE_BLOCKED_ALWAYS_REMAINS_BLOCKING
NO_PRODUCT_PR_PATCH_OR_REVIEW_BYPASS
```
