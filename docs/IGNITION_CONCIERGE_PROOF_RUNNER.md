# Ignition Concierge Proof Runner

Issue #1281 replacement proof is source-driven and exact-head gated.

## Local Windows proof command

Run from the Battle Bridge repo root after checking out the PR head:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\Invoke-Stephanos-Ignition-Concierge-Proof.ps1 -ExpectedHeadSha <PR_HEAD_SHA> -RepositoryRoot .
```

The helper confirms that the local checkout is exactly `<PR_HEAD_SHA>`, runs the ignition concierge source proof runner, and writes `tmp/ignition-concierge-proof-comment.md` for PR comment/evidence capture.

## Approval boundary

The helper does not merge, push, unlock OpenClaw, bypass exact-head approval, or use a visible PowerShell wall as the operator surface. Exact-head merge approval remains required after proof.
