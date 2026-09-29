# OpenClaw Codex Resilience Lane V1

Issue: #1284

## Purpose

OpenClaw provides a bounded local builder lane when Codex is unavailable, rate-limited, or intentionally held.

## Capability ladder

- V1 read-only repo scout
- V2 test/build runner
- V3 patch preparation assistant
- V4 approval-gated local writer
- V5 draft PR helper
- V6 Codex stall fallback mode

## Safety boundaries

- No uncontrolled mutation
- No merge to main
- No silent source cleanup
- No bypassing exact-head approval
- Prefer worktrees or branches
- Proof-first
- Dry-run before writes

## Proven so far

- V1 read-only repo scout passed.
- V2 OpenClaw GitHub authorization tests passed.
- V2 readonly adapter ensure/status passed.
- Readonly adapter is available with execution disabled.

## V3 rule

Patch preparation may create proposed patch files in proof/staging only.
It must not apply patches automatically.

## V4 rule

Local writes require explicit operator approval, exact files, base head, patch hash, and branch or worktree isolation.

## Final target
