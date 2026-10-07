# Reed sensor bench check

Standalone Arduino sketch, separate from the host actuator controller. This saves
the sketch supplied for the user's successful bench test on 2026-10-05.

## Wiring and upload

Disconnect USB before wiring. Connect the QWORK MC-38 dry-contact sensor between
D27 (GPIO27) and GND on the ELEGOO ESP32 board. Either sensor wire can go to either
pin. Use two separate lever connectors, with stripped wire seated and secured;
check each connection with a gentle tug. Do not connect the sensor to 12V.

Keep the driver, solenoid and 12V supply disconnected. Power the board through USB.
Open `reed-check.ino`, select `ESP32 Dev Module` with `esp32` by Espressif Systems
3.3.12, select the USB serial port and upload. Open Serial Monitor at 115200 baud.

The internal pull-up holds the input HIGH when the contact is open. A closed
contact connects it to GND (LOW). Move the supplied magnet toward and away from
the wired sensor: expect CLOSED near and OPEN away. The user confirmed both
states, including after securing the wires in the lever connectors.

## Limits

This is a raw contact check sampled every 500 ms, without debounce or fault
supervision. OPEN cannot distinguish an absent magnet from disconnected wiring.
CLOSED does not prove latch engagement or an authorized unlock. No actuator,
networking or integration with the host controller is implemented here.
