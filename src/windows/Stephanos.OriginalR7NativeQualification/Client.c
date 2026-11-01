#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fltuser.h>
#include <stdio.h>
#include "Protocol.h"
_Static_assert(sizeof(R7Q_REQUEST) == 16, "fixed request ABI");
_Static_assert(sizeof(R7Q_RESULT) == 32, "fixed result ABI");

int main(int argc, char **argv)
{
    HANDLE port = INVALID_HANDLE_VALUE;
    HRESULT status;
    DWORD returned = 0;
    R7Q_REQUEST request = { R7Q_VERSION, R7Q_RUN, { 0, 0 } };
    R7Q_RESULT result = {0};
    (void)argv;
    if (argc != 1) return 2;
    status = FilterConnectCommunicationPort(R7Q_PORT_NAME, 0, NULL, 0, NULL, &port);
    if (FAILED(status)) { fprintf(stderr, "R7_NATIVE_QUALIFICATION_CONNECT_FAILED=%08lx\n", (unsigned long)status); return 1; }
    status = FilterSendMessage(port, &request, sizeof(request), &result, sizeof(result), &returned);
    CloseHandle(port);
    if (FAILED(status) || returned != sizeof(result) || result.Version != R7Q_VERSION
        || result.Size != sizeof(result) || result.TestOnly != 1 || result.Reserved != 0) {
        fprintf(stderr, "R7_NATIVE_QUALIFICATION_PROTOCOL_FAILED=%08lx\n", (unsigned long)status);
        return 1;
    }
    printf("R7_NATIVE_QUALIFICATION_RESULT={\"version\":%lu,\"status\":\"%08lx\",\"completedStages\":%lu,\"causalPassCallbacks\":%lu,\"causalDeniedCallbacks\":%lu,\"testOnly\":true,\"custodyProven\":false,\"leaseChanged\":false}\n",
        result.Version, (unsigned long)result.Status, result.CompletedStages,
        result.CausalPassCallbacks, result.CausalDeniedCallbacks);
    return result.Status == 0 && result.CompletedStages == R7Q_ALL_STAGES
        && result.CausalPassCallbacks == 6 && result.CausalDeniedCallbacks == 2 ? 0 : 1;
}
