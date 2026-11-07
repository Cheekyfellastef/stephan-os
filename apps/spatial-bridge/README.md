# Stephanos Spatial Workspace V1

## Status

The flat source prototype and Quest PWA entry are built, and the Holodeck Baseline now renders the first dependency-free immersive Spatial Workspace chamber: stereo room grid, focal portal, pedestal and a first idea-cube visual primitive. Deterministic source proof is available, while physical Quest 3 observation, controller interaction, signed packaging and headset acceptance remain pending.

The flat prototype and Stephanos diagnostics remain read-only. They consume only `bridge-state.v0.json`, a bundled mock projection with `readOnly: true` and `authority: none`; that fixture is never evidence of live Stephanos/backend reachability. The starting room additionally offers an operator-selected Windows ChatGPT/Codex window with a holographic display and keyboard. See [Spatial ChatGPT console](SPATIAL-CONSOLE.md) for setup, local input boundaries and proof limits. The original app retains its tools and approval rules.

## Chosen Quest route

The intended one-icon experience is an **immersive WebXR Progressive Web App** distributed to Stephan through an invite-only Meta Horizon **ALPHA release channel**.

That route is preferred because it can place Stephanos in the normal Quest App Library and launch directly into an immersive experience while using the same Quest-local renderer at home and in the caravan.

Air Link remains an optional separate PCVR or high-fidelity media route. It is not required to open the Stephanos bridge.

## Prototype routes

Flat surface:

```text
/apps/spatial-bridge/index.html
```

Spatial Workspace starting-chamber entry:

```text
/apps/spatial-bridge/quest-entry.html
```

Transport simulation routes:

```text
/apps/spatial-bridge/index.html?mode=home
/apps/spatial-bridge/index.html?mode=caravan
/apps/spatial-bridge/index.html?mode=degraded
```

## Included in the branch

- captain mission view
- Quest-local home, caravan Starlink and degraded read-only simulations in the flat prototype
- department selection and captain detail focus
- mock transport telemetry
- evidence and readiness panels
- responsive flat-screen layout
- reduced-motion support
- keyboard navigation suitable for later controller mapping
- strict rejection of projections that are not read-only or that carry authority
- Quest PWA web manifest
- Spatial Workspace launch card with bounded WebXR session handling and fail-closed fallback
- stereo Holodeck starting chamber with a pedestal and first idea-cube visual primitive
- hidden Windows launcher plus reproducible `Stephanos Spatial Workspace` desktop shortcut installer
- offline service worker and read-only fallback shell
- source-only deterministic generator for 192px and 512px PNG icons
- Digital Asset Link template
- private Alpha release-channel deployment contract

## Controller movement

Inside the immersive chamber, Xbox-compatible standard gamepads and Quest/VR
controllers provide the same controls:

- Left stick: walk forward/backward and strafe, relative to where you look.
- Right stick left/right: smooth analog turning (up to 90 degrees per second).
- Press the right stick: return to the entrance and face the portal.

Connect an Xbox controller to the device running the browser (the PC for Link,
or the headset for Quest Browser), and press a button if the browser has not yet
exposed it. Quest controllers are read from the active WebXR session. Release
both sticks on entry, after switching controller type, and after tracking resumes.
Movement stops during tracking loss, hidden sessions, and controller disconnection.
Stick movement stays within the chamber and stops at the table, with a
28 cm body margin and sliding along edges. A swept collision check prevents
passing through thin objects between frames. Physical tracking is never overridden:
if room-scale walking or leaning places the viewer inside an object, stick movement
can take them back out through the nearest edge without an automatic camera jump.
Walking speed is capped at 1.2 metres per second, with drift dead zones and bounded
frame timing. Only one controller type drives movement at once.

Mappings follow the [WebXR Gamepads Module](https://immersive-web.github.io/webxr-gamepads-module/)
and standard Gamepad layout. Automated input and stereo-matrix tests are source
proof; Xbox and Quest physical controller acceptance remains pending playtesting.

The chamber uses a solid, softly lit room shell with a continuous grid on the
floor, all four walls and ceiling. Ceiling and perimeter lights illuminate a
suspended ceramic workstation with a sculpted split pedestal, luminous edge
and inlaid controls. Furniture and collision footprints share one layout module.
The desktop preview uses the same geometry and lighting as the immersive renderer.
Lighting is deliberately static, with no flashing effects or expensive shadow maps.

## Glass cube interaction

The original glass cube has 57 mm edges; the second has 114 mm edges (twice the
edge length, eight times the volume). Both start on the tabletop and use the same
transparent glass material, gravity, room contacts and controller controls.
Each hand can hold one cube. Selection chooses the nearest aimed-at available
cube; the Xbox X button recalls the held/aimed-at cube, or the last selected one.

The preview and VR session share one room instance. A versioned, bounded local
save stores both cubes' positions, orientations and free motion, without controller
ownership. Saves occur during motion, on release/rest, on page hide and on VR exit.
Reopening restores the layout; a cube left airborne continues falling. Saving is
local to the same browser profile and origin on this device, including offline.
It does not synchronise to a different browser/device, and clearing site data
removes the save. Storage failure and a stale window trying to overwrite a newer
save are reported visibly. Invalid records fall back to the tabletop layout;
future schema versions are preserved. This is simulation state only, with no
Stephanos execution, authority, telemetry or backend-state changes.

- Quest: point at the cube (within 3.5 m), or reach near it above the table;
  hold the grip/squeeze button to carry it. Release to drop or throw using the
  measured hand motion. Either controller can hold it; one holds it at a time.
- Xbox: look at the cube and hold RT to pick it up. Release RT to drop it, or
  press RB while holding to throw in the direction you look. D-pad up/down
  adjusts reach, left/right rotates it, and X recalls it to the tabletop.
- The existing left-stick walking and right-stick smooth turning are unchanged.
- Release grip/RT before first pickup or after a disconnect/tracking interruption.

Gravity is 9.81 m/s², integrated at a bounded 120 Hz. Swept support-volume checks
keep the cube within the floor, walls, ceiling and convex table surfaces, including
while held. The cubes also block one another using conservative convex contacts;
a resting stack wakes when its support moves. They bounce, loses energy and settles flat. This is lightweight local
cube physics, with conservative contacts around rotated corners, not fracture or
optical refraction simulation. Throw speed is capped at 8 m/s and tracking loss
releases a held cube without stale throw velocity. A distant pickup must reach
the hand before its motion contributes to a throw.

The desktop Drop cube, Throw at wall, Reset cube and Inspect glass cube controls
use the selected small/large cube and the same saved room as VR. These are preview interactions;
physical Quest/Xbox acceptance still requires an on-headset playtest.

The Quest grip and pose adapter follows the
[WebXR Gamepads mapping](https://immersive-web.github.io/webxr-gamepads-module/)
and [WebXR grip-space definition](https://www.w3.org/TR/webxr/#xrinputsource-interface).

## Generated packaging assets

The repository firewall rejects committed images and binary files. Generate the required PNG icons during packaging:

```text
node apps/spatial-bridge/tools/build-icons.mjs
```

For verification without dirtying the application folder:

```text
node apps/spatial-bridge/tools/build-icons.mjs --output-dir tmp/spatial-bridge-icons
```

Generated PNGs are deployment artifacts and must not be committed.

## Explicitly not yet included or proven

- live Stephanos state or live backend reachability
- packaged or signed Quest APK
- verified Digital Asset Link
- Meta Developer Dashboard application ID
- Alpha-channel upload or installation
- physical Quest 3 immersive observation or acceptance
- offline availability of destinations outside the Spatial Bridge service-worker scope
- voice recognition
- gaze tracking
- Xbox controller proof
- AI requests
- approvals
- agent dispatch
- OpenClaw, Codex or Battle Bridge command routes
- network writes

## Deterministic source test

```text
node --test tests/spatial-bridge-v0.test.mjs tests/spatial-bridge-holodeck-baseline-v0.test.mjs tests/spatial-workspace-launcher-v1.test.mjs tests/spatial-workspace-locomotion-v1.test.mjs
```

The source tests validate the flat contract, Holodeck Baseline source-readiness boundary and PNG generation without promoting physical headset proof.

## Remaining delivery work

After exact-head source proof and review are clean:

1. Generate deployment icons with `node apps/spatial-bridge/tools/build-icons.mjs`.
2. Run the repository app or static-surface validation used by the launcher.
3. Serve the repository through a trusted HTTPS route.
4. Confirm the launcher discovers **Stephanos Spatial Bridge**.
5. Open the flat prototype and Quest Holodeck entry and record screenshot, DOM, manifest, service-worker and console evidence.
6. Confirm all simulation controls change only local presentation state.
7. Confirm no POST, PUT, PATCH or DELETE request is emitted.
8. Package with Meta's forked Bubblewrap in immersive mode.
9. Create and preserve the signing keystore outside the repository.
10. Generate and publish the exact Digital Asset Link statement.
11. Upload the signed build to the invite-only ALPHA release channel.
12. Add Stephan's Meta account to the channel.
13. Prove the icon appears in Quest App Library and launches from the icon.
14. Test Quest-local home and caravan profiles independently.
15. Map and prove Xbox controller inputs separately.
16. Record comfort, readability, network and frame-pacing evidence.
17. Remove or quarantine generated icon artifacts before any source commit or PR update.

See `QUEST-DEPLOYMENT.md` and `quest-entry-contract.v1.json` for the full handoff.

## Merge gate

Do not merge merely because the source looks plausible. Merge only after the exact PR head has:

- deterministic test proof
- launcher discovery proof
- browser render and console proof
- PWA manifest and service-worker proof
- generated icon validation
- confirmation that the surface remains read-only
- an explicit record separating WebXR source readiness from packaging, Quest Library installation, controller and physical headset proof

The Holodeck Baseline may be described as source-ready only when its exact-head source/tests/review prove that claim. The app must never be described as a working Quest VR bridge until signed packaging, Digital Asset Link verification, Alpha-channel installation and on-headset launch are observed.
