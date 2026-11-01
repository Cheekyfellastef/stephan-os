#include "ScopedMutationGate.h"

/* ABI/link proof ONLY. This image refuses initialization and must never be
 * installed or loaded. It is not an enclosing production minifilter. */
DRIVER_INITIALIZE DriverEntry;
NTSTATUS DriverEntry(PDRIVER_OBJECT driver, PUNICODE_STRING registry)
{
    UNREFERENCED_PARAMETER(driver);
    UNREFERENCED_PARAMETER(registry);
    return STATUS_NOT_SUPPORTED;
}
