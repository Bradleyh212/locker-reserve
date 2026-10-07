#include <iostream>

#include "fake_lock_output.h"
#include "locker.h"

int main() {
  locker::FakeLockOutput output;
  // Simulation-only values, not approved solenoid timings.
  locker::Locker controller(output, 1000);
  std::cout << "Simulation: output inactive; door unknown\n";
  const auto result = controller.requestPulse(500, 0);
  if (result != locker::PulseResult::Started) return 1;
  std::cout << "Simulation: output active\n";
  controller.tick(499);
  if (!output.active()) return 1;
  controller.tick(500);
  std::cout << "Simulation: deadline reached; output inactive; door unknown\n";
  return output.active() ? 1 : 0;
}
