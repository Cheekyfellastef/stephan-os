# Canonical mailbox native evidence software producer

Continues PR #3302 — Goal #2315: implement saturated-mailbox evidence and
owner-control contracts. This is a library component for the original producer,
not a new service, controller, executable signing endpoint or enrolled key owner.

The native implementation produces the two existing V2 evidence envelopes with
Ed25519 and the exact canonical Node domain, one NUL and canonical payload.
It binds the session's producer/device/principal/profile, compares both public
SPKI and exact public PEM pins, bounds observation/Actions lifetime, refuses
unknown/missing fields and unsafe numeric values, and self-verifies signatures.
Native handle reads before and after signing bypass FileStream's managed cache.
A changed/truncated retained stream, invalid payload or disposal closes the
session permanently and clears its owned seed buffer.

canonicalMailboxNativeEvidenceCodecV2.mjs remains the canonical wire contract.
This replaceable native adapter has no independent phase/admission model. Its
output is compared byte-for-byte with that codec and passed to the exact existing
origin verifier. Even a verified signature leaves native authority, FROZEN
certification, merge and source synchronization false.

## Actual source proof and its limits

The Windows test compiles this exact C# source with warnings as errors using the
existing Framework compiler and the pinned official net461 Bouncy Castle asset.
It then runs real native handle reads and Ed25519-to-Node interoperability.
The separate library project targets .NET 8 Windows; a Framework fixture build
does not claim a .NET 8 build, NativeAOT binary or installed protected host.

Run the test on Windows with Node 24 or later:

    $env:STEPHANOS_MAILBOX_TEST_BC_PACKAGE = '<official pinned 2.7.0 nupkg>'
    node --test src/windows/Stephanos.CanonicalMailboxNativeEvidence/tests/native-producer.test.mjs

This environment option is consumed ONLY by the test driver for a public
dependency package. It supplies no production key, enrollment or profile.
The test executable is explicitly excluded from the library project. All key
material is the public RFC8032 vector #1; all records, inventories and enrollment
are synthetic fixture data. The positive origin test uses an isolated public
registry import in memory. Production enrollment remains empty and rejects the
same output. Nothing installs, changes a key, emits a mailbox command, freezes,
drains, activates an epoch or starts a build.

## Original owner's remaining commissioning proof

The constructor's retained-material seam is UNTRUSTED software input. Its pins
are comparisons, not authority. It does not prove that a path, OS handle, image,
principal or observation belongs to the original guarded transaction. It does
not detect an attacker changing and restoring bytes between observations,
guarantee erasure of library/JIT scratch copies, or establish hardware custody.

Before connecting this component to production, the existing native producer
owner must supply independently reviewed, operator-approved exact proof of:

1. The fixed installed host image, source closure, actual process principal and
   loader, with source workers excluded from key access AND arbitrary invocation.
   Ordinary same-user Node/JavaScript or Task Scheduler metadata is insufficient.
2. A separate original rotation-purpose key/public artifact, retained native
   no-reparse/single-link identity and protected key/pin/audit/replay custody.
   Capacity, Observatory and R7 keys/roles cannot be reused or relabeled.
3. A fixed ingress deriving observations from the original exclusive guard,
   transaction journal and immutable terminal/proof bundle. No external caller
   may submit a payload, seed, key path, domain, executable or signing options.
4. The actual protected-source enrollment required by
   canonicalMailboxNativeEvidenceEnrollmentV2.mjs: device/principal/profile,
   SPKI/artifact pins, allowed kinds/domain, commissioning/review digests and
   authentic operator approval reference, current validity and revocation.
5. Original ledger/replay and evidence-outbox integration, full native FROZEN/
   drain/Actions proof, protected integration, source adoption, both epoch
   acknowledgements, two distinct ACCEPTED-to-DONE probes and final VERIFY.

No production import factory, host registration, installer or enrollment writer
is added here. The library must be included in that original qualified host;
making its internal software constructor public is not a commissioning route.
The reusable invariant is that cryptographic interoperability is useful source
proof and never substitutes for original producer custody or transaction proof.

## Dependency provenance

Only BouncyCastle.Cryptography 2.7.0 is used, with an exact package reference,
committed dependency lock and MIT notice in THIRD_PARTY_NOTICES.txt.
Official package: https://www.nuget.org/packages/BouncyCastle.Cryptography/2.7.0

Package SHA256:
f091ffccab4d03993e660bace277659a79dee0972f54d7f1f4bd46d680966241

Official net461 asset and actual fixture-loaded DLL SHA256:
4f96977e9c67334742c683410b3a361258219f0d3084a5e0bc10fba96cf23a0d

NuGet lock content hash is a distinct NuGet value; neither package version nor
these software pins establishes protected installed runtime custody.
