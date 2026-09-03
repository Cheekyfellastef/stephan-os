# Stephanos OS — Project Intent Pack (Codex Guardrails)

Stephanos is a launcher-shell + runtime system with strict truth boundaries. Read this first, then any task-specific docs.

## Stephanos OS North Star
Build a persistent, cross-device human+AI mission operating system that preserves operator intent, reduces cognitive load, enforces architectural canon, verifies reality, and compounds professional quality over time.

## Roles
- **Operator:** sets mission intent, approves direction, defines quality bar.
- **Codex:** executes bounded changes that preserve canon/truth, proves outcomes, avoids local symptom-only fixes.
- **OpenClaw/Harness direction:** evolve toward approval-gated orchestration where Codex/OpenClaw/future agents run through shared truth + evidence contracts.

## Architecture canon (must preserve)
- Launcher shell (`/`) and Mission Console/runtime remain separate responsibilities.
- Keep `launchEntry`, `runtimeEntry`, `launcherEntry` distinct (`entry` is compatibility fallback only).
- Dist (`apps/stephanos/dist/**`) is generated output, never source truth.
- Runtime adjudication/truth systems remain canonical; UI consumes final projected truth.
- Keep provider intent/selected/executable/actual truths distinct.
- Keep reachability/usability/browser compatibility truths distinct.

## Canonical-adapter doctrine
- Do not create local one-off state, pane logic, route logic, provider shortcuts, duplicate authority surfaces, or isolated telemetry walls.
- Platform-specific adapters are allowed when they derive from canonical shared state, remain replaceable, publish bounded receipts, and cannot become an independent source of truth.
- Extend canonical models and shared projections whenever behaviour or authority must be reused across surfaces.

## Rule application and risk tiers
Apply rules to the authority surface actually affected; do not impose high-risk ceremony on unrelated low-risk work.

- **Constitutional rules always remain hard:** no fabricated proof, secret exposure, destructive Git, arbitrary command/filesystem authority, duplicate mutating lanes, silent authority expansion, or merge/deployment outside required approval gates.
- **Authority-bearing evidence fails closed:** identity, issue/PR/branch/head binding, approval, dependency completion, execution route, lease ownership, review/check status, proof, deployment state, runtime state, security policy, and spending authority.
- **Advisory evidence degrades safely:** labels, descriptions, presentation metadata, optional summaries, and non-authoritative decoration may become `UNKNOWN` or warning-bearing without stopping unrelated scheduling.
- **Low risk:** documentation, fixtures, test-only changes, and non-authoritative presentation metadata. Require focused deterministic proof and exact-head delta verification.
- **Standard risk:** ordinary source logic and shared projections. Require relevant complete tests and independent exact-head review.
- **High risk:** security, approval, controller authority, credentials, runtime mutation, deployment, provider switching, spending, and destructive capability. Require specialist review, complete exact-head proof, and all operator gates.
- Exact-head operator merge approval remains required unless a separately implemented, proven, and explicitly authorised standing-authority envelope says otherwise.

## Protected Command Deck rules
- Treat composer/input/execute flow as protected surface.
- Preserve answer pane visibility, scrollability, and autoscroll to latest final answer.
- Use pane canon primitives (CollapsiblePanel), not ad hoc replacements.
- Clipboard copy UX must provide success confirmation (green state) after successful write.

## Browser proof + evidence rules
- Require browser proof when a change affects browser-visible behaviour, interaction, visual truth, served-state claims, or UI/runtime integration.
- Do not require browser proof for documentation, test-only work, internal source validation, or backend logic that does not change browser behaviour.
- Support Snapshot / UI Reality are evidence surfaces, not decoration.
- Never report healthy/current authority-bearing states without reality proof.

## Ignition + convergence direction
- Keep ignition/startup clean, deterministic, and truth-preserving.
- Prefer the smallest **systemic** correction, not the smallest textual patch.
- First repair: fix the bounded defect and add a regression.
- Second related repair: strengthen the shared invariant/state model and adversarial tests.
- Third current-head P1/P2 repair round in the same invariant class: stop narrow guard accumulation and perform structural design review before another patch.
- Repeated invariant failures must produce model/property tests or an explicit architectural debt record.
- Do not loosen validation to “make it pass.”

## Human–AI Flywheel closure
- Every completed **programme goal** must deliver the requested result, add or confirm a reusable capability, and publish a new shared lesson/invariant or explicitly reference an existing applicable lesson.
- Child commits, fixture repairs, comments, and bounded sub-tasks may contribute to the parent goal outputs; they do not need to invent artificial capabilities or lessons individually.
- A goal with abnormal repair churn is not complete until its systemic lesson and convergence evidence are durable.

## PR hygiene rules
- Default to bounded, source-only changes unless explicitly requested.
- Never stage generated dist/runtime artifacts, `node_modules`, secrets, or root data dumps in source-only PRs.
- PR range must be clean: `origin/main...HEAD`.
- Explain root cause, assumptions, regression risks, applicable risk tier, and proof.

## Publication capability continuity
- Before declaring source publication blocked, discover the repository in every approved workspace root, including bounded nested checkouts, and preserve any existing commit or verified diff.
- Discover all task-relevant publication routes before denying capability: authenticated Git, the connected GitHub App blob/tree/commit/ref API, receipt-proven Forge or provider-neutral capacity, and the existing Battle Bridge handoff.
- A missing `gh` binary or one failed credential is a route-specific observation, never a global publication blocker while another approved route is proven available.
- Fail over without rebuilding the source change. Preserve exact base, head, tree, branch and PR identity; never force-push, overwrite an unrelated remote branch, create a duplicate PR, or bypass review and merge protection.
- Only report `SOURCE_PUBLICATION_CAPACITY_UNAVAILABLE` after bounded workspace discovery and every registered route has produced unavailable or invalid evidence.


## GitHub write-surface continuity
- Treat a connected ChatGPT/OpenAI GitHub write rejection that occurs before a durable execution receipt as a **route-specific execution-surface failure**, not as evidence that GitHub, the repository, the mission, or all publication capacity is blocked.
- Record the affected capability as `WRITE_BLOCKED` / `EXECUTION_SURFACE_FAILURE` for that provider surface, preserve the exact mission/task/goal identity, canonical owner, branch, base/head/tree, resource leases, review state, approval packet, source diff/artifact and required proof, then continue through the existing provider-neutral routing and continuity machinery.
- Reuse the canonical #2099 provider-failover path and existing publication/continuity routes. Select only an already-qualified healthy route such as OpenClaw, Foundry/Forge, Stephanos Native, an approved GitHub App blob/tree/commit/ref path, or the existing Battle Bridge handoff when its bounded contract admits the task.
- Do **not** rebuild the same source change, create a duplicate branch/PR/controller/scheduler/worker, seize another writer's lease, force-push, weaken review, or widen authority merely because one connected write surface failed.
- Do not repeatedly retry a known-broken client mutation when another qualified route is available. Park only the failed surface/action, release nonessential capacity where allowed, and continue resource-disjoint eligible work in the same controller run.
- A provider substitution does not inherit new authority. Protected ready, merge, deployment, runtime, credential, spending and other consequential gates remain independently binding.
- Do not claim that the alternative route executed, published, merged, deployed or became qualified until its own exact receipt/proof is present.
- Controller/build-chat reporting must distinguish `CHATGPT_GITHUB_WRITE_BLOCKED` from global GitHub unavailability. When another qualified route exists, the expected posture is “same mission handed to provider-neutral continuity fabric,” not “programme blocked by GitHub.”


## Source artifact escrow continuity
- When a source change already exists but every currently attempted publication route is unavailable, preserve the exact verified diff/commit/tree as a durable escrow artifact instead of rebuilding the change or asking the original executor to recreate it.
- Reuse the existing `sourceArtifactEscrowContinuityV1` / source-publication continuity machinery. Bind escrow to repository, canonical owner, branch, exact base/head/tree/diff identity and proof; retire it only after canonical publication is independently proven.
- A failed original publication surface does not invalidate the source artifact. Try only registered, qualified publication routes and fail closed when all route evidence is unavailable or invalid.
- Do not create a duplicate PR, branch, implementation lane or mutation owner merely because publication is delayed.

## Review artifact continuity
- A successful independent review whose normal terminal artifact/comment publication failed is not equivalent to “review never happened.” First inspect the existing workflow run/attempt and immutable artifacts, then use the canonical successful-review artifact recovery path when its exact predicates match.
- Reuse `independentReviewSuccessfulArtifactRecoveryWorkflowV1`, the exact-head review dispatcher and existing recovery script. Never manufacture a clean review, substitute another run/head/base, or convert missing evidence into success.
- Do not blindly rerun expensive review when an exact successful review result already exists and only publication/terminalization failed. Recover the authenticated artifact first; rerun only when recovery is inapplicable or invalid.
- Review recovery grants no ready, merge, deployment, runtime or self-approval authority.

## Provider/review capacity continuity
- Treat Codex/Work quota exhaustion, provider outage, queue saturation, or reviewer-capacity loss as a provider-capacity event, not as permission to stop unrelated eligible work.
- Reuse the existing provider-neutral review/qualification routes, OpenClaw/Forge/native capacity, #1898-#1901 continuity contracts and canonical scheduler/provider pool. Preserve the same task identity and review requirement while selecting another already-qualified provider.
- Never downgrade required review class, specialist coverage, exact-head/base binding, source evidence, or independence merely to avoid a provider outage.
- If no qualified alternative exists for that exact task class, park only that lane with a typed blocker and continue resource-disjoint eligible work.

## Protected ready-transition continuity
- For authorised draft-to-ready transitions, prefer the existing #1507 protected workflow-dispatch mailbox and `MARK_PROTECTED_PR_READY` route over any client-side GraphQL convenience mutation.
- Treat connected-client failures mentioning `Repository.fullDatabaseId` / `undefinedField` as a known client schema defect, not as evidence that GitHub or the protected ready route is unavailable.
- Do not retry that broken client mutation, invent caller-supplied GraphQL, or create a second ready/merge mechanism. Use `protectedReadyExecutionRouteV1` to select the canonical route and fail closed if its exact identity, review, mailbox, or operator-authority predicates are missing.
- The ready operation grants no merge, deployment, runtime, provider, credential, ruleset, or branch-mutation authority beyond the exact protected ready transition.

## Professionalisation clause
- Every programme goal must preserve or improve production-grade reliability, maintainability, operator trust, and reusable capability.
- Individual bounded repairs should remain narrow when they contribute to a proven goal-level outcome; do not gold-plate or expand scope merely to appear comprehensive.

## Definition of done
A change is done when it:
1. preserves canon/truth boundaries,
2. satisfies the proof required by its affected risk and authority surfaces,
3. keeps PR scope clean and reviewable,
4. leaves clear evidence and no hidden side effects,
5. contributes to the parent goal’s result/capability/lesson contract or explicitly records bounded debt.


## Goal, issue, and pull-request naming in operator communication
- When referring to a durable Stephanos goal, GitHub issue, or pull request in operator-facing chat/reporting, always include both its identifier and its exact current title on first mention. Preferred form: `#1657 — OpenClaw Standalone autonomy programme` or `PR #2099 — Route builder ignition around blocked OpenAI surfaces`.
- Do not present a bare issue/goal/PR number to the operator when the exact title is already known or can be safely read from canonical GitHub/durable state.
- If a title is not already in the current evidence packet, retrieve it from canonical GitHub/durable state before using the item in an operator-facing approval list, blocker queue, status summary, continuation report, merge-readiness list, or goal-progress answer.
- Never invent, abbreviate into a materially different meaning, or silently substitute a stale title. If exact title retrieval is unavailable, say `#<number> — title unavailable from current evidence` rather than guessing.
- In dense follow-up prose, a bare number may be used only after the same response has already established the exact `#number — title` binding and no ambiguity can result. Approval packets and merge/runtime gates should repeat the exact title even if it appeared earlier.
- This rule applies across general Stephanos controllers, scoped programme controllers, builders, reviewers, recovery agents, Forge/Foundry/OpenClaw/native provider chats, dashboards that generate operator-facing text, and future agent/bootstrap contexts that consume this repository instruction.
