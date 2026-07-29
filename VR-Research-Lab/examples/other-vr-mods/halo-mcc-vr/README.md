# Halo MCC VR research source

This folder registers `pancreations/Halo-MCC-VR` as a priority external source for the Stephanos VR Research Lab.

## What is stored here

- `source-manifest.json` records the upstream repository, pinned revision, licence, refresh policy and safe handling rules.
- `knowledge-extraction.md` separates verified upstream patterns from Stephanos architectural inferences and lists Capability Graph and Method Library candidates.
- `upstream/LICENSE` preserves the MIT notice required for copied material.
- `upstream/TITLE-RUNTIME-OWNERSHIP.md` preserves a high-value upstream engineering note about ownership, lifecycle freshness, transitions and capability gating.
- `upstream/EDITING-KIT-EVIDENCE.md` preserves the upstream per-title evidence policy and its prohibition on copying unverified identities across related games.

## Why the full repository is not vendored here

The external repository is a living codebase. Copying its complete tree into Stephanos would create a stale duplicate and blur the boundary between third-party evidence and canonical Stephanos implementation.

When source-level analysis is required, a bounded research worker should clone the exact pinned revision into an isolated research workspace:

```powershell
git clone https://github.com/pancreations/Halo-MCC-VR.git
Set-Location Halo-MCC-VR
git checkout ba1407ae5e0fee09f16fa8b52e3c2f2740344ba6
```

The worker may read and map the source, but passive ingestion must not execute the mod, download release binaries, import proprietary Halo or editing-kit files, or promote claims without evidence review.

## Programme ownership

- Continuous discovery and freshness: #1596
- Capability Graph and technique extraction: #1593
- VR Research Intelligence programme: #1597
- Spatial Bridge readiness consumption where independently relevant: #1605
- Learning and Method Library extraction: #1606 and #1607

Registration makes this an approved research source. It does not make every upstream statement canonical truth.
