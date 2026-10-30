# Launcher publication and runtime readiness

The launcher needs current valid Shared Workspace publication before its bounded
UI repair can run. Publication presence is a different fact from the aggregate
runtime verdict carried in that publication. A fresh `UNKNOWN` observation is
neither a missing observation nor proof of a healthy runtime.

The observed cold-start cycle was: the explicit publisher reported truthful
`DEGRADED/PARTIAL_UI_MISSING`; the backend's existing publisher then wrote
`UNKNOWN` because the supervisor was not green; the launcher interpreted that
runtime verdict as absent publication and refused the UI needed for green.
Independent current-main tests also found that malformed JSON, empty objects,
wrong identities and future/old content with fresh filesystem time could pass.
Repeated startup attempts cannot repair either invariant.

The existing shared publisher model now projects publication integrity and
freshness separately while preserving the original runtime status. Only the
fixed canonical Battle Bridge paths can use a valid `UNKNOWN` status/proof as
publication presence. Legacy `UNKNOWN` stays held. Schema, kind, record identity,
declared proof references and content time are checked through the canonical
record validator plus the fixed producer contract. Missing status/proof evidence,
foreign or ambiguous identity, stale/future content and invalid filesystem
evidence fail closed. Events follow their existing event schema, which does not
declare proof references, and cannot by themselves supply current state proof.

Filesystem reads are bounded to one megabyte, require a single-link regular
file, and compare path/handle identity and metadata before and after reading.
Filesystem time cannot refresh old content. Production observation time is
taken after reading; filesystem sub-millisecond precision is compared in the
same millisecond domain as the observation clock.

The launcher consumes publication presence only for its existing publisher
prerequisite. Backend, UI, exact source, dependencies, fixed command and served
runtime proof remain separate gates. Programme admission and native custody do
not consume this bit. No record is rewritten, no `UNKNOWN` becomes `READY`, and
no new writer, scheduler or execution authority is introduced.

The supervisor also retains at most two bounded UI repair observations across
later readiness projections. Typed blocker/spawn codes, PID, exit and exact-head
fields survive; raw child output, environment and arbitrary error text do not.
These are diagnostic observations and grant no runtime activation. The earlier
empty-log launch failure remains historically unexplained until an actual
qualified launch supplies its result; the publication correction does not
pretend to prove that child ran.

Regression coverage uses both real producer constructors, all eight interrupted
status/proof/event write combinations, strict negative evidence, preserved
runtime verdicts and actual supervisor persistence. Windows fixtures explicitly
use isolated workspaces so tests cannot read or write the operator's live estate.
Independent baseline was seven failures and one pass; candidate proof is source
validation, not installed or browser acceptance.

The maintenance installer and fixed runtime authenticate separate source
closures. Both must cover the full transitive probe graph before evaluation;
the maintenance bootstrap and its receiving installer agree on exactly 42
pinned files. A parse-only graph regression rejects either missing new import.
Publication state proof references must each be nonempty, trimmed strings;
coerced values and whitespace cannot establish publication authority.

Reusable lesson: publication integrity, observation freshness, component
readiness and execution admission need distinct canonical projections. A
repair's prerequisite must not depend on the successful outcome it is meant to
produce. Exact-head security review, protected integration and separately
approved installation/commissioning remain required. No restart is authorized
by this change; the preceding commissioning restart has already been used.
