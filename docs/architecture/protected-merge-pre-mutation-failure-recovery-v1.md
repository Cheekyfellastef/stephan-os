# Protected merge failure recovery before mutation

A failure in `operator-personal-repository-squash-merge` is not proof that GitHub received a merge request. Conversely, an open PR or a failed job alone cannot establish that no mutation was attempted. The canonical protected workflow needs explicit evidence at the request boundary.

The trusted-main executor creates a bounded `stephanos.protected-merge-pre-mutation-failure.v1` receipt only when it fails before issuing its single squash request. The mutation boundary flips before calling the request transport; a lost response, successful merge followed by receipt-publication failure, or any failure after issuing the request cannot produce a safe-retry receipt. The final workflow job publishes the receipt through an immutable Actions v4 artifact. No credentials or error messages enter this artifact.

A fresh dispatch may recover a failed final-validation attempt only after the canonical collector proves the artifact's run, attempt, name, size and SHA256 archive digest; validates its one bounded JSON member; and binds the receipt to the repository, PR, branch, exact head/tree/base and failed merge job's execution window. Every prior attempt retains complete canonical job envelopes. Original pre-approval read-only failures remain admitted under their existing rule. Every failed final job requires its own immutable proof, successful earlier evidence and approval jobs, and a terminal failed run. Missing, ambiguous, expired, stale or malformed proof blocks the entire history. The eight-attempt bound remains.

Recovery does not admit rerunning the same workflow run, grant merge authority, reuse a prior approval receipt, or waive current checks. Each fresh dispatch still requires exact owner/mailbox provenance, fresh evidence, independent review, protected-environment approval, exact source binding, configuration proof and final revalidation. ZIP extraction remains in memory. Artifact transport reuses the existing credential-separated bounded transport.

Legacy final-job failures without a receipt remain uncertain and blocked at the same base. This change does not fabricate retrospective receipts for Flywheel PR #2658. Its recovery follows installing this independently reviewed repair through the protected lane, then obtaining current-base review and protected merge proof for the unchanged Flywheel material under the existing main-movement binding.

Reusable invariant: classify recovery by proven mutation state, never by the name or failure status of the job that ran it.
