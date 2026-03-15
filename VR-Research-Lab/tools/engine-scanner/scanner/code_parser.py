"""Core scanning logic for finding potential VR hook points in codebases."""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List


SUPPORTED_EXTENSIONS = {
    ".c",
    ".cc",
    ".cpp",
    ".cxx",
    ".h",
    ".hpp",
    ".cs",
    ".rs",
    ".py",
    ".java",
}

FRAME_FUNCTION_HINTS = {
    "update",
    "tick",
    "frame",
    "render",
    "draw",
    "present",
    "submit",
}

MATRIX_MUTATION_HINTS = {
    "matrix",
    "projection",
    "view",
    "transform",
}


class CodeParser:
    """Scans source files for subsystem pattern matches and structural hints."""

    def __init__(self, source_root: Path, patterns: Dict[str, Dict[str, List[str]]]) -> None:
        self.source_root = Path(source_root)
        self.patterns = patterns

    def scan(self) -> Dict[str, Dict[str, object]]:
        results: Dict[str, Dict[str, object]] = {
            subsystem: {
                "files": defaultdict(dict),
                "score": 0,
            }
            for subsystem in self.patterns
        }

        for file_path in self._iter_source_files(self.source_root):
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            lowered = content.lower()

            for subsystem, definitions in self.patterns.items():
                keyword_hits = self._find_terms(lowered, definitions["keywords"])
                structure_hits = self._find_terms(lowered, definitions["structures"])
                frame_hits = self._find_frame_hints(lowered)
                matrix_hits = self._find_matrix_mutation_hints(lowered)

                if keyword_hits or structure_hits or frame_hits or matrix_hits:
                    score = (
                        len(keyword_hits) * 3
                        + len(structure_hits) * 4
                        + len(frame_hits) * 2
                        + len(matrix_hits)
                    )
                    relative = str(file_path.relative_to(self.source_root))
                    results[subsystem]["files"][relative] = {
                        "keyword_hits": keyword_hits,
                        "structure_hits": structure_hits,
                        "frame_hints": frame_hits,
                        "matrix_hints": matrix_hits,
                        "score": score,
                    }
                    results[subsystem]["score"] += score

        # keep only plain dicts for output serialization friendliness
        for subsystem in results:
            results[subsystem]["files"] = dict(results[subsystem]["files"])
        return results

    def _iter_source_files(self, root: Path) -> Iterable[Path]:
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if any(part.startswith(".") for part in path.parts):
                continue
            if path.suffix.lower() in SUPPORTED_EXTENSIONS:
                yield path

    @staticmethod
    def _find_terms(content: str, terms: List[str]) -> List[str]:
        hits: List[str] = []
        for term in terms:
            pattern = rf"\b{re.escape(term.lower())}\b"
            if re.search(pattern, content):
                hits.append(term)
        return hits

    @staticmethod
    def _find_frame_hints(content: str) -> List[str]:
        hits: List[str] = []
        for term in FRAME_FUNCTION_HINTS:
            if re.search(rf"\b{term}\w*\s*\(", content):
                hits.append(f"function:{term}")
        return hits

    @staticmethod
    def _find_matrix_mutation_hints(content: str) -> List[str]:
        hints: List[str] = []
        assignment_candidates = re.findall(r"([A-Za-z_][A-Za-z0-9_]*)\s*=", content)
        for name in assignment_candidates:
            lowered = name.lower()
            if any(token in lowered for token in MATRIX_MUTATION_HINTS):
                hints.append(name)
        # De-duplicate while preserving order
        seen = set()
        deduped: List[str] = []
        for hint in hints:
            if hint in seen:
                continue
            seen.add(hint)
            deduped.append(hint)
        return deduped
