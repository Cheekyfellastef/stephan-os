# GitHub-first one-shot source execution (#1574)

Owner: #1574 — Provider-neutral build and review continuity when Codex capacity is unavailable.

`createChatgptGithubGoalExecutorV1` supplies the missing execution adapter for the
existing manually invoked ChatGPT GitHub route. It is callable source, not another
planner, scheduler, worker pool, mailbox, lease database, review authority or
unattended service. Nothing registers a new Battle Bridge action or source writer.
PR #3132's multi-candidate arbitration remains separately owned; this executor
admits exactly one task, using the existing picker and canonical construction
authority, so it does not depend on unmerged picker bytes.

## Execution and continuation

1. A trusted host uses its own authenticated GitHub credential to read an owner
   comment on the original open goal, immutable for at most ten minutes. Validate
   fixed owner ID and login, goal binding, schema, expiry and exact main. Neither
   a task token nor a caller-supplied approval boolean is accepted.
2. Read the complete current GitHub PR estate with the existing authenticated
   discovery adapter. Obtain fresh task/path/head-bound canonical, Seed, Island
   and ChatGPT custody observations from the independently trusted host observer.
   Unknown custody holds this task. The original #2962/R7 attempt was RETIRED, with historical outcome UNKNOWN: it must never be reopened or released again. Any current, later source writer/maintenance hold is an independent identity requiring its own owner-authenticated proof.
3. Use `createBoundedParallelConstructionAuthority` for admission and its atomic
   reservation callback. An inventory check alone cannot acquire ownership.
   Keep that reservation when execution becomes uncertain; do not auto-release.
4. Persist the existing #1568 receipt chain and immutable evidence artifacts.
   Reserve the exact task branch with GitHub create-ref only. Recheck approval,
   current main/PR collisions, reservation custody and branch before source work.
5. Call the fixed GitHub `createCommitOnBranch` mutation with `expectedHeadOid`.
   This is a compare-and-swap append; a preliminary GET plus ordinary REST
   non-force ref update is insufficient. Publish at most six explicitly approved
   document/test additions or replacements (8 KiB each), never delete files or
   touch main. Authenticate resulting commit and complete changed-file scope.
6. Persist source proof, recheck ownership and PR collisions, open one **draft**
   PR for actual hosted CI. This avoids automatically requesting optional metered
   Codex review on initial PR creation when Codex is unavailable. Independently
   qualify exact-head review via the existing provider-neutral route; only the
   separately authorized protected READY/review lifecycle may later mark it ready.
   The GitHub-side Codex app may also auto-review on READY unless its own account
   settings disable that behavior; the draft default does not control that app.
   The existing protected operator workflow owns approval and merge. The adapter
   has no merge, ready, review, deployment, OS, source-lease-release or shell operation.
7. `reconcile` reads the ORIGINAL durable execution, authenticates exact PR/head
   identity and GitHub's merge result, then asks the separate protected collector
   for actual immutable review/workflow/environment proof. Only after that may
   the existing canonical completion/refill adapter reconcile this source child.
   Parent-goal completion, Battle Bridge installation and the next physical pickup
   remain separately proven requirements.

No request is retried internally. A timeout/lost acknowledgment after a write
returns `GITHUB_WRITE_OUTCOME_UNKNOWN` with the same reservation and branch.
`reconcile` reads that original canonical record even before its head/PR is known,
authenticates the original comment digest and active reservation, inspects that
same branch and verifies both its exact one-commit scope and every approved byte.
It discovers any existing PR before publishing a missing one. Missing source is
never re-executed. Expired authority permits read-only recovery of an existing
publication; it cannot authorize a new PR POST. A separate read-only recovery
receipt binds discoveries to the original task/reservation without reopening a
terminal source execution. Never create a replacement branch or PR.
Receipt sink failure prevents subsequent writes. Repeating intake
must encounter the canonical reservation fence rather than reacquire a lane.

## Owner intake

Post one `stephanos-chatgpt-source-task` JSON fence on the actual goal issue. The
closed schema has exactly `schemaVersion` (`stephanos.chatgpt-source-task.v1`),
`taskId` (3–40 lowercase letters/digits/hyphens), `expectedMain` (full SHA),
`expiresAt` (within ten minutes of authorship), `taskClass` (`docs-only` or
`tests-only`) and `edits` (1–6 exact `{path,content}` objects). Existing picker
path rules apply. Source implementation of this executor is standard/authority
code requiring its own independent review; this pilot task restriction does not
qualify it for self-implementation or self-review.

## Host commissioning contract — still required

The factory receives host-owned `token`, bounded `fetchImpl`, the EXISTING
`authority`, `readCustody`, `verifyReservation`, `appendReceipt`, `readExecution`,
`confirmProtectedMerge`, `completeAndRefill`, and clock. They must not be loaded
from task-selected modules, URLs, paths, executable strings or goal content.

- `readCustody` must read all four actual ownership domains and canonical active
  inventory. An injected empty inventory or forged `VERIFIED_UNCLAIMED` record
  is not authentication. The stock discovery adapter alone cannot supply this.
- The canonical authority's reserve callback must atomically compare current
  inventory and reserve scope, task and capacity across concurrent hosts. Its
  persistence/replay fence must survive host restart. This adapter creates no
  substitute lock or lease store. Never bind it to an in-memory test reservation.
- `verifyReservation` must independently resolve the same active, unexpired,
  exact task/branch/base/path reservation from that existing authority. It cannot
  merely check that an earlier local JavaScript object exists.
- `appendReceipt` must write `context.evidence` create-only at
  `context.evidenceRef`, verify its SHA-256, and durably append the validated
  receipt through #1568 machinery BEFORE returning `{ok:true,evidenceSha256}`.
  False/missing acknowledgment or wrong artifact digest stops execution. Store original task/comment
  digest, canonical reservation and exact branch/head/PR metadata for recovery.
  An API acknowledgment without durable evidence is insufficient.
  This chain begins before PR creation, so its immutable `prNumber` stays zero;
  its later PR/head binding lives in the hashed evidence and recovery record.
  Receipt times must strictly advance; a broken clock is held, never fabricated.
  Persist original comment digest, task, lease and recovery metadata at EVERY
  checkpoint, including pre-commit/pre-PR and failure checkpoints. Recovery must
  not require the fields whose write acknowledgments may have been lost.
- `readExecution` must resolve that original canonical record, not caller JSON.
  `confirmProtectedMerge` must use the existing independent exact-head review
  and protected merge artifact collector, including environment approval. A PR
  `merged` flag, green tests or our own receipt is insufficient.
- `completeAndRefill` must be canonical, atomic and idempotent for the original
  execution/reservation/merge. It must not close parent #1574 or count a refill
  as physically picked up. Runtime-changing work needs separate live acceptance.
- Use an already-approved GitHub App/user credential whose source publication
  actually triggers CI. Never put credentials in comments, receipts or source.

Zero-meter scope: this change removes one **unnecessary early vendor-review trigger**, not ChatGPT/GitHub hosted dependencies. A provider-neutral CI/security artifact must still be independently authenticated, high-risk specialist gates remain binding, and a draft PR is neither a review pass nor a merge. It does not claim a working fully local/offline route.

The existing bounded construction authority is a source contract. A production
`reserveConstructionLane` host binding was not found in repository source.
The Battle Bridge four-domain custody reader and persistent reservation host
binding have not been commissioned by adding this file. No current service,
timer, source writer, protected action, or lease was changed. A direct factory
invocation with unqualified adapters cannot establish production authority.

## Proof and limits

`node --test shared/agents/chatgptGithubGoalExecutorV1.test.mjs` exercises the
real canonical admission/reservation implementation and real on-disk #1568
receipt chain with controlled GitHub/custody/protected-collector test doubles.
It covers exact CAS, branch collision, scope overlap, replay, ownership loss,
quota, write uncertainty, receipt failure, changed main/head and protected
merge/refill denial. Existing hosted Shared-agent regressions A–F automatically
include this test; no new CI workflow or review-policy changes are necessary.

These tests prove adapter behavior, not a live GitHub source-task invocation,
independent human/model review, Battle Bridge pickup, protected merge, installed
runtime or two unattended refill cycles. Report each of those from its own real
receipt. The reusable invariant is: authenticate intake, reserve through the
existing owner, compare-and-swap source, checkpoint before the next write, and
keep incomplete lifecycle stages pending under the same identity.

GitHub API reference: https://docs.github.com/en/graphql/reference/commits#createcommitonbranch
