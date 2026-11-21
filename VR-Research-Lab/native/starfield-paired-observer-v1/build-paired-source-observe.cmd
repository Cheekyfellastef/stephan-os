@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0" || exit /b 1
set "CL="
set "_CL_="
set "LINK="
set "_LINK_="
if not defined STEPH_OBSERVER_EXPECTED_CL exit /b 2
if /I not "%VCToolsInstallDir%bin\Hostx64\x64\cl.exe"=="%STEPH_OBSERVER_EXPECTED_CL%" exit /b 3
set "STEPH_OBSERVE_DEFINES=/DSTEPH_DUAL_VIEW_PROBE /DSTEPH_OUTPUT_MAP_PROBE /DSTEPH_PAIRED_OUTPUT_PROBE /DSTEPH_VIEW_RESOURCE_AUDIT /DSTEPH_VIEW_BINDING_AUDIT /DSTEPH_NATIVE_EYE_OUTPUT /DSTEPH_PAIRED_SOURCE_OBSERVE"
"%STEPH_OBSERVER_EXPECTED_CL%" /nologo /std:c++20 /EHsc /MD /W4 /WX /O2 test-scoped-eye-ledger.cpp /Fetest-scoped-eye-ledger.exe || exit /b 1
test-scoped-eye-ledger.exe || exit /b 1
"%STEPH_OBSERVER_EXPECTED_CL%" /nologo /std:c++20 /EHsc /MD /W4 /WX /O2 test-paired-scoped-eye-ledger.cpp /Fetest-paired-scoped-eye-ledger.exe || exit /b 1
test-paired-scoped-eye-ledger.exe || exit /b 1
"%STEPH_OBSERVER_EXPECTED_CL%" /nologo /std:c++20 /EHsc /MD /W4 /WX /O2 test-paired-source-observation.cpp /Fetest-paired-source-observation.exe || exit /b 1
test-paired-source-observation.exe || exit /b 1
"%STEPH_OBSERVER_EXPECTED_CL%" /nologo /std:c++20 /EHsc /MD /W4 /WX /O2 /guard:cf %STEPH_OBSERVE_DEFINES% /DSTEPH_NATIVE_TRACE_SELF_TEST /Ivendor\minhook\include native-boundary-trace.cpp /Fonative-paired-source-observe-test.obj /Fenative-paired-source-observe-test.exe /link /guard:cf bcrypt.lib d3d12.lib vendor\minhook\minhook.x64.lib || exit /b 1
native-paired-source-observe-test.exe || exit /b 1
"%STEPH_OBSERVER_EXPECTED_CL%" /nologo /LD /std:c++20 /EHsc /MD /W4 /WX /O2 /guard:cf %STEPH_OBSERVE_DEFINES% /Ivendor\minhook\include native-boundary-trace.cpp /Fonative-paired-source-observe.obj /Fenative-paired-source-observe.dll /link /guard:cf bcrypt.lib d3d12.lib vendor\minhook\minhook.x64.lib || exit /b 1
echo STEPHANOS_PAIRED_OBSERVER_BUILD_PASSED
exit /b 0
