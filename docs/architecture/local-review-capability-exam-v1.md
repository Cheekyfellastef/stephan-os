# Local review capability exam v1 (Goal #1574, custody child #3123)

**Purpose:** advance provider-neutral Sovereign Commander/OpenClaw reviewer qualification with measurable proof, without borrowing Codex's identity or lowering a security check. This is a **source-only pre-admission verifier**, not commissioning, a trusted-key enrollment utility, a specialist reviewer, or a replacement for branch protection.

## Ten-question baseline exam

The review candidate must produce independently audited, source-bound evidence for: read-only machine identity; exact Git head; bounded file inspection; denied mutation attempt; read-only task/reentry observation; full changed-file diff coverage; adversarial finding detection; non-overlapping implementer/reviewer identities; Codex-meter-zero fallback; and denial on replay or head change.

A second five-part privileged **Windows** exam requires a native account/service identity readback, old principal negative write test, direct/task reentry prevention, independently protected signing roots, and separately audited host commissioning. The privileged exam **cannot run from CI**, an ordinary ChatGPT comment or an unprivileged local model. It needs physically trustworthy, independently authorised Battle Bridge administration. Never mutate the current dirty source checkout in exam preparation.

## Signed record contract and explicit limits

The fixed `stephanos.local-review-capability-exam.v1` record contains a bounded challenge ID, repository, exact 40-hex head and base, independently named reviewer and auditor, observed UTC time, outcome, SHA-256 evidence digest, and a detached Ed25519 signature. No generic shell, secret, private key, source data or full runtime logs are in the record. Signature payload is UTF-8 schema + NUL + JSON.stringify(unsigned record) in its documented fixed field order. Signature and explicitly pinned public key hash are verified; stale, changed, skipped, duplicated or malformed exam receipts fail closed.

**Threat boundary:** a caller-supplied public-key pin or `provisioningVerified` flag is NOT itself a trusted bootstrap. Only an externally protected, independently verified host configuration can supply those values, and this V1 module neither reads nor provisions it. Signatures authenticate assertions by a particular key; they do not establish physical Windows enforcement. V1 outputs `QUALIFICATION_EVIDENCE_READY_FOR_INDEPENDENT_ADMISSION` at most and **always** denies specialist status, protected merge approval, OS service install, original lease cancellation and writer authority, including when every receipt is signed.

## Path to real provider independence

1. Reuse merged standard-risk Sovereign Reviewer PR #3005 and high-risk advisory, not a duplicate implementation/reviewer controller. Collect 10 real Challenge receipts under the existing Goal #1574 and trusted Shared Workspace route. Codex usage must not be necessary for collection.
2. Enroll an auditor identity and key through a separate protected administrator operation; verify exact binary provenance, effective Windows token, signed logging, physical witness and reviewer/implementer independence. Never let a model or the source worker enroll itself.
3. Obtain independent outside security review of the new provider trust bootstrap and any change to `qualifiedSpecialistReviewV1.mjs`. Replace brand-pinned Codex dependence with a versioned, authenticated reviewer identity registry only after protected owner governance and adversarial cross-review. Keep Codex adapter optional.
4. Replay the qualifying set against current exact main and actual Windows writer-denial tests before admission. Approve privileged witness installation, separately protected operator signature and original r7 lease CAS only through their existing specialised authorities. No one-step arbitrary elevation from GitHub.
5. Prove two unattended non-overlapping goal build/refill cycles on Battle Bridge, with CPU/GPU gaming protection and independent Seed Canopy preserved.

## Focused tests

`node --test shared/agents/localReviewCapabilityExamV1.test.mjs`

The tests deliberately demonstrate that even 15 correctly signed assertions do not become privileged Windows specialist or merge authority. The gate still requires the existing authenticated Codex reviewer until a separately approved trusted-provider registry changes that contract.
