# Stephanos Control Tower: no-faff mailbox replacement

**Original owner:** Goal #2315, with existing #2961 Mission Controller, #2573 Sovereign Commander, #1574 Reviewer and #1290 Shared Workspace. This is NOT a new goal, worker, scheduler, lease authority or mailbox.

## Why change?

The existing fast Sovereign Relay polls the same finite GitHub issue as the slow fallback. Source of truth on protected main remains #3149, which reached the observed 2,500-comment ceiling; #3258 is still an inactive successor pending separate guarded #3268 cutover. Speeding up polling cannot remove finite issue capacity.

The operator wants to issue one build or repair intent, see the actual selected tentacle and full independently proven journey, and stop performing mailbox rollover rituals. GitHub-first independent source construction can continue even when the native transport is unavailable.

## Stage 1: this branch, source-only safe pilot

The new event-only workflow uses GitHub Actions' built-in manual workflow_dispatch interface with exactly **one** operator input: an existing goal issue number. It does not create a scheduler, persistent queue, native executor or another mailbox. No comments are posted. It provides:

- GitHub-authenticated canonical repository/owner numeric identity, source-defined main ref, immutable Actions run identity and first attempt only.
- A fixed read-only goal inspection. No user-supplied operation, path, script, arbitrary shell, URL, process ID or permissions.
- GitHub GET of protected main, then the exact goal issue, then protected main again. Any main drift or invalid issue fails closed.
- Sanitized observation summary and 30-day Actions artifact; zero secrets or raw issue text.
- Zero write permissions. Reported state explicitly says **not independently reviewed**, not source mutation authority, not lease/merge approval and not native builder pickup.
- Hostile unit tests on PR branch without privileged mutation.

**Manual dispatch is not live until this workflow reaches protected main.** A passing test job is not proof of live dispatch, physical OS custody, actual source build or UI readiness. The original #3268 freeze/drain and historical five nonterminal runs must not be bypassed.

## Stage 2: useful existing-builder discovery, without a new queue

Have the EXISTING five-controller fabric and original #2961 Mission Worker consume the immutable Actions run metadata as another *goal discovery* input. A run can only nominate an existing issue. The canonical scheduler still controls SELECT, exclusive CLAIM, source owner, exact main/head, model/provider qualification, task scope, gaming/CPU locks, retries and edit/test/commit acceptance. Do not treat Actions green or a recorded request as a worker action.

GitHub-only edits/tests/PRs may proceed independently of the saturated native mailbox. A sourced action's success requires a material diff, passing required tests, immutable PR commit and separate independent review; installed SOURCE/BUILT/SERVED and OS pickup remain distinct.

## Stage 3: native fixed actions via the original Sovereign executor

Extend the existing outbound Sovereign relay, not a second PC-side daemon, to inspect immutable bounded GitHub Actions run envelopes and fetch original task admission using a current signed/verified owner grant. Preserve immutable run identity, expiry, actor ID, exact source, dedupe, original lease/custody and gaming checks, bounded retry and correlated terminal receipt. Every privilege-changing step needs independent review and protected merge. Use existing Shared Workspace as the long-lived proof store. The Actions run is transport evidence, not long-lived command authority.

Keep the currently authorised #3149/#3258 epoch and #3268 legacy migration until the old producers and consumers have actually converged and two real successor or replacement read-only ACCEPTED-to-DONE loops are proven. No replay of old commands, generic shell, forced lease release, silent nonterminal run exemption, unreviewed protected mutation or third-party meter.

## Deluxe UI end-state

**One Build/Repair control in the original Goal Dashboard** automatically selects the authenticated command path. The Control Tower shows: original goal -> real selected existing builder/tentacle -> SELECT -> CLAIM -> PHYSICAL PICKUP -> EDIT -> TEST -> REVIEW -> protected MERGE -> INSTALLED -> SERVED -> refill. Each stage exposes the source reference, proof freshness, missing gate and one next action. A missing receipt is UNKNOWN, never PASS. Side-by-side inside-out/ outside-in fault repair shares the same evidence; no competing writers.

The operator sees ONE consequential approval only if actually required, not a parade of mailbox logistics.

## Scope and acceptance

1. This initial PR has exactly six source/test/workflow/documentation paths and no overlap with current #3268 or #1290 source candidates.
2. Read-only Actions run identity is immutable; actor/repo/ref/extra input/PR/fork/rerun/moved-main negative tests pass; no bearer/token leak.
3. PR tests and exact-head independent security review must pass before separately authorised protected merge.
4. After merge: owner triggers the one-input workflow and observes a genuine run artifact without issue comments; the original controller may discover it but not execute from it.
5. For a truly working replacement: prove one supervised existing-task material build through original admission, then authentic native retrieval and bounded terminal receipt; only then phase out comment transport.
