#define STEPHANOS_OPENXR_TELEMETRY_TEST
#include "stephanos-openxr-telemetry-layer.cpp"
#include <cassert>
#include <filesystem>
#include <fstream>
#include <iostream>

namespace mock {
XrInstance instance = reinterpret_cast<XrInstance>(1);
XrSession session = reinterpret_cast<XrSession>(2);
uint64_t nextSwapchain = 3;
uint32_t image = 0;
XrResult endResult = XR_SUCCESS;
const XrFrameEndInfo* receivedFrame{};

XrResult XRAPI_CALL create(const XrInstanceCreateInfo*, const XrApiLayerCreateInfo*, XrInstance* out) { *out = instance; return XR_SUCCESS; }
XrResult XRAPI_CALL destroyInstance(XrInstance) { return XR_SUCCESS; }
XrResult XRAPI_CALL createSession(XrInstance, const XrSessionCreateInfo*, XrSession* out) { *out = session; return XR_SUCCESS; }
XrResult XRAPI_CALL destroySession(XrSession) { return XR_SUCCESS; }
XrResult XRAPI_CALL beginSession(XrSession, const XrSessionBeginInfo*) { return XR_SUCCESS; }
XrResult XRAPI_CALL createSwapchain(XrSession, const XrSwapchainCreateInfo*, XrSwapchain* out) { *out = reinterpret_cast<XrSwapchain>(nextSwapchain++); return XR_SUCCESS; }
XrResult XRAPI_CALL destroySwapchain(XrSwapchain) { return XR_SUCCESS; }
XrResult XRAPI_CALL acquire(XrSwapchain, const XrSwapchainImageAcquireInfo*, uint32_t* out) { *out = image++; return XR_SUCCESS; }
XrResult XRAPI_CALL waitSwapchain(XrSwapchain, const XrSwapchainImageWaitInfo*) { return XR_SUCCESS; }
XrResult XRAPI_CALL release(XrSwapchain, const XrSwapchainImageReleaseInfo*) { return XR_SUCCESS; }
XrResult XRAPI_CALL waitFrame(XrSession, const XrFrameWaitInfo*, XrFrameState* state) {
    state->predictedDisplayTime = 1000000000;
    state->predictedDisplayPeriod = 13888888;
    state->shouldRender = XR_TRUE;
    return XR_SUCCESS;
}
XrResult XRAPI_CALL beginFrame(XrSession, const XrFrameBeginInfo*) { return XR_SUCCESS; }
XrResult XRAPI_CALL locate(XrSession, const XrViewLocateInfo* info, XrViewState* state, uint32_t capacity, uint32_t* count, XrView* views) {
    state->viewStateFlags = XR_VIEW_STATE_ORIENTATION_VALID_BIT | XR_VIEW_STATE_POSITION_VALID_BIT;
    *count = 2;
    if (capacity >= 2 && views) {
        for (uint32_t i = 0; i < 2; ++i) {
            views[i].type = XR_TYPE_VIEW;
            views[i].pose.orientation.w = 1.0f;
            views[i].pose.position.x = static_cast<float>(i) * 0.064f;
            views[i].fov = {-0.8f, 0.8f, 0.8f, -0.8f};
        }
    }
    return info ? XR_SUCCESS : XR_ERROR_VALIDATION_FAILURE;
}
XrResult XRAPI_CALL end(XrSession, const XrFrameEndInfo* frame) { receivedFrame = frame; return endResult; }
XrResult XRAPI_CALL dummy() { return XR_SUCCESS; }

XrResult XRAPI_CALL gipa(XrInstance, const char* name, PFN_xrVoidFunction* function) {
#define MAP(command, fn) if (strcmp(name, command) == 0) { *function = reinterpret_cast<PFN_xrVoidFunction>(fn); return XR_SUCCESS; }
    MAP("xrDestroyInstance", destroyInstance)
    MAP("xrCreateSession", createSession)
    MAP("xrBeginSession", beginSession)
    MAP("xrDestroySession", destroySession)
    MAP("xrCreateSwapchain", createSwapchain)
    MAP("xrDestroySwapchain", destroySwapchain)
    MAP("xrAcquireSwapchainImage", acquire)
    MAP("xrWaitSwapchainImage", waitSwapchain)
    MAP("xrReleaseSwapchainImage", release)
    MAP("xrWaitFrame", waitFrame)
    MAP("xrBeginFrame", beginFrame)
    MAP("xrLocateViews", locate)
    MAP("xrEndFrame", end)
    MAP("xrUnmodifiedExtension", dummy)
#undef MAP
    *function = nullptr;
    return XR_ERROR_FUNCTION_UNSUPPORTED;
}
}

int main() {
    wchar_t tempPath[MAX_PATH]{};
    GetTempPathW(MAX_PATH, tempPath);
    std::filesystem::path trace = std::filesystem::path(tempPath) / L"stephanos-openxr-telemetry-test.jsonl";
    std::error_code ec;
    std::filesystem::remove(trace, ec);
    SetEnvironmentVariableW(L"STEPHANOS_VR_TELEMETRY_TRACE_PATH", trace.c_str());
    SetEnvironmentVariableA("STEPHANOS_VR_TELEMETRY_LAUNCH_SESSION_ID", "test-launch");
    SetEnvironmentVariableA("STEPHANOS_VR_TELEMETRY_GAME_ID", "test-game");

    XrNegotiateLoaderInfo loader{
        XR_LOADER_INTERFACE_STRUCT_LOADER_INFO, 1, sizeof(XrNegotiateLoaderInfo),
        1, 1, XR_MAKE_VERSION(1, 0, 0), XR_CURRENT_API_VERSION};
    XrNegotiateApiLayerRequest request{
        XR_LOADER_INTERFACE_STRUCT_API_LAYER_REQUEST, 1, sizeof(XrNegotiateApiLayerRequest)};
    assert(xrNegotiateLoaderApiLayerInterface(&loader, "wrong", &request) == XR_ERROR_INITIALIZATION_FAILED);
    assert(xrNegotiateLoaderApiLayerInterface(&loader, stephanos_vr::kLayerName, &request) == XR_SUCCESS);

    XrApiLayerNextInfo next{};
    strcpy_s(next.layerName, stephanos_vr::kLayerName);
    next.nextGetInstanceProcAddr = mock::gipa;
    next.nextCreateApiLayerInstance = mock::create;
    XrApiLayerCreateInfo chain{};
    chain.nextInfo = &next;
    XrInstance instance{};
    XrInstanceCreateInfo instanceInfo{XR_TYPE_INSTANCE_CREATE_INFO};
    assert(telemetryCreate(&instanceInfo, &chain, &instance) == XR_SUCCESS);

    PFN_xrVoidFunction original{}, observed{};
    mock::gipa(instance, "xrUnmodifiedExtension", &original);
    assert(telemetryGipa(instance, "xrUnmodifiedExtension", &observed) == XR_SUCCESS && original == observed);
    assert(telemetryGipa(instance, "xrEndFrame", &observed) == XR_SUCCESS &&
           observed == reinterpret_cast<PFN_xrVoidFunction>(telemetryEndFrame));

    XrSession session{};
    XrSessionCreateInfo sessionInfo{XR_TYPE_SESSION_CREATE_INFO};
    assert(telemetryCreateSession(instance, &sessionInfo, &session) == XR_SUCCESS);
    XrSessionBeginInfo beginSessionInfo{XR_TYPE_SESSION_BEGIN_INFO};
    beginSessionInfo.primaryViewConfigurationType = XR_VIEW_CONFIGURATION_TYPE_PRIMARY_STEREO;
    assert(telemetryBeginSession(session, &beginSessionInfo) == XR_SUCCESS);

    XrSwapchain left{}, right{};
    XrSwapchainCreateInfo swapInfo{XR_TYPE_SWAPCHAIN_CREATE_INFO};
    assert(telemetryCreateSwapchain(session, &swapInfo, &left) == XR_SUCCESS);
    assert(telemetryCreateSwapchain(session, &swapInfo, &right) == XR_SUCCESS);

    XrFrameWaitInfo waitInfo{XR_TYPE_FRAME_WAIT_INFO};
    XrFrameState frameState{XR_TYPE_FRAME_STATE};
    assert(telemetryWaitFrame(session, &waitInfo, &frameState) == XR_SUCCESS);
    XrFrameBeginInfo beginInfo{XR_TYPE_FRAME_BEGIN_INFO};
    assert(telemetryBeginFrame(session, &beginInfo) == XR_SUCCESS);

    XrViewLocateInfo locateInfo{XR_TYPE_VIEW_LOCATE_INFO};
    locateInfo.displayTime = 1000000000;
    XrViewState viewState{XR_TYPE_VIEW_STATE};
    XrView located[2]{{XR_TYPE_VIEW}, {XR_TYPE_VIEW}};
    uint32_t locatedCount{};
    assert(telemetryLocateViews(session, &locateInfo, &viewState, 2, &locatedCount, located) == XR_SUCCESS);

    XrSwapchainImageAcquireInfo acquireInfo{XR_TYPE_SWAPCHAIN_IMAGE_ACQUIRE_INFO};
    XrSwapchainImageWaitInfo swapWait{XR_TYPE_SWAPCHAIN_IMAGE_WAIT_INFO};
    swapWait.timeout = XR_INFINITE_DURATION;
    XrSwapchainImageReleaseInfo releaseInfo{XR_TYPE_SWAPCHAIN_IMAGE_RELEASE_INFO};
    uint32_t index{};
    for (XrSwapchain swapchain : {left, right}) {
        assert(telemetryAcquireSwapchainImage(swapchain, &acquireInfo, &index) == XR_SUCCESS);
        assert(telemetryWaitSwapchainImage(swapchain, &swapWait) == XR_SUCCESS);
        assert(telemetryReleaseSwapchainImage(swapchain, &releaseInfo) == XR_SUCCESS);
    }

    XrCompositionLayerProjectionView eyeViews[2]{
        {XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW},
        {XR_TYPE_COMPOSITION_LAYER_PROJECTION_VIEW}};
    for (auto& view : eyeViews) {
        view.pose.orientation.w = 1.0f;
        view.subImage.imageRect.extent = {100, 100};
    }
    eyeViews[0].subImage.swapchain = left;
    eyeViews[1].subImage.swapchain = right;
    XrCompositionLayerProjection projection{XR_TYPE_COMPOSITION_LAYER_PROJECTION};
    projection.viewCount = 2;
    projection.views = eyeViews;
    const XrCompositionLayerBaseHeader* layers[]{
        reinterpret_cast<const XrCompositionLayerBaseHeader*>(&projection)};
    XrFrameEndInfo endInfo{XR_TYPE_FRAME_END_INFO};
    endInfo.displayTime = 1000000000;
    endInfo.layerCount = 1;
    endInfo.layers = layers;

    assert(telemetryEndFrame(session, &endInfo) == XR_SUCCESS);
    assert(mock::receivedFrame == &endInfo);

    projection.viewCount = 1;
    assert(telemetryEndFrame(session, &endInfo) == XR_SUCCESS);
    projection.viewCount = 2;
    mock::endResult = XR_ERROR_RUNTIME_FAILURE;
    assert(telemetryEndFrame(session, &endInfo) == XR_ERROR_RUNTIME_FAILURE);
    mock::endResult = XR_SUCCESS;

    telemetryDestroySwapchain(left);
    telemetryDestroySwapchain(right);
    telemetryDestroySession(session);
    telemetryDestroyInstance(instance);

    {
        std::lock_guard<std::mutex> guard(stephanos_vr::outputMutex);
        if (stephanos_vr::output) {
            fflush(stephanos_vr::output);
            fclose(stephanos_vr::output);
            stephanos_vr::output = nullptr;
        }
    }

    std::ifstream input(trace);
    std::string all((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    assert(all.find("\"event\":\"observer_ready\"") != std::string::npos);
    assert(all.find("\"visualFrameState\":\"SUBMISSION_PRESENT_PIXELS_UNOBSERVED\"") != std::string::npos);
    assert(all.find("\"visualFrameState\":\"MISSING_STEREO_EYE\"") != std::string::npos);
    assert(all.find("\"visualFrameState\":\"END_FRAME_FAILURE\"") != std::string::npos);
    assert(all.find("\"eyePresentationSkewMs\"") != std::string::npos);
    assert(all.find("\"poseDisplayDeltaMs\"") != std::string::npos);

    std::cout << "{\"passed\":true,\"gameLaunched\":false,\"frameMutation\":false,"
                 "\"stereoSubmission\":true,\"missingEyeDetection\":true,\"endFrameFailureDetection\":true}\n";
    std::filesystem::remove(trace, ec);
    return 0;
}
