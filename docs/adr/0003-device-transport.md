# ADR 0003: Start with outbound HTTPS polling

Status: proposed. Date: 2026-10-02.

Decision proposal: devices poll NestJS for short-lived commands and POST results/heartbeats using unique device credentials and verified TLS. No inbound connectivity to a locker is required.

Tradeoffs: polling adds request load and latency; choose intervals from measured needs. MQTT can be reconsidered for scale/latency but adds broker operations and does not remove authorization, expiry or duplicate-execution concerns. Use durable command IDs and explicit uncertain outcomes; do not promise exactly-once physical actuation. See [contract](../embedded/device-api.md).
