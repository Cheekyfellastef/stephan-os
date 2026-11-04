#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <openxr/openxr.h>
#include "loader_interfaces.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <deque>
#include <io.h>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace stephanos_vr {
constexpr const char* kLayerName = "XR_APILAYER_STEPHANOS_telemetry_v1";

struct Dispatch {
    PFN_xrGetInstanceProcAddr gipa{};
    PFN_xrDestroyInstance destroyInstance{};
    PFN_xrCreateSession createSession{};
    PFN_xrBeginSession beginSession{};
    PFN_xrDestroySession destroySession{};
    PFN_xrCreateSwapchain createSwapchain{};
    PFN_xrDestroySwapchain destroySwapchain{};
    PFN_xrAcquireSwapchainImage acquireSwapchainImage{};
    PFN_xrWaitSwapchainImage waitSwapchainImage{};
    PFN_xrReleaseSwapchainImage releaseSwapchainImage{};
    PFN_xrWaitFrame waitFrame{};
    PFN_xrBeginFrame beginFrame{};
    PFN_xrLocateViews locateViews{};
    PFN_xrEndFrame endFrame{};
};

struct Session {
    std::shared_ptr<Dispatch> dispatch;
    uint64_t frameSerial{};
    XrFrameState waitState{XR_TYPE_FRAME_STATE};
    int64_t waitReturnedQpc{};
    int64_t beginCalledQpc{};
    int64_t beginReturnedQpc{};
    int64_t locateCalledQpc{};
    int64_t locateReturnedQpc{};
    XrTime locateDisplayTime{};
    XrViewStateFlags viewFlags{};
    XrViewConfigurationType viewConfigurationType{};
    XrView locatedViews[2]{{XR_TYPE_VIEW}, {XR_TYPE_VIEW}};
    uint32_t locatedViewCount{};
    uint64_t previousReleaseSerial[2]{};
};

struct PendingImage {
    uint32_t imageIndex{};
    int64_t acquiredQpc{};
    int64_t waitedQpc{};
};

struct Swapchain {
    std::shared_ptr<Dispatch> dispatch;
    XrSession session{};
    std::deque<PendingImage> pending;
    uint64_t releaseSerial{};
    uint32_t releasedImage{};
    int64_t acquiredQpc{};
    int64_t waitedQpc{};
    int64_t releasedQpc{};
};

struct EyeSubmission {
    XrCompositionLayerProjectionView view{XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW};
    uint64_t releaseSerial{};
    uint32_t releasedImage{};
    int64_t acquiredQpc{};
    int64_t waitedQpc{};
    int64_t releasedQpc{};
    bool releaseObserved{};
};

std::mutex stateMutex;
std::mutex outputMutex;
std::unordered_map<XrInstance, std::shared_ptr<Dispatch>> instances;
std::unordered_map<XrSession, Session> sessions;
std::unordered_map<XrSwapchain, Swapchain> swapchains;
std::shared_ptr<Dispatch> fallbackDispatch;
PFN_xrGetInstanceProcAddr passThroughGipa{};
FILE* output{};
uint64_t rows{};
uint64_t bytesWritten{};
std::atomic<uint64_t> droppedRows{};
LARGE_INTEGER qpcFrequency{};
std::string launchSessionId;
std::string gameId;

int64_t qpc() {
    LARGE_INTEGER value{};
    QueryPerformanceCounter(&value);
    return value.QuadPart;
}

double qpcMs(int64_t newer, int64_t older) {
    if (newer <= 0 || older <= 0 || newer < older || qpcFrequency.QuadPart <= 0) return -1.0;
    return (static_cast<double>(newer - older) * 1000.0) / static_cast<double>(qpcFrequency.QuadPart);
}

double xrTimeMs(XrTime newer, XrTime older) {
    if (newer <= 0 || older <= 0) return -1.0;
    return static_cast<double>(newer - older) / 1000000.0;
}

std::string safeToken(const char* name, const char* fallback = "") {
    char buffer[512]{};
    const DWORD count = GetEnvironmentVariableA(name, buffer, static_cast<DWORD>(sizeof(buffer)));
    std::string value = (count > 0 && count < sizeof(buffer)) ? std::string(buffer, count) : std::string(fallback);
    for (char& c : value) {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                        (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.';
        if (!ok) c = '_';
    }
    if (value.size() > 160) value.resize(160);
    return value;
}

template<class T>
T proc(PFN_xrGetInstanceProcAddr gipa, XrInstance instance, const char* name) {
    PFN_xrVoidFunction fn{};
    return XR_SUCCEEDED(gipa(instance, name, &fn)) ? reinterpret_cast<T>(fn) : nullptr;
}

void openOutput() noexcept {
    try {
        std::lock_guard<std::mutex> guard(outputMutex);
        if (output) return;

        wchar_t exePath[32768]{};
        wchar_t tracePath[32768]{};
        wchar_t targetExe[512]{};
        GetModuleFileNameW(nullptr, exePath, 32768);
        const wchar_t* base = wcsrchr(exePath, L'\\');
        base = base ? base + 1 : exePath;

#ifndef STEPHANOS_OPENXR_TELEMETRY_TEST
        const DWORD targetCount = GetEnvironmentVariableW(L"STEPHANOS_VR_TELEMETRY_TARGET_EXE", targetExe, 512);
        if (!targetCount || targetCount >= 512 || _wcsicmp(base, targetExe) != 0) return;
#endif
        const DWORD pathCount = GetEnvironmentVariableW(L"STEPHANOS_VR_TELEMETRY_TRACE_PATH", tracePath, 32768);
        if (!pathCount || pathCount >= 32768) return;
        if (!((tracePath[1] == L':' && tracePath[2] == L'\\') || (tracePath[0] == L'\\' && tracePath[1] == L'\\'))) return;

        HANDLE file = CreateFileW(tracePath, GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file == INVALID_HANDLE_VALUE) return;
        int fd = _open_osfhandle(reinterpret_cast<intptr_t>(file), 0);
        if (fd < 0) { CloseHandle(file); return; }
        output = _fdopen(fd, "w");
        if (!output) { _close(fd); return; }
        setvbuf(output, nullptr, _IOFBF, 64 * 1024);
        QueryPerformanceFrequency(&qpcFrequency);
        launchSessionId = safeToken("STEPHANOS_VR_TELEMETRY_LAUNCH_SESSION_ID");
        gameId = safeToken("STEPHANOS_VR_TELEMETRY_GAME_ID", "unknown");

        FILETIME utc{};
        GetSystemTimeAsFileTime(&utc);
        const uint64_t filetime = (static_cast<uint64_t>(utc.dwHighDateTime) << 32) | utc.dwLowDateTime;
        fprintf(output,
            "{\"event\":\"observer_ready\",\"schemaVersion\":\"stephanos.openxr-visual-telemetry.v1\","
            "\"pid\":%lu,\"qpc\":%lld,\"qpcFrequency\":%lld,\"utcFiletime100ns\":%llu,"
            "\"launchSessionId\":\"%s\",\"gameId\":\"%s\","
            "\"capabilities\":[\"frame_lifecycle\",\"swapchain_release\",\"stereo_submission\",\"pose_fov\","
            "\"eye_skew\",\"pose_display_delta\",\"projection_presence\",\"submission_anomaly\"],"
            "\"pixelContentAvailable\":false,\"modifiesFrameData\":false}\n",
            GetCurrentProcessId(), qpc(), qpcFrequency.QuadPart, filetime,
            launchSessionId.c_str(), gameId.c_str());
        fflush(output);
    } catch (...) {}
}

void emit(const std::string& row) noexcept {
    try {
        std::unique_lock<std::mutex> guard(outputMutex, std::try_to_lock);
        if (!guard.owns_lock()) { ++droppedRows; return; }
        if (!output) return;
        if (rows >= 1000000 || bytesWritten + row.size() > 256ull * 1024ull * 1024ull) {
            fprintf(output, "{\"event\":\"observer_limit_reached\",\"rows\":%llu,\"bytes\":%llu}\n", rows, bytesWritten);
            fflush(output);
            fclose(output);
            output = nullptr;
            return;
        }
        if (fwrite(row.data(), 1, row.size(), output) != row.size()) {
            fclose(output);
            output = nullptr;
            return;
        }
        bytesWritten += row.size();
        if ((++rows % 72) == 0) fflush(output);
    } catch (...) {}
}

std::shared_ptr<Dispatch> dispatchInstance(XrInstance instance) {
    std::lock_guard<std::mutex> guard(stateMutex);
    auto it = instances.find(instance);
    return it == instances.end() ? fallbackDispatch : it->second;
}

std::shared_ptr<Dispatch> dispatchSession(XrSession session) {
    std::lock_guard<std::mutex> guard(stateMutex);
    auto it = sessions.find(session);
    return it == sessions.end() ? fallbackDispatch : it->second.dispatch;
}

std::shared_ptr<Dispatch> dispatchSwapchain(XrSwapchain swapchain) {
    std::lock_guard<std::mutex> guard(stateMutex);
    auto it = swapchains.find(swapchain);
    return it == swapchains.end() ? fallbackDispatch : it->second.dispatch;
}

std::string numbers(std::initializer_list<float> values) {
    std::string out = "[";
    bool first = true;
    char number[64]{};
    for (float value : values) {
        if (!first) out += ",";
        first = false;
        if (!std::isfinite(value)) out += "null";
        else {
            snprintf(number, sizeof(number), "%.9g", value);
            out += number;
        }
    }
    return out + "]";
}

std::string visualState(bool shouldRender, uint32_t viewCount, bool releaseMissing, bool releaseReused, XrResult endResult) {
    if (XR_FAILED(endResult)) return "END_FRAME_FAILURE";
    if (!shouldRender) return "NOT_EXPECTED";
    if (viewCount == 0) return "NO_PROJECTION_LAYER";
    if (viewCount < 2) return "MISSING_STEREO_EYE";
    if (releaseMissing) return "EYE_RELEASE_UNPROVEN";
    if (releaseReused) return "REUSED_SWAPCHAIN_RELEASE";
    return "SUBMISSION_PRESENT_PIXELS_UNOBSERVED";
}
} // namespace stephanos_vr

extern "C" XrResult XRAPI_CALL telemetryGipa(XrInstance, const char*, PFN_xrVoidFunction*);

extern "C" XrResult XRAPI_CALL telemetryCreate(
    const XrInstanceCreateInfo* info,
    const XrApiLayerCreateInfo* chain,
    XrInstance* instance) {
    using namespace stephanos_vr;
    if (!chain || !chain->nextInfo || !instance) return XR_ERROR_INITIALIZATION_FAILED;
    auto next = chain->nextInfo;
    if (!next->nextCreateApiLayerInstance || !next->nextGetInstanceProcAddr) return XR_ERROR_INITIALIZATION_FAILED;
    auto forwarded = *chain;
    forwarded.nextInfo = next->next;
    const XrResult result = next->nextCreateApiLayerInstance(info, &forwarded, instance);
    if (XR_FAILED(result)) return result;

    {
        std::lock_guard<std::mutex> guard(stateMutex);
        passThroughGipa = next->nextGetInstanceProcAddr;
    }
    try {
        auto d = std::make_shared<Dispatch>();
        d->gipa = next->nextGetInstanceProcAddr;
#define LOAD(member, type, name) d->member = proc<type>(d->gipa, *instance, name)
        LOAD(destroyInstance, PFN_xrDestroyInstance, "xrDestroyInstance");
        LOAD(createSession, PFN_xrCreateSession, "xrCreateSession");
        LOAD(beginSession, PFN_xrBeginSession, "xrBeginSession");
        LOAD(destroySession, PFN_xrDestroySession, "xrDestroySession");
        LOAD(createSwapchain, PFN_xrCreateSwapchain, "xrCreateSwapchain");
        LOAD(destroySwapchain, PFN_xrDestroySwapchain, "xrDestroySwapchain");
        LOAD(acquireSwapchainImage, PFN_xrAcquireSwapchainImage, "xrAcquireSwapchainImage");
        LOAD(waitSwapchainImage, PFN_xrWaitSwapchainImage, "xrWaitSwapchainImage");
        LOAD(releaseSwapchainImage, PFN_xrReleaseSwapchainImage, "xrReleaseSwapchainImage");
        LOAD(waitFrame, PFN_xrWaitFrame, "xrWaitFrame");
        LOAD(beginFrame, PFN_xrBeginFrame, "xrBeginFrame");
        LOAD(locateViews, PFN_xrLocateViews, "xrLocateViews");
        LOAD(endFrame, PFN_xrEndFrame, "xrEndFrame");
#undef LOAD
        {
            std::lock_guard<std::mutex> guard(stateMutex);
            fallbackDispatch = d;
            instances[*instance] = d;
        }
        openOutput();
    } catch (...) {}
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryCreateSession(XrInstance instance, const XrSessionCreateInfo* info, XrSession* session) {
    using namespace stephanos_vr;
    auto d = dispatchInstance(instance);
    const XrResult result = d->createSession(instance, info, session);
    if (XR_SUCCEEDED(result)) {
        try {
            std::lock_guard<std::mutex> guard(stateMutex);
            Session state;
            state.dispatch = d;
            sessions[*session] = state;
        } catch (...) {}
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryBeginSession(XrSession session, const XrSessionBeginInfo* info) {
    using namespace stephanos_vr;
    auto d = dispatchSession(session);
    const XrResult result = d->beginSession(session, info);
    if (XR_SUCCEEDED(result) && info) {
        try {
            std::lock_guard<std::mutex> guard(stateMutex);
            sessions.at(session).viewConfigurationType = info->primaryViewConfigurationType;
        } catch (...) {}
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryDestroySession(XrSession session) {
    using namespace stephanos_vr;
    auto d = dispatchSession(session);
    const XrResult result = d->destroySession(session);
    if (XR_SUCCEEDED(result)) {
        std::lock_guard<std::mutex> guard(stateMutex);
        sessions.erase(session);
        for (auto it = swapchains.begin(); it != swapchains.end();) {
            it = it->second.session == session ? swapchains.erase(it) : std::next(it);
        }
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryCreateSwapchain(XrSession session, const XrSwapchainCreateInfo* info, XrSwapchain* swapchain) {
    using namespace stephanos_vr;
    auto d = dispatchSession(session);
    const XrResult result = d->createSwapchain(session, info, swapchain);
    if (XR_SUCCEEDED(result)) {
        try {
            std::lock_guard<std::mutex> guard(stateMutex);
            Swapchain state;
            state.dispatch = d;
            state.session = session;
            swapchains[*swapchain] = state;
        } catch (...) {}
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryDestroySwapchain(XrSwapchain swapchain) {
    using namespace stephanos_vr;
    auto d = dispatchSwapchain(swapchain);
    const XrResult result = d->destroySwapchain(swapchain);
    if (XR_SUCCEEDED(result)) {
        std::lock_guard<std::mutex> guard(stateMutex);
        swapchains.erase(swapchain);
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryAcquireSwapchainImage(
    XrSwapchain swapchain,
    const XrSwapchainImageAcquireInfo* info,
    uint32_t* imageIndex) {
    using namespace stephanos_vr;
    auto d = dispatchSwapchain(swapchain);
    const XrResult result = d->acquireSwapchainImage(swapchain, info, imageIndex);
    if (XR_SUCCEEDED(result) && imageIndex) {
        try {
            std::lock_guard<std::mutex> guard(stateMutex);
            auto& state = swapchains.at(swapchain);
            if (state.pending.size() < 128) {
                state.pending.push_back(PendingImage{*imageIndex, qpc(), 0});
            }
        } catch (...) {}
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryWaitSwapchainImage(
    XrSwapchain swapchain,
    const XrSwapchainImageWaitInfo* info) {
    using namespace stephanos_vr;
    auto d = dispatchSwapchain(swapchain);
    const XrResult result = d->waitSwapchainImage(swapchain, info);
    if (XR_SUCCEEDED(result)) {
        try {
            std::lock_guard<std::mutex> guard(stateMutex);
            auto& state = swapchains.at(swapchain);
            if (!state.pending.empty()) state.pending.front().waitedQpc = qpc();
        } catch (...) {}
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryReleaseSwapchainImage(
    XrSwapchain swapchain,
    const XrSwapchainImageReleaseInfo* info) {
    using namespace stephanos_vr;
    auto d = dispatchSwapchain(swapchain);
    const XrResult result = d->releaseSwapchainImage(swapchain, info);
    if (XR_SUCCEEDED(result)) {
        try {
            std::lock_guard<std::mutex> guard(stateMutex);
            auto& state = swapchains.at(swapchain);
            PendingImage pending{};
            if (!state.pending.empty()) {
                pending = state.pending.front();
                state.pending.pop_front();
            }
            state.releasedImage = pending.imageIndex;
            state.acquiredQpc = pending.acquiredQpc;
            state.waitedQpc = pending.waitedQpc;
            state.releasedQpc = qpc();
            ++state.releaseSerial;
        } catch (...) {}
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryWaitFrame(XrSession session, const XrFrameWaitInfo* info, XrFrameState* frameState) {
    using namespace stephanos_vr;
    auto d = dispatchSession(session);
    const XrResult result = d->waitFrame(session, info, frameState);
    if (XR_SUCCEEDED(result) && frameState) {
        try {
            std::lock_guard<std::mutex> guard(stateMutex);
            auto& state = sessions.at(session);
            state.waitState = *frameState;
            state.waitReturnedQpc = qpc();
        } catch (...) {}
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryBeginFrame(XrSession session, const XrFrameBeginInfo* info) {
    using namespace stephanos_vr;
    auto d = dispatchSession(session);
    const int64_t called = qpc();
    const XrResult result = d->beginFrame(session, info);
    const int64_t returned = qpc();
    try {
        std::lock_guard<std::mutex> guard(stateMutex);
        auto& state = sessions.at(session);
        state.beginCalledQpc = called;
        state.beginReturnedQpc = returned;
    } catch (...) {}
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryLocateViews(
    XrSession session,
    const XrViewLocateInfo* info,
    XrViewState* viewState,
    uint32_t capacity,
    uint32_t* count,
    XrView* views) {
    using namespace stephanos_vr;
    auto d = dispatchSession(session);
    const int64_t called = qpc();
    const XrResult result = d->locateViews(session, info, viewState, capacity, count, views);
    const int64_t returned = qpc();
    if (XR_SUCCEEDED(result) && info && viewState && count) {
        try {
            std::lock_guard<std::mutex> guard(stateMutex);
            auto& state = sessions.at(session);
            state.locateCalledQpc = called;
            state.locateReturnedQpc = returned;
            state.locateDisplayTime = info->displayTime;
            state.viewFlags = viewState->viewStateFlags;
            state.locatedViewCount = (views && capacity > 0) ? std::min(*count, 2u) : 0u;
            for (uint32_t i = 0; i < state.locatedViewCount; ++i) state.locatedViews[i] = views[i];
        } catch (...) {}
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryEndFrame(XrSession session, const XrFrameEndInfo* frame) {
    using namespace stephanos_vr;
    auto d = dispatchSession(session);
    const int64_t called = qpc();

    EyeSubmission eyes[2]{};
    uint32_t projectionViews = 0;
    uint32_t projectionLayers = 0;
    uint64_t serial = 0;
    Session snapshot{};
    bool missingRelease = false;
    bool reusedRelease = false;

    try {
        std::lock_guard<std::mutex> guard(stateMutex);
        auto& state = sessions.at(session);
        serial = ++state.frameSerial;
        snapshot = state;

        if (frame && frame->layers) {
            for (uint32_t layerIndex = 0; layerIndex < std::min(frame->layerCount, 32u); ++layerIndex) {
                const auto* layer = frame->layers[layerIndex];
                if (!layer || layer->type != XR_TYPE_COMPOSITION_LAYER_PROJECTION) continue;
                ++projectionLayers;
                const auto* projection = reinterpret_cast<const XrCompositionLayerProjection*>(layer);
                if (!projection->views) continue;
                projectionViews = std::min(projection->viewCount, 2u);
                for (uint32_t eye = 0; eye < projectionViews; ++eye) {
                    eyes[eye].view = projection->views[eye];
                    auto it = swapchains.find(eyes[eye].view.subImage.swapchain);
                    if (it != swapchains.end()) {
                        eyes[eye].releaseSerial = it->second.releaseSerial;
                        eyes[eye].releasedImage = it->second.releasedImage;
                        eyes[eye].acquiredQpc = it->second.acquiredQpc;
                        eyes[eye].waitedQpc = it->second.waitedQpc;
                        eyes[eye].releasedQpc = it->second.releasedQpc;
                        eyes[eye].releaseObserved = it->second.releaseSerial > 0;
                    }
                    if (!eyes[eye].releaseObserved) missingRelease = true;
                    if (eyes[eye].releaseSerial > 0 && state.previousReleaseSerial[eye] == eyes[eye].releaseSerial) {
                        reusedRelease = true;
                    }
                    state.previousReleaseSerial[eye] = eyes[eye].releaseSerial;
                }
                break;
            }
        }
    } catch (...) {
        projectionViews = 0;
        projectionLayers = 0;
        missingRelease = true;
    }

    const XrResult result = d->endFrame(session, frame);
    const int64_t returned = qpc();

    try {
        const bool shouldRender = snapshot.waitState.shouldRender == XR_TRUE;
        const double eyeSkewMs = projectionViews >= 2
            ? std::abs(qpcMs(eyes[0].releasedQpc, eyes[1].releasedQpc) >= 0
                ? qpcMs(eyes[0].releasedQpc, eyes[1].releasedQpc)
                : qpcMs(eyes[1].releasedQpc, eyes[0].releasedQpc))
            : -1.0;
        const double poseDisplayDeltaMs = frame ? xrTimeMs(frame->displayTime, snapshot.locateDisplayTime) : -1.0;
        const double predictionDeltaMs = frame ? xrTimeMs(frame->displayTime, snapshot.waitState.predictedDisplayTime) : -1.0;
        const std::string state = visualState(shouldRender, projectionViews, missingRelease, reusedRelease, result);

        char header[8192]{};
        int n = snprintf(
            header, sizeof(header),
            "{\"event\":\"end_frame\",\"schemaVersion\":\"stephanos.openxr-visual-telemetry.v1\","
            "\"launchSessionId\":\"%s\",\"gameId\":\"%s\",\"frame\":%llu,"
            "\"calledQpc\":%lld,\"returnedQpc\":%lld,\"result\":%d,"
            "\"displayTime\":%lld,\"predictedDisplayTime\":%lld,\"predictedDisplayPeriod\":%lld,"
            "\"locateDisplayTime\":%lld,\"viewStateFlags\":%llu,\"shouldRender\":%u,"
            "\"viewConfigurationType\":%d,\"projectionLayers\":%u,\"projectionViews\":%u,"
            "\"locatedViews\":%u,\"droppedLogRows\":%llu,"
            "\"waitToBeginMs\":%.4f,\"beginCallMs\":%.4f,\"beginToEndMs\":%.4f,"
            "\"locateCallMs\":%.4f,\"predictionDeltaMs\":%.4f,\"poseDisplayDeltaMs\":%.4f,"
            "\"eyePresentationSkewMs\":%.4f,\"releaseMissing\":%s,\"releaseReused\":%s,"
            "\"visualFrameState\":\"%s\",\"pixelContentState\":\"UNOBSERVED\",\"eyes\":[",
            launchSessionId.c_str(), gameId.c_str(), serial,
            called, returned, result,
            frame ? frame->displayTime : 0,
            snapshot.waitState.predictedDisplayTime,
            snapshot.waitState.predictedDisplayPeriod,
            snapshot.locateDisplayTime,
            static_cast<unsigned long long>(snapshot.viewFlags),
            shouldRender ? 1u : 0u,
            snapshot.viewConfigurationType,
            projectionLayers, projectionViews,
            snapshot.locatedViewCount,
            droppedRows.load(),
            qpcMs(snapshot.beginCalledQpc, snapshot.waitReturnedQpc),
            qpcMs(snapshot.beginReturnedQpc, snapshot.beginCalledQpc),
            qpcMs(called, snapshot.beginReturnedQpc),
            qpcMs(snapshot.locateReturnedQpc, snapshot.locateCalledQpc),
            predictionDeltaMs, poseDisplayDeltaMs, eyeSkewMs,
            missingRelease ? "true" : "false",
            reusedRelease ? "true" : "false",
            state.c_str());

        if (n < 0 || n >= static_cast<int>(sizeof(header))) return result;
        std::string row(header, n);

        for (uint32_t eye = 0; eye < projectionViews; ++eye) {
            const auto& view = eyes[eye].view;
            const auto submittedPose = numbers({
                view.pose.orientation.x, view.pose.orientation.y, view.pose.orientation.z, view.pose.orientation.w,
                view.pose.position.x, view.pose.position.y, view.pose.position.z});
            const auto submittedFov = numbers({
                view.fov.angleLeft, view.fov.angleRight, view.fov.angleUp, view.fov.angleDown});

            std::string locatedPose = "[]";
            std::string locatedFov = "[]";
            if (eye < snapshot.locatedViewCount) {
                const auto& located = snapshot.locatedViews[eye];
                locatedPose = numbers({
                    located.pose.orientation.x, located.pose.orientation.y, located.pose.orientation.z, located.pose.orientation.w,
                    located.pose.position.x, located.pose.position.y, located.pose.position.z});
                locatedFov = numbers({
                    located.fov.angleLeft, located.fov.angleRight, located.fov.angleUp, located.fov.angleDown});
            }

            char eyeJson[4096]{};
            n = snprintf(
                eyeJson, sizeof(eyeJson),
                "%s{\"eye\":%u,\"swapchain\":%llu,\"arrayIndex\":%u,"
                "\"rect\":[%d,%d,%d,%d],\"releaseSerial\":%llu,\"releasedImageIndex\":%u,"
                "\"releaseObserved\":%s,\"acquireToReleaseMs\":%.4f,\"waitToReleaseMs\":%.4f,"
                "\"releaseToEndMs\":%.4f,\"submittedPose\":%s,\"submittedFov\":%s,"
                "\"locatedPose\":%s,\"locatedFov\":%s}",
                eye ? "," : "",
                eye,
                reinterpret_cast<unsigned long long>(view.subImage.swapchain),
                view.subImage.imageArrayIndex,
                view.subImage.imageRect.offset.x, view.subImage.imageRect.offset.y,
                view.subImage.imageRect.extent.width, view.subImage.imageRect.extent.height,
                eyes[eye].releaseSerial, eyes[eye].releasedImage,
                eyes[eye].releaseObserved ? "true" : "false",
                qpcMs(eyes[eye].releasedQpc, eyes[eye].acquiredQpc),
                qpcMs(eyes[eye].releasedQpc, eyes[eye].waitedQpc),
                qpcMs(called, eyes[eye].releasedQpc),
                submittedPose.c_str(), submittedFov.c_str(),
                locatedPose.c_str(), locatedFov.c_str());
            if (n < 0 || n >= static_cast<int>(sizeof(eyeJson))) return result;
            row.append(eyeJson, n);
        }
        row += "]}\n";
        emit(row);
    } catch (...) {}

    return result;
}

extern "C" XrResult XRAPI_CALL telemetryDestroyInstance(XrInstance instance) {
    using namespace stephanos_vr;
    auto d = dispatchInstance(instance);
    const XrResult result = d->destroyInstance(instance);
    if (XR_SUCCEEDED(result)) {
        std::lock_guard<std::mutex> guard(stateMutex);
        instances.erase(instance);
    }
    {
        std::lock_guard<std::mutex> guard(outputMutex);
        if (output) fflush(output);
    }
    return result;
}

extern "C" XrResult XRAPI_CALL telemetryGipa(XrInstance instance, const char* name, PFN_xrVoidFunction* function) {
    using namespace stephanos_vr;
    std::shared_ptr<Dispatch> d;
    PFN_xrGetInstanceProcAddr raw{};
    {
        std::lock_guard<std::mutex> guard(stateMutex);
        auto it = instances.find(instance);
        if (it != instances.end()) d = it->second;
        raw = passThroughGipa;
    }
    if (!d) return raw ? raw(instance, name, function) : XR_ERROR_HANDLE_INVALID;
    const XrResult result = d->gipa(instance, name, function);
    if (XR_FAILED(result) || !function || !*function || !name) return result;

#define INTERCEPT(command, wrapper) if (strcmp(name, command) == 0) { *function = reinterpret_cast<PFN_xrVoidFunction>(wrapper); return result; }
    INTERCEPT("xrGetInstanceProcAddr", telemetryGipa)
    INTERCEPT("xrDestroyInstance", telemetryDestroyInstance)
    INTERCEPT("xrCreateSession", telemetryCreateSession)
    INTERCEPT("xrBeginSession", telemetryBeginSession)
    INTERCEPT("xrDestroySession", telemetryDestroySession)
    INTERCEPT("xrCreateSwapchain", telemetryCreateSwapchain)
    INTERCEPT("xrDestroySwapchain", telemetryDestroySwapchain)
    INTERCEPT("xrAcquireSwapchainImage", telemetryAcquireSwapchainImage)
    INTERCEPT("xrWaitSwapchainImage", telemetryWaitSwapchainImage)
    INTERCEPT("xrReleaseSwapchainImage", telemetryReleaseSwapchainImage)
    INTERCEPT("xrWaitFrame", telemetryWaitFrame)
    INTERCEPT("xrBeginFrame", telemetryBeginFrame)
    INTERCEPT("xrLocateViews", telemetryLocateViews)
    INTERCEPT("xrEndFrame", telemetryEndFrame)
#undef INTERCEPT
    return result;
}

extern "C" __declspec(dllexport) XrResult XRAPI_CALL xrNegotiateLoaderApiLayerInterface(
    const XrNegotiateLoaderInfo* loaderInfo,
    const char* layerName,
    XrNegotiateApiLayerRequest* request) {
    using namespace stephanos_vr;
    if (!loaderInfo || !request || !layerName ||
        strcmp(layerName, kLayerName) != 0 ||
        loaderInfo->structType != XR_LOADER_INTERFACE_STRUCT_LOADER_INFO ||
        loaderInfo->structVersion != XR_LOADER_INFO_STRUCT_VERSION ||
        loaderInfo->structSize != sizeof(*loaderInfo) ||
        request->structType != XR_LOADER_INTERFACE_STRUCT_API_LAYER_REQUEST ||
        request->structVersion != XR_API_LAYER_INFO_STRUCT_VERSION ||
        request->structSize != sizeof(*request) ||
        loaderInfo->minInterfaceVersion > 1 ||
        loaderInfo->maxInterfaceVersion < 1 ||
        loaderInfo->minApiVersion > XR_CURRENT_API_VERSION ||
        loaderInfo->maxApiVersion < XR_MAKE_VERSION(1, 0, 0)) {
        return XR_ERROR_INITIALIZATION_FAILED;
    }
    request->layerInterfaceVersion = 1;
    request->layerApiVersion = std::min(loaderInfo->maxApiVersion, XR_CURRENT_API_VERSION);
    request->getInstanceProcAddr = telemetryGipa;
    request->createApiLayerInstance = telemetryCreate;
    return XR_SUCCESS;
}
