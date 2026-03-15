"""CLI entrypoint that runs the scanner and writes a research-oriented report."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, List

from code_parser import CodeParser
from engine_mapper import EngineMapper
from pattern_library import PatternLibrary


def _ranked_files(subsystem_results: Dict[str, Dict[str, object]], limit: int = 10) -> List[tuple[str, int]]:
    ranked = sorted(
        (
            (path, details.get("score", 0))
            for path, details in subsystem_results.get("files", {}).items()
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    return ranked[:limit]


def generate_report(scan_results: Dict[str, Dict[str, object]], map_results: Dict[str, object]) -> str:
    lines: List[str] = []
    lines.append("# VR Engine Scanner Report")
    lines.append("")
    lines.append(f"Generated: {datetime.utcnow().isoformat()}Z")
    lines.append("")
    lines.append("## Simplified Architecture Map")
    lines.append("")
    lines.append("Input System")
    lines.append("↓")
    lines.append("Player Controller")
    lines.append("↓")
    lines.append("Camera System")
    lines.append("↓")
    lines.append("Render System")
    lines.append("")

    for subsystem in ("camera", "rendering", "input"):
        lines.append(f"## Suspected {subsystem.title()} System Files")
        ranked = _ranked_files(scan_results.get(subsystem, {}))
        if not ranked:
            lines.append("- None detected")
        else:
            for file_path, score in ranked:
                lines.append(f"- {file_path} (score={score})")
        lines.append("")

    hooks = map_results.get("possible_hook_points", {})
    lines.append("## Possible VR Hook Points")
    lines.append("")
    lines.append("### Camera system")
    if hooks.get("camera_system"):
        lines.extend(f"- {path}" for path in hooks["camera_system"])
    else:
        lines.append("- None detected")

    lines.append("")
    lines.append("### Projection matrix")
    if hooks.get("projection_matrix"):
        lines.extend(f"- {path}" for path in hooks["projection_matrix"])
    else:
        lines.append("- None detected")

    lines.append("")
    lines.append("### Render submission")
    if hooks.get("render_submission"):
        lines.extend(f"- {path}" for path in hooks["render_submission"])
    else:
        lines.append("- None detected")

    lines.append("")
    lines.append("### Input system")
    if hooks.get("input_system"):
        lines.extend(f"- {path}" for path in hooks["input_system"])
    else:
        lines.append("- None detected")

    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="VR Engine Scanner prototype")
    parser.add_argument(
        "source_dir",
        nargs="?",
        default=".",
        help="Source directory to scan (default: current directory)",
    )
    parser.add_argument(
        "--pattern-dir",
        default=str(Path(__file__).resolve().parents[1] / "patterns"),
        help="Directory with pattern JSON definitions",
    )
    parser.add_argument(
        "--report-dir",
        default=str(Path(__file__).resolve().parents[1] / "reports"),
        help="Directory where markdown reports are written",
    )
    args = parser.parse_args()

    source_root = Path(args.source_dir).resolve()
    pattern_dir = Path(args.pattern_dir).resolve()
    report_dir = Path(args.report_dir).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)

    pattern_library = PatternLibrary(pattern_dir)
    parser_engine = CodeParser(source_root, pattern_library.all())
    scan_results = parser_engine.scan()

    mapper = EngineMapper()
    map_results = mapper.map_engine(scan_results)

    report_contents = generate_report(scan_results, map_results)
    report_name = f"engine_scan_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.md"
    report_path = report_dir / report_name
    report_path.write_text(report_contents, encoding="utf-8")

    print(f"Scan complete: {source_root}")
    print(f"Report written to: {report_path}")


if __name__ == "__main__":
    main()
