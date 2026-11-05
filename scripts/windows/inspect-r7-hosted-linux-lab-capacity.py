#!/usr/bin/env python3
"""Read-only capability inventory for the existing R7 hosted Linux CI child.

No VM creation, guest boot, installation, download, privilege-policy or device
configuration, disk allocation, certificate, signing or driver operation.
Environment checks prevent accidental local use; they are not authentication.
KVM system queries below never create a VM or prove that a guest can boot.
Existing hosted sudo may run this same fixed read-only probe; it grants no
permission to boot guests or alter device policy.
"""
import datetime
import json
import os
import platform
import re
import shutil
import stat
import sys

SCHEMA = "stephanos.r7-hosted-linux-lab-capability.v1"


def emit(value):
    print("R7_HOSTED_LINUX_LAB_CAPABILITY=" + json.dumps(value, sort_keys=True, separators=(",", ":")))


def safe_text(name):
    value = os.environ.get(name, "")
    return value if re.fullmatch(r"[A-Za-z0-9_.-]{1,96}", value) else None


def bounded_file(path, limit):
    with open(path, "rb") as stream:
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise ValueError("bounded input exceeded")
    return value.decode("ascii", errors="strict")


def main():
    # Reject before importing Linux-only modules or querying any local device.
    admitted = (
        len(sys.argv) == 1
        and sys.platform == "linux"
        and platform.machine() == "x86_64"
        and os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
        and os.environ.get("RUNNER_OS") == "Linux"
        and os.environ.get("RUNNER_ARCH") == "X64"
        and os.environ.get("ImageOS") == "ubuntu24"
        and re.fullmatch(r"[0-9a-f]{40}", os.environ.get("R7_LAB_SOURCE_HEAD", "")) is not None
    )
    if not admitted:
        emit({"schemaVersion": SCHEMA, "observationCompleted": False,
              "reason": "FIXED_HOSTED_UBUNTU24_CONTEXT_REQUIRED",
              "guestBooted": False, "productionAuthority": False})
        return 2

    import fcntl

    result = {
        "schemaVersion": SCHEMA,
        "observedAtUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "observationCompleted": True,
        "sourceHead": os.environ["R7_LAB_SOURCE_HEAD"],
        "runId": safe_text("GITHUB_RUN_ID"),
        "runAttempt": safe_text("GITHUB_RUN_ATTEMPT"),
        "runnerImageOS": safe_text("ImageOS"),
        "runnerImageVersion": safe_text("ImageVersion"),
        "provenanceIsAuthority": False,
        "queryPrivilege": "ROOT" if os.geteuid() == 0 else "ORDINARY",
        "cpuCount": os.cpu_count(),
        "cpuVirtualizationFlagVisible": None,
        "availableMemoryBytes": None,
        "rootAvailableBytes": None,
        "temporaryAvailableBytes": None,
        "kvm": {"deviceIsCharacter": None, "systemQuerySucceeded": False,
                "apiVersion": None, "apiVersionIsExpected12": False, "errno": None,
                "extensions": {"irqchip": None, "userMemory": None,
                               "recommendedVcpus": None, "maximumVcpus": None},
                "extensionQueryErrno": None},
        "qemuSystemX64OnPath": shutil.which("qemu-system-x86_64") is not None,
        "qemuImgOnPath": shutil.which("qemu-img") is not None,
        "uefiFirmwarePresent": any(os.path.isfile(p) for p in (
            "/usr/share/OVMF/OVMF_CODE_4M.fd",
            "/usr/share/OVMF/OVMF_CODE.fd",
            "/usr/share/qemu/OVMF.fd")),
        "softwareExecutedBeyondProbe": False,
        "packageInstalled": False,
        "guestCreated": False,
        "guestBooted": False,
        "guestRebooted": False,
        "guestMediaAdmitted": False,
        "guestMediaDownloaded": False,
        "diskAllocatedOrFormatted": False,
        "hostPolicyChanged": False,
        "certificateEnrolled": False,
        "driverLoaded": False,
        "nativeCallbacksExecuted": False,
        "guestSuitableForQualification": False,
        "productionAuthority": False,
        "leaseChanged": False,
    }
    try:
        cpu = bounded_file("/proc/cpuinfo", 2097152)
        result["cpuVirtualizationFlagVisible"] = any(
            "vmx" in line.split()[2:] or "svm" in line.split()[2:]
            for line in cpu.splitlines() if line.startswith("flags"))
    except (OSError, ValueError, UnicodeError):
        pass
    try:
        mem = bounded_file("/proc/meminfo", 65536)
        match = re.search(r"^MemAvailable:\s+(\d+) kB$", mem, re.MULTILINE)
        if match:
            result["availableMemoryBytes"] = int(match.group(1)) * 1024
    except (OSError, ValueError, UnicodeError):
        pass
    for path, key in (("/", "rootAvailableBytes"), ("/tmp", "temporaryAvailableBytes")):
        try:
            info = os.statvfs(path)
            result[key] = info.f_bavail * info.f_frsize
        except OSError:
            pass

    descriptor = None
    try:
        # O_RDWR checks the access mode QEMU needs, without a write or VM ioctl.
        # No KVM_CREATE_VM, KVM_CREATE_VCPU, KVM_SET_* or KVM_RUN is issued.
        descriptor = os.open("/dev/kvm", os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW)
        result["kvm"]["deviceIsCharacter"] = stat.S_ISCHR(os.fstat(descriptor).st_mode)
        if result["kvm"]["deviceIsCharacter"]:
            version = fcntl.ioctl(descriptor, 0xAE00, 0)  # KVM_GET_API_VERSION
            result["kvm"]["apiVersion"] = version
            result["kvm"]["systemQuerySucceeded"] = True
            result["kvm"]["apiVersionIsExpected12"] = version == 12
            if version == 12:
                try:
                    # Fixed system queries from Linux uapi/linux/kvm.h.
                    # These report capabilities, without enabling any of them.
                    for name, capability in (("irqchip", 0), ("userMemory", 3),
                                             ("recommendedVcpus", 9), ("maximumVcpus", 66)):
                        result["kvm"]["extensions"][name] = fcntl.ioctl(descriptor, 0xAE03, capability)
                except OSError as error:
                    result["kvm"]["extensionQueryErrno"] = error.errno
    except OSError as error:
        result["kvm"]["errno"] = error.errno
    finally:
        if descriptor is not None:
            os.close(descriptor)

    # This record reports facts, never an execution admission or eligibility pass.
    emit(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
