# Spatial World Foundry Storage Contract V1

## Purpose

This source-only slice advances #1760 large-asset handling without choosing or installing a storage provider.

It reuses the M2 asset registry and its canonical `cas://sha256/<hash>` identity. Physical storage can later be local content-addressed storage, Git LFS or an object store without changing the logical asset identity.

## Adapter contract

A storage adapter declares only:

- adapter id/version;
- provider class;
- fixed URI scheme;
- immutable addressing support;
- content-hash verification;
- mandatory write receipt.

The descriptor deliberately has no endpoint, arbitrary path, executable, shell command, token or credential field.

## Placement planning

`planSpatialStoragePlacement` accepts only a valid M2 registry, valid M1 asset record and valid adapter descriptor. It first proves that the asset can enter the M2 registration model and then derives the immutable target from the asset SHA-256.

The result is either a reference already bound to canonical CAS or a storage-write proof requirement. Neither state performs the write.

## Receipt boundary

A future fixed adapter can return `stephanos.spatial-world-foundry.storage-receipt.v1`. The receipt must bind exact adapter id/version, asset identity, content hash, target URI and registry source head, and must state `STORED_AND_HASH_VERIFIED`.

Even a valid receipt proves storage only. It grants no source mutation, asset promotion, merge, deployment or runtime authority.
