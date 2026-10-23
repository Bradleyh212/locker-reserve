#include "../include/ota_update.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <cJSON.h>
#include <cstring>
#include <cstdio>
#include <esp_ota_ops.h>
#include <mbedtls/sha256.h>
#include <time.h>

#include "../include/ota_policy.h"
#include "../include/version.h"

#if __has_include("../include/config.local.h")
#include "../include/config.local.h"
#else
#include "../include/config.example.h"
#endif

namespace locker::firmware {
namespace {

constexpr uint32_t kManifestPollMs = 30000;
constexpr uint32_t kResultRetryMs = 2000;
constexpr uint32_t kDownloadDeadlineMs = 180000;
constexpr uint32_t kReadTimeoutMs = 15000;
constexpr time_t kTrustedTimeEpoch = 1767225600;

OtaDependencies deps{};
bool initialized = false;
bool healthGate = false;
bool heartbeatSeen = false;
uint32_t healthStarted = 0;
uint32_t lastManifestPoll = 0;
uint32_t lastResultAttempt = 0;
bool hasManifestPolled = false;
bool hasResultAttempted = false;

struct Record {
  String id;
  String version;
  uint32_t build = 0;
  String result;
  String reason;
  locker::OtaRecordState state = locker::OtaRecordState::None;
};

const char* stateName(locker::OtaRecordState state) {
  switch (state) {
    case locker::OtaRecordState::Downloading: return "DOWNLOADING";
    case locker::OtaRecordState::BootingNew: return "BOOTING_NEW";
    case locker::OtaRecordState::ResultPending: return "RESULT_PENDING";
    case locker::OtaRecordState::None: return "NONE";
  }
  return "NONE";
}

bool saveRecord(const Record& record) {
  if (!deps.preferences) return false;
  cJSON* json = cJSON_CreateObject();
  if (!json) return false;
  cJSON_AddStringToObject(json, "id", record.id.c_str());
  cJSON_AddStringToObject(json, "version", record.version.c_str());
  cJSON_AddNumberToObject(json, "build", record.build);
  cJSON_AddStringToObject(json, "state", stateName(record.state));
  if (record.state == locker::OtaRecordState::ResultPending) {
    cJSON_AddStringToObject(json, "result", record.result.c_str());
    cJSON_AddStringToObject(json, "reason", record.reason.c_str());
  }
  char* encoded = cJSON_PrintUnformatted(json);
  const size_t length = encoded ? strlen(encoded) : 0;
  const size_t written = length ? deps.preferences->putString("ota", encoded) : 0;
  if (encoded) cJSON_free(encoded);
  cJSON_Delete(json);
  return length > 0 && written == length;
}

bool loadRecord(Record& record) {
  if (!deps.preferences || !deps.preferences->isKey("ota")) return false;
  String value = deps.preferences->getString("ota", "");
  cJSON* json = cJSON_Parse(value.c_str());
  if (!json) return false;
  cJSON* id = cJSON_GetObjectItemCaseSensitive(json, "id");
  cJSON* version = cJSON_GetObjectItemCaseSensitive(json, "version");
  cJSON* build = cJSON_GetObjectItemCaseSensitive(json, "build");
  cJSON* state = cJSON_GetObjectItemCaseSensitive(json, "state");
  cJSON* result = cJSON_GetObjectItemCaseSensitive(json, "result");
  cJSON* reason = cJSON_GetObjectItemCaseSensitive(json, "reason");
  const bool valid = cJSON_IsString(id) && cJSON_IsString(version) &&
      cJSON_IsNumber(build) && cJSON_IsString(state);
  if (valid) {
    record.id = id->valuestring;
    record.version = version->valuestring;
    record.build = static_cast<uint32_t>(build->valuedouble);
    const String stateValue(state->valuestring);
    if (stateValue == "DOWNLOADING") record.state = locker::OtaRecordState::Downloading;
    else if (stateValue == "BOOTING_NEW") record.state = locker::OtaRecordState::BootingNew;
    else if (stateValue == "RESULT_PENDING") record.state = locker::OtaRecordState::ResultPending;
    else record.state = locker::OtaRecordState::None;
    if (cJSON_IsString(result)) record.result = result->valuestring;
    if (cJSON_IsString(reason)) record.reason = reason->valuestring;
  }
  cJSON_Delete(json);
  return valid && record.state != locker::OtaRecordState::None;
}

bool setPending(Record& record, const char* result, const char* reason) {
  record.state = locker::OtaRecordState::ResultPending;
  record.result = result ? result : "FAILED";
  record.reason = reason ? reason : "DOWNLOAD_ERROR";
  return saveRecord(record);
}

void reportPending(Record& record) {
  if (!deps.request || !deps.preferences) return;
  const uint32_t now = deps.millisNow ? deps.millisNow() : millis();
  if (hasResultAttempted && now - lastResultAttempt < kResultRetryMs) return;
  hasResultAttempted = true;
  lastResultAttempt = now;
  cJSON* body = cJSON_CreateObject();
  if (!body) return;
  cJSON_AddStringToObject(body, "result", record.result.c_str());
  if (record.reason.length())
    cJSON_AddStringToObject(body, "reason", record.reason.c_str());
  cJSON_AddStringToObject(body, "firmwareVersion", FIRMWARE_VERSION);
  char* encoded = cJSON_PrintUnformatted(body);
  cJSON_Delete(body);
  if (!encoded) return;
  String response;
  const String path = String("/v1/device/firmware/updates/") + record.id + "/result";
  const int code = deps.request(path, String(encoded), response);
  cJSON_free(encoded);
  if (code == 200 && deps.preferences->remove("ota")) {
    Serial.println("OTA result acknowledged by API");
  }
}

int64_t parseUtcMs(const char* value) {
  if (!value || strlen(value) != 24) return 0;
  int y, mon, day, hour, minute, second, milli;
  char tail;
  if (sscanf(value, "%4d-%2d-%2dT%2d:%2d:%2d.%3dZ%c", &y, &mon, &day,
             &hour, &minute, &second, &milli, &tail) != 7) return 0;
  tm parsed = {};
  parsed.tm_year = y - 1900;
  parsed.tm_mon = mon - 1;
  parsed.tm_mday = day;
  parsed.tm_hour = hour;
  parsed.tm_min = minute;
  parsed.tm_sec = second;
  const time_t epoch = mktime(&parsed);
  if (epoch < kTrustedTimeEpoch) return 0;
  return static_cast<int64_t>(epoch) * 1000 + milli;
}

bool getManifest(String& response, locker::FirmwareManifest& manifest,
                 String& id, String& version, String& hash) {
  cJSON* json = cJSON_Parse(response.c_str());
  if (!json) return false;
  cJSON* protocol = cJSON_GetObjectItemCaseSensitive(json, "protocolVersion");
  cJSON* updateId = cJSON_GetObjectItemCaseSensitive(json, "updateId");
  cJSON* ver = cJSON_GetObjectItemCaseSensitive(json, "version");
  cJSON* build = cJSON_GetObjectItemCaseSensitive(json, "buildNumber");
  cJSON* size = cJSON_GetObjectItemCaseSensitive(json, "sizeBytes");
  cJSON* sha = cJSON_GetObjectItemCaseSensitive(json, "sha256");
  cJSON* expires = cJSON_GetObjectItemCaseSensitive(json, "expiresAt");
  const bool valid = cJSON_IsNumber(protocol) && cJSON_IsString(updateId) &&
      cJSON_IsString(ver) && cJSON_IsNumber(build) && cJSON_IsNumber(size) &&
      cJSON_IsString(sha) && cJSON_IsString(expires);
  if (valid) {
    id = updateId->valuestring;
    version = ver->valuestring;
    hash = sha->valuestring;
    manifest = {static_cast<uint32_t>(protocol->valuedouble), id.c_str(),
      version.c_str(), static_cast<uint32_t>(build->valuedouble),
      static_cast<uint32_t>(size->valuedouble), hash.c_str(),
      parseUtcMs(expires->valuestring)};
  }
  cJSON_Delete(json);
  return valid;
}

void rollbackAndReboot() {
  Serial.println("OTA health check failed; rolling back");
  esp_ota_mark_app_invalid_rollback_and_reboot();
  Update.rollBack();
  ESP.restart();
}

void checkHealth() {
  if (!healthGate || !deps.millisNow) return;
  if (deps.millisNow() - healthStarted >= locker::OTA_HEALTH_TIMEOUT_MS) {
    rollbackAndReboot();
  }
}

bool download(const locker::FirmwareManifest& manifest, const String& id,
              const String& version, const String& hash) {
  Record record{id, version, manifest.buildNumber, "", "",
                locker::OtaRecordState::Downloading};
  if (!saveRecord(record)) return false;
  WiFiClientSecure client;
  client.setCACert(API_CA_PEM);
  client.setHandshakeTimeout(5);
  client.setTimeout(kReadTimeoutMs);
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(kReadTimeoutMs);
  const String base(API_BASE_URL);
  if (!base.startsWith("https://")) {
    setPending(record, "FAILED", "DOWNLOAD_ERROR");
    return false;
  }
  const String url = base + "/v1/device/firmware/updates/" + id + "/download";
  if (!http.begin(client, url)) {
    setPending(record, "FAILED", "DOWNLOAD_ERROR");
    reportPending(record);
    return false;
  }
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  const uint32_t started = deps.millisNow();
  const int code = http.GET();
  const int length = http.getSize();
  if (code != 200 || length < 0 || static_cast<uint32_t>(length) != manifest.sizeBytes) {
    http.end();
    setPending(record, "FAILED", code == 200 ? "SIZE_MISMATCH" : "DOWNLOAD_ERROR");
    reportPending(record);
    return false;
  }
  if (!Update.begin(manifest.sizeBytes, U_FLASH)) {
    http.end();
    setPending(record, "FAILED", "DOWNLOAD_ERROR");
    reportPending(record);
    return false;
  }
  mbedtls_sha256_context shaContext;
  mbedtls_sha256_init(&shaContext);
  int shaResult = mbedtls_sha256_starts(&shaContext, 0);
  uint8_t buffer[1024];
  uint32_t received = 0;
  uint32_t lastProgress = started;
  NetworkClient* stream = http.getStreamPtr();
  String failure;
  while (received < manifest.sizeBytes && !failure.length()) {
    if (deps.millisNow() - started >= kDownloadDeadlineMs) {
      failure = "TIMEOUT";
      break;
    }
    if (deps.millisNow() - lastProgress >= kReadTimeoutMs) {
      failure = "TIMEOUT";
      break;
    }
    const int available = stream->available();
    if (available <= 0) {
      if (!http.connected()) {
        failure = "DOWNLOAD_ERROR";
        break;
      }
      delay(1);
      yield();
      continue;
    }
    const size_t wanted = static_cast<size_t>(available) < sizeof(buffer)
      ? static_cast<size_t>(available) : sizeof(buffer);
    const int count = stream->readBytes(buffer, wanted);
    if (count <= 0) {
      failure = deps.millisNow() - started >= kDownloadDeadlineMs
        ? "TIMEOUT" : "DOWNLOAD_ERROR";
      break;
    }
    if (static_cast<uint32_t>(count) > manifest.sizeBytes - received) {
      failure = "SIZE_MISMATCH";
      break;
    }
    if (shaResult == 0) shaResult = mbedtls_sha256_update(&shaContext, buffer, count);
    if (shaResult != 0 || Update.write(buffer, count) != static_cast<size_t>(count)) {
      failure = "WRITE_ERROR";
      break;
    }
    received += static_cast<uint32_t>(count);
    lastProgress = deps.millisNow();
    delay(1);
    yield();
  }
  http.end();
  uint8_t digest[32];
  if (shaResult == 0) shaResult = mbedtls_sha256_finish(&shaContext, digest);
  mbedtls_sha256_free(&shaContext);
  if (!failure.length() && received != manifest.sizeBytes) failure = "SIZE_MISMATCH";
  if (!failure.length() && shaResult != 0) failure = "WRITE_ERROR";
  if (!failure.length()) {
    static const char hex[] = "0123456789abcdef";
    char actual[65];
    for (size_t i = 0; i < sizeof(digest); ++i) {
      actual[i * 2] = hex[digest[i] >> 4];
      actual[i * 2 + 1] = hex[digest[i] & 0x0f];
    }
    actual[64] = '\0';
    if (hash != actual) failure = "SHA_MISMATCH";
  }
  if (failure.length()) {
    Update.abort();
    setPending(record, "FAILED", failure.c_str());
    reportPending(record);
    return false;
  }
  record.state = locker::OtaRecordState::BootingNew;
  if (!saveRecord(record)) {
    Update.abort();
    setPending(record, "FAILED", "WRITE_ERROR");
    reportPending(record);
    return false;
  }
  if (!Update.end(true)) {
    Update.abort();
    setPending(record, "FAILED", "WRITE_ERROR");
    reportPending(record);
    return false;
  }
  delay(50);
  ESP.restart();
  return true;
}

}  // namespace

#if OTA_ENABLED && defined(CONFIG_APP_ROLLBACK_ENABLE)
extern "C" bool verifyRollbackLater() { return true; }
#endif

void otaBegin(const OtaDependencies& dependencies, bool storageReady,
              bool wifiConnected, bool timeSynced) {
#if !OTA_ENABLED
  (void)dependencies; (void)storageReady; (void)wifiConnected; (void)timeSynced;
  return;
#else
  deps = dependencies;
  initialized = true;
  Record record;
  esp_ota_img_states_t imageState = ESP_OTA_IMG_UNDEFINED;
  const bool hasImageState = esp_ota_get_state_partition(
      esp_ota_get_running_partition(), &imageState) == ESP_OK;
  const bool pendingVerify = hasImageState && imageState == ESP_OTA_IMG_PENDING_VERIFY;
  if (!storageReady || !loadRecord(record)) {
    if (pendingVerify) rollbackAndReboot();
    return;
  }
  const locker::OtaRecord policyRecord{record.state, record.version.c_str(), record.build};
  const auto resolution = locker::resolveBoot(policyRecord, FIRMWARE_VERSION, FIRMWARE_BUILD);
  if (pendingVerify && resolution.action != locker::BootAction::StartHealthGate) {
    rollbackAndReboot();
  } else if (resolution.action == locker::BootAction::ReportFailed) {
    setPending(record, resolution.result, resolution.reason);
  } else if (resolution.action == locker::BootAction::StartHealthGate) {
    if (pendingVerify) {
      healthGate = true;
      healthStarted = deps.millisNow ? deps.millisNow() : millis();
      heartbeatSeen = false;
    } else if (hasImageState && imageState == ESP_OTA_IMG_VALID) {
      setPending(record, "UPDATED", "");
    }
  }
  (void)wifiConnected;
  (void)timeSynced;
#endif
}

void otaPoll(bool storageReady, bool pendingCommandReport,
             bool wifiConnected, bool timeSynced) {
#if !OTA_ENABLED
  (void)storageReady; (void)pendingCommandReport; (void)wifiConnected; (void)timeSynced;
  return;
#else
  if (!initialized) return;
  checkHealth();
  Record pending;
  if (storageReady && loadRecord(pending) &&
      pending.state == locker::OtaRecordState::ResultPending) {
    reportPending(pending);
    return;
  }
  const uint32_t now = deps.millisNow ? deps.millisNow() : millis();
  if (hasManifestPolled && now - lastManifestPoll < kManifestPollMs) return;
  hasManifestPolled = true;
  lastManifestPoll = now;
  if (!deps.deviceIdle || !deps.deviceIdle()) return;
  const bool synchronized = timeSynced && time(nullptr) >= kTrustedTimeEpoch;
  locker::OtaContext context{false, pendingCommandReport, storageReady,
      wifiConnected, synchronized, static_cast<int64_t>(time(nullptr)) * 1000};
  if (!locker::mayStart(context)) return;
  String response;
  const int code = deps.request("/v1/device/firmware/next", "", response);
  if (code == 204 || code != 200 || !response.length()) return;
  locker::FirmwareManifest manifest{};
  String id, version, hash;
  if (!getManifest(response, manifest, id, version, hash)) return;
  const auto validation = locker::validateManifest(manifest, context);
  if (!validation.valid) {
    Serial.printf("OTA manifest rejected: %s\n", locker::reasonCode(validation.reason));
    return;
  }
  download(manifest, id, version, hash);
#endif
}

void otaMarkHealthy(bool heartbeatAccepted, bool storageReady,
                    bool wifiConnected, bool timeSynced) {
#if !OTA_ENABLED
  (void)heartbeatAccepted; (void)storageReady; (void)wifiConnected; (void)timeSynced;
  return;
#else
  if (!healthGate || heartbeatSeen || !heartbeatAccepted) return;
  heartbeatSeen = true;
  const locker::HealthFlags flags{storageReady, wifiConnected, timeSynced, heartbeatAccepted};
  const uint32_t elapsed = (deps.millisNow ? deps.millisNow() : millis()) - healthStarted;
  const auto state = locker::healthGate(elapsed, flags);
  if (state == locker::HealthState::Healthy) {
    if (esp_ota_mark_app_valid_cancel_rollback() != ESP_OK) {
      rollbackAndReboot();
      return;
    }
    Record record;
    if (loadRecord(record)) {
      setPending(record, "UPDATED", "");
      healthGate = false;
      reportPending(record);
    }
  }
#endif
}

void otaCheckHealth() {
#if OTA_ENABLED
  checkHealth();
#endif
}

bool otaHealthGateOpen() {
#if !OTA_ENABLED
  return false;
#else
  return healthGate;
#endif
}

}  // namespace locker::firmware
