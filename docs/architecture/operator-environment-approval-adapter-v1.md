# Operator Environment Approval Adapter V1

## Purpose

Remove the final manual `Review deployments -> Approve and deploy` click from an already-authorized protected Stephanos lifecycle without weakening the protected environment boundary.

This adapter is deliberately not a browser robot and not a generic GitHub mutation client. It models one exact GitHub API action: approving the single pending `operator-merge-approval` environment for one exact protected workflow run after the operator has already supplied consequential authorization.

## Canonical boundary

The V1 adapter is fixed to:

- repository `Cheekyfellastef/stephan-os`;
- operator `Cheekyfellastef`;
- environment `operator-merge-approval`;
- decision `approved`;
- GitHub endpoint `/repos/Cheekyfellastef/stephan-os/actions/runs/{run_id}/pending_deployments`;
- exactly one pending environment ID;
- an already authenticated operator identity supplied by the execution surface.

The adapter does not accept a token, arbitrary endpoint, arbitrary GraphQL, arbitrary environment, arbitrary decision or arbitrary GitHub request body from the caller.

## Required proof before approval

Before exposing the one POST request, V1 requires all of the following to be exact at the same observation boundary:

1. current protected `main` equals the authorized base SHA;
2. the PR is still open, unmerged, on the authorized branch, at the authorized exact head and exact base;
3. the protected workflow run is the authorized run ID, is still `waiting`, has no conclusion, is a `workflow_dispatch` execution on the authorized protected base and has the exact protected-merge run title;
4. exactly one pending deployment exists;
5. its environment is exactly `operator-merge-approval` with a stable numeric environment ID;
6. `current_user_can_approve=true`;
7. the wait timer is zero;
8. the sole user reviewer is exactly `Cheekyfellastef`;
9. the authenticated execution actor is exactly `Cheekyfellastef`.

Any drift fails closed without a request.

## Execution contract

`executeOperatorEnvironmentApprovalV1()` accepts an authenticated request callback from the surrounding trusted execution surface. The adapter passes only its internally constructed bounded POST request to that callback. It accepts only HTTP `204` as proof that GitHub consumed the approval.

The adapter itself stores no credential and cannot manufacture operator identity. A ChatGPT/GitHub connector, local operator-authenticated Stephanos surface or future user-to-server GitHub integration must provide that authenticated request capability.

## Authority ceiling

The adapter grants no merge, ready-for-review, branch, ruleset, source, deployment target, runtime, Windows, Battle Bridge, OpenClaw, provider, spending or credential authority. Approving the pending environment only releases the already-dispatched protected workflow; that workflow remains responsible for its own final exact-head/base/check/review revalidation and protected squash semantics.

This keeps the operator approval boundary intact while allowing the mechanical click to disappear once an operator-authenticated execution surface exposes GitHub's pending-deployment approval endpoint.
