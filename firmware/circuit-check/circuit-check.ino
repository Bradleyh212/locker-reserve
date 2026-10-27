#include <Arduino.h>

constexpr int DOOR_PIN = 27;
constexpr int LOCK_PIN = 26;

bool lastMagnetDetected;

void setup() {
  Serial.begin(115200);

  pinMode(DOOR_PIN, INPUT_PULLUP);
  pinMode(LOCK_PIN, OUTPUT);

  digitalWrite(LOCK_PIN, LOW);

  lastMagnetDetected = digitalRead(DOOR_PIN) == LOW;

  // Print initial state once
  Serial.println(lastMagnetDetected
    ? "Magnet detected -> UNLOCKED"
    : "No magnet -> LOCKED");
}

void loop() {
  const bool magnetDetected = digitalRead(DOOR_PIN) == LOW;

  if (magnetDetected != lastMagnetDetected) {
    if (magnetDetected) {
      digitalWrite(LOCK_PIN, HIGH);
      Serial.println("Magnet detected -> UNLOCKED");
    } else {
      digitalWrite(LOCK_PIN, LOW);
      Serial.println("No magnet -> LOCKED");
    }

    lastMagnetDetected = magnetDetected;
  }

  delay(50);
}