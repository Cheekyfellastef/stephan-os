# VR Engine Scanner (Prototype)

This tool helps the VR Research Lab quickly triage unfamiliar game or mod codebases and highlight likely VR injection points.

It focuses on identifying systems typically required for flat-to-VR conversion research:

- camera updates
- projection matrix generation
- render submission
- input handling

The scanner is intentionally heuristic and keyword-driven for speed. It is designed to accelerate reverse engineering, not replace manual validation.

## Folder Layout

```text
tools/engine-scanner/
├── scanner/
│   ├── code_parser.py
│   ├── pattern_library.py
│   ├── engine_mapper.py
│   └── report_generator.py
├── patterns/
│   ├── camera_patterns.json
│   ├── rendering_patterns.json
│   └── input_patterns.json
└── reports/
```

## How to Run

From this folder:

```bash
cd tools/engine-scanner
python3 scanner/report_generator.py <path-to-target-codebase>
```

Examples:

```bash
# Scan the VR-Research-Lab repository
python3 scanner/report_generator.py ../../

# Scan a specific extracted game module directory
python3 scanner/report_generator.py /path/to/decompiled-or-sdk-source
```

The scanner writes a timestamped markdown report into:

```text
tools/engine-scanner/reports/
```

## What the Scanner Detects

The parser currently checks for:

- Known keywords (e.g. `ViewMatrix`, `RenderGraph`, `InputManager`)
- Structural hints (e.g. `UpdateCamera(`, `SubmitCommandBuffer(`)
- Frame-loop function signatures (`update*`, `render*`, `present*`, etc.)
- Matrix/projection/view assignment hints

The report includes:

- suspected camera system files
- suspected rendering system files
- suspected input system files
- possible VR hook locations (camera, projection, render submission, input)
- a simplified architecture map:

```text
Input System
↓
Player Controller
↓
Camera System
↓
Render System
```

## How to Add or Tune Patterns

Edit JSON pattern templates in `patterns/`:

- `camera_patterns.json`
- `rendering_patterns.json`
- `input_patterns.json`

Each file supports:

- `keywords`: exact word-style matches (case-insensitive)
- `structures`: snippet-style structural hints (case-insensitive)

Example entry:

```json
{
  "keywords": ["ProjectionMatrix", "CameraManager"],
  "structures": ["UpdateCamera(", "SetProjection("]
}
```

After updating patterns, rerun the scanner to generate a new report.

## Research Value

This prototype supports VR mod research by:

- reducing time spent manually searching massive codebases
- surfacing likely hook points for stereo camera and render pipeline injection
- making cross-engine comparisons easier (Creation Engine 2, RAGE, and others)
- providing a baseline that can be extended with AI-assisted code analysis in future iterations
