# Protected Workflow Dispatch Threat Model V1

Threats explicitly denied by the clean-review dispatch path:

- caller-selected workflow;
- caller-selected workflow ref;
- caller-selected protected-merge mode;
- caller-selected source head tree;
- arbitrary shell, PowerShell, executable or arguments;
- direct PR merge;
- direct write to `main`;
- force push;
- ruleset bypass;
- protected-environment bypass;
- reuse of the qualified-bootstrap finding exception;
- acceptance of a review artifact with findings;
- dispatch after PR/head/base drift.

Trusted inputs remain exact GitHub identities and the immutable Independent Merge Security Review evidence already required by the protected merge programme.
