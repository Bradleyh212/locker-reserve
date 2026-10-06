#pragma once

#include <cstdint>

namespace locker {

// Output state deliberately makes no claim about the physical latch or door.
enum class OutputState { Inactive, Active };
enum class DoorState { Unknown, Open, Closed };
enum class PulseResult { Started, Busy, InvalidDuration };

class LockOutput {
 public:
  virtual ~LockOutput() = default;
  virtual void setActive(bool active) = 0;
};

// Single-threaded actuator primitive. Authorization/deduplication belong above it.
// Caller supplies monotonic milliseconds and must call tick frequently.
class Locker {
 public:
  Locker(LockOutput& output, std::uint32_t maxPulseMs);
  Locker(const Locker&) = delete;
  Locker& operator=(const Locker&) = delete;

  PulseResult requestPulse(std::uint32_t durationMs, std::uint32_t nowMs);
  void tick(std::uint32_t nowMs);
  void stop();
  OutputState outputState() const { return state_; }
  DoorState doorState() const { return DoorState::Unknown; }

 private:
  LockOutput& output_;
  const std::uint32_t maxPulseMs_;
  OutputState state_ = OutputState::Inactive;
  std::uint32_t startedAtMs_ = 0;
  std::uint32_t durationMs_ = 0;
};

}  // namespace locker
