#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <cJSON.h>
#include <time.h>
#include "../include/locker.h"
#include "../include/device_protocol.h"
#include "../include/door_sensor.h"
#include "../include/firmware_app.h"

#if __has_include("../include/config.local.h")
#include "../include/config.local.h"
#else
#include "../include/config.example.h"
#endif

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
uint32_t lastHeartbeat = 0;
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

void readSensor() {
  const auto before = sensor.state(millis());
  sensor.sample(digitalRead(DOOR_PIN) == LOW, millis());
  const auto after = sensor.state(millis());
  if (before != after) {
    Serial.printf("Reed debounced: %s at %lu ms\n",
      after == locker::DoorState::Closed ? "CLOSED" : "OPEN",
      static_cast<unsigned long>(millis()));
  }
}
// Only while output is inactive: get a fresh stable observation before reporting
// or authorizing, even if a blocking HTTPS operation interrupted sampling.
void refreshSensor() {
  const uint32_t start = millis();
  do { readSensor(); delay(1); } while (millis() - start < 55);
}
const char* doorState() {
  switch (sensor.state(millis())) {
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
    return -1;
  }

  if (time(nullptr) < 1767225600) {
    Serial.println("HTTP skipped: system time not synchronized");
    return -1;
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
    return -1;
  }

  Serial.print("Request: ");
  Serial.println(url);

  if (!http.begin(client, url)) {
    Serial.println("HTTP begin() failed");
    return -1;
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

  return code;
}


// --------------------------------------------------
// Heartbeat
// --------------------------------------------------

void heartbeat() {
  refreshSensor();
  const String reportedDoor = sensor.fresh(millis()) ? doorState() : "UNKNOWN";
  if (!sensor.fresh(millis())) Serial.println("Reed unsettled: heartbeat reports UNKNOWN; output remains inhibited");
  cJSON* b = cJSON_CreateObject();

  cJSON_AddStringToObject(
    b,
    "doorState",
    reportedDoor.c_str()
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

  String response;

  int code = request(
    "/v1/device/heartbeat",
    jsonString(b),
    response
  );

  Serial.printf(
    "Heartbeat HTTP %d; contact %s; output inactive\n",
    code,
    reportedDoor.c_str()
  );
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
  refreshSensor();
  if (!sensor.canUnlock(millis()) ||
      WiFi.status() != WL_CONNECTED ||
      expires <= (int64_t)time(nullptr) * 1000 + 1000) {
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
      "locker-api",
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

  readSensor();

  // --------------------------------------------------
  // WIFI DEBUG
  // --------------------------------------------------

  Serial.println();
  Serial.print(
    "Connecting to WiFi SSID: "
  );

  Serial.println(
    WIFI_SSID
  );

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

  readSensor();


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
  // WIFI RECONNECT
  // --------------------------------------------------

  if (
    WiFi.status() !=
      WL_CONNECTED
  ) {

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

  if (
    millis() -
      lastHeartbeat >=
      5000
  ) {

    lastHeartbeat =
      millis();

    heartbeat();
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
      storageReady
    ) {

      poll();
    }
  }


  delay(1);
}

} // namespace locker::firmware
