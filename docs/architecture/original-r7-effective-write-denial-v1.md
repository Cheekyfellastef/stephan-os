# Original r7 native effective-write denial checks (#3123)

The existing DACL reader checks rule shape. That cannot establish whether an
original Windows token can actually open a source file for writing. The new
`R7EffectiveWriteDenial.Observe` performs native `OPEN_EXISTING` access requests
under a retained, SID-matched, unmodified OS token. It does not create a token
from a SID, reduce privileges to make a test pass, write a file, change an ACL,
launch a process, install a service, sign anything or release a lease.

Write and append requests are tested **separately**. A denied combined request
would conceal an allowed append operation. Only `ERROR_ACCESS_DENIED` counts as
denial; a sharing conflict, unavailable object or other error remains unknown.
The observer also checks WRITE_DAC and WRITE_OWNER. It reports ownership and
any existing dangerous token privileges, including disabled privileges and
deny-only Administrators membership. A writer that can enable a privilege or
regain elevation is not attested as safely excluded.

Object identity comes from open Windows handles (volume and file index), is
checked before/after impersonation, and refuses hard-linked files and reparse
points. Ancestors must be readable and non-reparse. Alternate data streams,
UNC/device names, traversal and ambiguous trailing characters are refused.
All output is bounded static classifications and booleans: no SID, path,
process ID, token content, ACL, native exception text or private file data.

## Real native tests

The existing Windows native test project now runs behavioral checks on its
own disposable scratch files. It verifies writable-file refusal, a real
kernel write/append denial, owner WRITE_DAC bypass, partial write-only denial,
sharing failures, hard-link aliases, malformed paths, wrong SID and missing
token. ACL rollback reconstructs a modified Access section from the original
descriptor; reusing an already persisted FileSecurity object is not rollback.
Sentinel data is checked unchanged and scratch is removed after ACL restoration.

Run the existing test project with .NET 8 on Windows:

```
dotnet run --project src/windows/Stephanos.OriginalR7DaclReadback.Tests --configuration Release
```

An actual host test executed 31 checks successfully on 16 October 2026. These
are test-process tokens and disposable files, **not the original r7 actor or
production source**. No positive production custody claim follows.

## Required specialist decision before production integration

This is one necessary physical probe in the protected witness implementation,
not a completed containment service. The existing SCM host intentionally stays
closed. Its next integration must first establish the original principal set
from independently trusted machine evidence. A current task's user, guessed
SID or queue correlation cannot silently substitute for native provenance.

The independent Windows authority reviewer must qualify:

1. The old principal inventory and alternate/linked tokens, existing writable
   handles and mapped views. Open denial is prospective and cannot revoke an
   already obtained handle. A before/after file ID is not a continuous race lock.
2. Exact source/worktree, Git common-directory, parent rename and alias scope,
   including every descendant, alternate stream and remaining write credential.
   This primitive observes one object; it cannot assert whole-tree containment.
3. A narrowly scoped administrative enforcement/rollback design that leaves
   canonical dirty work and operator/gaming services intact. An old principal
   that owns objects or can regain admin authority cannot be qualified merely
   by adding a deny ACE. Do not blanket-deny the interactive operator account.
4. Actual direct/WMI/COM/task/service relaunch and negative-write tests, protected
   continuing audit and fresh time/anti-replay evidence. No caller booleans may
   be promoted to native facts.
5. The independent witness service identity and protected Ed25519 issuer, with
   a separate operator SID/key approving the exact lease and witness digests.
   Do not generate a key or enable signing before these gates are qualified.

After that qualification, finish the service/enforcement and signer integration
on this same goal, independently review its final exact head, and use protected
owner merge/commissioning. Only the existing canonical cancellation/recheck/CAS
may release the stale lease. No original-source goal completion, material worker
pickup or unattended refill is proved by this source change.

## Primary API references

- [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
- [Windows file privileges](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/privileges)
- [Impersonation failure handling](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-impersonateloggedonuser)
