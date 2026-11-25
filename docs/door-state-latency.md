# Door-state latency

GPIO27 is active LOW with INPUT_PULLUP. Previously the Arduino loop read the pin,
performed synchronous HTTPS and took another 55 ms sampling window before a
heartbeat or command decision. A complete open/close cycle inside a command GET
could go unobserved. The two-second command poll does not transmit door state.

A FreeRTOS task now reads the pin about every 10 ms during networking, Wi-Fi
recovery and command processing. The existing debounce requires 50 ms of stable
input. A gap over 250 ms requires settling again. A short critical section
protects sampling and snapshot copies. A live OPEN sample immediately revokes
local CLOSED permission. The command path also checks the pin directly after
journaling and checks freshness, Wi-Fi and expiry before requesting a pulse.

Only the network loop sends heartbeats. A fresh changed level is eligible on
the next free pass after a successful acknowledgment, including changes captured
during a poll or POST. Reconnect requests a current snapshot. An unaccepted
attempt closes the command gate and retries on the five-second periodic cadence.
The single-flight sender coalesces intermediate levels. It timestamps a known
state at its last GPIO sample and reports UNKNOWN for an unsettled or stale input.

The API validates the sample's freshness and ordering, commits the device row
and then acknowledges. The admin dashboard requests fresh data every three
seconds while visible and responsive, skipping a tick if a request is pending.
The POST, network retries and dashboard fetch add separate delays.

The existing API also caps last-seen at receipt time. Once a device has sent
timestamped observations, unstamped reports cannot replace them. For a deliberate
rollback to unstamped firmware, the existing procedure requires the device to be
offline while an operator clears its timestamp watermark and invalidates its last
contact (UNKNOWN and null lastSeen). This sampler revision uses the existing API
and schema.

## Timing

Run `sh firmware/scripts/run-host.sh`. The virtual-clock test sweeps ten edge
phases against a 10 ms sampler during an eight-second command GET. It detects
stable OPEN in 50–59 ms. With an injected 300 ms POST, simulated edge-to-ACK is
7,291–7,300 ms. Another CLOSED transition during that POST is captured locally
and eligible for the next report. These results assume the sampler runs on time.

Prior physical observations on the old firmware were approximately 6, 11 and 8 s
for opening and 1–2, 6 and 9 s for closing, measured through the dashboard.
Revised physical and cloud timings require a supervised retest.

At 115200 baud, match the transition and response sequence numbers. Subtract
`first_raw_ms` from `debounced_ms` for sampled debounce time. Subtract
`debounced_ms` from `scheduled_ms` for network scheduling delay. The HTTP
line gives request duration. For the first `accepted=1` response carrying a
change, `response_ms - debounced_ms` gives device-observed time to acknowledgment.
A periodic report can repeat a sequence. Use uptime values, since serial lines
can drain later. A gap in transition sequence numbers indicates dropped local
diagnostic records. The queue holds 16 transitions and never drives reporting
or authorization. Film the magnet and dashboard together for physical
edge-to-display timing. Keep coil power disconnected throughout.
