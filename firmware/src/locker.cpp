#include "locker.h"

namespace locker {

Locker::Locker(LockOutput& output, std::uint32_t maxPulseMs)
    : output_(output), maxPulseMs_(maxPulseMs) {
  output_.setActive(false);
}

PulseResult Locker::requestPulse(std::uint32_t durationMs, std::uint32_t nowMs) {
  if (state_ == OutputState::Active) return PulseResult::Busy;
  if (durationMs == 0 || durationMs > maxPulseMs_)
    return PulseResult::InvalidDuration;
  startedAtMs_ = nowMs;
  durationMs_ = durationMs;
  state_ = OutputState::Active;
  output_.setActive(true);
  return PulseResult::Started;
}

void Locker::tick(std::uint32_t nowMs) {
  // Unsigned subtraction handles one wrap of the monotonic 32-bit clock.
  if (state_ == OutputState::Active &&
      static_cast<std::uint32_t>(nowMs - startedAtMs_) >= durationMs_) {
    stop();
  }
}

void Locker::stop() {
  state_ = OutputState::Inactive;
  output_.setActive(false);
}

}  // namespace locker
