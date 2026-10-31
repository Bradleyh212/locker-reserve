> Diagnostic target retained independently. The main firmware is now
> `../src/src.ino`; see `../README.md`. This diagnostic does not implement the
> main target's CLOSED-only interlock and retains its 1000 ms compile ceiling.

# ESP32 device API bench client

Status: prototype implementation; physical API activation has not been verified.
Hardware: ELEGOO classic ESP32, GPIO26 -> XY-MOS TRIG/PWM, common GND,
GPIO27 -> reed contact -> GND with INPUT_PULLUP. ESP32 stays USB powered.
The 12V supply connects only to the driver/coil; fit the external flyback diode
with cathode stripe at OUT+. Confirm control-pad solder joints and power wiring.

## Before powering the coil

A previous approximately 60-second activation is an observation, not a validated
continuous duty rating. This intermittent coil needs a verified pulse ceiling and
cooldown. ACTUATION_ENABLED defaults false, MAX_PULSE_MS defaults zero, and the
API also defaults disabled. The 1000ms software bound is NOT a hardware rating.
Validate output polarity, off state at reset/brownout and actual pulse duration
with the coil disconnected first. Firmware does not control pins before setup;
verify the driver's input pull-down and fit external bias if required.

## Configure and compile

Copy config.example.h to config.local.h (ignored by Git). Fill Wi-Fi credentials,
API HTTPS URL, device ID, database locker UUID, unique device token and CA PEM.
Use the Mac's LAN address, not localhost. The ESP32 and Mac must have network
reachability; campus client isolation/captive portals may prevent this.
Never use setInsecure or commit secrets. Time synchronization must succeed before
HTTPS/commands work. This bench client uses SNTP; authenticated time provisioning
and credential protection remain deployment hardening work.

Arduino IDE: open device-check.ino; select ESP32 Dev Module with Espressif 3.3.12.
No additional Arduino libraries are needed. Compile/upload with the coil supply
disconnected. Open Serial Monitor at 115200. First verify heartbeat and contact
changes with ACTUATION_ENABLED=false. This sketch does NOT activate on reed changes.

After validating hardware, set MAX_PULSE_MS to the approved ceiling and
ACTUATION_ENABLED=true; configure DEVICE_MAX_PULSE_MS on the API to the same ceiling.
Only then enable the coil supply and request one supervised pulse in /devices.
The API enforces a 30-second minimum cooldown, also not a validated duty rating.

## Command handling

Outbound HTTPS heartbeat every 5 seconds, poll/result retry every 2 seconds.
Server certificate/hostname verification is mandatory. Commands require version,
ID, matching device/locker, type, reliable current time, expiry and duration.
A single NVS journal records consumption before output activation. The timestamp
watermark rejects older/replayed commands, including across reboot. Do not erase
NVS with a pending command; database timestamps must remain monotonic per device.
One pending result blocks further polling until acknowledged. Reboot during a
consumed but unfinished command reports UNKNOWN, without another pulse.

The existing host-tested Locker primitive enforces the pulse deadline. Network
requests and reconnection happen only while inactive, never during the pulse.
This is software cutoff, not an independent hardware watchdog. Timing under load
and brownout still requires bench verification before unattended use.

Contact input is debounced for 50ms; OPEN can also mean a disconnected wire.
Neither CLOSED nor OUTPUT_PULSE_COMPLETED proves mechanical locking/unlocking.
Heartbeat observations are sampled while inactive; command results describe pulse
completion. The dashboard shows last-seen age so stale observations remain visible.

## Limits

Admin bench requests only; no customer reservation authorization is implemented.
Expired commands with no result remain unresolved and block new pulses. Inspect
hardware and reconcile the command before attempting another request; do not delete
command history to bypass uncertainty. No OTA or production commissioning yet.
