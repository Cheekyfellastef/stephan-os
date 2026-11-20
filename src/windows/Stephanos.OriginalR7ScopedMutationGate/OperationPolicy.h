#pragma once

/* Shared by the real callbacks and the exhaustive user-mode policy test.
 * These are operation dispositions, never custody/lease assertions. */
enum R7GateMajor {
    R7GateWrite = 0x04, R7GateSetInformation = 0x06,
    R7GateSetEa = 0x08, R7GateFileSystemControl = 0x0d,
    R7GateSetSecurity = 0x15,
    R7GatePrepareMdlWrite = 0xef, R7GateMdlWriteComplete = 0xee
};
enum R7GateDisposition { R7GatePass, R7GateDeny, R7GateForceIrp, R7GateDrainAndInvalidate };

static __inline int R7GateIsMdlCompletion(unsigned major, unsigned minor)
{
    return major == R7GateMdlWriteComplete
        || (major == R7GateWrite && (minor & 4u) != 0 && (minor & ~7u) == 0);
}

static __inline enum R7GateDisposition
R7GateDecide(unsigned major, unsigned minor, int enrolled, int retiring, int denyPaging,
    int paging, int fastIo, unsigned informationClass,
    int readOnlyControl, int retainedOplockControl)
{
    if (!enrolled) return R7GatePass;
    /* Never strand an already issued MDL. An observed completion is evidence
     * of an old write capability: let Windows drain it and latch a fault. */
    if (R7GateIsMdlCompletion(major, minor)) return R7GateDrainAndInvalidate;
    if (retiring) return fastIo ? R7GateForceIrp : R7GateDeny;
    switch (major) {
    case R7GateWrite:
        /* Reject new MDL grants and unknown write variants even if paging. */
        if ((minor & ~1u) != 0) return fastIo ? R7GateForceIrp : R7GateDeny;
        /* Preparation must permit old dirty pages to drain. This is NOT an
         * assertion that all pre-attach operations or mappings have drained. */
        if (paging && !denyPaging) return R7GatePass;
        return fastIo ? R7GateForceIrp : R7GateDeny;
    case R7GatePrepareMdlWrite:
        return fastIo ? R7GateForceIrp : R7GateDeny;
    case R7GateSetSecurity:
    case R7GateSetEa:
        return R7GateDeny;
    case R7GateSetInformation:
        /* FilePositionInformation changes the retained handle's cursor.
         * Unknown classes, mode/delete/rename/link/size changes deny. */
        return informationClass == 14u ? R7GatePass : R7GateDeny;
    case R7GateFileSystemControl:
        return readOnlyControl || retainedOplockControl ? R7GatePass : R7GateDeny;
    default:
        return R7GateDeny;
    }
}
