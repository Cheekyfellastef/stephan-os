#pragma once
/* Fixed laboratory protocol. No path, handle, access mask or identity input. */
#define R7Q_PORT_NAME L"\\R7NativeQualificationOnly"
#define R7Q_VERSION 1u
#define R7Q_RUN 0x37514E52u
typedef struct _R7Q_REQUEST {
    unsigned long Version;
    unsigned long Command;
    unsigned long Reserved[2];
} R7Q_REQUEST;
typedef struct _R7Q_RESULT {
    unsigned long Version;
    unsigned long Size;
    long Status;
    unsigned long CompletedStages;
    unsigned long CausalPassCallbacks;
    unsigned long CausalDeniedCallbacks;
    unsigned long TestOnly;
    unsigned long Reserved;
} R7Q_RESULT;
#define R7Q_VOLUME_ADMITTED 0x01u
#define R7Q_BASELINE_PASSED 0x02u
#define R7Q_ENROLLED 0x04u
#define R7Q_CALLER_READ_CLOSED 0x08u
#define R7Q_METADATA_DENIED 0x10u
#define R7Q_CONTROL_USABLE 0x20u
#define R7Q_RETAINED_SHARE_DENIED 0x40u
#define R7Q_RETIRED 0x80u
#define R7Q_AFTER_RETIRE_PASSED 0x100u
#define R7Q_ALL_STAGES 0x1ffu
