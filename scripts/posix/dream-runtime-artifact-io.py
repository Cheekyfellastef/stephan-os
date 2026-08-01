#!/usr/bin/env python3
"""Handle-bound, no-replace promotion for dream runtime artifacts.

File descriptor 3 is the owned pending file and descriptor 4 is its validated
parent directory.  No caller-controlled pathname is used to select the inode
that enters the authoritative namespace.
"""

import argparse
import ctypes
import errno
import fcntl
import os
import platform
import stat
import sys


def fail(code: str) -> None:
    print(code, file=sys.stderr, flush=True)
    raise SystemExit(2)


parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--pending-name", required=True)
parser.add_argument("--artifact-name", required=True)
args = parser.parse_args()

for value in (args.pending_name, args.artifact_name):
    if not value or value in (".", "..") or "/" in value or "\0" in value:
        fail("DREAM_MIGRATION_ARTIFACT_NAME_INVALID")

pending_fd = 3
parent_fd = 4
owned = os.fstat(pending_fd)
if not stat.S_ISREG(owned.st_mode) or owned.st_nlink != 1:
    fail("DREAM_MIGRATION_RECEIPT_COMMIT_IDENTITY_INVALID")

# Darwin has no AT_EMPTY_PATH.  Its explicitly supported fallback serializes
# cooperating publishers on the validated directory handle and uses
# renameatx_np(RENAME_EXCL), with before/after ownership checks.
if platform.system() == "Darwin":
    fcntl.flock(parent_fd, fcntl.LOCK_EX)
    before = os.stat(args.pending_name, dir_fd=parent_fd, follow_symlinks=False)
    if (before.st_dev, before.st_ino) != (owned.st_dev, owned.st_ino):
        fail("DREAM_MIGRATION_RECEIPT_COMMIT_IDENTITY_CHANGED")
    libc = ctypes.CDLL(None, use_errno=True)
    renameatx_np = libc.renameatx_np
    renameatx_np.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    if renameatx_np(parent_fd, os.fsencode(args.pending_name), parent_fd, os.fsencode(args.artifact_name), 0x00000004) != 0:
        error = ctypes.get_errno()
        fail("EEXIST" if error == errno.EEXIST else "DREAM_MIGRATION_RECEIPT_COMMIT_FAILED")
else:
    libc = ctypes.CDLL(None, use_errno=True)
    linkat = libc.linkat
    linkat.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
    # Following the procfs descriptor symlink selects the already-open file
    # description, never the mutable pending directory entry.  Unlike
    # AT_EMPTY_PATH this does not require CAP_DAC_READ_SEARCH.
    if linkat(-100, b"/proc/self/fd/3", parent_fd, os.fsencode(args.artifact_name), 0x400) != 0:
        error = ctypes.get_errno()
        fail("EEXIST" if error == errno.EEXIST else "DREAM_MIGRATION_RECEIPT_COMMIT_FAILED")
    # Remove the pending name only if it still selects the owned inode.  An
    # attacker replacement is never unlinked.
    try:
        pending = os.stat(args.pending_name, dir_fd=parent_fd, follow_symlinks=False)
        if (pending.st_dev, pending.st_ino) == (owned.st_dev, owned.st_ino):
            os.unlink(args.pending_name, dir_fd=parent_fd)
    except FileNotFoundError:
        pass

promoted = os.stat(args.artifact_name, dir_fd=parent_fd, follow_symlinks=False)
if (promoted.st_dev, promoted.st_ino) != (owned.st_dev, owned.st_ino) or promoted.st_nlink != 1:
    # The link itself selected the owned descriptor.  If an attacker moved the
    # pending name and thereby retained another link, remove only the exact
    # authoritative link just created and fail closed.
    if (promoted.st_dev, promoted.st_ino) == (owned.st_dev, owned.st_ino):
        os.unlink(args.artifact_name, dir_fd=parent_fd)
    fail("DREAM_MIGRATION_RECEIPT_COMMIT_IDENTITY_CHANGED")
print("PROMOTED", flush=True)
