# Proposed first-root owner endpoint policy

Status: isolated source proposal. This text, its source/tests and peer vectors
are not policy adoption, a qualified security review or permission to commission.
Use the existing issue #3123 / PR #3178 owner-controlled source route for exact
independent review and protected admission. Preserve the original r7 identity.

The existing owner environment approval for source merge does not authenticate
a Windows endpoint. This proposal adds a separate, narrowly scoped decision:
`ENROLL_EPHEMERAL_R7_OWNER_POLICY_PEER_ONLY:<full pairing fingerprint>`.
The owner must compare the complete fingerprint presented by the fixed native
Windows adapter and the read-only job for this exact run before making that
protected environment decision. Ordinary approval, a prior run/attempt or an
arbitrary comment is insufficient. This decision enrolls one ephemeral delivery
peer; it does not attest physical containment, install a service or release r7.

The native adapter separately obtains its genuine OS decision and binds its
retained original challenge to the run/attempt. The shared twelve-field,
domain-separated transcript binds repository, workflow, current main, run,
attempt 1, exact permit, audience, public-recipient digest and original issuance
and expiry. The native and Node encoders have a public static golden vector.
Neither a public key, matching hash nor a caller's claim of OS approval can
replace the independent native decision. The challenge expires within five
minutes and must never be refreshed in place or reused for another run.

The workflow first authenticates the exact reviewed/merged source, package,
current run and owner/environment configuration in a job with read-only access.
It displays the matching data before the protected decision. A dependent job
uses the same existing protected environment. The fixed issuer independently
reads actual GitHub records and the exact enrollment comment before mapping the
runner's broker URL and credential. It makes at most one credential request,
follows no redirect, then rechecks actual authority before delivery. Failure or
an unknown mint outcome is terminal; a helper cannot retry by supplying a
successful receipt, boolean or alternate transport. Source/main movement holds.

The broker URL is supplied by the trusted GitHub runner, never a dispatch input.
Its HTTPS Actions namespace, request, response size and original challenge are
bounded. The issuer encrypts the returned compact credential with RSA-OAEP-256
and A256GCM for the exact ephemeral public recipient. No plaintext credential is
printed, uploaded or written to disk. Only create-new ciphertext with mode 0600,
flush/readback and a bounded public proof is uploaded for one day. Owned byte
buffers are cleared; complete erasure of JavaScript/provider memory is not claimed.

The producer does not authenticate the Windows OS or assert a verified JWT
signature. The native consumer must independently verify the GitHub signature
and fixed issuer/key policy, audience, owner/repository/workflow/current-main,
freshness, exact run/attempt and its opaque native decision before consuming the
one-use challenge. Its full physical custody, independent witness/operator roots,
commissioning and original-mission release policy remain separate mandatory
gates. This producer cannot sign host assertions, import arbitrary roots, change
the lease, bypass review or remove the production startup refusal.

Existing five merge/lifecycle jobs keep their permissions and bodies. Only the
exact R7 mode is excluded from the three legacy dispatch jobs. Unknown modes
still enter the existing rejection path. New action uses are immutable pins.
Hosted execution and exact Node 24.21.0 behavior must be proved by genuine CI;
local fixture tests on Node 24.13.1 do not supply that proof.

Primary implementation references for the runner broker mapping:

- https://github.com/actions/runner/blob/main/src/Runner.Worker/Handlers/ScriptHandler.cs
- https://github.com/actions/toolkit/blob/main/packages/core/src/oidc-utils.ts

These explain the platform transport; they do not endorse this recovery policy.
