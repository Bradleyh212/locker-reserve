#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include <cJSON.h>

// Only the private USB bootstrap contains a seed. CI application images read
// the same device identity and command-journal namespace from persistent NVS.
namespace locker::identity {
inline String ssid, password, token, device, lockerId, journal;

inline bool load() {
  Preferences profile;
#ifdef OTA_USB_PROFILE
  if (!profile.begin("lr-ota-profile", false)) return false;
  if (profile.isKey("profile") && profile.getString("profile", "") != OTA_USB_PROFILE) return false;
  if (!profile.isKey("profile") &&
      profile.putString("profile", OTA_USB_PROFILE) != strlen(OTA_USB_PROFILE)) return false;
#else
  if (!profile.begin("lr-ota-profile", true)) return false;
#endif
  String encoded = profile.getString("profile", "");
  profile.end();
  cJSON* json = cJSON_Parse(encoded.c_str());
  auto read = [json](const char* name) -> String {
    auto* v = cJSON_GetObjectItemCaseSensitive(json, name);
    return cJSON_IsString(v) ? String(v->valuestring) : String();
  };
  ssid = read("ssid"); password = read("password"); token = read("token");
  device = read("device"); lockerId = read("locker"); journal = read("journal");
  cJSON_Delete(json);
  return ssid.length() && password.length() && token.length() == 64 &&
         device.length() && lockerId.length() == 36 && journal.length() == 15 &&
         journal.startsWith("cloud-");
}
}
