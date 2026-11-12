#pragma once
#include "door_sensor.h"

namespace locker {
// Single-flight scheduling. Only the latest sampled level matters; an old
// CLOSED observation must never be replayed when the network comes back.
class DoorHeartbeat {
 public:
  void disconnected() { resync_ = true; }
  bool due(DoorState current, bool fresh, std::uint32_t now) const {
    const auto elapsed = now - attemptedAt_;
    if (!attempted_) return true;
    if (elapsed >= 5000) return true;  // periodic fallback, including failures
    return accepted_ && elapsed >= 500 && (resync_ || (fresh && current != reported_));
  }
  void attempted(std::uint32_t now, DoorState reported, bool accepted) {
    attemptedAt_ = now;
    attempted_ = true;
    accepted_ = accepted;
    reported_ = reported;
    resync_ = false;
  }
 private:
  std::uint32_t attemptedAt_ = 0;
  DoorState reported_ = DoorState::Unknown;
  bool attempted_ = false, accepted_ = false, resync_ = false;
};
} // namespace locker
