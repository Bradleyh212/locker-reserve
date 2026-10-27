#include <Arduino.h>
#include "../include/door_sensor.h"

// Historical wiring diagnostic: deliberately never energizes the solenoid.
constexpr int DOOR_PIN = 27;
constexpr int LOCK_PIN = 26;
locker::DoorSensor sensor;
locker::DoorState lastState = locker::DoorState::Unknown;

void setup() {
  digitalWrite(LOCK_PIN, LOW);
  pinMode(LOCK_PIN, OUTPUT);
  pinMode(DOOR_PIN, INPUT_PULLUP);
  Serial.begin(115200);
  Serial.println("Circuit diagnostic: output inactive; contact UNKNOWN; no actuation");
}

void loop() {
  sensor.sample(digitalRead(DOOR_PIN) == LOW, millis());
  const auto state = sensor.state(millis());
  if (state != lastState) {
    Serial.println(state == locker::DoorState::Closed ? "Contact CLOSED; output inactive" :
                   state == locker::DoorState::Open ? "Contact OPEN; output inactive" :
                   "Contact UNKNOWN; output inactive");
    lastState = state;
  }
  delay(1);
}
