#include "device_protocol.h"
#include <cassert>
#include <cstdlib>
#include <ctime>
#include <iostream>
using namespace locker::protocol;
int main() {
  for (const char* zone : {"UTC0", "EST5EDT", "JST-9"}) {
    setenv("TZ", zone, 1); tzset();
    assert(timestamp("2026-01-01T00:00:00.123Z") == 1767225600123LL);
    assert(timestamp("2028-02-29T12:00:00.000Z") == 1835438400000LL);
    assert(timestamp("2100-02-29T00:00:00.000Z") == 0);
    assert(timestamp("2026-02-29T00:00:00.000Z") == 0);
    assert(timestamp("2026-04-31T00:00:00.000Z") == 0);
    assert(timestamp("2026-01-01T24:00:00.000Z") == 0);
    assert(timestamp("2026-01-01T00:00:00.000+01:00") == 0);
    assert(timestamp("2026-01-01T00:00:00.000Zjunk") == 0);
  }
  assert(commandId("12345678-1234-1234-abcd-123456789abc"));
  assert(!commandId("../../../../../../../../../../../../"));
  assert(!commandId("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"));
  assert(!commandId(nullptr));
  assert(rejection(true,true,10000,15000,10000,0,true) == nullptr);
  assert(std::strcmp(rejection(true,false,10000,15000,10000,0,true),"INVALID_PULSE_DURATION") == 0);
  assert(std::strcmp(rejection(true,true,12000,15000,10000,0,true),"ISSUED_IN_FUTURE") == 0);
  assert(std::strcmp(rejection(true,true,10000,11000,10000,0,true),"EXPIRED_COMMAND") == 0);
  assert(std::strcmp(rejection(true,true,10000,15000,10000,10000,true),"STALE_COMMAND") == 0);
  assert(std::strcmp(rejection(true,true,10000,15000,10000,0,false),"ACTUATION_DISABLED") == 0);
  assert(rejection(false,true,10000,15000,10000,0,true));
  assert(rejection(true,true,0,15000,10000,0,true));
  assert(rejection(true,true,10000,20001,10000,0,true));
  for (int status : {400,401,403,404,409,422}) assert(terminalReportStatus(status));
  for (int status : {-1,200,408,429,500,503}) assert(!terminalReportStatus(status));
  uint32_t delay = 2000;
  for (int i = 0; i < 20; ++i) delay = nextRetryDelay(delay);
  assert(delay == 60000);
  std::cout << "Device protocol tests passed (UTC, rejection, reporting)\n";
}
