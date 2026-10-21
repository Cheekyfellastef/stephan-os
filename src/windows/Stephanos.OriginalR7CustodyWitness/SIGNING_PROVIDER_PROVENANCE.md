# R7 software signing preparation and dependency provenance

This component is algorithm and lifecycle preparation. It does not open a production
key, adopt a root/profile, sign physical observations, install a service or release
the original lease. The SCM Program.cs startup refusal remains unconditional.

## Pinned implementation

- Publisher: Legion of the Bouncy Castle Inc.
- Package: BouncyCastle.Cryptography, exact version 2.7.0.
- Official distribution: https://www.bouncycastle.org/download/bouncy-castle-c/
- NuGet identity: https://www.nuget.org/packages/BouncyCastle.Cryptography/2.7.0
- Source release commit: 4007498b13582d90ee1eda5d9920c324428b98b3.
- License: MIT; the package's LICENSE.md is retained in THIRD_PARTY_NOTICES.txt
  and copied alongside the service on output/publish.
- Raw downloaded package SHA256:
  f091ffccab4d03993e660bace277659a79dee0972f54d7f1f4bd46d680966241.
- Raw downloaded package SHA512:
  2f2b3e749b61a43f2ab8e35a024455f647bc0e0113d02c015bdd4d7898cc547646bd144d3bc0e475179815f08138272f329cc9782dc3b8bae946e9ed627abd23.
- NuGet's generated lock contentHash:
  U+12df8UEWHgBi04YVf/Lgi2dy3SItlIYvHjjEVa/BngCQIzDCDRBk50DDByCfDvSbe5pRNFr3b7UrVK2kMcLw==.
  This is the NuGet lock value, not a claim that it equals a raw archive hash.
- Official publisher checksum list:
  https://downloads.bouncycastle.org/csharp/docs/CHECKSUMS.csv.
- Publisher .NET 6 DLL SHA256:
  ef92fc661e8d7ba8ec4d39a7cdfcdba41f14cb327f0d24fe79d0b5bb428899b5.
  The retained package entry and the DLL actually loaded by the .NET 8 test must
  both match this value. Exact package references, committed dependency locks
  and CI locked restore retain this implementation; a version label is not
  independently protected runtime custody. The service bundle/image provenance
  remains part of future host qualification.

## Encoding and lifecycle invariants

Only the two existing canonical Ed25519 domains are supported. Claims are bounded
flat JSON with strings, booleans and safe integers. Duplicate keys, floats,
null/nested values, controls, Unicode and noncanonical JSON encodings are rejected.
Unsupported encodings HOLD rather than signing bytes with ambiguous Node semantics.

The operator's witnessDigest covers Node's JSON.stringify interpretation of the
witness part. A default .NET outer serializer can escape Base64 '+' differently;
the canonical part encoder preserves the interpreted bytes. The integration test
uses the unchanged authenticateLegacyOrphanQuarantine verifier, a disposable
worktree containing ASCII punctuation, Base64 + / =, public RFC8032 keys and
explicit test-only root pins. With no pins the actual verifier rejects the same
fixture. A signed synthetic fixture establishes cryptographic/encoding
interoperability, never a physical observation or production enrollment.

The internal seed session is an UNTRUSTED retained-stream test seam. It accepts
read-only 32-byte material and performs fresh OS RandomAccess reads at import and
each operation, bypassing FileStream's managed read cache. Changed material,
malformed signing input or role mismatch poisons the session and clears its owned
seed. Dispose is terminal and also clears that owned buffer. This does not prove
erasure of every library/JIT scratch allocation, hardware non-exportability,
Windows file/ACL custody or enrollment. No host path selector is supplied by the
proposal, and no production service endpoint calls the primitive.

## First-root boundary

The fixed host profile remains UNADOPTED_PREPARATION_ONLY. The first-root plan
requires two independent witness/operator keys and principals; the actual admitted
operator may be the executor and the operator root may commission the separate
witness. A pre-existing third root is not required. The read-only witness cannot
be its own executor, and neither actor may be a source principal.

Actual protected repository-owner/OS consent, exact-source review/admission,
complete native prospective source isolation, protected seed/pin/audit/replay
custody, fixed executor admission and ongoing containment must be proved by the
future host ceremony. The candidate parser, native current-context observation,
test roots and plan cannot perform or authorize that ceremony. Production key
access remains unreachable. Historical outcome stays UNKNOWN, with exact consumed
execution identity distinct from held lease revision7.

## Focused proof

Run the test executable with --signing-provider-only from the repository root.
It checks RFC8032 section7.1 vectors, domain/format/length failures, owned-buffer
clearing and terminal failure, candidate/role separation, actual current Windows
context without granting authority, and Node canonical-verifier interoperability.
The current private run passed 79 assertions; hosted CI repeats this against the
delivered source. The service and test project compile with warnings as errors.

Vector source: https://datatracker.ietf.org/doc/html/rfc8032#section-7.1.
