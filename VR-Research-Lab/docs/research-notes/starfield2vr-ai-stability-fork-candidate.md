# starfield2vr AI-assisted stability fork candidate

- Status date: 2026-07-30
- Programme: #1591
- Intake and runtime-proof owner: #1595
- Discovery/refresh owner: #1596

## Candidate

Repository and branch:

- `https://github.com/gsaw0/starfield2vr/tree/fix/dlss-ram-allocation`
- paired framework branch: `https://github.com/gsaw0/vrframework/tree/fix/dlss-ram-allocation`
- candidate binary release: `https://github.com/gsaw0/starfield2vr/releases/tag/v2.0.1-ai`
- stated upstream prerequisite: `https://github.com/mutars/starfield2vr/releases/tag/v2.0.1.Public`

## Public claim

The fork author reports that Mutar's baseline accumulated roughly 30–40 GB of RAM after repeatedly opening menus such as inventory, map and skills, leading to a crash after approximately 20–39 minutes on the author's system.

The author says an AI-assisted repair built with Claude Code changes the `dxgi.dll` implementation and extends usable sessions to roughly one or two hours. The author also reports that the first launch may still crash and that the replacement currently writes RAM diagnostics to `vr.log`.

Reported headset observations cover Pimax Dream Air and Samsung Galaxy XR. They do not prove Quest 3 Meta Air Link compatibility.

Public discussion:

`https://www.reddit.com/r/virtualreality/comments/1utrqsj/resilent_vr_mod_for_starfield/`

## Evidence classification

- Public creator claim: present.
- Public source: linked, exact commits and licence still to be pinned by #1595/#1596.
- Binary provenance: linked release, hash not yet recorded.
- Independent reproduction: absent.
- Quest 3 Meta Air Link proof: absent.
- Exact installed-Starfield compatibility: absent.
- Skyrim VR-quality parity proof: absent.

This is therefore a high-value candidate, not an accepted runtime.

## Required bounded experiment

1. Pin both fork commits and inspect the applicable licences.
2. Diff the fork against Mutar `v2.0.1.Public` and identify the exact allocation-lifetime change.
3. Build from reviewed source or hash the public release under the #1595 intake contract.
4. Preserve the existing Mutar and VorpX files and their rollback receipts.
5. Run the fixed Starfield save-route on Quest 3 over Meta Air Link.
6. Capture working set, private bytes, commit size, menu-open count, frame timing and crash state for at least:
   - baseline start;
   - repeated inventory/map/skills cycles;
   - 30 minutes;
   - 60 minutes;
   - 120 minutes when stable.
7. Admit the fork to the `Starfield VR` launcher profile only after exact hashes and a headset evidence packet produce `STARFIELD_VR_LAUNCH_PATH_VERIFIED`.

## Launcher consequence

No launcher code change is required if this fork is accepted. #1595 can select it by writing its exact version, provider-file hashes and evidence packet into the existing `mutar-openxr` launch profile. A merely replaced `dxgi.dll` remains blocked without that proof.
