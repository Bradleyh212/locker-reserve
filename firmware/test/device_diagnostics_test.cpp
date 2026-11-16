#include "device_diagnostics.h"
#include <cassert>
#include <initializer_list>
int main() {
  locker::DeviceDiagnostics d;
  assert(!d.heartbeatAccepted);
  d.heartbeatAccepted = true;
  d.observeWifi(false); d.observeWifi(false);
  assert(!d.heartbeatAccepted);
  assert(d.wifiDisconnects == 0);
  d.observeWifi(true); d.observeWifi(false); d.observeWifi(false);
  assert(d.wifiDisconnects == 1);
  d.observeWifi(true); d.observeWifi(false);
  assert(d.wifiDisconnects == 2);
  for (int code : {200, 204}) d.observeHttp(code);
  assert(d.communicationFailures == 0);
  for (int code : {-1, 401, 500}) d.observeHttp(code);
  assert(d.communicationFailures == 3);
  d.communicationFailures = INT32_MAX;
  d.observeHttp(-1);
  assert(d.communicationFailures == INT32_MAX);
  locker::DeviceDiagnostics reboot;
  assert(reboot.communicationFailures == 0 && reboot.wifiDisconnects == 0);
}
