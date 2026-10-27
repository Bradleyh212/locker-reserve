# Locker Reserve firmware

`src/` is the main ESP32 firmware target. `device-check/` remains a separate,
standalone diagnostic; uploading either replaces the firmware on the board.
This migration does not establish production security or a hardware duty rating.

## Layout

- `src/src.ino`: Arduino sketch marker (open this file to flash the main firmware).
- `src/main.cpp`: Arduino setup/loop entry points.
- `src/firmware_app.cpp`: Wi-Fi reconnect, certificate-verified HTTPS, heartbeat,
  command polling, target/expiry validation, persistent consumption journal,
  result reporting and GPIO adapters.
- `include/firmware_app.h`: main application lifecycle interface.
- `include/door_sensor.h`: testable debounced sensor; reliable state and fresh unlock permission are separate.
- `include/locker.h`, `src/locker.cpp`: shared timed output controller.
- `include/config.example.h`: main target configuration template; disabled by default.
- `include/config.local.h`: private main configuration, ignored by Git.
- `test/`, `sim/`, `scripts/run-host.sh`: hardware-free tests and simulation.
- `device-check/`, `usb-check/`, `reed-check/`: independent diagnostics.
- `circuit-check/`: historical wiring diagnostic; output always LOW, no actuation.

## Build and flash

Use Arduino ESP32 core **3.3.12**, board **ESP32 Dev Module** (`esp32:esp32:esp32`).
No PlatformIO migration is needed. Arduino compiles the `.cpp` files alongside
`src.ino`; do not add the diagnostic `actuator.cpp` to this target (it would duplicate
`locker.cpp`). All includes under `include/` are resolved relative to these sources.

1. Keep your existing private `include/config.local.h`. On another machine, copy
   `include/config.example.h` to `include/config.local.h`. Copy Wi-Fi, API URL,
   device/locker IDs, token and CA from the working diagnostic private config.
   Do not copy its old maximum blindly. Never commit credentials.
2. `MAX_PULSE_MS` defaults to **5000**, the temporary software ceiling requested
   for the next supervised test. `ACTUATION_ENABLED` defaults to **false**.
   A successful 200 ms test does not establish a five-second coil duty rating.
3. Open **`firmware/src/src.ino`** in Arduino IDE. Select ESP32 Dev Module and the
   USB port. Disconnect coil power while flashing. Upload and open Serial Monitor
   at 115200 baud. Output GPIO26 is preloaded LOW before OUTPUT mode or networking.
4. Verify HTTPS heartbeat 200, firmware version `locker-firmware-0.2`, and sensor
   changes in Devices. GPIO27 uses INPUT_PULLUP; contact to GND means CLOSED.
5. For the physical test, explicitly enable the private main firmware config and
   set the API's private `DEVICE_MAX_PULSE_MS` to the desired tested ceiling
   (at most 5000). Recompile/upload and restart the API after configuration changes.
   The dashboard uses the smaller server/device limit. Enter the requested
   duration explicitly: there is no automatic 200 ms default, and the form keeps
   your chosen duration after submission. Neither ceiling is the requested
   pulse duration. Begin physical validation with a known tested short pulse.

Command-line build from the repository root (after configuring Arduino CLI):

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/src
arduino-cli upload --fqbn esp32:esp32:esp32 --port YOUR_USB_PORT firmware/src
sh firmware/scripts/run-host.sh
```

If Arduino CLI uses a non-default installation, supply its `--config-file` option.
No firmware upload or physical command is part of the automated verification.

## Command and sensor rules

- Hard ceiling 5000 ms in the shared controller, main configuration assertion and
  API. A higher configured ceiling fails closed; API defaults to disabled.
- Main sensor CLOSED requires 50 ms stable sampling. Opening immediately revokes
  CLOSED permission. A gap greater than 250 ms invalidates freshness, but retains
  the last debounced OPEN/CLOSED state. Boot has no reliable observation: UNKNOWN.
  Heartbeat and pre-actuation paths re-sample for 55 ms after blocking operations.
  Heartbeats send UNKNOWN if sampling still has not settled (for example, bounce);
  retained historical CLOSED alone never authorizes actuation.
- Serial diagnostics log debounced changes with uptime. Heartbeat logs display
  the exact contact snapshot sent, rather than a new reading after HTTPS.
- API considers a heartbeat recent for less than 15 seconds. Enqueue **and delivery**
  require recent CLOSED, enabled device/locker, enabled actuation and inactive output.
  A heartbeat is an observation, not proof of the current mechanical latch state.
- Before actuation, firmware re-samples for 55 ms after HTTPS/NVS operations and
  rechecks CLOSED, Wi-Fi and expiry. The sensor alone never triggers an unlock.
- Commands are consumed in NVS before activation. Duplicates/older commands,
  invalid targets, duration or expiry, unavailable storage and invalid TLS/API
  responses cannot start an output pulse. Pending reports block further polling.
- No HTTP/TLS or NVS writes while the output is active. The loop ticks the shared
  controller frequently. Observed Wi-Fi loss stops an active pulse and reports FAILED.
  API loss during an already-started pulse is not synchronously detectable: the
  local deadline still ends it. Result reporting retries after connectivity returns.
- An expired/UNKNOWN unresolved command blocks new requests; do not erase the
  journal or database history to force a retry.
- The old diagnostic remains independent and retains its original 1000 ms compile
  ceiling. Use the main target for CLOSED-only physical tests.

## Supervised acceptance tests

1. CLOSED + recent heartbeat: request 200 ms, observe one pulse and its result.
2. OPEN and UNKNOWN: verify readiness is blocked and direct admin POST is rejected.
3. Disconnect Wi-Fi: after 15 seconds, API rejects enqueue/delivery. Reconnect and
   verify a new heartbeat; expired commands must never be replayed.
4. Open the contact after enqueue: no new pulse may start with an open/unstable
   contact. A server snapshot can lag; the local interlock is the final check.
5. Reset during/past a command: output off at boot, no replay; unfinished result
   remains UNKNOWN. Inspect before any next request.
6. Verify 5001 ms is refused; automated boundary tests use fake outputs only.

`tick()` is software-controlled, not an independent hardware cutoff. A wedged MCU,
reset-time pin float or failed MOSFET requires hardware mitigation. Physical timing,
coil heating/duty cycle and reset/brownout behavior still need bench verification.
A reed contact cannot distinguish an open door from a disconnected wire; a shorted
wire can resemble CLOSED. None of these states proves latch engagement.


## Host tests and simulator

Requirements: a C++17 compiler (`c++`, or set `CXX`) and a POSIX shell. On macOS,
Xcode Command Line Tools supply the compiler. Docker, Stripe, Wi-Fi credentials
and API environment files are not needed for these hardware-free tests.

From the repository root:

```sh
sh firmware/scripts/run-host.sh
```

This compiles and runs controller/sensor tests and a deterministic simulation
without sleeps or real hardware. Outputs stay in ignored `firmware/build/`.
The fake output is in `sim/`, with a simulated clock supplied by the demo.
Expected simulation output:

```text
Simulation: output inactive; door unknown
Simulation: output active
Simulation: deadline reached; output inactive; door unknown
```

Tests cover boot reset, pulse limits, no extension while busy, 32-bit clock wrap,
late ticks, explicit stop, missing sensors, debounce and communication gaps.
The 500/1000 ms demo values are simulation fixtures, not selected lock ratings.
The simulator has no sensor adapter, so its door state stays UNKNOWN.

## Shared controller boundaries and diagnostic history

`Locker::requestPulse` is a low-level actuator request, not an authorized customer
unlock. The shared controller alone has no command IDs, expiry, persistence or
reboot journal. The main firmware application supplies those protections and
checks fresh CLOSED before requesting a pulse. Do not expose the controller
itself directly to a network endpoint. See the
[device contract](../docs/embedded/device-api.md) and
[access policy](../docs/embedded/access-control.md) for the surrounding requirements.

The controller is single-threaded and requires the output adapter to outlive it.
It uses caller-supplied monotonic milliseconds. `tick()` must run frequently;
output turns off when tick/stop runs, so blocking calls can delay cutoff. The main
application avoids blocking HTTP/NVS work while output is active. Clock arithmetic
supports one 32-bit wrap, not gaps spanning an entire clock period. Independent
cutoff/watchdog design and boot-pin behavior still require hardware validation.

The standalone [USB serial](usb-check/README.md) and
[reed sensor](reed-check/README.md) sketches were bench-tested by Bradley on
2026-10-05 with ESP32 Dev Module and Espressif core 3.3.12. They remain separate
diagnostics. The earlier scaffold roadmap for GPIO, Wi-Fi, HTTPS, journal and
debounced input is now implemented in the main target described above; it is not
an outstanding prerequisite for compiling that target. PlatformIO is not required.
See [hardware selection](../docs/embedded/hardware.md) for physical constraints.

## Review hardening: command results and provisioning

Both network firmware targets parse command timestamps explicitly as UTC and
journal identifiable, correctly addressed rejections with a reason. Invalid
identities or foreign targets are ignored without acknowledging another device's
command. Rejected timestamps never advance the replay watermark; duplicate IDs
re-send their recorded result without another pulse.

Result delivery requires HTTP 200 with `accepted: true`. Transport/server failures,
408 and 429 retry with bounded exponential delay (2–60 seconds). Other 4xx responses
persist a report-blocked fault and stop new commands, including after reboot.
Serial output identifies this fault, and heartbeats advertise actuation disabled so
the API/dashboard cannot enqueue further unlocks after observing it. An operator must inspect the command/result,
resolve credentials or server discrepancies, and explicitly clear only the
`reportBlocked` journal flag using a controlled maintenance procedure before
retrying the identical pending result. No automatic reset, journal deletion,
re-actuation or queue bypass is provided. Keep the consumed ID, watermark, result,
reason and pending flag intact; this release does not include a maintenance UI.

Provisioning writes and flushes the exclusive 0600 credential file before database
creation. Known database rejections remove the new file. An uncertain database
commit retains it for recovery: inspect the device row before retrying. Filesystem
and database operations are not one atomic transaction. Errors use fixed messages
rather than exposing raw database/connection details. Run its failure-path tests:
`node --test services/api/scripts/provision-device.test.cjs`.
