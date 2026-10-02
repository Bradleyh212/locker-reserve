# ADR 0004: Access authorization and recovery

Status: proposed. Date: 2026-10-02.

Decision proposal: require reservation-scoped customer entitlement and server authorization for every new unlock request. Initial devices deny new remote access offline, consume command IDs durably before activation and never replay uncertain commands after reboot.

Tradeoff: preventing automatic repeated pulses can leave a command unexecuted after a crash. Surface UNKNOWN and require reauthorization/operator recovery. Short command expiry bounds but does not eliminate the cancellation-after-delivery race.

Before acceptance: choose customer identity/credential delivery, paid-entitlement and admin override policies, pulse/expiry/cooldown limits, lock power-loss behavior and physical recovery procedure. See [access policy](../embedded/access-control.md).
