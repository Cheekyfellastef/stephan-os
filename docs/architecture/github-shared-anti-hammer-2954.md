# Goal #2954: shared GitHub cooldown for the canonical control plane

This is the bounded repair PR for #2954, **Close fleet-wide GitHub anti-hammer cooldown gap**.

## Fault and scope

Repeated GitHub API installation rate-limit responses from the existing observation and pull-request evidence readers caused avoidable retries and protected review failures. The already-prepared source patch adds a shared, durable cooldown contract to `githubObservationBrokerV1` and consumes it in `githubPrEvidenceService`. It also includes two focused test suites.

## Allowed change

Only the existing observation broker, PR evidence service, their regression tests, and this document. No duplicate provider, daemon, queue, controller, new GitHub credential, or bypass of protected branch/check requirements.

## Required proof

- Source patch applies to the current canonical main head without modifying existing non-related changes.
- Scoped regression tests pass, including a shared retry-after/cooldown case and failure-closed read behaviour.
- Existing code paths remain read-only for GitHub observation.
- The exact PR head passes source-firewall, protected review, security review, and required tests.
- Canonical goal #2954 remains blocked until its own mission receives a valid independent repair, re-entry, worker-pickup and completion receipt. GitHub merge alone does not supply those mission receipts.

This PR does not relax the source mutation lease, merge protection, or admission authority.
