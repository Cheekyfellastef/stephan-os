# Commander normal-operator execution context

Continues #2961 — Goal: Core Daemon Blocked-Goal Repair Steward and Proof-Gated Re-Admission.

The installed S4U task reported `Limited`, but an attended, read-only native
observation proved that its actual Commander process had an enabled
administrator token. The fixed runtime intentionally refuses that token.
Task registration metadata therefore cannot certify normal-operator execution.
The exact native inspection error was discarded by the old parent; the token
observation establishes a guaranteed failed admission predicate, not a captured
native error string.

The same existing Commander task now uses the existing Interactive/Limited
operator-session pattern. Its startup, logon and periodic triggers remain; it
requires Windows sign-in. No pre-login Commander availability is claimed. The
separate recovery tasks retain their existing S4U configuration. No task,
worker, controller, queue, credential or token-reduction mechanism is added.

Before lifecycle mutation, the runner reads its actual Windows identity and
administrator membership. Privileged, missing, malformed or unknown evidence
stops startup. This preflight cannot grant helper activation or release custody;
the fixed native helper still independently checks the operator, actual token,
protected installation, source, boot, resource and authenticated custody gates.

The elevated installer verifies task configuration, including the operator SID,
logon type, matching logon trigger and single fixed action. Its receipt explicitly
does not prove runtime token, pre-login execution or runtime activation. An
installation acknowledgment or task start request is not a healthy daemon.

The original Control Tower artifact is preserved in its own commit. Its build
consumer and Commander share one frozen descriptor of the already admitted
maintenance action/profile and its bounded deadline. The old heartbeat action
is still refused; no native allowlist is widened. A completed wake still does
not establish source-worker pickup or a material build.

Independent exact-head Windows/security review, protected integration and
separate operator-approved installation remain necessary. A running owner must
not be killed or replaced using a health snapshot as an atomic handoff proof.
Any required Windows restart needs its own approval. Already recovered custody
is not prepared or recovered again to activate this context correction.

Live acceptance requires the actual new Commander token, installed source and
helper qualification, a bound native maintenance result, original worker
admission/pickup and served-runtime evidence. Existing attended Core stale-lock
recovery remains a separate fixed action; neither this change nor a healthy
heartbeat permits manual lock deletion or replay of stale grants.

The reusable invariant is: configured privilege metadata is advisory; actual
execution-context evidence must qualify the real process. Missing evidence
holds the affected route without disabling independently qualified workers.

The read-only context adapter stays inside the existing runner. Both trusted
reviewer source modules remain unchanged. The historical internal reviewer
intentionally refuses the guarded runner's new bytes; an inert, byte-verified
fixture preserves its historical coverage without enrolling this successor.
The existing external-first route requires authentic independent exact-head/base
Windows/security evidence before formal review can clear the new surfaces.
Local tests are not qualification. Protected integration and separate runtime
approval remain required; no reviewer bootstrap authority is introduced.
