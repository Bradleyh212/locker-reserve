# ADR 0002: ESP32 C++ toolchain

Status: proposed. Date: 2026-10-02.

Decision proposal: create a separate firmware project, initially using PlatformIO and an Arduino framework. ESP-IDF is the alternative when board/library support or required features justify it.

Before acceptance: select the board, verify framework/library compatibility and pin reproducible versions. Keep logic independent of hardware adapters so host tests can run before parts arrive. Firmware is compiled/flashed to the device, not deployed in cloud Docker containers. See [firmware plan](../embedded/firmware.md).
