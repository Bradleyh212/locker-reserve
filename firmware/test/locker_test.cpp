#include <cassert>
#include <cstdint>
#include <iostream>
#include <limits>

#include "fake_lock_output.h"
#include "locker.h"
#include "door_sensor.h"

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
  FakeLockOutput cappedOutput;
  Locker capped(cappedOutput, 10000); // Even misconfigured callers cannot exceed hard cap.
  assert(capped.requestPulse(5001, 0) == PulseResult::InvalidDuration);
  assert(capped.requestPulse(5000, 0) == PulseResult::Started);
  capped.tick(4999);
  assert(cappedOutput.active());
  capped.tick(5000);
  assert(!cappedOutput.active());

  DoorSensor sensor;
  assert(sensor.state(0) == DoorState::Unknown);
  assert(!sensor.canUnlock(0));
  sensor.sample(true, 0);
  sensor.sample(true, 49);
  assert(sensor.state(49) == DoorState::Unknown);
  sensor.sample(true, 50);
  assert(sensor.state(50) == DoorState::Closed && sensor.canUnlock(50));
  for (unsigned t = 100; t <= 1000; t += 50) {
    sensor.sample(true, t);
    assert(sensor.state(t) == DoorState::Closed && sensor.canUnlock(t));
  }
  // HTTPS pause preserves last observation but never grants stale permission.
  assert(sensor.state(3000) == DoorState::Closed);
  assert(!sensor.canUnlock(3000));
  sensor.sample(true, 3000);
  assert(!sensor.canUnlock(3000));
  sensor.sample(true, 3050);
  assert(sensor.canUnlock(3050));
  sensor.sample(false, 3051);
  assert(!sensor.canUnlock(3051)); // Opening raw signal immediately inhibits output.
  sensor.sample(true, 3060);
  sensor.sample(false, 3070);
  assert(sensor.state(3070) == DoorState::Closed); // Last debounced state, not UNKNOWN.
  assert(!sensor.canUnlock(3070));
  sensor.sample(false, 3120);
  assert(sensor.state(3120) == DoorState::Open && !sensor.canUnlock(3120));
  sensor.sample(false, 9000);
  assert(sensor.state(9000) == DoorState::Open);
  sensor.sample(false, 9050);
  assert(sensor.state(9050) == DoorState::Open);
  DoorSensor openAtBoot;
  openAtBoot.sample(false, 0);
  assert(openAtBoot.state(0) == DoorState::Unknown);
  openAtBoot.sample(false, 50);
  assert(openAtBoot.state(50) == DoorState::Open);
  DoorSensor wrap;
  wrap.sample(true, UINT32_MAX - 30);
  wrap.sample(true, 20);
  assert(wrap.canUnlock(20));

  std::cout << "PASS: boot reset, limits, busy deadline, clock wrap, late tick, stop, unknown door\n";
}
