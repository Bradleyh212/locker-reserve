#include "door_heartbeat.h"
#include <algorithm>
#include <cassert>
#include <iostream>
#include <vector>

using namespace locker;
int main() {
  DoorHeartbeat policy;
  DoorSensor reed;
  auto due = [&](unsigned now) { return policy.due(reed.state(now), reed.fresh(now), now); };
  reed.sample(true, 0);
  reed.sample(true, 50);
  assert(due(50));
  policy.attempted(50, DoorState::Closed, true);
  reed.sample(false, 100);
  reed.sample(true, 115);
  reed.sample(false, 120);
  reed.sample(false, 170);
  assert(reed.state(170) == DoorState::Open && !due(170));
  reed.sample(false, 550);
  reed.sample(false, 600);
  assert(due(600));
  policy.attempted(600, DoorState::Open, false);
  reed.sample(true, 620);
  reed.sample(true, 670);
  assert(!due(670) && !due(5599) && due(5600));
  policy.attempted(5600, DoorState::Closed, true);
  policy.disconnected();
  assert(!due(5700) && due(6100));
  policy.attempted(6100, DoorState::Unknown, true);
  reed.sample(false, 6200);
  reed.sample(false, 6250);
  reed.sample(false, 6500);
  reed.sample(false, 6600);
  assert(due(6600));
  // Sweep independent physical transition and dashboard refresh phases.
  // Advance a virtual clock, with no TLS latency or active pulse.
  for (bool expedited : {false, true}) {
    std::vector<int> delays;
    for (int edge = 100; edge < 5100; edge += 50) {
      DoorHeartbeat cadence;
      DoorSensor sensor;
      cadence.attempted(0, DoorState::Closed, true);
      for (int t = 0; ; ++t) {
        sensor.sample(t < edge, t);
        if (expedited ? !cadence.due(sensor.state(t), sensor.fresh(t), t) : t % 5000 != 0) continue;
        cadence.attempted(t, sensor.state(t), true);
        if (sensor.state(t) != DoorState::Open) continue;
        const int visible = t + 55; // existing refreshSensor before HTTP
        for (int phase = 0; phase < 3000; phase += 50)
          delays.push_back(visible - edge + (phase - visible % 3000 + 3000) % 3000);
        break;
      }
    }
    std::sort(delays.begin(), delays.end());
    std::cout << (expedited ? "Transition" : "Periodic") << " simulated dashboard ms: median "
              << delays[delays.size()/2] << ", p95 " << delays[delays.size()*95/100]
              << ", max " << delays.back() << '\n';
  }
}
