#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <cJSON.h>
#include <time.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <sys/time.h>
#include "../include/device_diagnostics.h"
#include "../include/locker.h"
#include "../include/device_protocol.h"
#include "../include/door_heartbeat.h"
#include "../include/firmware_app.h"

#if __has_include("../include/config.local.h")
#include "../include/config.local.h"
#else
#include "../include/config.example.h"
#endif

// Keep the existing Mac journal by default. Cloud builds use an identity-scoped
// namespace, so a pending Mac result is never submitted to a different database.
#ifndef COMMAND_JOURNAL_NAMESPACE
#define COMMAND_JOURNAL_NAMESPACE "locker-api"
#endif
static_assert(sizeof(COMMAND_JOURNAL_NAMESPACE) > 1 && sizeof(COMMAND_JOURNAL_NAMESPACE) <= 16,
              "ESP32 NVS namespace must contain 1 to 15 characters");

namespace locker::firmware {
constexpr int OUTPUT_PIN = 26;
constexpr int DOOR_PIN = 27;

static_assert(
  MAX_PULSE_MS >= 0 && MAX_PULSE_MS <= locker::HARD_MAX_PULSE_MS,
  "Absolute software ceiling is 5000ms; not a hardware rating"
);

static_assert(
  !ACTUATION_ENABLED || MAX_PULSE_MS > 0,
  "Set a validated maximum before enabling"
);

class GpioOutput : public locker::LockOutput {
public:
  void setActive(bool active) override {
    digitalWrite(OUTPUT_PIN, active ? HIGH : LOW);
  }
};

GpioOutput output;
locker::Locker* actuator = nullptr;

Preferences prefs;
locker::DeviceDiagnostics diagnostics;
char bootId[33] = {};
const char* resetReason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_EXT: return "EXT";
    case ESP_RST_SW: return "SW";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    default: return "UNKNOWN";
  }
}

bool storageReady = false;

String consumedId;
String outcome;
String outcomeReason;

int64_t watermark = 0;

bool pendingReport = false;
bool reportBlocked = false;
uint32_t reportLastAttempt = 0;
uint32_t reportRetryDelay = 0;

locker::DoorSensor sensor;
// Best-effort diagnostic history only. Reports and authorization always use
// the latest live sample, never this queue.
QueueHandle_t reedTransitions = nullptr;
portMUX_TYPE sensorMux = portMUX_INITIALIZER_UNLOCKED;
locker::DoorHeartbeat doorHeartbeat;
uint32_t lastPoll = 0;
uint32_t lastReconnect = 0;


// --------------------------------------------------
// JSON helpers
// --------------------------------------------------

String stringField(cJSON* obj, const char* name) {
  cJSON* v = cJSON_GetObjectItemCaseSensitive(obj, name);

  return cJSON_IsString(v) && v->valuestring
    ? String(v->valuestring)
    : String();
}

String jsonString(cJSON* obj) {
  char* s = cJSON_PrintUnformatted(obj);

  String result = s ? String(s) : String();

  if (s) {
    cJSON_free(s);
  }

  cJSON_Delete(obj);

  return result;
}


// --------------------------------------------------
// Persistent command journal
// --------------------------------------------------

bool saveJournal() {
  cJSON* j = cJSON_CreateObject();

  cJSON_AddStringToObject(j, "id", consumedId.c_str());
  cJSON_AddNumberToObject(j, "watermark", (double)watermark);
  cJSON_AddStringToObject(j, "result", outcome.c_str());
  cJSON_AddStringToObject(j, "reason", outcomeReason.c_str());
  cJSON_AddBoolToObject(j, "pending", pendingReport);
  cJSON_AddBoolToObject(j, "reportBlocked", reportBlocked);

  String record = jsonString(j);

  return storageReady &&
        record.length() &&
        prefs.putString("journal", record) == record.length();
}


// --------------------------------------------------
// Reed sensor
// --------------------------------------------------

// Only GPIO and a small value object are accessed under the spinlock. TLS,
// Serial, NVS and the actuator stay on the Arduino loop task.
void sampleDoorTask(void*) {
  for (;;) {
    portENTER_CRITICAL(&sensorMux);
    const auto previous = sensor.sequence();
    sensor.sample(digitalRead(DOOR_PIN) == LOW, millis());
    const auto current = sensor;
    portEXIT_CRITICAL(&sensorMux);
    if (reedTransitions && current.sequence() != previous)
      xQueueSend(reedTransitions, &current, 0);
    vTaskDelay(pdMS_TO_TICKS(10) ? pdMS_TO_TICKS(10) : 1);
  }
}

locker::DoorSensor doorSnapshot() {
  portENTER_CRITICAL(&sensorMux);
  const auto snapshot = sensor;
  portEXIT_CRITICAL(&sensorMux);
  return snapshot;
}

bool doorAllowsPulse() {
  portENTER_CRITICAL(&sensorMux);
  const auto now = millis();
  // Include the current pin level even if a transition happened since the
  // sampler last ran. A CLOSED pin alone cannot refresh a stalled sampler.
  if (digitalRead(DOOR_PIN) != LOW) sensor.sample(false, now);
  const bool allowed = sensor.canUnlock(now);
  portEXIT_CRITICAL(&sensorMux);
  return allowed;
}

const char* doorState(locker::DoorState state) {
  switch (state) {
    case locker::DoorState::Closed: return "CLOSED";
    case locker::DoorState::Open: return "OPEN";
    default: return "UNKNOWN";
  }
}

// --------------------------------------------------
// Timestamp parser
// --------------------------------------------------

// Commands use canonical UTC ISO timestamps,
// with milliseconds from the NestJS API.

int64_t timestamp(const String& s) {
  return locker::protocol::timestamp(s.c_str());
}


// --------------------------------------------------
// HTTPS request
// --------------------------------------------------

int request(
  const String& path,
  const String& body,
  String& response
) {
  response = "";

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("HTTP skipped: WiFi not connected");
    return diagnostics.observeHttp(-1);
  }

  if (time(nullptr) < 1767225600) {
    Serial.println("HTTP skipped: system time not synchronized");
    return diagnostics.observeHttp(-1);
  }

  WiFiClientSecure client;

  client.setCACert(API_CA_PEM);
  client.setHandshakeTimeout(5);

  HTTPClient http;

  http.setConnectTimeout(2000);
  http.setTimeout(2000);

  String url = String(API_BASE_URL) + path;

  if (!String(API_BASE_URL).startsWith("https://")) {
    Serial.println("HTTP error: API_BASE_URL is not HTTPS");
    return diagnostics.observeHttp(-1);
  }

  const char* operation = path == "/v1/device/heartbeat" ? "heartbeat" :
    path == "/v1/device/commands/next" ? "poll" : "result";
  const uint32_t started = millis();

  if (!http.begin(client, url)) {
    Serial.println("HTTP begin() failed");
    return diagnostics.observeHttp(-1);
  }

  http.addHeader(
    "Authorization",
    String("Bearer ") + DEVICE_TOKEN
  );

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  int code;

  if (body.length()) {
    code = http.POST(body);
  } else {
    code = http.GET();
  }

  if (
    code == 200 &&
    http.getSize() >= 0 &&
    http.getSize() <= 2048
  ) {
    response = http.getString();
  }

  http.end();
  Serial.printf("HTTP %s status=%d duration_ms=%lu\n", operation, code,
                static_cast<unsigned long>(millis() - started));

  return diagnostics.observeHttp(code);
}


// --------------------------------------------------
// Heartbeat
// --------------------------------------------------

void heartbeat(const locker::DoorSensor& snapshot) {
  timeval sampledTime{};
  gettimeofday(&sampledTime, nullptr);
  const uint32_t started = millis();
  const auto observed = snapshot.fresh(started) ? snapshot.state(started) : locker::DoorState::Unknown;
  const char* reportedDoor = doorState(observed);
  const uint32_t sampleAge = started - snapshot.sampledAt();
  // UNKNOWN records the current inability to confirm the level. A known
  // observation uses the sample's time, never the later HTTP completion time.
  const double observedAtMs = sampledTime.tv_sec * 1000.0 + sampledTime.tv_usec / 1000 -
    (observed == locker::DoorState::Unknown ? 0 : sampleAge);
  Serial.printf("Reed seq=%lu state=%s raw_edge_ms=%lu stable_ms=%lu sample_ms=%lu scheduled_ms=%lu\n",
    (unsigned long)snapshot.sequence(), reportedDoor, (unsigned long)snapshot.edgeAt(),
    (unsigned long)snapshot.stableAt(), (unsigned long)snapshot.sampledAt(), (unsigned long)started);
  cJSON* b = cJSON_CreateObject();
  cJSON_AddNumberToObject(b, "observedAtMs", observedAtMs);

  cJSON_AddStringToObject(
    b,
    "doorState",
    reportedDoor
  );

  cJSON_AddStringToObject(
    b,
    "outputState",
    "INACTIVE"
  );

  cJSON_AddStringToObject(
    b,
    "firmwareVersion",
    "locker-firmware-0.2"
  );

  cJSON_AddBoolToObject(
    b,
    "actuationEnabled",
    ACTUATION_ENABLED && storageReady && !reportBlocked
  );

  cJSON_AddNumberToObject(
    b,
    "maxPulseMs",
    MAX_PULSE_MS
  );

  cJSON* health = cJSON_AddObjectToObject(b, "diagnostics");
  cJSON_AddStringToObject(health, "bootId", bootId);
  cJSON_AddNumberToObject(health, "uptimeMs", static_cast<double>(esp_timer_get_time() / 1000));
  cJSON_AddStringToObject(health, "resetReason", resetReason());
  cJSON_AddNumberToObject(health, "wifiDisconnects", diagnostics.wifiDisconnects);
  cJSON_AddNumberToObject(health, "communicationFailures", diagnostics.communicationFailures);

  String response;

  int code = request(
    "/v1/device/heartbeat",
    jsonString(b),
    response
  );

  cJSON* ack = code == 200 ? cJSON_Parse(response.c_str()) : nullptr;
  diagnostics.acknowledgeHeartbeat(code,
    ack && cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(ack, "accepted")),
    ack && cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(ack, "ignored")));
  cJSON_Delete(ack);
  doorHeartbeat.attempted(started, observed, diagnostics.heartbeatAccepted);
  Serial.printf("Reed seq=%lu response_ms=%lu accepted=%d\n", (unsigned long)snapshot.sequence(),
    (unsigned long)millis(), diagnostics.heartbeatAccepted);

}


// --------------------------------------------------
// Command result reporting
// --------------------------------------------------

void report() {
  // Never send an outcome that failed to reach durable storage.
  if (!storageReady || reportBlocked ||
      millis() - reportLastAttempt < reportRetryDelay) return;
  reportLastAttempt = millis();
  cJSON* b = cJSON_CreateObject();
  cJSON_AddStringToObject(b, "result", outcome.c_str());
  cJSON_AddStringToObject(b, "reason", outcomeReason.c_str());
  String response;
  const int status = request("/v1/device/commands/" + consumedId + "/result", jsonString(b), response);
  if (status == 200) {
    // Require the API's explicit acknowledgment before clearing the journal.
    cJSON* ack = cJSON_Parse(response.c_str());
    const bool accepted = ack && cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(ack, "accepted"));
    cJSON_Delete(ack);
    if (accepted) {
      pendingReport = false;
      reportRetryDelay = 0;
      if (!saveJournal()) { pendingReport = true; storageReady = false; }
      return;
    }
  }
  Serial.printf("Command result HTTP %d; journal retained\n", status);
  if (locker::protocol::terminalReportStatus(status)) {
    reportBlocked = true;
    if (!saveJournal()) storageReady = false;
    Serial.println("RESULT REPORT BLOCKED: operator reconciliation required; no further commands");
  } else {
    reportRetryDelay = reportRetryDelay ? locker::protocol::nextRetryDelay(reportRetryDelay) : 2000;
  }
}


// --------------------------------------------------
// Command polling
// --------------------------------------------------

void poll() {
  String response;

  if (
    request(
      "/v1/device/commands/next",
      "",
      response
    ) != 200
  ) {
    return;
  }

  cJSON* b = cJSON_Parse(response.c_str());

  if (!b) {
    Serial.println("Command response JSON parse failed");
    return;
  }

  String id = stringField(
    b,
    "commandId"
  );

  cJSON* version =
    cJSON_GetObjectItemCaseSensitive(
      b,
      "protocolVersion"
    );

  cJSON* duration =
    cJSON_GetObjectItemCaseSensitive(
      b,
      "pulseMs"
    );

  int64_t issued =
    timestamp(
      stringField(
        b,
        "issuedAt"
      )
    );

  int64_t expires =
    timestamp(
      stringField(
        b,
        "expiresAt"
      )
    );

  int64_t now =
    (int64_t)time(nullptr) * 1000;

  const bool addressed = locker::protocol::commandId(id.c_str()) &&
    stringField(b, "deviceId") == DEVICE_ID && stringField(b, "lockerId") == LOCKER_ID;
  const bool versionAndType = cJSON_IsNumber(version) && version->valuedouble == 1 &&
    stringField(b, "type") == "UNLOCK_PULSE";
  const bool durationValid = cJSON_IsNumber(duration) && duration->valuedouble == duration->valueint &&
    duration->valueint > 0 && duration->valueint <= MAX_PULSE_MS;
  const int pulse = cJSON_IsNumber(duration) ? duration->valueint : 0;
  const char* rejection = locker::protocol::rejection(versionAndType, durationValid,
    issued, expires, now, watermark, ACTUATION_ENABLED);
  cJSON_Delete(b);

  // Never acknowledge malformed identities or commands intended for another device.
  if (!addressed || !storageReady) {
    Serial.println("Command ignored: invalid target/identity or unavailable journal");
    return;
  }
  if (id == consumedId) {
    // Redelivery repeats the recorded result, never the physical pulse.
    pendingReport = true;
    if (!saveJournal()) storageReady = false;
    return;
  }
  if (rejection) {
    consumedId = id;
    outcome = "REJECTED";
    outcomeReason = rejection;
    pendingReport = true;
    // Rejected timestamps (especially future timestamps) cannot advance replay protection.
    if (!saveJournal()) storageReady = false;
    return;
  }

  // Commit consumption before touching the output.
  // Never replay across resets.

  consumedId = id;

  watermark = issued;

  outcome = "UNKNOWN";

  outcomeReason =
    "INTERRUPTED_OR_NOT_STARTED";

  pendingReport = true;

  if (!saveJournal()) {
    storageReady = false;
    return;
  }

  if (
    expires <=
      (int64_t)time(nullptr) * 1000 +
      1000 ||

    WiFi.status() !=
      WL_CONNECTED
  ) {
    outcome =
      "REJECTED";

    outcomeReason =
      "EXPIRED_OR_OFFLINE_BEFORE_ACTIVATION";

    if (!saveJournal()) {
      storageReady = false;
    }

    return;
  }

  // Require a fresh stable CLOSED, independent of the historical display state.
  if (WiFi.status() != WL_CONNECTED ||
      expires <= (int64_t)time(nullptr) * 1000 + 1000 || !doorAllowsPulse()) {
    outcome = "REJECTED";
    outcomeReason = "DOOR_NOT_CLOSED_OR_EXPIRED_OR_OFFLINE";
    if (!saveJournal()) storageReady = false;
    return;
  }

  auto r =
    actuator->requestPulse(
      pulse,
      millis()
    );

  if (
    r !=
    locker::PulseResult::Started
  ) {
    outcome =
      "REJECTED";

    outcomeReason =
      "ACTUATOR_REJECTED";

    if (!saveJournal()) {
      storageReady = false;
    }

    return;
  }

  Serial.println(
    "Output pulse started"
  );
}


// --------------------------------------------------
// SETUP
// --------------------------------------------------

void begin() {
  digitalWrite(OUTPUT_PIN, LOW);
  pinMode(OUTPUT_PIN, OUTPUT);

  Serial.begin(115200);
  // Random boot session ID, independent of wall clock and OTA/command NVS namespaces.
  for (int i = 0; i < 4; ++i) snprintf(bootId + i * 8, 9, "%08lx", static_cast<unsigned long>(esp_random()));
  Serial.printf("Boot %s; reset reason %s\n", bootId, resetReason());

  delay(500);

  Serial.println();
  Serial.println(
    "=== LockerReserve device boot ==="
  );

  // Safe output initialization

  pinMode(
    OUTPUT_PIN,
    OUTPUT
  );

  digitalWrite(
    OUTPUT_PIN,
    LOW
  );

  pinMode(
    DOOR_PIN,
    INPUT_PULLUP
  );


  // Locker controller

  static locker::Locker controller(
    output,
    MAX_PULSE_MS
  );

  actuator =
    &controller;


  // Persistent storage

  storageReady =
    prefs.begin(
      COMMAND_JOURNAL_NAMESPACE,
      false
    );

  Serial.print(
    "Preferences storage: "
  );

  Serial.println(
    storageReady
      ? "READY"
      : "FAILED"
  );


  if (
    storageReady &&
    prefs.isKey(
      "journal"
    )
  ) {

    cJSON* j =
      cJSON_Parse(
        prefs
          .getString(
            "journal"
          )
          .c_str()
      );

    cJSON* w =
      j
        ? cJSON_GetObjectItemCaseSensitive(
            j,
            "watermark"
          )
        : nullptr;

    if (
      !j ||
      !cJSON_IsNumber(w)
    ) {
      storageReady =
        false;
    }
    else {

      reportBlocked = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(j, "reportBlocked"));
      if (reportBlocked) Serial.println("RESULT REPORT BLOCKED: persisted fault; reconcile before further commands");

      consumedId =
        stringField(
          j,
          "id"
        );

      watermark =
        (int64_t)
        w->valuedouble;

      outcome =
        stringField(
          j,
          "result"
        );

      outcomeReason =
        stringField(
          j,
          "reason"
        );

      pendingReport =
        cJSON_IsTrue(
          cJSON_GetObjectItemCaseSensitive(
            j,
            "pending"
          )
        );

      if (
        consumedId.length() !=
          36 ||

        watermark < 0 ||

        !outcome.length()
      ) {
        storageReady =
          false;
      }
    }

    if (j) {
      cJSON_Delete(j);
    }
  }


  // Reed sensor initial state

  reedTransitions = xQueueCreate(16, sizeof(locker::DoorSensor));
  if (xTaskCreate(sampleDoorTask, "reed", 2048, nullptr, 2, nullptr) != pdPASS) {
    Serial.println("Reed sampler unavailable; contact UNKNOWN and output inhibited");
  }

  Serial.println("Connecting to WiFi");
  WiFi.mode(
    WIFI_STA
  );

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );


  unsigned long wifiStart =
    millis();

  while (
    WiFi.status() !=
      WL_CONNECTED &&

    millis() -
      wifiStart <
      15000
  ) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();


  if (
    WiFi.status() ==
      WL_CONNECTED
  ) {

    Serial.println(
      "WiFi connected"
    );

    Serial.print(
      "IP address: "
    );

    Serial.println(
      WiFi.localIP()
    );

    Serial.print(
      "RSSI: "
    );

    Serial.print(
      WiFi.RSSI()
    );

    Serial.println(
      " dBm"
    );
  }
  else {

    Serial.println(
      "WiFi connection FAILED"
    );

    Serial.print(
      "WiFi status code: "
    );

    Serial.println(
      WiFi.status()
    );
  }


  // --------------------------------------------------
  // NTP
  // --------------------------------------------------

  Serial.println();
  Serial.println(
    "Starting NTP synchronization..."
  );

  configTime(
    0,
    0,
    "pool.ntp.org",
    "time.nist.gov"
  );


  if (
    WiFi.status() ==
      WL_CONNECTED
  ) {

    unsigned long ntpStart =
      millis();

    while (
      time(nullptr) <
        1767225600 &&

      millis() -
        ntpStart <
        10000
    ) {

      delay(250);

      Serial.print(".");
    }

    Serial.println();


    if (
      time(nullptr) >=
        1767225600
    ) {

      Serial.println(
        "NTP synchronized"
      );

      Serial.print(
        "Unix time: "
      );

      Serial.println(
        (long)time(nullptr)
      );
    }
    else {

      Serial.println(
        "NTP synchronization FAILED / timed out"
      );
    }
  }


  Serial.println();

  Serial.println(
    "Main locker firmware ready."
  );

  Serial.println(
    "Output inactive."
  );

  Serial.println(
    "CLOSED contact required; only API commands authorize activation."
  );

  Serial.println(
    "================================="
  );
}


// --------------------------------------------------
// LOOP
// --------------------------------------------------

void run() {
  diagnostics.observeWifi(WiFi.status() == WL_CONNECTED);


  bool wasActive =
    actuator
      ->outputState() ==
      locker::OutputState::Active;


  const bool connectionLost = wasActive && WiFi.status() != WL_CONNECTED;
  if (connectionLost) actuator->stop();
  actuator->tick(millis());


  if (
    wasActive
  ) {

    if (
      actuator
        ->outputState() ==
        locker::OutputState::Inactive
    ) {

      outcome =
        connectionLost ? "FAILED" : "OUTPUT_PULSE_COMPLETED";

      outcomeReason =
        connectionLost ? "WIFI_LOST_DURING_PULSE" : "LOCAL_DEADLINE_REACHED";


      if (
        !saveJournal()
      ) {

        storageReady =
          false;

        outcome =
          "UNKNOWN";

        outcomeReason =
          "RESULT_STORAGE_FAILED";
      }


      Serial.println(
        "Output inactive; result recorded (not proof of latch state)"
      );
    }


    // No HTTP, TLS, reconnect
    // or storage operations
    // while output is active.

    delay(1);

    return;
  }


  // --------------------------------------------------
  // Drain a bounded number per pass and only with output inactive. Sequence
  // gaps identify diagnostic entries dropped during a long network operation.
  locker::DoorSensor event;
  for (int i = 0; i < 16 && reedTransitions && xQueueReceive(reedTransitions, &event, 0); ++i) {
    Serial.printf("Reed transition seq=%lu state=%s first_raw_ms=%lu debounced_ms=%lu\n",
      (unsigned long)event.sequence(), doorState(event.state(event.stableAt())),
      (unsigned long)event.edgeAt(), (unsigned long)event.stableAt());
  }

  // WIFI RECONNECT
  // --------------------------------------------------

  if (
    WiFi.status() !=
      WL_CONNECTED
  ) {

    doorHeartbeat.disconnected();
    if (
      millis() -
        lastReconnect >=
        10000
    ) {

      lastReconnect =
        millis();

      Serial.println(
        "WiFi disconnected - attempting reconnect..."
      );

      WiFi.reconnect();
    }

    delay(10);

    return;
  }


  // --------------------------------------------------
  // HEARTBEAT
  // --------------------------------------------------

  const auto snapshot = doorSnapshot();
  const uint32_t now = millis();
  if (doorHeartbeat.due(snapshot.state(now), snapshot.fresh(now), now)) {
    heartbeat(snapshot);
    // Give a transition captured during the POST priority over starting a
    // second blocking operation. Periodic retries alone must not starve polls.
    const auto latest = doorSnapshot();
    if (diagnostics.heartbeatAccepted && latest.fresh(millis()) &&
        latest.sequence() != snapshot.sequence()) return;
  }


  // --------------------------------------------------
  // COMMAND POLLING
  // --------------------------------------------------

  if (
    millis() -
      lastPoll >=
      2000
  ) {

    lastPoll =
      millis();


    if (
      pendingReport
    ) {

      report();
    }
    else if (
      diagnostics.canPoll(storageReady)
    ) {

      poll();
    }
  }


  delay(1);
}

} // namespace locker::firmware
