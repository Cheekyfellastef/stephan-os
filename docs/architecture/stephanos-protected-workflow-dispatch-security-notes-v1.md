# Protected Workflow Dispatch Security Notes V1

This change exists because the active ChatGPT GitHub connector may expose direct PR merge while omitting GitHub Actions workflow dispatch. Direct merge is not an acceptable substitute when the operator authorization requires the repository's protected workflow.

The Battle Bridge already has a bounded protected-merge mailbox adapter with GitHub CLI access and immutable-review preflight. The new clean-review mode reuses that surface and stops at workflow dispatch.

Security consequences:

- the clean path cannot use the qualified-bootstrap finding exception;
- the clean path requires a separate approval token namespace;
- the head tree is obtained from the Git commit object after exact PR/head/base revalidation;
- the workflow name and mode are constants in trusted source;
- arbitrary workflow names, refs, inputs, shell fragments and commands are not caller fields;
- dispatch does not imply merge success; the workflow must independently re-prove configuration, exact identities and protected approval before mutation;
- the mailbox receipt records dispatch truth, not merge truth.
