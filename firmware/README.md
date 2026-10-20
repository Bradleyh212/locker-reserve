# Locker Reserve firmware scaffold

Status: host-tested C++ actuator logic and fake output, plus standalone
[USB serial](usb-check/README.md) and [reed sensor](reed-check/README.md) Arduino
bench sketches tested by the user on 2026-10-05. No hardware actuator adapter, Wi-Fi,
API client or device credential handling is implemented yet.

## Run before hardware arrives

Requirements: a C++17 compiler (`c++`, or set `CXX`) and a POSIX shell. On macOS,
the compiler is supplied by Xcode Command Line Tools. Docker, Stripe and `.env`
files are not needed for this simulator.

From the repository root:

```sh
sh firmware/scripts/run-host.sh
```

This compiles/runs tests and a deterministic simulation without sleeps or real
hardware. Build outputs stay in ignored `firmware/build/`.

Expected simulation output:

```text
Simulation: output inactive; door unknown
Simulation: output active
Simulation: deadline reached; output inactive; door unknown
```

## Structure

- `include/locker.h`: output interface, output/door states and controller API.
- `src/locker.cpp`: default-inactive output, duration validation, busy rejection,
  elapsed-time cutoff and explicit stop.
- `sim/`: fake output and a simulated clock supplied by the demo.
- `test/`: boot reset, timing limits, no extension while busy, 32-bit clock wrap,
  delayed tick, stop and absent-sensor tests.
- `scripts/run-host.sh`: dependency-free host compile/test/demo runner.
- `usb-check/`: standalone USB upload and serial uptime check.
- `reed-check/`: standalone GPIO27/GND dry-contact sensor check.

## Boundaries

`requestPulse` is a low-level actuator request, not an authorized customer unlock.
It has no command IDs, expiry, persistence, duplicate protection or reboot journal.
Do not connect it directly to a network endpoint. Those layers must implement the
[device contract](../docs/embedded/device-api.md) and
[access policy](../docs/embedded/access-control.md) before physical deployment.

The controller is single-threaded, requires the output adapter to outlive it,
and uses caller-supplied monotonic milliseconds. `tick` must run frequently;
output only turns off when tick/stop runs. Blocking network calls can delay cutoff.
A real driver needs a validated independent cutoff/watchdog design and boot pin
behavior before hardware use. The clock must not move backward; elapsed-time
arithmetic supports one 32-bit wrap, not gaps spanning an entire clock period.

The 500/1000 ms demo/test values are simulation fixtures, not selected lock ratings.
Door state stays unknown without a sensor adapter. Inactive output does not prove
that a physical latch is locked.

## Next implementation steps

1. Select the exact ESP32 board, framework and validated lock/driver timings.
2. Add a pinned board build configuration and inactive-at-boot GPIO adapter.
3. Add durable command consumption and replay/expiry/target validation with tests.
4. Add Wi-Fi provisioning/reconnection and HTTPS client with verified server trust.
5. Add optional door input, debounce and supervised hardware tests.

The bench sketches use Arduino IDE with `ESP32 Dev Module` and Espressif core
3.3.12. The integrated firmware build and PlatformIO configuration remain planned.
See [hardware selection](../docs/embedded/hardware.md).
