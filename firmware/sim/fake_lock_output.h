#pragma once

#include "locker.h"

namespace locker {

class FakeLockOutput final : public LockOutput {
 public:
  void setActive(bool active) override {
    if (active && !active_) ++activationCount_;
    active_ = active;
  }
  bool active() const { return active_; }
  unsigned activationCount() const { return activationCount_; }

 private:
  bool active_ = false;
  unsigned activationCount_ = 0;
};

}  // namespace locker
