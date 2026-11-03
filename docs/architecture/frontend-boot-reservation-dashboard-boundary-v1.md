# Frontend boot reservations and dashboard authority

The frontend autostart producer reserves one attempt per machine/full boot using
an exclusive `wx` create of `status/frontend-boot-attempt-<64 hex>.json`.
Its `stephanos.frontend-autostart.v1` body is a conservative duplicate-attempt
diagnostic, not a generic Shared Workspace status envelope. Existence remains
binding after uncertain dispatch. A dashboard scan must neither reject unrelated
programme admission because of this different schema nor turn it into readiness.

The canonical specialized-status registry owns this classification, as it does
immutable worker launch identities. Only the anchored existing filename namespace
is excluded from generic dashboard validation. Its producer retains the file and
all exclusive-create semantics unchanged. Specialized records cannot enter generic
status authority, even if their bodies claim success; their own consumer remains
responsible for their meaning. Unregistered records still require full canonical
validation and fail closed. No live record migration or reservation replay is
necessary or authorized by this source change.

The regression uses the real reservation producer and dashboard reader, checks
that repeated scans retain the original bytes, and proves a second claim refuses
before and after an invalid adjacent filename produces a feed error. Existing
frontend source-continuity, uncertain-dispatch and immutable launcher tests remain
required. This is an admission boundary change requiring independent exact-head
and specialist review; fixture success alone is not live recovery proof.

Reusable lesson: classify subsystem-owned diagnostic files at the existing shared
reader boundary. Do not rewrite them into authoritative passing records to repair
a presentation consumer. Live acceptance still needs exact installed source,
browser-visible hydration and independently proven programme admission; healthy
port 4173 alone does not establish a working backend or productive builder.
