# Native owner peer operation

This source adds a one-shot operation to the existing fixed witness executable:
`--authenticate-owner-peer-only`. It is a delivery-peer authentication operation,
not an operational signer or a commissioning service. The existing SCM startup
refusal remains unconditional. The source is not admitted on Battle Bridge.
Before actual invocation, the whole exact source/package needs independent
Windows security review and protected approval of the proposed endpoint policy.

The native process retains one ephemeral RSA recipient and its original
five-minute window. Redirected standard input is a closed, byte-bounded JSON
line protocol. It accepts no file paths, endpoint URLs, commands, SIDs, adopted
policy flags, plaintext credentials or replacement native decisions. Standard
output carries public challenges, transcript/fingerprint and bounded results.

The lines, in order, are:

1. `begin-owner-peer` with `permitSha256` and `expectedMain` strings.
2. `pair-protected-run` with canonical `runId` and `runAttempt: "1"` strings.
3. `authenticate-displayed-peer` with the exact displayed `peerFingerprint`.
4. `consume-owner-envelope` with `encryptedEnvelope`, the compact JWE.

Each line has an `operation` string and exactly the fields listed above. The
third line only requests the actual Windows transaction; it cannot attest
consent. The native dialog displays the full protected-run URL, fingerprint,
expiry and narrow scope. The current implementation supports the current local
SAM operator with a fresh interactive password authentication. Domain/AAD,
Hello, smartcard, another account, cancellation or unsupported providers hold.
No authentication dialog or real account logon is performed by fixture tests.

The protected workflow separately prepares the same fingerprint before its
owner-environment decision. Only the exact purpose/fingerprint approval history
enrolls this ephemeral peer. Its producer emits ciphertext for the retained key.
The native consumer separately requires its opaque, private OS decision, current
native actor, original challenge, GitHub signature/profile, expected main and
the exact signed run and first attempt. Error, replay, expiry, changed actor or
cross-run input consumes or closes the session without an authenticated result.
Input waits are bounded; the native credential-provider call has no hard
cancellation guarantee and cannot refresh an expired challenge.

An authenticated result proves these peer factors only. It never adopts host
policy, provisions either signing root, establishes old-handle/mapping or
whole-estate exclusion, installs/starts the service, signs custody evidence or
releases R7. Those operations require their actual admitted native callgraph and
independent proof. A serialized success result cannot stand in for that proof.

The intended subsequent commissioning path remains unfinished. In particular,
the seed-creation transaction currently has owned-fixture entry points only;
source exclusion, fixed-policy OS adoption, crash/orphan handling, protected
audit and live independent signers have not been commissioned. The original
lease must remain held until those gates and the canonical owner CAS pass.
