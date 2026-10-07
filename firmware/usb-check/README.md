# USB-only ESP32 bring-up

This standalone Arduino sketch checks compilation, USB upload and serial output.
It does not run the locker controller, access Wi-Fi or configure actuator GPIO.
Keep all external wiring disconnected for this test.

Verified by Bradley on 2026-10-05: compilation, upload with flash hash verification,
and repeating serial uptime output (including 60000 ms). The upload identified
ESP32-D0WD-V3 revision v3.1 on the ELEGOO board. Configuration: `ESP32 Dev Module`,
`esp32` by Espressif Systems 3.3.12, observed port `/dev/cu.usbserial-0001`
(port names can change). Reset-button behavior has not been separately recorded.

For a new development machine, install Arduino IDE and `esp32` by Espressif Systems
through Boards Manager using the official instructions:
https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html

For the purchased classic ESP-WROOM-32 board, confirm the module label and select
`ESP32 Dev Module` (not an S2/S3/C3 board). The tested board-package version is recorded above. This bring-up sketch does not decide
the eventual PlatformIO project configuration.

1. Connect one ESP32 to the Mac using a USB data cable; no 12V/driver connections.
2. Open `usb-check.ino` in Arduino IDE.
3. Select the board and its newly appearing USB serial port.
4. Click Verify, then Upload. Close other serial monitors before uploading.
5. Open Serial Monitor at 115200 baud. Expect an uptime message every second.
6. Press EN/reset to verify restart and repeating output.

If the port is missing, check cable/data support and USB detection first; do not
install an arbitrary driver. If upload cannot connect, use the board-specific
BOOT/reset procedure after verifying board/port selection. On Apple Silicon, an Intel-only tool such as `ctags` may require Rosetta; see
[Arduino troubleshooting](https://support.arduino.cc/hc/en-us/articles/7765785712156-Error-bad-CPU-type-in-executable-on-macOS).
