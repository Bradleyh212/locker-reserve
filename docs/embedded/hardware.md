# Hardware plan and selection checklist

Status: planned. No exact component models, wiring pinout or tested circuit are recorded yet. This is a selection/validation checklist, not a construction-ready schematic.

## Bill of materials to finalize

| Part | Required information before purchase or connection |
| --- | --- |
| ESP32 development board | Exact board/module, supported toolchain, USB interface, pinout, input-power limits and boot-pin behavior. |
| 12V solenoid lock | Exact part/datasheet, current, permitted duty cycle/pulse, mechanical dimensions, latch behavior and behavior without power. |
| Lock driver | Switching ratings, compatibility with the board's logic level, input polarity, default-off behavior and included protection. |
| Inductive-load protection | Confirm the driver/lock manufacturer's suppression circuit; document any required external flyback protection and polarity. |
| 12V supply | Load budget for coil and electronics, supply rating, connectors and protection. |
| ESP32 power path | Board-approved USB supply or suitable regulation from the lock supply; document shared-ground/isolation requirements of the chosen circuit. |
| Wiring/enclosure | Rated wire/connectors, strain relief, insulation and mounting. A breadboard is optional for signal prototyping; validate the coil-current path separately. |
| Optional reed sensor | Contact type, mounting/magnet alignment, pull-up arrangement, input limits and debounce behavior. |

Do not power the solenoid from a GPIO or apply 12V to an ESP32 GPIO. GPIO controls the driver; the supply powers the coil. Determine the actual schematic from selected parts' documentation, including whether suppression is already fitted. No universal pin numbers or pulse duration are approved here.

## Functional arrangement

12V supply → protected driver/coil power path → solenoid. ESP32 GPIO → driver control input. A separate board-approved power path supplies the ESP32. Optional reed contacts feed a compatible digital input. See the [system diagram](../diagrams/architecture.mmd) for functional connections, not electrical wiring.

Before energizing a lock, add a reviewed schematic and pin table with voltage, polarity, default output state, fuse/protection details and datasheet references. Verify output behavior during boot, reset and power loss with the actual board/driver.

## State and mechanical checks

Record whether power releases or engages the selected lock. Do not infer fail-safe/fail-secure behavior from the word “solenoid.” Verify door closure and mechanical engagement separately from electrical activation. A reed sensor measures door position, not latch engagement; without it report door state as unknown.

Measure required activation time within the manufacturer's rating, repeat-use heating, supply sag and sensor behavior. Preserve an authorized physical recovery method for power/network faults. Record tested limits before enabling real actuation.
