# Chat Update Exact Target and Node Runner

The operator phrase `Update Stephanos now` authorizes one bounded update to the latest canonical `origin/main` observed immediately after that run fetches it.

The run records that 40-character commit as `approvedTargetHead` and requires the local post-sync HEAD to equal it exactly. It must not pin a latest-main request to a stale historical merge head.

Focused dispatch tests run through the current Node executable with explicit `--test` file arguments. The chat update path does not invoke `npm`, `npm.cmd`, PowerShell, or a free-form shell to start those tests.

Safety remains fail-closed:

- canonical `main` only;
- fast-forward only;
- no local commits or divergence;
- no reset, clean, stash, rebase, force checkout, push, or branch deletion;
- no runtime refresh until source sync and tests pass;
- exact served-head and localhost health proof required after refresh.
