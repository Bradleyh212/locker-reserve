#include <cassert>
#include <cstdint>
#include <iostream>
#include <limits>

#include "fake_lock_output.h"
#include "locker.h"

int main() {
  using namespace locker;
  FakeLockOutput output;
  output.setActive(true);
  Locker controller(output, 1000);
  assert(!output.active());  // Construction resets an already-active adapter.
  assert(controller.outputState() == OutputState::Inactive);
  assert(controller.doorState() == DoorState::Unknown);

  assert(controller.requestPulse(0, 0) == PulseResult::InvalidDuration);
  assert(controller.requestPulse(1001, 0) == PulseResult::InvalidDuration);
  assert(!output.active());

  assert(controller.requestPulse(500, 100) == PulseResult::Started);
  const auto activations = output.activationCount();
  assert(controller.requestPulse(1000, 400) == PulseResult::Busy);
  assert(output.activationCount() == activations);
  controller.tick(599);
  assert(output.active());
  controller.tick(600);  // Busy request must not extend the original deadline.
  assert(!output.active());
  assert(controller.outputState() == OutputState::Inactive);

  const auto nearWrap = std::numeric_limits<std::uint32_t>::max() - 99;
  assert(controller.requestPulse(200, nearWrap) == PulseResult::Started);
  controller.tick(99);
  assert(output.active());
  controller.tick(100);
  assert(!output.active());

  assert(controller.requestPulse(1000, 1000) == PulseResult::Started);
  controller.tick(2500);  // Late scheduling shuts off at the first tick.
  assert(!output.active());
  assert(controller.requestPulse(1, 2500) == PulseResult::Started);
  controller.stop();
  controller.stop();
  assert(!output.active());
  assert(controller.doorState() == DoorState::Unknown);

  FakeLockOutput disabledOutput;
  Locker disabled(disabledOutput, 0);
  assert(disabled.requestPulse(1, 0) == PulseResult::InvalidDuration);
  assert(!disabledOutput.active());
  std::cout << "PASS: boot reset, limits, busy deadline, clock wrap, late tick, stop, unknown door\n";
}
