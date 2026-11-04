# Sovereign Skill Foundry: external skill intake V1

Owner: existing **Skill Forge** and canonical Shared Workspace. This change does not create a new scheduler, lease authority, conveyor, or skill database.

## What V1 does

A separately staged external `SKILL.md` can be inspected offline and turned into a
**review-only** packet. The node library:
- requires a pinned 40/64-character hexadecimal Git revision, canonical GitHub source URL, a safe relative `SKILL.md` path, a declared registry/publisher and SPDX license *claim*;
- validates frontmatter and a strict 64 KiB UTF-8 size limit;
- computes a SHA-256 digest of the exact reviewed contents and reports likely dangerous instruction signals without executing the contents;
- emits `stephanos.external-skill-review.v1` with `DRAFT` or `BLOCKED` and permanently false execution, installation, permission-grant, merge and activation flags;
- admits proposals for **OpenClaw Local only**; never implicitly promotes to Standalone, Stephanos AI, or Sovereign Commander.

Publisher and license claims are untrusted metadata. Passing structural validation DOES NOT verify the publisher, license, repository content, dependencies, or runtime permissions. The scanner is heuristic and cannot certify an external skill safe.

## Operator staging example

Obtain a trustworthy copy of an upstream SKILL.md by an *independent, approved* route and review the source repository and license. Use the **exact commit** corresponding to the separately staged bytes; the tool does not fetch or assert that they match the claimed repository. Place the document in an operator-controlled staging area outside any auto-loaded agent skills directory.

```sh
node scripts/skills/stage-external-skill-review.mjs \
  --registry github \
  --repo https://github.com/OWNER/REPOSITORY \
  --revision EXACT_40_OR_64_HEX_COMMIT \
  --path skills/example/SKILL.md \
  --publisher OWNER \
  --license MIT \
  --name "Candidate Example" < path/to/separately-staged/SKILL.md
```

The CLI writes **only a JSON packet to stdout**, never installs a skill, and exits 2 for structural errors. It performs no network requests, filesystem writes, subprocess execution, privileged operations or service restarts. It does not output untrusted skill contents or secrets as part of the review packet.

An authorized existing Shared Workspace capability ingestion route may retain the packet as an `externalSkillIntake` field on a capability record; **this PR does not add a new write route** or imply that this happened. The Skill Forge dashboard will display only such genuine canonical records as `EXTERNAL_DRAFT_NOT_INSTALLED`. Without a record, the dashboard must show zero external drafts.

## Gates before any real installation

1. Independently obtain and cross-check upstream author identity, immutable revision, exact bytes and license/dependency rights.
2. Review full instructions and bundled resources for prompt injection, command execution, secrets exposure, unexpected network activity, recursive references and licensing risks. The regex signal list is only a warning, never approval.
3. Customise a separate copy for OpenClaw Local's Stephanos-only scope, with least-privilege tools and explicit refusal/recovery paths.
4. Run the existing ten-question qualification, deterministic positive/negative tests and independent reviewer checks. Do not equate passing GitHub tests with Battle Bridge runtime proof.
5. Obtain existing exact-base/head merge review and explicit operator approval for runtime changes. Preserve the protected main workflow.
6. Install to the **recipient-specific** authorized library via an already guarded deployment route; run a fresh OpenClaw Local session and verify an exact installed revision and action receipt.
7. Publish the existing `stephanos.skill-provenance.v1` proof record only after actual live verification. Do not mark skill ACTIVE based on the candidate JSON.
8. Treat every additional recipient as a fresh separate permission, proof and approval exercise. Sovereign Commander can receive only source proposals for its existing bounded capability compiler, never an expanded command allowlist from an imported skill.

Preserve the independent Seed Canopy vs Goal Dashboard conveyors and leases, GitHub anti-hammer policies, Sovereign Reviewer, source governance, CPU/GPU limits and Quest 3 full-performance gaming mode. No imported skill gets a scheduler, bypass around a blocked lease, or authority to launch a worker.

## Tests

```sh
node --test shared/skill-forge/externalSkillIntakeV1.test.mjs
node --test shared/skill-forge/skillGrowthProjectionV1.test.mjs
npm run stephanos:build
npm run stephanos:verify
```

## Limitations

V1 is a bounded **offline intake + canonical projection**, not automatic marketplace discovery/download, independent supplier verification, skill synthesis, a deployed installer, or live Battle Bridge proof. These require separate guarded transports and a reviewer, not a UI status shortcut.
