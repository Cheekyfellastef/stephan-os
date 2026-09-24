# Meta VR CLI — capability-scoped provider adapter extraction

## Evidence identity

This record promotes the validated #1596 Meta VR CLI discovery into the source-controlled VR Research Lab without treating vendor tooling as trusted ambient authority.

Observed on 2026-09-24:

- public npm package: `@meta-quest/metavr`
- observed version: `1.3.2`
- package licence label: `Meta Platform Technologies SDK License`
- native installers are documented for Windows, macOS and Linux
- the public `meta-quest/agentic-tools` repository is separately Apache-2.0 and must not be used to infer the binary/package licence
- Meta documents one CLI with a direct command-line interface and an MCP server over stdio

## Provider-neutral teaching

Treat a vendor device CLI as a set of named capabilities, never as a shell-shaped permission blob.

### Identity plane

Candidate fixed observations:

- `metavr --version`
- exact installed executable path
- binary/package hash
- package provenance and licence evidence

### Local tooling read plane

Candidate fixed observation:

- `metavr doctor`

Meta documents `doctor` as reporting installed developer tooling. A clean result is not device, account, runtime or headset proof.

### Documentation discovery plane

Candidate fixed observations:

- `metavr docs search ...`
- `metavr asset search ...`

Search results are research evidence only. They do not authorize asset ingestion or runtime mutation.

### Device observation plane

Candidate fixed observations:

- `metavr device list`
- `metavr device info <device_id>`

Any future device identifier must come from a preceding bounded observation and remain scoped to the same receipt chain.

### Mutation plane

The following capability families are explicitly excluded from automatic admission by this research record:

- generic shell/ADB execution
- file push, pull, deletion or directory mutation
- application install, uninstall, launch or stop
- authentication or credential flows
- Store publication
- package/tool installation or updates
- device pairing, runtime/provider or headset configuration
- arbitrary MCP tool invocation

Those operations may exist in the vendor CLI, but existence is not authority.

## Spatial Bridge consequence

If Stephanos later uses Meta VR CLI, it should appear only as a replaceable provider adapter behind the existing Spatial Bridge and Battle Bridge fixed-operation machinery.

Minimum first implementation slice:

1. prove exact installed Meta VR CLI version and executable hash;
2. retain applicable package licence/provenance evidence;
3. expose one fixed read-only identity/doctor operation;
4. sanitize the receipt into provider-neutral capability fields;
5. independently prove that arbitrary command text and mutation-plane commands are rejected;
6. add device-observation operations only when a current mission requires them.

MCP does not widen this boundary. Tool discovery may improve ergonomics, but every callable operation still needs the same identity, allowlist, authority and receipt gates.

## What this does not prove

This record does **not** prove:

- Meta VR CLI is installed on Battle Bridge;
- any local binary identity or hash;
- Quest 3 connectivity;
- Meta Air Link readiness;
- OpenXR provider readiness;
- Starfield VR readiness;
- physical headset acceptance.

Those remain separate machine and operator evidence planes.
