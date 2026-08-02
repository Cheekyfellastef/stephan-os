#!/usr/bin/env python3
"""Handle-bound, no-replace publication for dream runtime artifacts.

Darwin promotion receives the owned pending file on descriptor 3 and its
validated parent on descriptor 4. Linux isolated publication receives only the
validated parent on descriptor 3 and stages content in an unnamed inode. No
caller-controlled pathname selects the inode entering the authoritative name.
"""

import argparse
import base64
import binascii
import ctypes
import errno
import os
import platform
import stat
import sys
import uuid


MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_BASE64_BYTES = ((MAX_ARTIFACT_BYTES + 2) // 3) * 4


def fail(code: str) -> None:
    print(code, file=sys.stderr, flush=True)
    raise SystemExit(2)


def promoted_identity(info: os.stat_result) -> str:
    return (
        f"PROMOTED:{info.st_dev}:{info.st_ino}:{info.st_size}:"
        f"{info.st_nlink}:{info.st_mtime_ns}"
    )


def committed_identity(info: os.stat_result) -> str:
    return (
        f"PROMOTED:{info.st_dev}:{info.st_ino}:{info.st_size}:"
        f"1:{info.st_mtime_ns}"
    )


parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--mode", choices=("promote", "isolated"), default="promote")
parser.add_argument("--pending-name", default="")
parser.add_argument("--artifact-name", required=True)
parser.add_argument("--token", default="")
args = parser.parse_args()

names = (args.artifact_name,) if args.mode == "isolated" else (args.pending_name, args.artifact_name)
for value in names:
    if not value or value in (".", "..") or "/" in value or "\0" in value:
        fail("DREAM_MIGRATION_ARTIFACT_NAME_INVALID")


if args.mode == "isolated":
    if platform.system() != "Linux" or not hasattr(os, "O_TMPFILE"):
        fail("DREAM_MIGRATION_RECEIPT_ISOLATED_STAGE_UNSUPPORTED")
    try:
        parsed_token = uuid.UUID(args.token)
        if str(parsed_token) != args.token:
            raise ValueError("non-canonical token")
    except (ValueError, AttributeError):
        fail("DREAM_MIGRATION_RECEIPT_ISOLATED_TOKEN_INVALID")

    parent_fd = 3
    temporary_fd = -1
    final_linked = False
    try:
        encoded = sys.stdin.buffer.readline(MAX_BASE64_BYTES + 2)
        if not encoded.endswith(b"\n") or len(encoded) > MAX_BASE64_BYTES + 1:
            fail("DREAM_MIGRATION_RECEIPT_ISOLATED_INPUT_INVALID")
        try:
            content = base64.b64decode(encoded[:-1], validate=True)
        except (binascii.Error, ValueError):
            fail("DREAM_MIGRATION_RECEIPT_ISOLATED_INPUT_INVALID")
        if len(content) > MAX_ARTIFACT_BYTES:
            fail("DREAM_MIGRATION_RECEIPT_ISOLATED_INPUT_INVALID")

        temporary_fd = os.open(".", os.O_TMPFILE | os.O_RDWR, 0o600, dir_fd=parent_fd)
        written = 0
        while written < len(content):
            count = os.write(temporary_fd, content[written:])
            if count <= 0:
                fail("DREAM_MIGRATION_RECEIPT_ISOLATED_STAGE_FAILED")
            written += count
        os.fsync(temporary_fd)
        staged = os.fstat(temporary_fd)
        if (not stat.S_ISREG(staged.st_mode)
                or staged.st_nlink != 0
                or staged.st_size != len(content)):
            fail("DREAM_MIGRATION_RECEIPT_ISOLATED_STAGE_FAILED")
        print(f"READY:{args.token}:{promoted_identity(staged)}", flush=True)

        command = sys.stdin.buffer.readline(16)
        if command == b"ABORT\n":
            print(f"ABORTED:{args.token}", flush=True)
            raise SystemExit(0)
        if command != b"COMMIT\n":
            fail("DREAM_MIGRATION_RECEIPT_ISOLATED_COMMAND_INVALID")

        libc = ctypes.CDLL(None, use_errno=True)
        linkat = libc.linkat
        linkat.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
        if linkat(temporary_fd, b"", parent_fd, os.fsencode(args.artifact_name), 0x1000) != 0:
            error = ctypes.get_errno()
            fail("EEXIST" if error == errno.EEXIST else "DREAM_MIGRATION_RECEIPT_COMMIT_FAILED")
        final_linked = True
        # linkat is the commit point. Every fallible validation is completed
        # before it; the parent recovers a lost acknowledgement by comparing
        # the final path with this exact staged inode identity.
        print(f"COMMITTED:{args.token}:{committed_identity(staged)}", flush=True)
        raise SystemExit(0)
    except SystemExit:
        raise
    except BaseException:
        fail(
            "DREAM_MIGRATION_RECEIPT_COMMIT_CLEANUP_UNVERIFIED"
            if final_linked
            else "DREAM_MIGRATION_RECEIPT_ISOLATED_STAGE_FAILED"
        )
    finally:
        if temporary_fd >= 0:
            os.close(temporary_fd)

pending_fd = 3
parent_fd = 4
owned = os.fstat(pending_fd)
if not stat.S_ISREG(owned.st_mode) or owned.st_nlink != 1:
    fail("DREAM_MIGRATION_RECEIPT_COMMIT_IDENTITY_INVALID")

# Darwin has no AT_EMPTY_PATH.  fclonefileat atomically creates the complete
# destination from the already-open source descriptor and refuses an existing
# destination, so the mutable pending pathname is never selected for
# authoritative publication.
system = platform.system()
if system == "Darwin":
    libc = ctypes.CDLL(None, use_errno=True)
    fclonefileat = libc.fclonefileat
    fclonefileat.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    if fclonefileat(pending_fd, parent_fd, os.fsencode(args.artifact_name), 0) != 0:
        error = ctypes.get_errno()
        fail("EEXIST" if error == errno.EEXIST else "DREAM_MIGRATION_RECEIPT_COMMIT_FAILED")
    try:
        try:
            pending = os.stat(args.pending_name, dir_fd=parent_fd, follow_symlinks=False)
            if (pending.st_dev, pending.st_ino) == (owned.st_dev, owned.st_ino):
                os.unlink(args.pending_name, dir_fd=parent_fd)
        except FileNotFoundError:
            pass
        promoted = os.stat(args.artifact_name, dir_fd=parent_fd, follow_symlinks=False)
        if (not stat.S_ISREG(promoted.st_mode)
                or promoted.st_nlink != 1
                or promoted.st_size != owned.st_size):
            fail("DREAM_MIGRATION_RECEIPT_COMMIT_CLEANUP_UNVERIFIED")
        print(promoted_identity(promoted), flush=True)
    except SystemExit:
        raise
    except BaseException:
        fail("DREAM_MIGRATION_RECEIPT_COMMIT_CLEANUP_UNVERIFIED")
    raise SystemExit(0)
else:
    fail("DREAM_MIGRATION_RECEIPT_PROMOTION_UNSUPPORTED")
