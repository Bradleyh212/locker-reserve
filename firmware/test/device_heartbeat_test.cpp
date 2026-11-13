#include "device_diagnostics.h"
#include "door_heartbeat.h"
#include <cassert>
#include <iostream>

int main() {
  locker::DeviceDiagnostics diagnostics;
  locker::DoorHeartbeat heartbeat;
  diagnostics.observeWifi(true);
  assert(!diagnostics.canPoll(true));  // Every boot requires acceptance.
  auto acknowledge = [&](unsigned now, locker::DoorState door, int status, bool accepted, bool ignored) {
    diagnostics.acknowledgeHeartbeat(status, accepted, ignored);
    heartbeat.attempted(now, door, diagnostics.heartbeatAccepted);
  };
  acknowledge(0, locker::DoorState::Closed, 200, true, false);
  assert(diagnostics.canPoll(true) && !diagnostics.canPoll(false));
  assert(!heartbeat.due(locker::DoorState::Open, true, 499));
  assert(heartbeat.due(locker::DoorState::Open, true, 500));

  // An ignored, malformed, negative or failed acknowledgement closes the
  // command gate and keeps the periodic retry, even after another transition.
  for (int scenario = 0; scenario < 4; ++scenario) {
    acknowledge(1000, locker::DoorState::Open, scenario == 3 ? 500 : 200,
                scenario != 1 && scenario != 2, scenario == 0);
    assert(!diagnostics.canPoll(true));
    assert(!heartbeat.due(locker::DoorState::Closed, true, 1500));
    assert(!heartbeat.due(locker::DoorState::Closed, true, 5999));
    assert(heartbeat.due(locker::DoorState::Closed, true, 6000));
  }
  acknowledge(6000, locker::DoorState::Closed, 200, true, false);
  diagnostics.observeWifi(false);
  heartbeat.disconnected();
  assert(!diagnostics.canPoll(true) && diagnostics.wifiDisconnects == 1);
  diagnostics.observeWifi(true);
  assert(!diagnostics.canPoll(true));
  assert(heartbeat.due(locker::DoorState::Open, true, 6500));
  acknowledge(6500, locker::DoorState::Open, 200, true, false);
  assert(diagnostics.canPoll(true));
  assert(!heartbeat.due(locker::DoorState::Open, true, 11499));
  assert(heartbeat.due(locker::DoorState::Open, true, 11500));
  locker::DeviceDiagnostics reboot;
  reboot.observeWifi(true);
  assert(!reboot.canPoll(true));
  std::cout << "Combined heartbeat acknowledgement, reconnect and polling tests passed\n";
}
