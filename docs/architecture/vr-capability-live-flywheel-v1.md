# VR Capability Live Flywheel V1

Status: implementation contract

## Purpose

The VR Capability Atlas must describe Stephanos as it actually exists, not as somebody last remembered to update it.

This contract connects the Atlas to canonical Stephanos proof through the Shared Agent Workspace and Verification Harness. It also removes the ten-concept ceiling and defines how the Spatial Workspace can become the preferred visual source for Current Capability Views.

## Readiness truth

Capability readiness remains absolute:

- design/spec: 10%
- implementation: 30%
- automated proof: 20%
- runtime proof: 20%
- operator acceptance: 20%

A stage advances only from an explicit passing canonical proof. Research strength, a source reference, a PR existing, or text that merely mentions a capability cannot promote readiness.

### Verification Harness bridge

The existing Verification Harness already carries `proofRefs` into its canonical Shared Workspace proof record. A VR proof becomes machine-readable by adding exactly one canonical reference:

`proofs/vr-capability/<capability-id>/<stage>`

Example:

`proofs/vr-capability/living-starship/runtimeProof`

A `PASS` verification aggregate carrying that ref promotes only `living-starship.runtimeProof`. A failed or ambiguous record adds zero.

`shared/agents/vrCapabilityProofContractV1.mjs` constructs these refs so builders and verifiers do not invent spellings.

## Live feed

`GET /api/shared-workspace/vr-capability-feed` is read-only. It combines:

1. the checked-in conservative readiness baseline;
2. current validated Shared Workspace proof/capability/status records;
3. canonical concept candidates;
4. verified Spatial Workspace visual evidence.

The Atlas polls this feed every 60 seconds. If the backend or Shared Workspace is unavailable, the merged static Atlas remains the fallback rather than fabricating live state.

Freshness is capability-specific. New evidence for one capability does not make unrelated stale capability state look fresh.

## Living concept horizon

The original ten concepts remain the seed catalogue, not a maximum.

A new candidate can enter the live Atlas when it is explicitly marked `atlasVisible: true`, or its state is `ACTIVE`, `ACCEPTED`, or `PUBLISHED`. A candidate can create a 10% design readiness entry only when it also carries `designProven: true` and canonical evidence refs.

Supported candidate envelope:

```json
{
  "id": "orbital-workshop",
  "title": "Orbital workshop habitat",
  "description": "A persistent spatial workshop for engineering and mission work.",
  "tags": ["spatial", "engineering", "workspace"],
  "atlasVisible": true,
  "designProven": true,
  "evidence": ["proofs/vr-capability/orbital-workshop/design"],
  "visual": {
    "conceptViewUrl": "/browser-reachable/concept-image"
  }
}
```

If no concept image is available yet, the Atlas renders an explicitly labelled live concept projection instead of pretending a generated image is observed reality.

## Spatial Workspace as Current Capability visual source

Once the Spatial Workspace can capture an observed capability state, it can publish a verified visual with the same capability proof:

```json
{
  "capabilityId": "living-starship",
  "stage": "runtimeProof",
  "passed": true,
  "visualEvidence": {
    "url": "https://browser-reachable-host/captures/living-starship.webp",
    "source": "spatial-workspace",
    "state": "OBSERVED",
    "observedAt": "2026-09-19T20:29:00Z"
  }
}
```

`shared/agents/vrCapabilityEvidencePublisherV1.mjs` writes this as a validated Shared Workspace proof record.

The visual must be browser-reachable from the Battle Bridge/iPad surface. A filesystem path is not evidence transport and must not be exposed.

When verified visual evidence exists, the Atlas uses it for the lower Current Capability thumbnail, Current hero and Delta view. Until then it keeps the evidence-gated schematic projection.

## Guardrails

- no promotion from prose or tag similarity;
- no promotion from failed/blocked verification;
- no external reference counted as Stephanos runtime proof;
- no observed visual without an explicit verified/observed/accepted state;
- no secret/local filesystem paths in visual evidence;
- no concept-count ceiling;
- unavailable live machinery falls back honestly instead of guessing.
