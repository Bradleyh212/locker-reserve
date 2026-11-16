#pragma once
#include <cstdint>
#include <climits>

namespace locker {
// RAM-only counters for a single boot. No flash writes or network work in this helper.
struct DeviceDiagnostics {
  uint32_t wifiDisconnects = 0;
  uint32_t communicationFailures = 0;
  bool connected = false;
  bool heartbeatAccepted = false;
  static void increment(uint32_t& value) { if (value < INT32_MAX) ++value; }
  void observeWifi(bool nowConnected) {
    if (connected && !nowConnected) increment(wifiDisconnects);
    connected = nowConnected;
    if (!connected) heartbeatAccepted = false;
  }
  void acknowledgeHeartbeat(int status, bool accepted, bool ignored) {
    heartbeatAccepted = status == 200 && accepted && !ignored;
  }
  bool canPoll(bool storageReady) const {
    return connected && heartbeatAccepted && storageReady;
  }
  int observeHttp(int status) {
    if (status < 200 || status >= 300) increment(communicationFailures);
    return status;
  }
};
}
