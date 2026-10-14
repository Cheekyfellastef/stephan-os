# Protected mailbox owner dispatch

The canonical #2590 mailbox remains the owner authorization surface. `MARK_PROTECTED_PR_READY` executes its fixed ready transition there. For `DISPATCH_PROTECTED_OPERATOR_MERGE`, the mailbox validates the owner comment and exact open, ready PR/head/tree/current-main identity, then publishes `PROTECTED_MERGE_OWNER_DISPATCH_REQUIRED` and the fixed `ownerDispatchRequest` in its receipt.

The authenticated owner connection submits that exact request to the existing `operator-merge-approval-gate.yml` workflow. This is transport handoff, not completed execution or merge approval. The existing gate still requires owner transport, the original owner-authored comment, independently verified review, exact source/base and required checks, protected environment approval, final revalidation and replay protection. A receipt alone proves none of pickup, merge or deployment.

The mailbox uses GitHub's workflow token. Dispatching the merge workflow with that token creates `github-actions[bot]` transport, which the protected gate rejects. Retrying an owner-authenticated attempt after approval can also trip the gate's prior-attempt protection. Do not rerun the failed attempt or delete prior runs to evade that protection. Preserve the receipts and recover only through the canonical gate's admitted source/base rules.

No token is exported, no owner token is installed in the mailbox, no bot gains merge authority, and no second workflow, worker, mailbox or control plane is added. The handoff contains only the existing fixed workflow path, `main` ref and bounded exact identity/review/authorization inputs.
