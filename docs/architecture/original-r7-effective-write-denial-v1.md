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
any unqualified token privileges, including disabled privileges and deny-only
Administrators membership. Privilege qualification is closed-world: only
`SeChangeNotifyPrivilege` is admitted; every other present privilege, including
`SeRelabelPrivilege` and future unknown LUIDs, remains held. A writer that can
enable a privilege or regain elevation is not attested as safely excluded.

Native token qualification rejects IsTokenRestricted, TokenHasRestrictions
(including previously filtered tokens), AppContainer, sandbox-inert, TokenIsSandboxed
and UIAccess
forms before any target access probe. The result says `SuppliedTokenSidMatched`,
not that a historical original token was authenticated. The separate
`OriginalPrincipalProvenanceAuthenticated` claim is permanently false in this
component. These checks cannot establish that a caller supplied the original
unmodified launch token; that requires independently authenticated native launch
provenance (including native token identity/modification binding) at the service
boundary before commissioning/signing. A same-SID token is insufficient.

Object identity comes from retained Windows handles (volume and file index)
and the handle-resolved, normalized native final path. The object and every
ancestor remain open without DELETE sharing throughout the probe. Native name
binding rejects 8.3 aliases in any component and volume namespace substitutions;
the object identity is checked before/after impersonation. Hard-linked files, directories presented as source files,
and reparse points are refused. Ancestors must be readable and non-reparse. Alternate data streams,
UNC/device names (including DOS devices with extensions), traversal, alternate
separators, wildcard characters and ambiguous trailing characters are refused.
The supplied path must already equal its full normalized form; evidence is
never silently rebound to a different normalized target.
All positive classifications refer only to the supplied token or principal;
no classification authenticates the original historical writer. A directory is
rejected before access-denial evidence is emitted. All output is bounded static
classifications and booleans: no SID, path,
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

The immutable hosted Windows run
[38866215526](https://github.com/Cheekyfellastef/stephan-os/actions/runs/38866215526)
passed all 77 native checks at source head
`a51f83d27c1492bf13b716b6b1ec2d9a31b9a497`, including the sandbox,
object-type and supplied-token wording changes. That disposable runner exercised
the public unfiltered-token entry path and a real short-name alias. Its scratch
file was not owned by the current user SID; tests classified the actual native
owner and access results instead of assuming ownership.

An earlier local host had a filtered token: the public entry point correctly
rejected it, while tests exercised the private kernel mechanism separately with
that unchanged test token and reported
`R7_NATIVE_UNFILTERED_ENTRYPOINT_CASE_AVAILABLE=false`. These are distinct
machine observations. Neither the hosted runner nor the earlier local test
authenticates the original r7 launch token or production source custody.
Fresh exact-head CI and independent Windows/security specialist review remain
required after any source or base integration. Hosted test success is not
specialist acceptance or commissioning.

## Required specialist decision before production integration

This is one necessary physical probe in the protected witness implementation,
not a completed containment service. The existing SCM host intentionally stays
closed. Its next integration must first establish the original principal set
from independently trusted machine evidence. A current task's user, guessed
SID or queue correlation cannot silently substitute for native provenance.

### Target-binding design invariant

The supplied path is only a request. The retained native object is the evidence
identity. Accepting normalized text or checking just the final filename does
not qualify every Windows namespace component. The probe therefore acquires
the target and full ancestor chain, excludes reparse tags, retains no-DELETE
handles, and compares the handle's Windows-normalized final DOS path with the
entire supplied path before any original-token access request. Volume/file ID
and native-name qualification must still agree after the requests. Pure policy
tests cover file and ancestor aliases; a real GetShortPathName regression runs
when the volume provides a different short spelling. Unknown native resolution
holds. This invariant replaces name-pattern-based alias qualification.

The independent Windows authority reviewer must qualify:

1. The old principal inventory and alternate/linked tokens, existing writable
   handles and mapped views. Open denial is prospective and cannot revoke an
   already obtained handle. Retained name guards and before/after IDs are not
   revocation of old writable handles/mapped sections or continuous custody.
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
