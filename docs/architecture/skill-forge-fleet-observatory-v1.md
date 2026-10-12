# Skill Forge / Stephanos Command Observatory: evidence-first uplift

## What is implemented in this branch

- The dedicated `?surface=skill-forge` route now renders its own full-width workspace instead of falling through to the default pane wall.
- The canonical Stephanos workspace has a new read-only Command Observatory above the existing, untouched pane canvas.
- Skill Forge reads `/api/shared-workspace/dashboard-feed?scope=full-history` on a 30-second interval and renders the existing closed-loop teaching and verification states without creating a daemon or new truth store.
- Existing static seeds are labelled `STATIC_SEED_NOT_INSTALLED`. Genuine typed learning events automatically conjure **reviewable draft** skill blueprints labelled `LEARNING_DRAFT_NOT_INSTALLED`.
- The library distinguishes proposals, verified lessons, published skill provenance records, and recipient-specific recorded skills.
- Transfer assessment explicitly blocks target activation until exam, deterministic/runtime proof, independent target runtime evidence, scope review and operator approval are supplied. It **never** executes, installs, merges or grants new authority.
- Buttons copy a review handoff only; they do not manufacture operator approval or mutate persistent skill status.
- The main observatory reads the existing shared-workspace current-state dashboard feed and reports unknown rather than inventing goal, worker or build metrics.
- The original App pane identities, drag/collapse controls and workflow ownership remain unchanged.

## OpenClaw capability workshop upgrade path

OpenClaw skills are `SKILL.md` packages. An OpenClaw agent can draft a personal skill through `skill_workshop` if its installed version, permission gate and authorized skill library permit it. A workshop revision is specific to that agent and is **not automatically propagated** to another agent.

Source-of-truth agent identities in this project:
- OpenClaw Local: `stephanos-scout-coder` (reported as `openclaw-local` in the orchestration fabric), scoped to Stephanos source and approved product runtime.
- OpenClaw Standalone: `openclaw-standalone`, the separate whole-PC worker.
- Sovereign Commander: an independent fixed-verb and receipt-gated Windows control plane. A new skill card cannot widen its command allowlist.

Required progression:

1. Inspect the existing OpenClaw Local runtime, Gateway health, model reachability, version and `openclaw skills check` using its authorized fixed health route. No claim of continuous operation until runtime proof exists.
2. Route a typed failure in the existing Shared Workspace closed-loop fabric to Local. Query existing skills and recipes before composing new ones.
3. Have Local propose a `SKILL.md` recipe using its authorized `skill_workshop` route (or produce a source draft for review if Workshop is absent). Include name, purpose, preconditions, allowed tools, refusal paths, executable test, recovery and evidence provenance. Do not install external skills from unverified sources.
4. Apply the existing ten-question capability exam, a deterministic test and live runtime proof. A green source/unit test does not substitute for target runtime evidence.
5. Bring the candidate through the **existing** independent review and operator approval boundary. Keep external provider payments, arbitrary shell, network privilege, Git merge and changes to Windows security outside the candidate's granted authority.
6. Only after a recipient-specific proof and approval, publish the approved skill into that recipient's own workspace skill library or a narrowly allowlisted managed library. A Local workshop skill must never silently enter Standalone's whole-PC scope.
7. Record an explicit `stephanos.skill-provenance.v1` capability record with `skillId`, `status`, `allowedTargets`, `proofRefs`, reviewer and installed revision. Re-check a fresh runtime session before counting the skill as active in the observatory. Do not backfill claims on an unverified installation.
8. A validated shared lesson can become a proposal for Sovereign Commander's fixed capability compiler, **not** an automatic change to its command allowlist. Use a normal guarded patch, proof and merge.

This branch establishes the visibility, draft construction and transfer clearance contracts. It does **not** establish that the two OpenClaw agents are running continuously, that Workshop has been activated, that a skill has been installed, or that a new command is available in Sovereign Commander.

## Evidence requirements and safety

- Shared Workspace is the only learning/evidence source; do not add a parallel skill database.
- `UNKNOWN`, `STALE` and `UNAVAILABLE` stay visible.
- A typed `RETRY_READY` lesson is a reusable knowledge candidate, not an installed runtime tool.
- Any claimed target skill installation needs verified publisher provenance and target runtime proof (extend the projection contract before allowing production ACTIVATED status).
- No global OpenClaw skill install by default. No untrusted ClawHub skill installs.
- Existing killing, mutation, elevated Windows privileges, filesystem boundary, credentials and network routes remain unchanged.
- Keep gaming resource governor and Local model eviction policies intact; skill discovery should yield to Quest 3 gaming mode.

## Acceptance checks

```text
node --test shared/skill-forge/skillGrowthProjectionV1.test.mjs
node --test stephanos-ui/src/components/upliftWorkspaceSurfaces.test.mjs
npm run stephanos:build
npm run stephanos:verify
```

A GitHub CI pass proves source quality. Successful source tests do **not** prove live Battle Bridge service state, agent installation or served UI head parity; those require a post-merge local runtime audit and browser proof.

OpenClaw references:
- https://docs.openclaw.ai/tools/creating-skills
- https://docs.openclaw.ai/skills
