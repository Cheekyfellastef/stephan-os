# Starfield AER native build capability V1

Lineage: original goal #2707 / merged PR #2709 and canonical VR Reference Source Lock. This PR adds a pinned-source native-build preflight and a hosted C++23 stereo-history probe. It **does not** produce, install, approve or deploy a Starfield DLL.

## Source and compiler identity

- Canonical MIT source: mutars/starfield2vr commit c8a2b200710cdf70db22fd0fcac498cba02da676.
- Preserve exact upstream submodule gitlinks at extern/vrframework and extern/CommonLibSF. Never substitute latest upstream for pinned source.
- Requires C++23, CMake 3.27 or newer and Windows Visual Studio MSVC/clang-cl development tools.
- Upstream CMake configure preset: build-release-msvc. Its build preset: release-msvc.
- Source patch stage one: VR-Research-Lab/patches/starfield2vr-aer-stabilizer-v1.patch.
- Source patch stage two: VR-Research-Lab/patches/starfield2vr-aer-v2-stereo-history-v1.patch, written against stabilizer provenance b25bb9f9bf7f02ec87660a34ce3a2ef129d2fd3d.
- Proprietary R.E.A.L. VR sources are explicitly excluded.

## Safe native build route for a separately qualified worker

1. Acquire the exact pinned MIT source and recursively hydrate its pinned submodules into an isolated scratch checkout, **not the Starfield game directory**, and prove Git HEAD, licence and clean source.
2. Run the read-only preflight from the Stephanos repository:
   node scripts/starfield-vr-aer-native-build-readiness.mjs --source-dir <isolated-source-checkout> --json
   Missing, dirty or drifted source and absent pinned CMake metadata BLOCK qualification.
3. After separately qualified original native builder custody and verified no active gaming, COPY that pinned checkout to an isolated build working copy. Check patch V1 with git apply --check, apply it only in the working copy, then check/apply V2. Stop on mismatch, rather than fuzzing or overwriting drift.
4. Configure Windows isolated working copy with cmake --preset build-release-msvc; compile with cmake --build --preset release-msvc. Actual Windows C++ compiler, native dependencies, successful DLL output and its SHA-256/PE identity remain unproven until this step produces authentic receipts.
5. Record source SHA, pinned dependency gitlinks, patch SHA-256, compiler/toolchain versions, DLL SHA-256, native unit tests and review identity. Do NOT install the DLL yet.
6. Only after exact-head independent native security review, approved experimental staging, hash-verified baseline backup and tested rollback may the experimental build be selected for a Quest 3 playtest. No automatic original Starfield DXGI DLL replacement.
7. Compare real Quest eye timing, frame pacing, CPU/GPU headroom, stretching/combing and physical comfort against the accepted baseline; never promote an experiment from desktop/unit-test results alone.

## Existing hosted CI integration

The existing vr-research-tests workflow runs scripts/starfield-vr-launcher-source.test.mjs; that source test imports the new native preflight test. A lightweight C++23 stereo-history behavior fixture compiles and executes in a bounded temporary directory on a Linux hosted runner. It exercises independent left/right history, reset isolation, unknown eye identity, repeated/skipped presents and route resets.

**Evidence boundary:** this is an independently authored C++ reference model, NOT the compiled upstream renderer. The existing Starfield AER v2 patch still chooses an eye from render-loop parity. Correct physical presented-eye identity across skips remains an unsolved runtime proof requirement.

No sixth controller, new lease, scheduler, R7 mutation, live Quest settings or Battle Bridge resource usage is introduced.
