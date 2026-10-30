# GitHub Continuity Mode M2 — bounded execution grants V1

## Purpose

M1 (`githubContinuityModeV1`) decides which work may continue when the Battle Bridge is unavailable. M2 converts only M1 `CONTINUE` dispositions into bounded execution grants for already-proven source execution routes.

This is intentionally not a second scheduler, queue, worker, lease owner, source writer, merge engine or runtime controller.

## Required parent truth

M2 accepts only a valid `stephanos.github-continuity-mode.v1` plan that:

- is bound to the same repository and exact expected source head as the execution envelope;
- is explicitly in `GITHUB_CONTINUITY` state;
- requires recovery handoff to #1814;
- adds no source mutation, merge, deployment or runtime mutation authority;
- forbids duplicate dispatch and protected-merge dispatch.

Any identity drift or authority widening blocks the entire batch.

## Eligible work

A grant may be emitted only for a task that M1 classified `CONTINUE` and that is:

- non-Windows-bound;
- dispatchable through an already selected canonical route;
- bound to a safe mission ID and task ID;
- bound to the route adapter and the existing capacity receipt when the route requires one;
- bound to safe proof references.

The admitted routes remain the existing canonical routes only:

- `CODEX`;
- `CHATGPT_GITHUB`;
- `FOUNDRY_FORGE`.

M2 does not make an unavailable route available. It preserves the route selected by the existing capacity router.

## Explicit holds

M2 emits no grant for:

- `HOLD_RUNTIME_RECOVERY`;
- `HOLD_NO_PROVEN_CAPACITY`;
- `PRESERVE_EXISTING_DISPATCH`;
- invalid tasks.

A forged `CONTINUE` disposition that is Windows-bound fails closed rather than escaping the Battle Bridge outage fence.

## Authority boundary

Every grant states:

- `executionScope = SOURCE_ONLY_EXISTING_ROUTE`;
- no existing-dispatch takeover;
- no source-mutation authority added;
- no merge authority added;
- no deployment authority added;
- no runtime-mutation authority added;
- no protected-merge dispatch;
- no lease seizure;
- no duplicate dispatch;
- no arbitrary command.

The grant is therefore a portable, bounded continuation packet. The existing route still owns its ordinary authorization, lease, publication, review and completion contracts.

## Incident behavior

During the August 2026 Battle Bridge outage, M2 permits eligible GitHub/cloud source construction to retain momentum while Windows-only Forge commissioning, runtime deployment and acceptance remain held for remote recovery.

This prevents a Battle Bridge failure from becoming a programme-wide stop without pretending the missing machine is healthy.

## Next slice

M3 should connect these grants to the existing durable external-handoff/worker-queue machinery with idempotent correlation and portable completion receipts. It must not create a parallel scheduler or bypass protected merge/runtime gates.
