"""Pattern loading utilities for the VR engine scanner."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List


class PatternLibrary:
    """Loads and serves scanner patterns from JSON templates."""

    def __init__(self, pattern_dir: Path) -> None:
        self.pattern_dir = Path(pattern_dir)
        self._patterns = self._load_patterns()

    def _load_patterns(self) -> Dict[str, Dict[str, List[str]]]:
        mapping = {
            "camera": "camera_patterns.json",
            "rendering": "rendering_patterns.json",
            "input": "input_patterns.json",
        }

        loaded: Dict[str, Dict[str, List[str]]] = {}
        for subsystem, filename in mapping.items():
            path = self.pattern_dir / filename
            if not path.exists():
                raise FileNotFoundError(f"Pattern file missing: {path}")

            with path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)

            loaded[subsystem] = {
                "keywords": data.get("keywords", []),
                "structures": data.get("structures", []),
            }

        return loaded

    def all(self) -> Dict[str, Dict[str, List[str]]]:
        return self._patterns

    def subsystem_patterns(self, subsystem: str) -> Dict[str, List[str]]:
        if subsystem not in self._patterns:
            raise KeyError(f"Unknown subsystem '{subsystem}'")
        return self._patterns[subsystem]
