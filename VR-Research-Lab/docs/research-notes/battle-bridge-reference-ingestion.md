# Battle Bridge VR Reference Ingestion

## Purpose

Ingest locally owned flat-to-VR reference packages from the Battle Bridge `Downloads` folder into the VR Research Lab without publishing proprietary or access-controlled binaries.

## Importer

`scripts/windows/import-vr-reference-packages.ps1`

Default paths:

- source: `%USERPROFILE%\Downloads`
- repository: `%USERPROFILE%\Documents\GitHub\stephan-os`
- private packages: `VR-Research-Lab\private-reference-packages\`
- local manifests: `VR-Research-Lab\local-manifests\`
- metadata report: `VR-Research-Lab\docs\experiment-logs\`

The private package and local manifest folders are excluded by `.gitignore`.

## Recognised routes

| Match | Destination route |
|---|---|
| MutaR or NoMoreFlat plus Starfield | `starfield/mutar/<hash>/` |
| Luke Ross or REAL VR plus Red Dead/RDR2 | `red-dead-redemption-2/luke-ross/<hash>/` |
| Generic Starfield VR archive | `starfield/unknown/<hash>/` |
| Generic RDR2 VR archive | `red-dead-redemption-2/unknown/<hash>/` |

## Execution

```powershell
cd $env:USERPROFILE\Documents\GitHub\stephan-os
powershell -ExecutionPolicy Bypass -File .\scripts\windows\import-vr-reference-packages.ps1
```

Dry run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\import-vr-reference-packages.ps1 -WhatIf
```

## Safety and provenance

- originals are copied, never moved or modified
- every package receives a SHA-256 fingerprint
- package binaries remain local
- reports contain metadata only
- redistribution is marked false by default
- analysis begins from documentation, configuration, symbols, imports and observable behaviour
- any source extraction must be separately checked against the package licence

## Next analysis stage

After import, create one architecture note per package covering:

1. package contents and dependencies
2. runtime/API indicators such as OpenXR, OpenVR, DirectX and injector components
3. configuration surface
4. camera, stereo, UI, input and frame-pacing clues
5. techniques that can be lawfully reproduced from public knowledge or independent observation
6. unknowns requiring controlled Battle Bridge experiments
