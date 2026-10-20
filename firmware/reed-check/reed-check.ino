#include <Arduino.h>

constexpr int DOOR_PIN = 27;

void setup() {
  Serial.begin(115200);
  pinMode(DOOR_PIN, INPUT_PULLUP);
}

void loop() {
  const bool contactClosed = digitalRead(DOOR_PIN) == LOW;

  Serial.println(contactClosed
    ? "Contact CLOSED — magnet near"
    : "Contact OPEN — magnet away or disconnected");

  delay(500);
}
