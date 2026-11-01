# Codex Capacity Outage Runbook

## Trigger

Treat any explicit Codex meter exhaustion, usage-limit response, code-review quota exhaustion, provider-capacity outage, or equivalent `Codex unavailable` evidence as a provider-capacity event. Typical evidence includes messages such as `You have reached your Codex usage limits for code reviews`.

## Required response

1. Preserve the existing mission, goal, branch, PR, exact head/base/tree, review state, proof and operator authority. Do not rebuild work merely because Codex is unavailable.
2. Stop retrying Codex once the capacity outage is proven for the relevant surface. Repeated quota retries are not progress.
3. Route immediately through the existing Stephanos provider-neutral machinery. Prefer already-qualified OpenClaw, Forge/Foundry, Stephanos Native, GitHub Actions independent-review, GitHub App publication, or Battle Bridge routes that admit the exact task.
4. For review work, use the canonical provider-neutral exact-head review coordinator and immutable-artifact recovery path. A Codex review quota failure does not waive independent review, specialist coverage, exact-head/base binding, or evidence requirements.
5. For source/build work, continue eligible resource-disjoint work through the canonical scheduler/provider pool. If no qualified alternative exists for the exact task class, park only that lane with a typed capacity blocker and continue other eligible work.
6. Never create a duplicate controller, worker, scheduler, branch, PR, review lane or mutation owner to work around Codex capacity.
7. Never weaken merge, deployment, runtime, credential, spending or other operator gates because Codex is unavailable.
8. Report the condition as `CODEX_CAPACITY_UNAVAILABLE` or equivalent provider-specific truth, not as global programme/GitHub failure when Stephanos has another qualified route.

## Controller and new-chat doctrine

A controller or new chat that encounters an empty Codex meter must not enter narration/wait mode. Its next action is to discover and use the best already-qualified Stephanos route, preserving exact identity and authority. The operator should only be interrupted when a real operator gate or a genuine no-qualified-route blocker remains.

This runbook refines the repository-wide `AGENTS.md` section **Provider/review capacity continuity**. That doctrine remains authoritative: provider substitution changes capacity, not authority.

## Success criteria

The outage is handled correctly when the same mission continues through a qualified non-Codex route, or only the unsupported lane is durably parked while unrelated eligible work continues. A successful bypass must still produce its own receipts and proof before any claim of execution, review, publication, merge or runtime effect.
