"use client";
import { useEffect, useState } from "react";
import RequireAdminAuth from "../components/RequireAdminAuth";
import { apiUrl, authFetch } from "../lib/auth";
import { formatDateTime } from "../lib/ui";
import styles from "./devices.module.css";

const statusLabels: Record<string, string> = {
  OUTPUT_PULSE_COMPLETED: "Pulse completed",
  EXPIRED_UNKNOWN: "Expired · outcome unknown",
  REJECTED: "Rejected",
  QUEUED: "Queued",
  DELIVERED: "Delivered",
};

function readable(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replaceAll("_", " ");
}

type Device = {
  id: string;
  online: boolean;
  lastSeen: string | null;
  doorState: string;
  outputState: string;
  actuationEnabled: boolean;
  maxPulseMs: number;
  locker: { code: string };
  unlock: {
    allowed: boolean;
    blockedReason: string | null;
    maxPulseMs: number;
    cooldownUntil: string | null;
  };
  commands: {
    id: string;
    status: string;
    issuedAt: string;
    pulseMs: number;
    reason: string;
    resultReason: string | null;
    completedAt: string | null;
  }[];
};
function PulseFields({ device }: { device: Device }) {
  const maxSeconds = Math.min(device.unlock.maxPulseMs, 5000) / 1000;
  const storageKey = `locker-pulse-seconds:${device.id}`;
  const [seconds, setSeconds] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && Number(saved) > 0 && Number(saved) <= maxSeconds) return saved;
    } catch { /* Storage may be unavailable in private browsing. */ }
    return String(Math.min(0.5, maxSeconds));
  });
  const [reason, setReason] = useState("");
  return (
    <>
      <div className={styles.fields}>
        <label className="field">Pulse duration (seconds)
          <input name="seconds" type="number" min="0.001" step="0.001" max={maxSeconds}
            value={seconds} required onChange={(event) => {
              const input = event.currentTarget;
              setSeconds(input.value);
              if (input.validity.valid) {
                try { sessionStorage.setItem(storageKey, input.value); } catch { /* Optional preference. */ }
              }
            }} />
          <small>Maximum {maxSeconds} s</small>
        </label>
        <label className="field">Reason
          <select name="reason" required value={reason} onChange={(event) => setReason(event.target.value)}>
            <option value="" disabled>Choose a reason</option>
            <option>Bench test</option>
            <option>Maintenance</option>
            <option>Other</option>
          </select>
        </label>
      </div>
      {reason === "Other" && <label className="field">Describe the reason
        <input name="otherReason" required minLength={3} maxLength={200} placeholder="Saved in command history" />
      </label>}
      <label className={styles.confirm}><input name="confirmed" type="checkbox" required /> I can see the mechanism and it’s clear to move.</label>
    </>
  );
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const r = await authFetch(apiUrl("/v1/admin/devices"));
      if (!r.ok) throw new Error("Unable to load devices");
      setDevices(await r.json());
      setConnectionError("");
    } catch (e) {
      setConnectionError(e instanceof Error ? e.message : "Network error");
    }
  }
  useEffect(() => {
    // Initial polling synchronizes device observations from the external API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, []);
  async function pulse(d: Device, form: HTMLFormElement) {
    if (busy || !d.unlock.allowed || connectionError) return;
    const fields = new FormData(form);
    const pulseMs = Math.round(Number(fields.get("seconds")) * 1000);
    if (
      !Number.isInteger(pulseMs) ||
      pulseMs <= 0 ||
      pulseMs > Math.min(5000, d.unlock.maxPulseMs)
    ) {
      setError("Invalid pulse duration");
      return;
    }
    const reason = String(fields.get(fields.get("reason") === "Other" ? "otherReason" : "reason") ?? "").trim();
    if (reason.trim().length < 3 || reason.length > 200) {
      setError("Enter an audit reason between 3 and 200 characters.");
      return;
    }
    if (fields.get("confirmed") !== "on") {
      setError("Confirm that the mechanism is clear before sending.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await authFetch(
        apiUrl(`/v1/admin/devices/${encodeURIComponent(d.id)}/unlock-requests`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pulseMs, reason }),
        },
      );
      const b = await r.json();
      if (!r.ok) throw new Error(b.message ?? "Request failed");
      setNotice(
        `Pulse request submitted for ${d.locker.code}. See activity for the device result.`,
      );
      // Keep the operator's selected duration; require confirmation again.
      const confirmation = form.elements.namedItem(
        "confirmed",
      ) as HTMLInputElement | null;
      if (confirmation) confirmation.checked = false;
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <RequireAdminAuth>
      <main className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Hardware</p>
            <h1 className="page-title">Locker devices</h1>
            <p className="lede">Monitor door contacts and run supervised unlock tests.</p>
          </div>
        </header>
        <div className="grid">
          {connectionError && <p className="alert alert-error" role="alert">Device updates paused. {connectionError}. Requests are disabled until updates resume.</p>}
          {error && <p className="alert alert-error" role="alert">{error}</p>}
          {notice && <p className="alert" role="status">{notice}</p>}
          {!connectionError && !devices && <p className="loading-state">Loading devices…</p>}
          {!connectionError && devices?.length === 0 && <p className="empty-state">No devices provisioned yet.</p>}
          {devices?.map((d) => {
            const stale = !!connectionError || !d.online;
            const latest = d.commands[0];
            return (
              <section key={d.id} className={`card ${styles.device}`} aria-label={`Locker ${d.locker.code}`}>
                <header className={styles.identity}>
                  <div>
                    <h2>Locker {d.locker.code}</h2>
                    <p className={styles.deviceId}>{d.id}</p>
                  </div>
                  <span className={`badge ${stale ? "badge-muted" : "badge-success"}`}>
                    {connectionError ? "Connection unknown" : d.online ? "Online" : "Offline"}
                  </span>
                </header>

                <dl className={styles.readings}>
                  <div><dt>Door contact</dt><dd>{readable(d.doorState)}</dd></div>
                  <div><dt>Driver output</dt><dd>{readable(d.outputState)}</dd></div>
                  <div><dt>Last seen</dt><dd>{d.lastSeen ? <time dateTime={d.lastSeen}>{formatDateTime(d.lastSeen)}</time> : "Never"}</dd></div>
                </dl>
                <p className={styles.caption}>
                  {stale && "Readings may be stale. "}
                  The contact and output readings do not confirm whether the latch is locked.
                </p>

                {d.unlock.allowed && !stale ? (
                  <details className={styles.panel}>
                    <summary>Run a supervised unlock test</summary>
                    <form onSubmit={(event) => { event.preventDefault(); void pulse(d, event.currentTarget); }}>
                      <fieldset disabled={busy} className={styles.controls}>
                        <legend className="sr-only">Supervised unlock test for {d.locker.code}</legend>
                        <PulseFields device={d} />
                        <button type="submit" className="button button-primary">{busy ? "Sending…" : `Send unlock pulse to ${d.locker.code}`}</button>
                      </fieldset>
                    </form>
                  </details>
                ) : (
                  <div className={styles.blocked}>
                    <strong>Unlock test unavailable</strong>
                    <p>{connectionError ? "Waiting for a fresh device update." : d.unlock.blockedReason || "Waiting for a safe device state."}</p>
                  </div>
                )}

                <details className={styles.history}>
                  <summary>Recent activity <span className={styles.preview}>{latest ? `Latest: ${statusLabels[latest.status] ?? readable(latest.status)}` : "No commands yet"}</span></summary>
                  {latest ? <ol className={styles.entries}>
                    {d.commands.map((c) => (
                      <li key={c.id}>
                        <div className={styles.row}><strong>{statusLabels[c.status] ?? readable(c.status)}</strong><time dateTime={c.issuedAt}>{formatDateTime(c.issuedAt)}</time></div>
                        <p>{c.pulseMs} ms · {c.reason}</p>
                        {c.resultReason && <p>Device report: <code>{c.resultReason}</code></p>}
                        {c.status === "OUTPUT_PULSE_COMPLETED" && <p>Physical unlock unconfirmed.</p>}
                        {c.status === "EXPIRED_UNKNOWN" && <p>No result received. The pulse may have occurred.</p>}
                      </li>
                    ))}
                  </ol> : <p className={styles.caption}>Requests will appear here once a test is submitted.</p>}
                </details>
              </section>
            );
          })}
        </div>
      </main>
    </RequireAdminAuth>
  );
}
