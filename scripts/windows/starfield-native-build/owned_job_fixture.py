"""Harmless disposable processes for test_owned_job.py; never a product CLI."""

import ctypes
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def identity():
    class FileTime(ctypes.Structure):
        _fields_ = [("low", ctypes.c_uint32), ("high", ctypes.c_uint32)]
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    kernel.GetCurrentProcess.argtypes = []
    kernel.GetProcessTimes.restype = ctypes.c_int32
    kernel.GetProcessTimes.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(FileTime)] * 4
    values = [FileTime() for _ in range(4)]
    if not kernel.GetProcessTimes(kernel.GetCurrentProcess(), *(ctypes.byref(value) for value in values)):
        raise OSError(ctypes.get_last_error())
    return {"pid": os.getpid(), "birth": str((values[0].high << 32) | values[0].low)}


def publish(path, value):
    path = Path(path)
    pending = path.with_suffix(path.suffix + ".pending")
    pending.write_text(json.dumps(value), encoding="utf-8")
    os.replace(pending, path)


def wait_for(path):
    deadline = time.monotonic() + 20
    while not Path(path).exists():
        if time.monotonic() >= deadline:
            raise RuntimeError("FIXTURE_ACK_TIMEOUT")
        time.sleep(0.01)


def main():
    mode, witness, ack, descendant = sys.argv[1:5]
    if mode == "launcher":
        # This fixture alone accepts its test parent's identity.  The product
        # owned_job module has no CLI and the fixed product recipe owns inputs.
        source = Path(__file__).with_name("owned_job.py")
        spec = importlib.util.spec_from_file_location("owned_job_fixture_module", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.run_owned_stage(
            executable=sys.executable,
            args=["-I", "-S", "-B", str(Path(__file__).resolve()), "tree", witness, ack, descendant],
            cwd=str(Path(witness).parent),
            env={key: value for key, value in os.environ.items()
                 if key.upper() in {"SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH"}},
            deadline_monotonic=time.monotonic() + 30, output_limit=8192,
            parent_pid=int(sys.argv[5]), parent_birth_filetime=sys.argv[6])
        publish(witness + ".terminal.json", result)
        return 0 if result["operation_ok"] else 2
    if mode not in {"normal", "failed", "sleep", "descendant", "orphan", "tree", "overflow", "parent"}:
        raise ValueError("FIXTURE_MODE_INVALID")
    publish(witness, identity())
    if mode == "normal":
        print("owned-job-normal", flush=True)
        return 0
    if mode == "failed":
        print("owned-job-failed", flush=True)
        return 37
    if mode in {"orphan", "tree"}:
        # The child inherits this Job and the output pipe, even though it is
        # detached from the console. No breakaway flag is requested or allowed.
        child = subprocess.Popen(
            [sys.executable, "-I", "-S", "-B", str(Path(__file__).resolve()),
             "descendant", descendant, ack, descendant],
            creationflags=0x8, close_fds=False, stdin=subprocess.DEVNULL,
            stdout=sys.stdout, stderr=sys.stderr)
        wait_for(descendant)
        if mode == "orphan":
            wait_for(ack)
            return 0
        # Keep both the root and its child alive for launcher-death proof.
        time.sleep(30)
        return child.poll() if child.poll() is not None else 0
    if mode == "overflow":
        os.write(sys.stdout.fileno(), b"x" * 131072)
    time.sleep(30)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
