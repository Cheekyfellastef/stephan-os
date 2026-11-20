# Shared Workspace Proof Index V1 (Goal #1290)

## Scope and owner

Extend the **existing** Stephanos Shared Agent Workspace truth bus (Goal #1290), not its command/lease/merge authority. A single read-only projection lists a bounded window of **already-existing** `proof/` JSON records and links to GitHub goal, PR and commit identities where safely parseable. No new writer, scheduler, queue, mailbox, controller, storage root, signing key, or execution principal is introduced.

### Operator and participant reads

- **Local/private backend:** `GET /api/shared-workspace/dashboard-feed` already exists. The response now includes `proofIndex`, with schema `stephanos.shared-workspace-proof-index.v1`. The Goal Dashboard **Proof** tab consumes this same field.
- **ChatGPT via existing #1506 fixed GitHub relay:** authenticated, correlated, unexpired, owner-authored `READ_PROOF_INDEX` with `recordKind=proof-index-projection`, an **empty** bounded payload and a valid `relatedGoal` or `relatedPr` returns at most **eight** sanitized proof entries, alongside the existing signed-off transport receipt. The ordinary backend feed shows at most **24**. A relay request is not considered delivered until a matching terminal response for its unique requestId is read back. Do not post a new executable command to the exhausted #3149 or inactive #3258 mailbox.
- **Stephanos/OpenClaw/authorised local agents:** consume the existing `proof/` records or the same read-only backend projection according to their existing transport and permissions; no independent proof cache or shadow truth source should be created.
- **Hosted dashboard, iPhone and iPad:** when the existing authenticated private/HTTPS Battle Bridge backend is reachable, the ordinary shared dashboard feed carries the same proofIndex. In GitHub-only fallback mode, the private workspace itself is **not** accessible and the index must display **UNAVAILABLE**, not fake empty/fresh proof. There is no new public backend path.

### Trust and provenance

The index verifies **workspace record shape**, not the truth of each claim. A writer saying `PASS` is labelled a recorded claim, never independent CI, secure review, lease, custody, protected merge, physical runtime pickup or approval. The projection carries:

- original record timestamp, origin participant and correlation ID;
- explicit `CURRENT`, `STALE` or `FUTURE_DATED` by original timestamp (poll time never refreshes old evidence);
- bounded and sanitized proof references; safely constructed GitHub issue/PR/commit links; exact-head only when a real 40-character SHA was supplied in an already-validated record;
- separate unknown/unavailable states and source errors;
- `independentVerificationPerformed=false`, `authorizationGranted=false`, `approvalGranted=false` and `grantsExecutionOrMergeAuthority=false`.

The user can use GitHub links to inspect original protected review runs, PR diffs and test reports. Links are **pointers** to evidence, not validation of that evidence. No new secret-bearing file paths or arbitrary URL values are reflected to the browser. Do not include private filesystem paths, logs, tokens, raw environment, secret values or credentials in proof records.

### Acceptance / deployment distinction

Source publication, PR CI, independent exact-head review, protected operator approval, protected merge, Windows/Battle Bridge checkout, served build and fresh cross-device delivery are **separate gates**. Until they are proven, label this a proposed source upgrade rather than a live feature.

Focused regression commands on the admitted source checkout:

```bash
node --test shared/agents/sharedWorkspaceProofIndexV1.test.mjs shared/agents/sharedWorkspaceProofIndexBridgeV1.test.mjs shared/agents/shared-workspace-dashboard-feed.test.mjs shared/agents/chatGptParticipantBridgeV1.test.mjs tests/shared-workspace-dashboard-api.test.mjs
```

Inspect the existing Goal Dashboard Proof tab with a real backend feed and in remote fallback. Verify that a malformed, stale or absent record never appears as an approved build, and that proof links do not contain an arbitrary hostname. Browser proof remains necessary because this change affects the dashboard UI.

**Canonical references:** #1290 Shared Agent Workspace, #1506 bounded ChatGPT participant bridge, #1313 Mission Room V2. This does not change #2315 mailbox rollover authority or its cutover prerequisites.
