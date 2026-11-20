# Sovereign Reviewer complete meter-independent review coverage (Goal #1574)

## One reviewer, every current review class

This source slice extends PR #3168 and the EXISTING Sovereign Reviewer. It does not introduce a separate review queue, controller, scheduler, untrusted provider identity, or merge path.

The canonical exact-head source snapshot is classified into a bounded set of review domains. Each domain gets a candidate-only read-only local review lane and a mandatory evidence checklist, even when multiple domains occur in one PR. Source-only availability is not physical execution.

| Review domain | Meter-free candidate route | Mandatory trusted acceptance |
| --- | --- | --- |
| Ordinary UI / app / code | Existing standard Sovereign Reviewer | Full diff, exact head/base, independent reviewer or permitted deterministic quorum |
| Windows OS / service / SCM / PowerShell | Existing high-risk local advisory + Windows calibration | Qualified Windows/security specialist, native identity/access/re-entry evidence, protected bootstrap |
| OpenClaw / agent execution | Existing high-risk local advisory | Independent agent privilege/containment security specialist, code and live boundary proof |
| Original source lease / builder custody | Existing high-risk local advisory | Independent witness and signed operator digest for original R7 CAS; no review alone releases a lease |
| Credentials / identity / secrets | Existing high-risk local advisory | Independently authenticated security specialist and separate protected signing roots |
| GitHub workflow / protected merge policy | Existing high-risk local advisory | Independent specialist, immutable GitHub/source artifact and original operator protected merge approval |
| Reviewer trust and self-changes | Existing high-risk local advisory | Out-of-band trust root, separately authenticated auditor and protected self-change review |
| Browser / served runtime evidence | Existing standard local reviewer for source; Commander browser proof for runtime | Live exact-head served/browser receipt as applicable, never inferred from source tests |
| Daemons / deployment / ignition | Existing high-risk local advisory | Independently qualified runtime/Windows specialist and live exact-head deployment/health proof |
| Other executable or policy paths not otherwise classified | Existing high-risk local advisory | Independent specialist before admission; fail-closed unknown-domain handling |

These are review needs, not automatic classifications of reviewer qualifications. Classification can be over-inclusive; it must never suppress high-risk requirements when a PR crosses domains. The inventory is not an additional scheduler, witness, authority, approval, or deployment tool.

## Concrete implementation

- shared/agents/sovereignReviewCoverageV1.mjs: bounded exact-head/source/classification contract. Rejects duplicate/invalid changed-path inventories, malformed source refs, and returns all applicable domain packets with a fixed existing local candidate runner. Every outcome explicitly denies trusted review acceptance and lease/deployment authority.
- scripts/sovereign-review-coverage-v1.mjs --once: requires the existing read-only exact local source snapshot; emits bounded categories and requirements, not raw code, credentials, raw model output or private paths.
- Regression tests feed mixed high-risk patches across all ten classes, duplicate/unsafe paths, forged auth flags and unverified Git snapshots. The old provider-neutral and exact-head test suites include these cases.

## Dependency chain: what actually removes the meter

1. Prove the standard model accurately reviews real nontrivial PR changes at clean exact source head; mark it CANDIDATE until independent attestation.
2. Qualify at least one *separate* local high-risk reviewer principal against the adversarial source exam and Windows competency exam. Independent reviewer/implementer separation needs enforceable OS/account identity, not a caller-supplied string.
3. Commission protected trust/auditor root *outside* GitHub, source checkout, OpenClaw and agent Shared Workspace. Prove revocation, non-replay, expiry, exact head/base/tree and signed attestations. No reviewer may enroll itself.
4. Independently review the trust bootstrap and change the existing provider-specific qualifiedSpecialistReviewV1 acceptance only through normal protected governance. Merely adding a reviewer to a whitelist is not qualification.
5. Make the existing provider-neutral exact-head coordinator consume independently authenticated sovereign results without dispatch duplicates, preserving the source/head and immutable evidence artifact.
6. Run real independent reviews of Windows, OpenClaw, security, lease, protected workflow and runtime PR samples against relevant physical negative tests. Failing classes remain held individually while unrelated class reviews continue.
7. In a real Codex-meter-zero trial, prove source review, high-risk specialist acceptance through authenticated sovereign identity, original protected owner approval, merge, Battle Bridge exact-head deployment and post-merge browser/runtime receipts. Demonstrate two unattended independent examples and no VR gaming degradation.

**Crucial:** tests in CI prove only source checks. A real Windows witness, independently protected signing service, trust bootstrap and governance admission cannot be established by GitHub source changes or an ordinary local model. PR #3090 (Windows reviewer launch), #3153 (R7 read-only witness readiness), and #3168 (Windows qualification/coverage) remain distinct existing work. Do not merge #3168 as a live capability until independently reviewed and safe.

This route makes Codex and other paid providers optional capacity only *after* sovereign reviewers have proved the same assurance properties. It never lowers a branch-protection gate because the meter is empty.
