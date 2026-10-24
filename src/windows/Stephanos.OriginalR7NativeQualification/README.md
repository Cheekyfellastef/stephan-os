# R7 disposable native qualification harness

This separate loadable test minifilter links the actual retained-object core.
It is source for an isolated Windows guest, not a commissioned custody driver.
Never install it on Battle Bridge. The existing KernelLinkProbe still refuses
startup and must never be loaded. No installation, test certificate, code
integrity change, altitude assignment, guest provisioning or reboot is performed
by this source or its build script.

The first physical test covers native owner/DACL and EA operation interception,
file/stream context lookup on an old metadata handle, retention after the
caller's read handle closes, retirement and an unrelated control file. It does
not exercise source sealing, recovery writes, paging denial, old writable views,
MDLs, namespace closure, TxF, issuer revocation or any lease operation.

The filter permits one manual NTFS disk-volume attachment. Before creating
anything, the system-thread worker refuses the actual SystemRoot volume and
requires exact volume label `R7_NATIVE_TEST_ONLY` plus a successfully queried
`BusTypeFileBackedVirtual` device descriptor. These are laboratory safeguards,
not authentication that a volume is empty, disposable or production-authorized.
Only a dedicated data VHD inside the separately admitted guest may be used.

A SYSTEM/administrator communication port accepts one fixed RUN message:
version1, fixed command and two zero reserved words. It accepts no path, handle,
mask, SID, key, signature or arbitrary control input. The request is captured
under exception handling; raw user buffers never reach the worker. A dedicated
system thread performs all lifecycle calls at PASSIVE_LEVEL with kernel previous
mode, and the message callback joins the actual thread before copying its fixed
result. Disconnect or a failed result copy cannot free an executing worker.
Unload stops admission, drains setup/message/worker lifetime, releases its
instance rundown reference and unregisters. Forced instance teardown races one
atomic historical completion point: teardown winning first refuses success.
Later teardown does not rewrite a finished experiment. The result asserts no
continuing protection after that point and is never a live custody receipt.

The worker creates a fresh UUID directory with FILE_CREATE, then two fixed files
relative to its retained directory handle, without reparse traversal. It never
opens an existing fixture tree or deletes anything. Fixture files remain for
inspection until the disposable guest/data VHD is discarded. No recursive
cleanup capability exists.

Native baseline and post-retirement DACL/EA operations must succeed. While the
gate exists, both operations through the original metadata-only handle must
return STATUS_ACCESS_DENIED, and wrapper callbacks must independently observe
the core's actual FLT_PREOP_COMPLETE plus denial on that exact FILE_OBJECT and
worker thread. All original operation flags/completion/result values are
preserved. The denied EA attempt uses a different value; real native EA
readback must retain the baseline value. The DACL attempt reapplies the actual
original DACL; this first harness claims interception, not an altered-DACL
recovery test. The unenrolled control file remains usable. After closing the
caller's only read handle, a fresh ordinary data-writer open must fail with
STATUS_SHARING_VIOLATION; the same open must succeed after retirement. That
sharing result proves retained-guard lifetime, not WRITE callback execution.

Build with the same pinned WDK archive and existing SDK/MSVC prerequisites:

```powershell
./scripts/windows/build-original-r7-native-qualification.ps1 `
  -WdkRoot '<verified-development-directory>' `
  -WdkPackagePath '<Microsoft.Windows.WDK.x64.10.0.26100.6584.nupkg>'
```

The script reuses the archive/all-763-input checks and core policy tests, compiles
the separate unsigned driver with GsDriverEntry startup, and builds the fixed
client. It never invokes the client or installs/loads/signs an image. Build
receipts explicitly say nativeCallbacksExecuted=false. A successful client
receipt requires all nine stages, six causal pass callbacks and two causal
denials; it still reports custodyProven=false and leaseChanged=false.

Independent Windows/security review, a genuine admitted disposable guest and
driver-signing/altitude/load configuration must precede execution. Driver
Verifier qualification must target this driver alone in that guest. Guest boot,
installation, callback observations and unload/race behavior remain unproven
until real native receipts exist. Production commissioning is a separate gate.

Primary references: [Filter lifecycle](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/loading-and-unloading),
[message-buffer contract](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nc-fltkernel-pflt_message_notify),
[port security](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nf-fltkernel-fltbuilddefaultsecuritydescriptor),
[generated-I/O stack placement](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nf-fltkernel-fltcreatefileex2).
