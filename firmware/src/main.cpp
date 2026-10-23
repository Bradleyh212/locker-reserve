#include "../include/firmware_app.h"
void setup() { locker::firmware::begin(); }
void loop() { locker::firmware::run(); }
