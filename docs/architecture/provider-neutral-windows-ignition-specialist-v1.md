# Provider-neutral Windows ignition specialist V1

## Purpose

This source-only contract closes one bounded Zero-Codex parity gap under #1574/#1898/#1899 without creating a second reviewer.

PR #1919 currently escalates exactly four Windows authority paths that the existing deterministic Windows specialist stack does not understand:

1. `scripts/windows/probe-battle-bridge-recovery-mesh.ps1`
2. `scripts/windows/repair-stephanos-battle-bridge.ps1`
3. `scripts/windows/restart-approved-stephanos-runtime.ps1`
4. `scripts/windows/start-stephanos-backend.ps1`

The existing `qualifiedSpecialistReviewV1` fallback can cover unsupported Windows paths, but its accepted reviewer identity is provider-specific. That makes high-risk ignition convergence review a Codex-coupled critical-path task class when the deterministic stack cannot cover it.

## Exact reviewed target

This child specialist is fixed to one repository, PR and branch, while the exact reviewed head and base arrive only through the digest-bound independent-review findings artifact and the wrapper's fresh GitHub lineage reads:

```text
repository=Cheekyfellastef/stephan-os
pr=1919
branch=fix/ignition-canonical-convergence-gate-v1
sourceHead=<artifact exact head>
baseSha=<artifact exact base and live protected main>
```

The specialist accepts only a two-parent reconciliation commit whose second parent equals the exact artifact base, while two independent live-main reads, the GitHub comparison base and merge base all equal that same base. Each of the four source records must also match its independently reviewed Git blob identity. A stale artifact, changed main, reordered parent, divergent comparison, substituted source commit, changed script byte or accessor-backed value is ineligible. Head or base movement therefore never inherits specialist evidence silently, while unchanged reviewed scripts may survive a preservation-only reconciliation.

The current #1919 source materially hardens the Windows probe, repair, restart and backend-start paths. Backend listener identity is bound to fixed canonical Node plus the immutable bootstrap command, and backend startup materializes `stephanos-server/backend-bootstrap.mjs` from the exact approved Git object, verifies its Git blob identity, and launches canonical Node through a minimal process environment with the exact head/root/bootstrap bindings. The specialist therefore validates the complete four-path authority estate rather than relying on a target SHA embedded in reviewer source.

If #1919 head or base moves, all prior artifacts become ineligible. A freshly generated artifact plus fresh exact-source and live-lineage proof is required; reviewer source does not need a circular SHA retarget.

## Design

`windowsAuthorityIgnitionConvergenceReviewV1.mjs` is a deterministic child specialist pinned by exact Git blob identity in `windowsAuthoritySpecialistReviewV1.mjs`. The trusted composition asserts the exact four-path inventory before importing it and invokes it before legacy or external fallbacks.

Eligibility is closed-world:

- exact reviewed repository, PR and branch above;
- exact artifact head/base plus fresh two-parent reconciliation lineage bound to the same live base;
- exactly four P0 `unsupported-high-risk-surface` escalations, one for each fixed path above;
- exactly four immutable `stephanos.windows-authority-source.v1` source records bound to repository, path and exact head with content-derived Git blob identity that also equals the independently reviewed blob pin;
- ordinary input, analysis, finding and source evidence must arrive through plain data properties; accessor-shaped authority/evidence fails closed without being invoked.

The specialist then verifies the task-class invariants that make the four Windows scripts safe to review deterministically:

- exact-head gates before consequential mutation;
- fixed canonical Git/Node/npm boundaries where applicable;
- exact local and hosted backend health identity;
- canonical backend health schema `stephanos.backend-health.v1` and runtime ID `stephanos-battle-bridge-backend` are mandatory before an already-healthy backend can bypass convergence;
- fixed backend and Mission Worker Scheduled Task identities;
- `MultipleInstances=IgnoreNew` checks around backend restart handoff;
- backend listener identity requires canonical Node and the fixed process-bound immutable-bootstrap command;
- atomic, short-lived backend expected-head handoff;
- verified-owned-process-only termination;
- canonical `main` / `origin/main` synchronization;
- tracked source dirt remains fail-closed;
- exact-head backend bootstrap materialization uses the fixed `stephanos-server/backend-bootstrap.mjs` path, disables Git replacement objects, verifies the content-derived Git blob identity, and fails closed on mismatch;
- backend child launch uses fixed canonical Node through the minimal-environment launcher with exact source-head, repository-root and verified bootstrap-byte bindings;
- fresh exact-head runtime receipt/heartbeat proof;
- no caller-selected command/path/task/executable/URL authority;
- no dynamic PowerShell execution or destructive/publishing Git authority.

Every result fixes merge, runtime and provider-qualification authority to false.

## Integration boundary

The integration adds only one exact child-module blob pin, one exact four-path inventory assertion and one call before fallback. The child module is added to `WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1`, so this change is itself classified as an approval-boundary self-change and cannot be approved by the new specialist it introduces. It requires the existing protected bootstrap, independent assurance and separate exact-head merge authorization.

## Truth boundary

This source does not make OpenClaw, GitHub, a local model or any other provider a qualified Windows specialist. It creates a deterministic non-provider-specific review contract for one exact task class. #1899 must not mark broad high-risk Windows specialist parity proven from this source alone.

The #1919 task class may move from `MISSING_NON_CODEX_ROUTE` only after this integration is independently admitted, a real exact-head/base-bound #1919 review executes through the canonical provider-neutral path, the resulting immutable independent review artifact is clean, and ordinary operator merge/runtime boundaries remain unchanged.

## Authority

Source and tests only. No merge, reviewer promotion, provider qualification, deployment, Windows mutation, OpenClaw mutation, process restart, Scheduled Task mutation, destructive Git, arbitrary shell, credential or spending authority is granted.
