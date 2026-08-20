# Provider-neutral Windows ignition specialist V1

## Purpose

This source-only contract closes one bounded Zero-Codex parity gap under #1574/#1898/#1899 without creating a second reviewer.

PR #1919 currently escalates exactly three Windows authority paths that the existing deterministic Windows specialist stack does not understand:

1. `scripts/windows/repair-stephanos-battle-bridge.ps1`
2. `scripts/windows/restart-approved-stephanos-runtime.ps1`
3. `scripts/windows/start-stephanos-backend.ps1`

The existing `qualifiedSpecialistReviewV1` fallback can cover unsupported Windows paths, but its accepted reviewer identity is provider-specific. That makes high-risk ignition convergence review a Codex-coupled critical-path task class when the deterministic stack cannot cover it.

## Exact reviewed target

This child specialist is intentionally head-bound to the current reviewed #1919 source, rather than being a floating approval rule:

```text
repository=Cheekyfellastef/stephan-os
pr=1919
branch=fix/ignition-canonical-convergence-gate-v1
sourceHead=51438eeb85df96f7363b7d5d8700711f54374371
baseSha=3dc12a7c84c54f406b10dee1293789e2338f7824
```

The immediately previous source target `34b573d15fe065a35a6c94f9f58a2876811a63b7`, earlier targets `0cbd8318f5da7d815e3f4e30d8ef9a5d1c9feb77` and `9941da6e500a7d95d11e8a3654630462cce71a91`, and previous base `13f13144730b2a6d94754914dbdf2c254c39567d` are historical and ineligible. The specialist is deliberately retargeted only by an explicit source change plus fresh proof; head or base movement never inherits specialist evidence silently.

The current #1919 move from `34b573d...` to `51438ee...` preserves the same exact three Windows authority path inventory but materially hardens two of those paths. Backend listener identity is now bound to fixed canonical Node plus the immutable bootstrap command, and backend startup now materializes `stephanos-server/backend-bootstrap.mjs` from the exact approved Git object, verifies its Git blob identity, and launches canonical Node through a minimal process environment with the exact head/root/bootstrap bindings. The specialist therefore adds explicit invariants and regressions for those new authority boundaries rather than merely changing the target SHA.

If #1919 head or base moves again, this specialist becomes ineligible. A new exact target requires another bounded source update and fresh proof.

## Design

`windowsAuthorityIgnitionConvergenceReviewV1.mjs` is an inert child-specialist contract. It is not wired into `windowsAuthoritySpecialistReviewV1` by this PR.

Eligibility is closed-world:

- exact reviewed repository, PR, branch, source head and base above;
- exactly three P0 `unsupported-high-risk-surface` escalations, one for each fixed path above;
- exactly three immutable `stephanos.windows-authority-source.v1` source records bound to repository, path and exact head with content-derived Git blob identity;
- ordinary input, analysis, finding and source evidence must arrive through plain data properties; accessor-shaped authority/evidence fails closed without being invoked.

The specialist then verifies the task-class invariants that make the three Windows scripts safe to review deterministically:

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

This first slice deliberately does **not** modify the trusted top-level `windowsAuthoritySpecialistReviewV1` composition. The child contract must first receive ordinary hosted proof and independent review as source.

A later bounded approval-boundary integration may add only:

- one exact child-module blob pin;
- one exact three-path inventory assertion; and
- one call to the child specialist before the generic external qualified-specialist fallback.

That integration remains a trusted reviewer self-change and requires its existing protected bootstrap/independent assurance and separate exact-head merge authorization.

## Truth boundary

This source does not make OpenClaw, GitHub, a local model or any other provider a qualified Windows specialist. It creates a deterministic non-provider-specific review contract for one exact task class. #1899 must not mark broad high-risk Windows specialist parity proven from this source alone.

The #1919 task class may move from `MISSING_NON_CODEX_ROUTE` only after:

1. this child specialist is separately admitted into the existing trusted specialist stack;
2. a real exact-head/base-bound #1919 review executes through that canonical provider-neutral path;
3. the resulting immutable independent review receipt is clean; and
4. ordinary operator merge/runtime boundaries remain unchanged.

## Authority

Source and tests only. No merge, reviewer promotion, provider qualification, deployment, Windows mutation, OpenClaw mutation, process restart, Scheduled Task mutation, destructive Git, arbitrary shell, credential or spending authority is granted.
