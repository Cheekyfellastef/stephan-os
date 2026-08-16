# Stephanos Protected Workflow Dispatch Mailbox V1

Status: source-built, runtime-unproven.

## Purpose

This slice closes the control-plane gap exposed while commissioning Forge: ChatGPT can verify a protected merge packet but the connected GitHub surface may not expose GitHub Actions `workflow_dispatch`. Directly merging the PR would bypass the repository's protected approval workflow, so the system must fail closed instead.

The repair keeps issue #1507 as the canonical operator command surface and adds one GitHub-hosted, owner-authored dispatch fence for exactly one target workflow:

`.github/workflows/operator-merge-approval-gate.yml`

No arbitrary workflow, ref, input, URL, command, shell, credential or token is caller-selectable.

## Command boundary

The owner posts a fenced `stephanos-protected-workflow-dispatch` JSON command on issue #1507. The command is accepted only when:

- author is exactly `Cheekyfellastef`;
- issue is exactly `1507`;
- repository is exactly `Cheekyfellastef/stephan-os`;
- operation is exactly `DISPATCH_PROTECTED_OPERATOR_MERGE`;
- mode is exactly `user-owned-protected-squash`;
- explicit operator approval is present;
- request ID is bounded;
- expiry is valid and no more than ten minutes after comment authorship;
- PR, branch, head, head tree and base are exact immutable identities;
- independent-review run, attempt, artifact ID, artifact digest and payload digest are exact bounded identities;
- no additional JSON field is present.

The dispatcher independently re-reads live PR, canonical main and the exact head commit before issuing the workflow dispatch. Any identity drift fails closed.

## Fixed dispatch

The only mutation performed by the dispatcher is a GitHub Actions dispatch to the fixed workflow above on fixed ref `main`, using the exact closed input set already required by the protected merge workflow.

The target workflow remains responsible for its normal personal-repository evidence, protected environment approval and final exact-head squash merge revalidation. This dispatcher does not merge a PR itself and cannot bypass those jobs.

## Durable receipt

After GitHub accepts the workflow dispatch, the dispatcher writes one durable receipt back to issue #1507 containing:

- request ID;
- fixed workflow path and ref;
- PR number;
- expected branch/head/tree/base;
- dispatch timestamp;
- explicit zero-authority flags for arbitrary workflow/ref/input/shell/credential export.

The receipt comment is written by GitHub Actions and therefore cannot trigger a second dispatch, because only comments authored by `Cheekyfellastef` are eligible.

## Forge commissioning consequence

Once this slice is reviewed and protected-merged, the previously approved PR #1805 merge can be dispatched through the correct protected workflow without relying on whether the active ChatGPT connector exposes a workflow-dispatch tool.

That removes the current control-plane stall. It does not by itself make Forge production-ready. Forge still requires:

1. merge #1805 through the protected workflow;
2. exact-main Battle Bridge synchronization;
3. fixed Podman 6.0.2 prerequisite proof;
4. fresh M2 receipt;
5. M3 artifact preparation;
6. exact M3 execution and teardown proof;
7. measured Foundry capacity publication;
8. one genuine machinery task completed through Forge without Remote Codex.
