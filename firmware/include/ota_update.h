#pragma once

#include <Arduino.h>
#include <Preferences.h>

namespace locker::firmware {

using OtaRequestFn = int (*)(const String&, const String&, String&);
using OtaMillisFn = uint32_t (*)();
using OtaIdleFn = bool (*)();

struct OtaDependencies {
  Preferences* preferences;
  OtaRequestFn request;
  OtaMillisFn millisNow;
  OtaIdleFn deviceIdle;
};

void otaBegin(const OtaDependencies& dependencies, bool storageReady,
              bool wifiConnected, bool timeSynced);
void otaPoll(bool storageReady, bool pendingCommandReport,
             bool wifiConnected, bool timeSynced);
void otaMarkHealthy(bool heartbeatAccepted, bool storageReady,
                    bool wifiConnected, bool timeSynced);
void otaCheckHealth();
bool otaHealthGateOpen();

}  // namespace locker::firmware
