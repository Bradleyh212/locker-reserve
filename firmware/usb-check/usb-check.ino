// USB-only bring-up. Leave the driver, solenoid and all external wiring disconnected.
// No GPIO outputs, network credentials or actuator commands are configured.
#include <Arduino.h>

unsigned long lastMessageMs = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("Locker Reserve: USB serial test started");
}

void loop() {
  const unsigned long nowMs = millis();
  if (nowMs - lastMessageMs >= 1000UL) {
    lastMessageMs = nowMs;
    Serial.print("ESP32 running; uptime ms: ");
    Serial.println(nowMs);
  }
  delay(1);
}
