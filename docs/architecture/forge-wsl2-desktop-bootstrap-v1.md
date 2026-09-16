# Forge WSL2 desktop bootstrap V1

This repair closes the Battle Bridge elevation gap observed while commissioning #1671, Goal: Add a parallel Stephanos Forge sidecar beside GitHub.

The canonical GitHub command mailbox remains a hidden, limited scheduled task and does not request elevation directly. When the Forge WSL2 prerequisite is absent, the source-controlled desktop bootstrap wrapper verifies exact `main` identity for itself and for `scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1`, then either consumes the fixed elevated receipt or writes one fixed launcher named `Stephanos Forge WSL2 Bootstrap.cmd` to the signed-in operator desktop.

The launcher can only invoke the existing reviewed WSL2 prerequisite script with the exact expected head, `-OperatorApproved`, and `-VisibleElevationBroker`. The reviewed script remains the sole elevation surface. Its elevated child can enable only `Microsoft-Windows-Subsystem-Linux` and `VirtualMachinePlatform`, always with DISM `/norestart`.

The bootstrap wrapper cannot run as administrator, invoke `RunAs`, restart Windows, mutate Podman or Forge, mutate source, select arbitrary paths/executables/arguments, use GitHub credentials, or create a standing privileged task. Two literal one-use request IDs admit launcher creation and later receipt consumption. No wildcard request identity is accepted.

If feature enablement requires a restart, the elevated script writes `FORGE_WSL2_REBOOT_REQUIRED`; it never performs the restart. A separate explicit operator approval remains required for any reboot.
