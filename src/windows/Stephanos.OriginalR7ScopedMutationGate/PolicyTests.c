#include <stdio.h>
#include <stdlib.h>
#include "OperationPolicy.h"

static unsigned long long checks;
static void Check(int condition, const char *invariant)
{
    checks++;
    if (!condition) { fprintf(stderr, "R7_GATE_POLICY_FAILED:%s\n", invariant); exit(1); }
}

int main(void)
{
    unsigned major, minor, flags, information;
    for (major = 0; major < 256; major++) {
      for (minor = 0; minor < 16; minor++) {
        for (flags = 0; flags < 128; flags++) {
            for (information = 0; information < 128; information++) {
                int enrolled = (flags & 1) != 0, retiring = (flags & 2) != 0;
                int denyPaging = (flags & 4) != 0, paging = (flags & 8) != 0;
                int fastIo = (flags & 16) != 0, readOnly = (flags & 32) != 0;
                int ownOplock = (flags & 64) != 0;
                enum R7GateDisposition result = R7GateDecide(major, minor, enrolled,
                    retiring, denyPaging, paging, fastIo, information, readOnly, ownOplock);
                Check(result >= R7GatePass && result <= R7GateDrainAndInvalidate, "CLOSED_DISPOSITION");
                if (!enrolled) { Check(result == R7GatePass, "NO_UNRELATED_OBJECT_DENIAL"); continue; }
                /* Enumerate completion minors independently of the policy's
                 * bit predicate. Existing cleanup cannot be stranded. */
                if (major == R7GateMdlWriteComplete || (major == R7GateWrite
                    && (minor == 4 || minor == 5 || minor == 6 || minor == 7))) {
                    Check(result == R7GateDrainAndInvalidate, "OLD_MDL_DRAINS_AND_INVALIDATES_EVEN_DURING_RETIREMENT");
                    continue;
                }
                if (retiring) { Check(result != R7GatePass, "KNOWN_RETIRING_OBJECT_NEVER_PASSES"); continue; }
                if (major == R7GateWrite) {
                    if (!paging || denyPaging || minor > 1) Check(result != R7GatePass, "PROTECTED_MUTATION_NEVER_PASSES");
                    if (!paging && fastIo) Check(result == R7GateForceIrp, "FAST_WRITE_CANNOT_SKIP_IRP_GATE");
                    if (paging && !denyPaging && minor <= 1) Check(result == R7GatePass, "PREPARATION_CAN_DRAIN_OLD_DIRTY_PAGES");
                }
                if (major == R7GatePrepareMdlWrite)
                    Check(result != R7GatePass && result != R7GateDrainAndInvalidate, "NEW_MDL_WRITE_CAPABILITY_NEVER_ISSUED");
                if (major == R7GateSetSecurity || major == R7GateSetEa)
                    Check(result == R7GateDeny, "OLD_GRANTED_METADATA_RIGHTS_CANNOT_OVERRIDE_POLICY");
                if (major == R7GateSetInformation && information != 14)
                    Check(result == R7GateDeny, "UNKNOWN_OR_MUTATING_INFORMATION_FAILS_CLOSED");
                if (major == R7GateSetInformation && information == 14)
                    Check(result == R7GatePass, "HARMLESS_HANDLE_CURSOR_REMAINS_USABLE");
                if (major == R7GateFileSystemControl && !readOnly && !ownOplock)
                    Check(result == R7GateDeny, "UNKNOWN_OR_MUTATING_CONTROL_FAILS_CLOSED");
            }
        }
      }
    }
    printf("R7_GATE_POLICY_CHECKS_PASSED=%llu\n", checks);
    return 0;
}
