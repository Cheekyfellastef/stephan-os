"""Read-only consumer fixture for the isolated PowerShell owner-lifetime test."""
import json
from pathlib import Path
import sys

import native_build
import owned_job


def main():
    workspace = Path(sys.argv[1]) / "Documents" / "Stephanos-openclaw-workspace"
    state = native_build.bounded_json_file(workspace / "vr" / "vr-resource-governor-current.json")
    grant = state["cpuProbeContinuity"]
    owner = owned_job.observe_parent_identity(grant["ownerProcessId"], grant["ownerCreationFileTime"])
    try:
        native_build.gaming_admitted(workspace, probe_owner_observer=owned_job.observe_parent_identity)
        admitted = True
    except native_build.BuildBlocked:
        admitted = False
    print(json.dumps({"admitted": admitted, "ownerLive": owner["ok"] and owner["alive"]}))


if __name__ == "__main__":
    main()
