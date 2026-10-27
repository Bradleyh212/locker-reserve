#pragma once
#include "locker.h"
namespace locker {
// Preserve the last debounced observation across communication gaps. Freshness
// is a separate authorization condition, not a reason to erase contact state.
class DoorSensor {
 public:
  void sample(bool closed, std::uint32_t now) {
    if (!initialized_ || now - sampledAt_ > 250 || closed != rawClosed_) {
      changedAt_ = now;
      settling_ = true;
    }
    initialized_ = true;
    rawClosed_ = closed;
    sampledAt_ = now;
    if (now - changedAt_ >= 50) {
      stable_ = closed ? DoorState::Closed : DoorState::Open;
      settling_ = false;
    }
  }
  DoorState state(std::uint32_t) const { return stable_; }
  bool fresh(std::uint32_t now) const {
    return initialized_ && !settling_ && now - sampledAt_ <= 250;
  }
  bool canUnlock(std::uint32_t now) const {
    return fresh(now) && rawClosed_ && stable_ == DoorState::Closed;
  }
 private:
  bool initialized_ = false, settling_ = true, rawClosed_ = false;
  DoorState stable_ = DoorState::Unknown;
  std::uint32_t changedAt_ = 0, sampledAt_ = 0;
};
}
