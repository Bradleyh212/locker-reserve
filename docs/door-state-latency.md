# Door-state latency

On the main-branch implementation, GPIO27 uses INPUT_PULLUP. A 50 ms stable level establishes OPEN or CLOSED; after a sampling gap longer than 250 ms the sensor must settle again. Reporting takes a fresh 55 ms sample. Before this change, the next five-second heartbeat carried the state. The authenticated API writes the device row before replying. The admin page reads that row every three seconds. Command polling (two seconds) doesn't report the door. Wi-Fi reconnect attempts are ten seconds apart. HTTPS is synchronous with two-second connect/read timeouts and a five-second TLS handshake timeout. The two polling phases, network stalls and the active-pulse exclusion can all contribute to the observed delay.

The firmware now sends the current debounced state using the same heartbeat on a change or Wi-Fi recovery. Extra attempts are spaced by at least 500 ms; a failed attempt waits for the five-second fallback, which resamples the current level. An acknowledged observation replaces the previous level. A burst can coalesce intermediate states. All network work still takes place with the output inactive. Fresh local contact, expiry and output checks remain in the command path.

Timestamped firmware sends UTC sample milliseconds using its already-synchronized clock. A conditional database write accepts only strictly newer samples, rejects samples outside the freshness budget, and caps last-seen at receipt time. The dashboard explicitly bypasses the HTTP cache and ignores late completions of older reads. Legacy devices continue sending receipt-timed heartbeats. Once a device has reported timestamps, unstamped reports cannot replace it. A deliberate rollback to older firmware requires an operator to clear that device's timestamp watermark while the device is offline and invalidate its last contact (UNKNOWN and lastSeen null). Apply the database migration and updated API before upgrading firmware. No OTA mechanism is needed by this change.

## Measurements

| Source | Before | After |
| --- | --- | --- |
| User's three physical trials, opening | ~6, 11, 8 s | Awaiting hardware retest |
| User's three physical trials, closing | ~1–2, 6, 9 s | Awaiting hardware retest |
| Host simulation, median | 4.10 s | 1.65 s |
| Host simulation, 95th percentile | 6.90 s | 3.00 s |
| Host simulation, maximum in sweep | 8.05 s | 3.55 s |

Run the host suite to reproduce the simulation. It exercises the firmware scheduler while varying the reed transition and browser poll phase independently in 50 ms increments. It includes the 55 ms reporting sample and assumes an idle output, healthy connection and negligible network time. These are scheduling estimates, not physical upper bounds. A change during a pulse can wait for the rest of that pulse. The browser still contributes up to approximately three seconds with a visible, responsive tab.

For a physical retest, leave the actuator inactive and move the magnet independently. Enable the optional LOCKER_DOOR_TIMING compiler define for device uptime at sample and response. Compare the debounced Serial line, heartbeat HTTP status, authenticated admin devices response in the browser Network panel, and visible state. Use a common clock or film the magnet and dashboard together for end-to-end timing. Record opening and closing separately, including timeouts and reconnects. No unlock is needed for this measurement.
