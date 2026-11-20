# R7 native owner-token intake preparation

The proposed protected producer exists only in the inactive
`r7-protected-owner-workflow-proposal.yml.txt` template. It is not installed in
the live owner workflow. The existing protected merge roles and validators are
unchanged. The template and CLI are tested source preparation; enabling a token
producer requires separate source-policy admission and native commissioning.

This source supplies a real cryptographic component, not an installed carrier,
first-root ceremony or physical custody witness. Production service startup
continues to refuse uncommissioned custody. The original lease remains held.

`OriginalR7OwnerWorkflowAuthentication` obtains its current primary token,
process creation time, SID, session and elevation from Windows. Elevation is
an observation, never human consent. It generates its own 32-byte nonce and
checks the same native context before and after fixed-issuer authentication.
One atomic attempt covers all outcomes, including network and parse failure;
neither retries nor another caller can renew the five-minute session.

The issuer keys come only from the fixed GitHub Actions HTTPS JWKS endpoint,
with OS TLS validation intact and no redirects, credentials or caller key URL.
RS256, bounded unique key IDs/objects, canonical Base64url, fixed repository
and owner IDs, protected environment subject, workflow/main/source identity,
audience, run/replay identifiers and freshness are verified. GitHub's bounded
optional `x5t` hint is metadata, never a trust anchor. Only the exact known
legacy and immutable-ID repository subjects are supported.

`OriginalR7OwnerEnvelopeTransport` creates an ephemeral RSA-2048 encryption key.
It is not a third signing root. The signed JWT audience binds, in order,
`stephanos:r7:first-root-owner-permit:v1:<permitSha256>:<nativeNonce64>:<recipientSpkiSha256>`.
Compact JWE uses RSA-OAEP-256 and A256GCM, a fresh 256-bit content key and
96-bit nonce, an exact canonical protected header as authenticated data, and
a 128-bit tag. The recipient SPKI is canonical DER RSA-2048/e65537. Tokens
are bounded to 32KiB and envelopes to48KiB. A wrong session, component
mutation, failed decryption or replay cannot produce another consumption.
Only the disposable-fixture seam can return plaintext; native intake sends it
directly to the fixed issuer verifier. Owned byte buffers are cleared. Managed
strings and provider scratch memory are not claimed to be hardware-erased.

## Remaining integration boundary

Matching an audience and SPKI digest authenticates neither endpoint nor
carrier. Replacing a key alone breaks the audience binding, but replacing an
entire unauthenticated challenge is possible. A real token producer must first
authenticate the exact native recipient/challenge and actual owner/OS decision
through an admitted fixed route. It must not request a bearer token and send
it to this stateless encryption method merely because an untrusted packet is
self-consistent. No production workflow, endpoint, listener, process launcher,
key store, approval card or root enrollment is created by this preparation.

Owner source/merge approval remains distinct from native host policy adoption,
OS consent, original-principal isolation, complete old-capability/re-entry
disposition and witness/operator signing custody. The existing merge job has
no first-root issuer. No fixture or source-review result fills those gaps.

Native tests exercise real disposable RSA signatures and Node's standard
`crypto` OAEP/GCM implementation against .NET, including tampering, key
substitution, cross-session consumption, concurrent one-use access, replay,
maximum sizes and authority separation. They create no production token or
root and never call the live token/JWKS path with a valid permit.
