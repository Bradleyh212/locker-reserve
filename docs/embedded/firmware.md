# ESP32 firmware development plan

Status: planned. There is no `firmware/` directory or flashable image yet. C++ runs on the ESP32; web/API code remains in `services/web` and `services/api`.

## Proposed structure

```text
firmware/
  platformio.ini       # only if PlatformIO is selected
  src/main.cpp         # boot and cooperative scheduling
  src/locker.cpp       # command/state logic
  include/locker.h
  src/lock_driver.cpp  # real or fake output implementation
  src/door_sensor.cpp  # optional input implementation
  src/wifi_manager.cpp
  src/device_client.cpp
  test/                # host logic and device integration tests
```

Toolchain proposal: PlatformIO with an Arduino framework for the first prototype; ESP-IDF remains an alternative. Select the exact board and pin versions before creating build configuration. See [ADR 0002](../adr/0002-firmware-toolchain.md) and the [PlatformIO ESP32 reference](https://docs.platformio.org/en/latest/platforms/espressif32.html).

## Work before parts arrive

1. Define clock, command store, network client and hardware interfaces.
2. Implement the state machine against fake outputs and a controllable clock. Logging a simulated activation does not mean a physical door opened.
3. Build a host simulator for the [proposed contract](device-api.md); the routes must be implemented or mocked first.
4. Test expiry, wrong-target rejection, duplicates, uncertain execution and missing sensors.
5. Add board adapters after hardware selection. Host tests do not emulate electrical behavior or ESP32 Wi-Fi.

## Runtime behavior

Boot with the output inactive, read configuration and recover the command journal without replaying prior activations. Join provisioned Wi-Fi and synchronize trustworthy time before accepting time-limited commands. Retry connectivity with bounded backoff/jitter. Network work must never extend the locally enforced activation limit.

Before execution, validate target, protocol version, command ID, validity window and duration against configured hardware limits. Persist consumption before activation; after a crash report an uncertain outcome rather than retrying the pulse. A crash between consumption and activation can mean no actuation occurred. Exactly-once physical execution is not guaranteed.

Maintain separate network, command, output and sensor state. When the sensor is absent/unreliable, send unknown. Apply debounce only after defining contact polarity. Never report “locked” solely because the output is off.

## Configuration and first flash

Record board ID, pinned framework/libraries, output pin/polarity, validated pulse ceiling, sensor presence/pin, Wi-Fi credentials, public API URL, device ID, unique credential and server trust configuration. Keep secrets in a provisioning path outside Git and redact serial logs.

Once a build project exists, document its exact build command, USB port selection, upload and serial-monitor commands. First boot with the actuator disconnected; verify configuration and inactive output, then complete the [bench tests](testing.md). Record firmware version and build identifier. USB flashing is the proposed initial update path; OTA is future work requiring a separate signed-update/recovery design.

HTTPS must validate the server certificate and hostname; do not use an insecure bypass. Plan trust-store maintenance. See [Espressif HTTP client TLS configuration](https://docs.espressif.com/projects/esp-idf/en/v5.5.3/esp32/api-reference/protocols/esp_http_client.html); concrete APIs depend on the chosen framework.
