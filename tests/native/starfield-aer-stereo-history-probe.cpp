// Independent C++23 behavior fixture, NOT a Starfield DLL or production patch.
// The real renderer still needs independently verified eye identity.
#include <array>
#include <cassert>
#include <cstdint>
#include <optional>
#include <unordered_map>

struct Snapshot { int frame; int camera; };
struct StereoHistory { std::array<std::optional<Snapshot>, 2> perEye{}; };
struct Result { bool eyeVerified; std::optional<Snapshot> prior; };

class HistoryProbe {
  std::unordered_map<std::uintptr_t, StereoHistory> history_;
public:
  Result update(std::uintptr_t block, std::optional<unsigned int> presentedEye,
                Snapshot current, bool reset = false) {
    // Parity alone is not physical-eye proof after repeated/skipped presentations.
    if (!presentedEye || *presentedEye > 1) return {false, std::nullopt};
    auto& slot = history_[block].perEye[*presentedEye];
    auto prior = reset ? std::nullopt : slot;
    slot = current;
    return {true, prior};
  }
  void resetRoute() { history_.clear(); }
};

int main() {
  HistoryProbe probe;
  const auto left0 = probe.update(0x1000, 0u, {10, 1});
  const auto right0 = probe.update(0x1000, 1u, {11, 2});
  assert(left0.eyeVerified && !left0.prior);
  assert(right0.eyeVerified && !right0.prior);
  const auto left1 = probe.update(0x1000, 0u, {12, 3});
  const auto right1 = probe.update(0x1000, 1u, {13, 4});
  assert(left1.prior && left1.prior->frame == 10);
  assert(right1.prior && right1.prior->frame == 11);
  assert(!probe.update(0x1000, std::nullopt, {14, 5}).eyeVerified);
  assert(!probe.update(0x1000, 9u, {14, 5}).eyeVerified);
  const auto left2 = probe.update(0x1000, 0u, {15, 6});
  assert(left2.prior && left2.prior->frame == 12);
  const auto right2 = probe.update(0x1000, 1u, {16, 7});
  assert(right2.prior && right2.prior->frame == 13);
  const auto leftReset = probe.update(0x1000, 0u, {17, 8}, true);
  const auto right3 = probe.update(0x1000, 1u, {18, 9});
  assert(!leftReset.prior && right3.prior && right3.prior->frame == 16);
  const auto leftNext = probe.update(0x1000, 0u, {19, 10});
  assert(leftNext.prior && leftNext.prior->frame == 17);
  assert(!probe.update(0x2000, 0u, {20, 11}).prior);
  probe.resetRoute();
  assert(!probe.update(0x1000, 0u, {21, 12}).prior);
  return 0;
}
