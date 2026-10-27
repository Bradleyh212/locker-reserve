# Historical circuit check

Bradley originally tested reed-driven solenoid switching here. That historical
behavior could energize the coil indefinitely and its LOCKED/UNLOCKED messages
could not prove latch state.

The retained sketch is now a non-actuating wiring diagnostic: GPIO26 is preloaded
LOW at boot and never driven HIGH. GPIO27 uses INPUT_PULLUP and the shared 50 ms
reed debounce. Logs report contact state separately from the inactive output.
Use the main firmware for bounded, explicitly enabled, CLOSED-only API tests.
