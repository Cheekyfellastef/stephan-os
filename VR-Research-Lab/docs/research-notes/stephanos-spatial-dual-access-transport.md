# Stephanos Spatial Dual-Access Transport Doctrine

**Status:** Durable architecture decision, implementation deferred  
**Recorded:** 2026-07-14  
**Parent doctrine:** [Stephanos Spatial Bridge Doctrine](stephanos-spatial-bridge-doctrine.md)  
**Home profile:** [Stephanos Home Air Link Profile](stephanos-home-air-link-profile.md)  
**Retrieval tags:** `vr`, `quest-3`, `air-link`, `wireless-only`, `starlink`, `caravan`, `remote-spatial`, `battle-bridge`, `control-plane`, `media-plane`, `tailscale`, `pcvr`

## Decision

The Stephanos spatial surface will support two operating environments through one canonical Stephanos brain:

1. **Home Air Link Mode:** Quest 3 is physically near the Battle Bridge and connects wirelessly using Meta Quest Air Link.
2. **Caravan Remote Mode:** Quest 3 is in the caravan and reaches the home Battle Bridge over Starlink through an authenticated remote path.

These are transport profiles, not separate products. Goals, memory, agents, approvals, execution state, evidence, layout identity, and completion verdicts remain canonical Stephanos state in both modes.

Stephan's Quest setup is wireless-only. He does not use a USB Quest connection and does not own a Quest Link cable. No cable-based Quest route should be assumed, recommended, required, or presented as fallback without a future explicit change from Stephan.

## Governing principle

> Render the bridge as close to Stephan as possible. Move only the information that must cross the network.

The spatial bridge must not require high-bandwidth remote PCVR streaming in order to function from the caravan. The preferred caravan architecture renders the bridge locally on Quest 3 and sends only Stephanos state, intent, contextual references, proposals, approvals, telemetry, and evidence over Starlink.

## Home Air Link Mode

At home, Quest 3 and the Battle Bridge share the local environment.

The canonical posture is:

- Meta Quest Air Link is the only configured Quest transport.
- The Battle Bridge renders the PC spatial or PCVR experience.
- Quest 3 receives the wireless media stream and returns head tracking, audio, and controller input.
- The Battle Bridge should preferably use wired Ethernet to the home network while Quest 3 uses the strongest suitable local Wi-Fi path.
- Ethernet on the Battle Bridge side must not be confused with a cable between Quest and the PC.
- Local services remain reachable without depending on Starlink or the public internet.
- Battle Bridge telemetry, OpenClaw, verification, and evidence return remain behind normal Stephanos authority gates.

Home Air Link Mode may use richer graphics because the rendered frames remain on the local network.

The home bridge should observe:

- Air Link session state
- local Wi-Fi quality
- local latency, jitter, and packet loss
- Battle Bridge reachability
- Battle Bridge Ethernet state where available
- GPU and encoder headroom
- frame pacing and comfort health
- Quest battery and power posture where available
- reconnect count

## Caravan Remote Mode

In the caravan, Quest 3 is a remote Stephanos command surface. Starlink connects it to the authenticated Stephanos surface gateway and the home Battle Bridge.

The preferred posture is:

- the bridge shell, scene, typography, interaction logic, and comfort-critical rendering run locally on Quest 3
- Starlink carries compact state updates and commands rather than continuous stereoscopic bridge video
- the Battle Bridge remains the execution environment for services requiring the home PC
- the headset displays explicit network, freshness, session, and Battle Bridge health
- loss of the high-bandwidth media path does not remove access to the lightweight Stephanos command surface
- the same mission and evidence remain recoverable from phone, tablet, or desktop

Caravan Remote Mode must remain useful for commanding Stephanos even when remote PCVR gaming is unavailable.

## Separate the control plane from the media plane

### Stephanos control plane

The control plane is authoritative and comparatively lightweight. It carries:

- authenticated session identity
- canonical mission and goal state
- gaze or selected-object context
- spoken or controller intent
- proposals and risk classifications
- exact-action approvals
- execution progress
- verification evidence
- alerts, telemetry, confidence, and freshness
- stop, revoke, and safe-fallback signals

The control plane should use the authenticated Stephanos or Tailscale-class route and remain usable at modest bandwidth. A relayed route may be acceptable for observation and proposals, but its degraded state must be visible and may restrict approvals or execution.

### Optional remote PCVR media plane

The media plane carries high-bandwidth encoded video, audio, and low-latency input for remotely streaming a PCVR application from the Battle Bridge.

It is optional, non-authoritative, and independently replaceable. Candidate streaming products must be reverified at implementation time and must not become part of Stephanos's trust boundary.

The media plane must never carry unique mission truth or grant execution authority. If it freezes or disconnects, Stephanos remains safe and the control plane either continues or falls back cleanly.

## Air Link is local, Starlink mode is remote

Do not design Caravan Remote Mode as Air Link stretched over the internet.

Air Link is a proximity transport for the home local network. Caravan access is a remote-client architecture with different assumptions about latency, jitter, packet loss, NAT, reconnects, and Battle Bridge availability.

The bridge should present an unmistakable mode indicator:

- `HOME · AIR LINK`
- `HOME DEGRADED · CONTROL ACTIVE`
- `CARAVAN · REMOTE STARLINK`
- `REMOTE DEGRADED · READ ONLY`
- `REMOTE MEDIA UNAVAILABLE · CONTROL ACTIVE`

## End-to-end path awareness

The remote experience depends on the complete route:

```text
Quest 3
  ↓ caravan Wi-Fi
Starlink terminal and satellite path
  ↓ public internet or relay path
Home router or secure gateway
  ↓ local Ethernet
Battle Bridge
```

The weakest segment controls the result. Stephanos must measure and expose more than headline download speed.

Required observations include:

- authentication status
- direct, peer-relayed, or public-relayed control connection
- round-trip latency
- jitter and packet loss
- reconnect count and recent outages
- state freshness
- caravan Wi-Fi quality
- Starlink obstruction or service degradation signal where available
- home connection upload headroom
- Battle Bridge reachability
- GPU encoder and service health when the media plane is requested

## Battle Bridge remote-readiness requirements

Caravan operation depends on the Battle Bridge being a dependable unattended ship system rather than a PC waiting for Stephan to rescue it.

Before remote spatial use is ready, the Battle Bridge needs:

- authenticated remote bootstrap and health proof
- a proven supervisor for required Stephanos services
- safe recovery after a worker, gateway, or process stops
- controlled start, restart, and shutdown routes
- an independent stop or kill route outside the headset
- power-loss and restart recovery appropriate to granted policy
- clear handling of locked Windows sessions
- no dependency on a visible PowerShell window
- headless or display-detection support where a remote streaming product requires a Windows display
- versioned known-good profiles and rollback
- local evidence capture that survives a network disconnect

No remote action should depend on Stephan travelling home to click a dialog or paste a command.

## Remote session and approval rules

Caravan Remote Mode must enforce:

- short-lived authenticated headset sessions
- device and user binding
- exact target revision on every approval
- state-age and connection-health checks before approval
- idempotency across retries and reconnects
- no reuse of an approval after its proposal, target, or evidence contract changes
- no approval accepted from cached or stale state
- automatic read-only fallback if identity, freshness, telemetry, or Battle Bridge state becomes uncertain
- no hidden execution after headset removal or session loss
- durable intent, proposal, approval, execution, and evidence audit records

A disconnected request may be saved as an unapproved intent or draft proposal. It must not silently become executable authority when the connection returns.

## Network-sensitive behaviour

### Control surface

The control surface should degrade gracefully:

- animations reduce before information disappears
- lower-frequency state updates replace continuous telemetry when the route worsens
- cached panels are visibly marked with their age
- questions and proposals may remain available when execution is locked
- audio may fall back to push-to-talk or text when speech quality degrades
- approvals are disabled before observation is disabled

### Remote PCVR streaming

Remote PCVR is comfort-critical and should remain experimental until proven on the actual caravan-to-home route.

Stephanos should refuse or stop remote PCVR streaming when:

- packet loss or jitter exceeds the tested comfort envelope
- the route cannot sustain the stream
- home upload or caravan download is unstable
- the GPU encoder has insufficient headroom
- the Battle Bridge display or runtime is not in a known-good state
- repeated reconnects or tracking/input delay could create discomfort

The bridge should recommend `CONTROL ONLY` rather than gambling with nausea.

## Local-first assets and continuity

To keep the bridge useful over Starlink:

- cache the spatial shell, environment, fonts, sounds, and stable layout locally on Quest
- stream structured data and small assets on demand
- preserve the last verified captain view for orientation, clearly marked as stale when offline
- queue non-authoritative notes locally and reconcile them safely
- never cache reusable approval tokens or broad execution credentials
- keep a non-VR recovery surface available on phone, tablet, and desktop

## Mode selection

Stephanos should detect the likely operating mode from proximity, route, and session evidence, then state the selected profile visibly.

Suggested classifications:

- **Home Air Link:** Battle Bridge and Quest are on a proven local wireless path.
- **Remote healthy:** authenticated remote path, fresh state, stable control telemetry.
- **Remote constrained:** control path works, but approvals or actions are restricted.
- **Remote media-capable:** the separately tested media path also passes its comfort and performance gate.
- **Offline:** local shell and last verified state only; no remote authority.

Automatic selection must not hide assumptions. The captain may override presentation choices, but cannot override safety classification without a separately defined authority policy.

## Acceptance tests

The dual-access design is not ready until it proves:

1. The same mission appears at home and in the caravan without duplicate state.
2. Home mode identifies Meta Quest Air Link as the only configured Quest transport.
3. No cable-based Quest route is assumed, offered, or required.
4. Disconnecting Quest loses no goals, approvals, execution state, or evidence.
5. A Starlink interruption forces the expected degraded or read-only posture.
6. Duplicate packets or reconnects do not duplicate an action.
7. Remote approvals fail when state is stale or the target revision has moved.
8. The control plane remains useful when remote PCVR streaming is unavailable.
9. A relayed Tailscale-class connection is detected and surfaced.
10. Battle Bridge services recover or report a blocker without requiring a local human click.
11. A failed media stream cannot bypass or corrupt Stephanos authority state.
12. Phone or tablet can recover the same mission after the headset disappears.

## Current implementation decision

Build the intelligence, canonical state, Battle Bridge reliability, approval gates, verification, and rollback machinery first.

When spatial implementation begins, create one original Stephanos bridge with two transport profiles. Use Meta Quest Air Link as Stephan's wireless-only home route. Prioritise a locally rendered Quest command surface for caravan use. Treat full remote PCVR streaming from the Battle Bridge as a useful optional lane, not as the foundation of remote Stephanos.

## Retrieval instruction

Retrieve this note together with the parent Spatial Bridge Doctrine and Home Air Link Profile whenever planning Air Link, WebXR, Starlink, caravan access, Tailscale routing, remote Battle Bridge control, or PCVR streaming. Reverify current product behaviour and network requirements at implementation time.