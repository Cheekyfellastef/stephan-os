// Goal #2707: execute the original native source/readiness regression suite in
// the existing shared-agent CI job. The prior successful workflow did not run
// scripts/*.test.mjs, so its green status did not qualify native-build probes.
// This imports existing tests without changing their implementation, running
// Git/C++ fixtures only in disposable hosted-runner directories. No game access.
import '../../scripts/starfield-vr-aer-native-build-readiness.test.mjs';
