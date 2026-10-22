"use client";
import { useEffect, useState } from "react";
import RequireAdminAuth from "../components/RequireAdminAuth";
import { apiUrl, authFetch } from "../lib/auth";
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
export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
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
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, []);
  async function pulse(d: Device, form: HTMLFormElement) {
    if (busy || !d.unlock.allowed || connectionError) return;
    const fields = new FormData(form);
    const pulseMs = Number(fields.get("pulseMs"));
    if (
      !Number.isInteger(pulseMs) ||
      pulseMs <= 0 ||
      pulseMs > d.unlock.maxPulseMs
    ) {
      setError("Invalid pulse duration");
      return;
    }
    const reason = String(fields.get("reason") ?? "").trim();
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
        "Command queued. Waiting for the device result; the door is not confirmed unlocked.",
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
        <h1>Locker devices</h1>
        <p>
          Supervised prototype testing. Door contact and output activity do not
          prove the locker is locked.
        </p>
        {connectionError && (
          <p role="alert">
            {connectionError}. Displayed observations may be stale; requests are
            disabled.
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p role="alert" className="alert alert-error">
            {error}
          </p>
        )}
        {!devices.length && <p>No devices provisioned yet.</p>}
        {devices.map((d) => (
          <section key={d.id} className="card">
            <h2>
              {d.locker.code} · {d.id}
            </h2>
            <p>
              {d.online ? "Online" : "Offline — observations may be stale"} ·
              Last seen:{" "}
              {d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "Never"}
            </p>
            <p>
              Door contact: {d.doorState} · Output: {d.outputState}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void pulse(d, event.currentTarget);
              }}
            >
              <fieldset
                disabled={busy || !!connectionError || !d.unlock.allowed}
              >
                <legend>Supervised unlock test</legend>
                <p>
                  <label>
                    Pulse duration (ms)
                    <input
                      name="pulseMs"
                      type="number"
                      min="1"
                      max={d.unlock.maxPulseMs}
                      step="1"
                      placeholder={`1–${d.unlock.maxPulseMs} ms`}
                      required
                    />
                  </label>
                </p>
                <p>
                  <label>
                    Reason (saved in history)
                    <input
                      name="reason"
                      type="text"
                      minLength={3}
                      maxLength={200}
                      placeholder="First web unlock test"
                      required
                    />
                  </label>
                </p>
                <p>
                  <label>
                    <input name="confirmed" type="checkbox" required />I am
                    supervising this test and the mechanism is clear.
                  </label>
                </p>
                <button type="submit" className="button button-primary">
                  {busy ? "Sending…" : `Send unlock pulse to ${d.locker.code}`}
                </button>
              </fieldset>
            </form>
            <p>
              {d.unlock.blockedReason ??
                `Ready for a supervised pulse (maximum ${d.unlock.maxPulseMs} ms).`}
            </p>
            <h3>Recent commands</h3>
            {!d.commands.length && <p>No commands requested.</p>}
            <ul>
              {d.commands.map((c) => (
                <li key={c.id}>
                  {new Date(c.issuedAt).toLocaleString()}: {c.status} ·{" "}
                  {c.pulseMs} ms
                  <div>Reason: {c.reason}</div>
                  {c.resultReason && <div>Device report: {c.resultReason}</div>}
                  {c.status === "OUTPUT_PULSE_COMPLETED" && (
                    <div>
                      Output pulse completed; mechanical unlock not confirmed.
                    </div>
                  )}
                  {c.status === "EXPIRED_UNKNOWN" && (
                    <div>
                      Expired without a result. Do not assume it did or did not
                      activate.
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </RequireAdminAuth>
  );
}
