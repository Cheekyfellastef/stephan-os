"""Builds a simplified architecture map from scanner findings."""

from __future__ import annotations

from typing import Dict, List


class EngineMapper:
    """Transforms raw scan results into a high-level subsystem map."""

    PIPELINE = [
        "input",
        "player_controller",
        "camera",
        "rendering",
    ]

    def map_engine(self, scan_results: Dict[str, Dict[str, object]]) -> Dict[str, object]:
        architecture = [
            "Input System",
            "Player Controller",
            "Camera System",
            "Render System",
        ]

        likely_hooks = self._extract_hooks(scan_results)

        return {
            "pipeline": self.PIPELINE,
            "architecture": architecture,
            "possible_hook_points": likely_hooks,
        }

    def _extract_hooks(self, scan_results: Dict[str, Dict[str, object]]) -> Dict[str, List[str]]:
        hook_map = {
            "camera_system": [],
            "projection_matrix": [],
            "render_submission": [],
            "input_system": [],
        }

        # camera hooks
        for file_path, details in scan_results.get("camera", {}).get("files", {}).items():
            keywords = {k.lower() for k in details.get("keyword_hits", [])}
            if "cameramanager" in keywords or "updatecamera" in keywords:
                hook_map["camera_system"].append(file_path)
            if "projectionmatrix" in keywords or "viewprojectionmatrix" in keywords:
                hook_map["projection_matrix"].append(file_path)

        # rendering hooks
        for file_path, details in scan_results.get("rendering", {}).get("files", {}).items():
            keywords = {k.lower() for k in details.get("keyword_hits", [])}
            if {"present", "commandbuffer", "drawcall"} & keywords:
                hook_map["render_submission"].append(file_path)

        # input hooks
        for file_path, details in scan_results.get("input", {}).get("files", {}).items():
            keywords = {k.lower() for k in details.get("keyword_hits", [])}
            if {"inputmanager", "playercontrols", "controllerupdate"} & keywords:
                hook_map["input_system"].append(file_path)

        for key in hook_map:
            hook_map[key] = sorted(set(hook_map[key]))[:10]

        return hook_map
