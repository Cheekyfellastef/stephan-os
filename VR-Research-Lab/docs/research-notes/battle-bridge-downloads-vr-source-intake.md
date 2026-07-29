# Battle Bridge Downloads VR Source Intake

Status date: 2026-07-29  
Canonical worker: #1595  
Starfield integration goal: #1611

## Purpose

Allow Stephanos to ingest VR source packages that the operator downloads onto the Battle Bridge without turning the operator into a manual file courier.

This contract advances the governing policy: **The best click is no click.** The operator supplies intent and may place a source package in Downloads. The bounded worker performs inventory, provenance, licence classification, static analysis and evidence routing.

## Approved Windows intake surface

Default source root:

```text
C:\Users\Stephan Callear\Downloads
```

Preferred bounded drop zone:

```text
C:\Users\Stephan Callear\Downloads\Stephanos-VR-Intake
```

The worker may inspect the approved Downloads root for explicitly authorised VR packages. New unattended ingestion should use the dedicated drop zone so unrelated personal downloads are not swept into research.

## Allowed intake material

Examples include:

- source repositories downloaded as ZIP or other approved archives;
- loose source trees;
- public mod source packages;
- SDK samples whose licence permits analysis;
- documentation, manifests, symbols and logs supplied for an authorised VR goal;
- operator-created configuration exports and test evidence.

Each item remains a candidate until provenance and licence are established.

## Required intake workflow

1. **Discover**
   - identify only material within the approved scope;
   - record original path, name, size and timestamps.
2. **Hash**
   - calculate SHA-256 before unpacking or modification;
   - preserve the original as immutable evidence.
3. **Classify provenance**
   - identify canonical upstream, creator, release and download route;
   - flag mirrors, uncertain origin or access-controlled material.
4. **Classify rights**
   - read root and per-file licences;
   - classify reusable, attribution-required, copyleft, analysis-only, proprietary, restricted or unknown.
5. **Quarantine and unpack**
   - safely unpack approved archives into isolated staging;
   - prevent path traversal, overwrite and executable auto-launch;
   - inventory nested archives and binaries.
6. **Index**
   - create a static source index, language/build overview and important-file map;
   - do not compile or execute by default.
7. **Relate**
   - link the source to the canonical VR registry, Starfield target, Creation Kit evidence, Capability Graph and current goal.
8. **Emit evidence packet**
   - return facts, unknowns, licence posture, hashes, source map and recommended next bounded action.
9. **Promote selectively**
   - commit only lawful derived notes, manifests, small attributed excerpts where permitted, and independently written extraction records;
   - never mirror a full external project merely because it was available locally.

## Approval gates

Explicit approval remains required before:

- executing or installing a downloaded binary;
- compiling and launching an unknown project;
- injecting into Starfield or another game;
- changing game, mod-manager, runtime or headset configuration;
- using elevated privileges;
- uploading or publishing any third-party content;
- deleting, moving or modifying the original download;
- accessing material outside the approved intake scope.

Static hashing, inventory, licence inspection and source indexing are bounded research actions under #1595.

## Forbidden handling

The worker must not:

- ingest unrelated personal Downloads content;
- upload Bethesda game files, Creation Kit files, ESM/ESP/ESL plugins, BA2 archives or game assets;
- publish proprietary mod binaries, paywalled files, credentials or private tokens;
- use unauthorised mirrors as canonical sources;
- execute installers or scripts merely to inspect them;
- silently replace or clean up the operator's original files;
- declare a package safe, compatible or accepted without the required proof.

## Evidence packet contract

Every packet should include:

```json
{
  "packetType": "vr-source-intake",
  "goal": 1595,
  "integrationGoal": 1611,
  "sourcePath": "<approved local path>",
  "originalSha256": "<hash>",
  "canonicalUpstream": "<url-or-unknown>",
  "versionOrCommit": "<identity-or-unknown>",
  "licence": "<classification>",
  "rightsVerdict": "reusable|attribution-required|copyleft|analysis-only|restricted|unknown",
  "unpackVerdict": "not-required|safe-staged|blocked",
  "sourceIndex": "<evidence location>",
  "target": "starfield|other-vr|shared-infrastructure",
  "facts": [],
  "unknowns": [],
  "risks": [],
  "nextBoundedAction": "<action>",
  "commands": [],
  "timestampUtc": "<time>"
}
```

## Starfield-first use

For the first Skyrim VR-quality project, prioritise intake of:

- Mutar/NoMoreFlat Starfield source and exact releases;
- lawful Creation Engine 2 and SFSE-related public source;
- VR framework source supplied by the operator;
- configuration or diagnostic packages from the known-good VorpX baseline;
- headset logs and captures generated by approved experiments.

The worker should compare downloaded code with the canonical upstream revision whenever possible. A local package may contain newer, older or modified material and must never be assumed identical from its filename.

## Success condition

The contract is proven when the operator can place one authorised VR source package in the intake folder and Stephanos returns a provenance-preserving, licence-aware source index and evidence packet without requiring the operator to manually copy files into GitHub or relay command output.
