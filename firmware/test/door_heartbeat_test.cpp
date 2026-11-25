#include "door_heartbeat.h"
#include <algorithm>
#include <cassert>
#include <iostream>

using namespace locker;

int main() {
  // An eight-second command GET occupies the network loop. Advance the
  // independent GPIO task for every possible edge phase within its 10 ms tick.
  unsigned minimum = 100, maximum = 0;
  unsigned minAck = 8300, maxAck = 0;
  for (unsigned phase = 0; phase < 10; ++phase) {
    DoorSensor reed;
    DoorHeartbeat reports;
    const unsigned edge = 1000 + phase;
    for (unsigned t = 0; t <= 8000; t += 10) {
      reed.sample(t < edge, t);
      if (t == 100) reports.attempted(t, DoorState::Closed, true);
      if (t >= edge) assert(!reed.canUnlock(t));
    }
    assert(reed.state(8000) == DoorState::Open && reed.sequence() == 2);
    const unsigned latency = reed.stableAt() - edge;
    assert(latency >= 50 && latency <= 59);
    minimum = std::min(minimum, latency);
    maximum = std::max(maximum, latency);
    assert(reports.due(reed.state(8000), reed.fresh(8000), 8000));
    // The OPEN POST takes 300 ms. CLOSED is detected while it is in flight.
    const DoorSensor sent = reed;
    for (unsigned t = 8010; t <= 8300; t += 10) reed.sample(true, t);
    minAck = std::min(minAck, 8300 - edge);
    maxAck = std::max(maxAck, 8300 - edge);
    reports.attempted(8000, sent.state(8000), true);
    assert(reed.stableAt() == 8060 && reed.canUnlock(8300));
    assert(reports.due(reed.state(8300), reed.fresh(8300), 8300));
  }
  std::cout << "8 s blocked GET: local detection " << minimum << "-" << maximum
            << " ms; simulated edge-to-OPEN ACK " << minAck << "-" << maxAck << " ms (300 ms POST)\n";

  DoorSensor reed;
  DoorHeartbeat reports;
  reed.sample(true, 0);
  reed.sample(true, 50);
  reports.attempted(50, DoorState::Closed, false);
  reports.disconnected();
  // Bounce and multiple stable transitions while disconnected. Only latest
  // stable OPEN is eligible on recovery, even after a failed prior attempt.
  for (unsigned t = 60; t <= 500; t += 10) {
    bool closed = (t == 70 || (t >= 200 && t < 300));
    reed.sample(closed, t);
    if (t < 130 || t >= 300) assert(!reed.canUnlock(t));
    if (t == 250) assert(reed.canUnlock(t));
  }
  assert(reed.sequence() == 4 && reed.state(500) == DoorState::Open);
  assert(reports.due(reed.state(500), reed.fresh(500), 500));
  reports.attempted(500, DoorState::Open, false);
  assert(!reports.due(DoorState::Closed, true, 5499));
  assert(reports.due(DoorState::Closed, true, 5500));
  reed.sample(true, 5500);
  assert(!reed.fresh(5500) && !reed.canUnlock(5500));
  reed.sample(true, 5550);
  assert(reed.canUnlock(5550));
  assert(!reed.canUnlock(5801));
  std::cout << "Reconnect, bounce, coalescing and stalled-sampler checks passed\n";
}
