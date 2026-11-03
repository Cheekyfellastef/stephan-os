# Protected Workflow Dispatch Operator Boundary V1

The clean workflow-dispatch path is not standing merge authority. Every use requires a fresh owner-authored #1507 mailbox command bound to one exact PR/head/base/review artifact and the explicit token `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:<pr>:<head>`.

The mailbox may dispatch the canonical protected workflow only after all exact preflight predicates pass. The workflow itself remains the only component authorized to cross the protected squash-merge boundary after its protected-environment approval and final revalidation.
