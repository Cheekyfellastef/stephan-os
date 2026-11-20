# Recovery when the OS audit anchor has rolled over

Source candidate under the existing #2961 maintenance owner. This is not runtime
activation or a recovered frontend. Independent Windows/security review and
exact-head operator protected integration remain required.

## Observed failure and structural choice

The Windows PowerShell channel is circular. The 25 October ACTIVE record was
initially authenticated, then evicted before the approved recovery ran. The
installed adapter correctly refused recovery. A signed workspace projection
proves historical authenticity, not freshness: it cannot stand in for the lost
OS record, even when it carries the previously approved digest.

Do not add an IDLE seed or replay an old record. Add a new, explicitly approved
ACTIVE audit-loss fence using the existing guardian, native kernel
compare-and-append, OS channel and signing domain. A fresh later full boot must
then exclude *every potentially lost execution*, including unknown intermediate
owners. The earlier reboot cannot discharge this new fence.

## Two separately gated phases

1. `prepare-after-audit-loss` binds exact installed main, original reservation
   and whole signed projection digest. Only the authenticated source-pinned
   guardian may invoke it while held and idle. A conflicting known owner,
   readable existing anchor, corrupt/unreadable authority, changed projection,
   unverified boot, missing approval or persistence failure refuses admission.
   An absent in-memory cycle after process restart is not fabricated continuity:
   the captured signed ACTIVE projection binds the exact explicitly approved
   original identity, with its freshness explicitly UNPROVEN.
2. Preparation durably archives the complete original signed record's contents
   and digest with UNKNOWN historical outcome and UNPROVEN freshness. It creates
   only ACTIVE, binds a fresh native observation of the current boot, and grants
   no owner release handle. It does not start/stop any process or change a source
   lease. Its returned new digest needs a separate approved recovery after a boot
   later than this preparation, through the existing `recover-after-boot` route.

The native null-previous compare rejects a concurrent new anchor; workspace
fences remain conservative diagnostics. Unknown writes retain the same boot
fence. HTTP ownership remains single-flight while the boot observer is awaited.
Repeated preparation, missing later evidence, same-boot reload and old digest
recovery stay held. Audit loss is not equivalent to successful termination.

## Retention and availability limitation

This does not configure Windows logging or promise unbounded audit retention.
If the newly prepared record rolls over again before recovery, the hold remains.
Operational activation must account for the observed channel retention window;
prompt restart/recovery or a separately reviewed retention improvement is needed.
Clearing/replaying events, enlarging a log after evidence loss, and restarting
Commander cannot reconstruct the missing original authority. No new scheduler,
signer, source worker, log source or Windows privilege is introduced.

After legitimate recovery, run the existing bounded UI repair, canonical build
and verification, exact served marker/module MIME and browser/ignition proof.
Normal frontend startup persistence is a separate subsequent reviewed change;
the restricted visibility server is not that outcome.
