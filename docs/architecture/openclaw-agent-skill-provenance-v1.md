# OpenClaw Local and Standalone: skill provenance acceptance V1

Canonical seed: [#3094 — Seed: OpenClaw Local & Standalone Continuous Excellence and Codex Task Parity](https://github.com/Cheekyfellastef/stephan-os/issues/3094). This is a **source-only evidence contract** for the existing seed and its existing owners, not an installed skill, approved update, physical worker pickup, or Codex-parity proof.

## Separate principals

| Recipient | Runtime identity | Permitted review scope |
| --- | --- | --- |
| OpenClaw Local | `stephanos-scout-coder` | Stephanos repository and separately approved product runtime only |
| OpenClaw Standalone | `openclaw-standalone` | Whole-PC tasks only with independent explicit operator authorization |

Do not transfer Local credentials, allowlists, tools, models, trust results, or approvals to Standalone. Missing runtime data is `UNKNOWN`, not `PASS`.

## Candidate evidence packet, per recipient and original owner

1. Original seed/task/issue and agent principal, exact current source and installed version, gateway health and tool allowlist from an authenticated observation; no inferred access.
2. Upstream official release and security advisory URL, publisher, revision and license; exact content hash; risk class and required external permissions.
3. Skill source, signed provenance if available, immutable revision, reviewed `SKILL.md`, dependencies, data egress and tool invocation surface; quarantine unknown or untrusted origins.
4. Distinct recipient-specific approval and the current original-owner lease and file scope; approval for one recipient never authorizes the other.
5. Reproducible isolated negative tests for prompt injection, credential exfiltration, path escape, role escalation, replay, unbounded processes, and unauthorized network calls.
6. Ten-question trust exam, bounded functional tests, independent exact-head qualified specialist review and separately authenticated operator approval, each with source-linked receipt.
7. Rollbackable backup of existing configuration and skills, preservation of unknown local edits, rehearsal, exact restored-state digest and recovery procedure.
8. Live post-install observation from the intended principal and machine, plus explicit gaming-governor zero-residency proof before any Battle Bridge CPU/GPU/VRAM work.
9. Same-worker SELECT→CLAIM→PICKUP→SOURCE→TEST→REVIEW→MERGE→SERVED chain only where each stage has a real independently verifiable receipt; never infer a physical pickup from GitHub CI.

## Decision

- `UNVERIFIED`: missing authentic source, principal, scope, review or runtime evidence. Do not install or advance a growth rung.
- `WAITING_FOR_PREREQUISITE`: immutable approval, original-owner lease, Windows custody or gaming gate. Park only the held action.
- `REJECTED`: unsafe provenance, permissions, licensing, tests or review. Retain failing proof and no installation.
- `QUALIFIED_FOR_RECIPIENT`: all relevant exact-source security, exam, review and authorization prerequisites passed, but installation is still a separate consequential action.
- `INSTALLED_AND_VERIFIED`: approved installation and rollback verified on the exact recipient with an independent runtime witness. This does not establish Codex parity.

If an adapter is missing, reconcile one deduplicated capability request through existing [#1903 — Goal: Stephanos Governed Self-Improvement and Operator Gap-to-Change Loop V1](https://github.com/Cheekyfellastef/stephan-os/issues/1903) / Skill Forge intake under the original task identity. No new controller, scheduler, queue, authority or self-reviewer is created here. The original [#2962 — Goal: Repair Native Capacity Publisher generated-dist source gate mismatch](https://github.com/Cheekyfellastef/stephan-os/issues/2962) revision-7 custody HOLD and [PR #3097 — Bootstrap independent Seed Canopy Parallel Forge (#3096)](https://github.com/Cheekyfellastef/stephan-os/pull/3097) local inference gaming HOLD remain binding.

## Negative acceptance matrix (mandatory fail-closed)

| Candidate evidence | Expected result | Original-owner remedy |
| --- | --- | --- |
| Upstream skill URL without pinned revision and independently verified content digest | `REJECTED`; never fetch and execute it as trusted code | Pin publisher, revision, digest, licence and complete quarantine review |
| Skill manifest addressed to Local but proposed for Standalone | `WAITING_FOR_PREREQUISITE`; no permission or exam inheritance | Obtain Standalone-specific scope, tests, reviewer and operator approval |
| Self-authored reviewer PASS or CI-only approval | `UNVERIFIED`; no qualification or protected merge | Independent qualified exact-head review and authentic protected approval |
| Correct source SHA but missing installed runtime principal or served digest | `UNVERIFIED`; no `INSTALLED_AND_VERIFIED` | Collect machine-authenticated recipient/runtime installation and rollback receipts |
| Gaming active or GPU/CPU/model process-tree eviction unproven | `WAITING_FOR_PREREQUISITE`; do not start local inference or heavy tests | Independently qualify zero-residency governor or bounded CPU-only process-tree route |
| Unknown Windows writer/descendant/relaunch custody or mismatched lease CAS | `WAITING_FOR_PREREQUISITE`; do not release or substitute another writer | Original-owner signed custody and source-digest/head evidence |

These rows are **acceptance expectations**, not simulated pass receipts. A proposed skill must not be counted as installed, and a GitHub source change must not be counted as physical OpenClaw PICKUP.
