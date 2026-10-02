# Locker Reserve documentation

Reviewed against the repository on 2026-10-02. This update changes documentation only.

## Status and reading order

- **Implemented:** reservation/admin/public booking software, Stripe PaymentIntents and webhooks, PostgreSQL, optional Redis cache, Dockerfiles and local startup.
- **Target:** simpler cloud-hosted Docker deployment plus ESP32 C++ firmware controlling a 12V solenoid, with an optional door sensor.
- **Not implemented:** firmware, device authentication/endpoints, access credentials, command persistence, or a validated cloud Compose deployment.
- **Legacy:** AWS/EKS deployment instructions and manifests. Historical deployment claims are not verification of currently running resources.

1. [Requirements and gaps](requirements.md)
2. [Target system diagram](diagrams/architecture.mmd) and [current reservation flow](diagrams/reservation-sequence.mmd)
3. [Docker deployment plan](deployment.md)
4. [Hardware and parts checklist](embedded/hardware.md)
5. [Customer access policy](embedded/access-control.md) and [device API proposal](embedded/device-api.md)
6. [Firmware development](embedded/firmware.md)
7. [Testing](embedded/testing.md) and [operations](embedded/operations.md)

## Models and decisions

- [Current database ERD](erd/erd.mmd)
- [Proposed device data model](embedded/data-model.md)
- [Proposed unlock sequence](diagrams/unlock-sequence.mmd)
- [Deployment decision](adr/0001-docker-hosting.md)
- [Firmware proposal](adr/0002-firmware-toolchain.md)
- [Transport proposal](adr/0003-device-transport.md)
- [Access and recovery proposal](adr/0004-access-and-recovery.md)

## Historical reference

[Previous AWS deployment guide](legacy/aws-eks-deployment.md) and [previous AWS target diagram](diagrams/locker-reserve-aws-eks-architecture.mmd). They are not the recommended deployment path.
