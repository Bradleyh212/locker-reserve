import { useState } from "react";
import type { Device } from "./device-model";
import styles from "./devices.module.css";
export default function PulseFields({ device }: { device: Device }) {
  const maxSeconds = Math.min(device.unlock.maxPulseMs, 5000) / 1000;
  const storageKey = `locker-pulse-seconds:${device.id}`;
  const [seconds, setSeconds] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && Number(saved) > 0 && Number(saved) <= maxSeconds)
        return saved;
    } catch {
      /* Storage may be unavailable in private browsing. */
    }
    return String(Math.min(0.5, maxSeconds));
  });
  const [reason, setReason] = useState("");
  return (
    <>
      <div className={styles.fields}>
        <label className="field">
          Duration (seconds)
          <input
            name="seconds"
            type="number"
            min="0.001"
            step="0.001"
            max={maxSeconds}
            value={seconds}
            required
            onChange={(event) => {
              const input = event.currentTarget;
              setSeconds(input.value);
              if (input.validity.valid) {
                try {
                  sessionStorage.setItem(storageKey, input.value);
                } catch {
                  /* Optional preference. */
                }
              }
            }}
          />
          <small>Maximum {maxSeconds} s</small>
        </label>
        <label className="field">
          Reason
          <select
            name="reason"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            <option value="" disabled>
              Choose a reason
            </option>
            <option>Bench test</option>
            <option>Maintenance</option>
            <option>Other</option>
          </select>
        </label>
      </div>
      {reason === "Other" && (
        <label className="field">
          Describe the reason
          <input
            name="otherReason"
            required
            minLength={3}
            maxLength={200}
            placeholder="Saved in command history"
          />
        </label>
      )}
      <label className={styles.confirm}>
        <input name="confirmed" type="checkbox" required /> I can see the
        mechanism and it’s clear to move.
      </label>
    </>
  );
}
