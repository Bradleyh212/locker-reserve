"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Cpu } from "lucide-react";
import RequireAdminAuth from "../components/RequireAdminAuth";
import { apiUrl, authFetch } from "../lib/auth";
import { type Device, statusLabel } from "./device-model";
import DeviceStatus from "./DeviceStatus";
import DeviceDrawer, { type Feedback } from "./DeviceDrawer";
import styles from "./devices.module.css";

export default function DevicesPage() {
  return (
    <RequireAdminAuth>
      <Devices />
    </RequireAdminAuth>
  );
}

function Devices() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selected, setSelected] = useState<{
    id: string;
    opener: HTMLElement;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(async (force = false) => {
    if (!mounted.current || (request.current && !force)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort("timeout"), 6000);
    try {
      const r = await authFetch(apiUrl("/v1/admin/devices"), {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!r.ok) throw new Error("Unable to load devices");
      const data: Device[] = await r.json();
      if (request.current !== controller || controller.signal.aborted) return;
      setDevices(data);
      setConnectionError("");
    } catch (e) {
      if (mounted.current && request.current === controller)
        setConnectionError(
          e instanceof Error ? e.message : "Device update unavailable",
        );
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 3000);
    return () => {
      mounted.current = false;
      clearTimeout(initial);
      clearInterval(t);
      request.current?.abort();
      request.current = null;
    };
  }, [refresh]);

  async function pulse(d: Device, form: HTMLFormElement) {
    if (
      pending.current ||
      !d.online ||
      !d.unlock.allowed ||
      connectionError ||
      !form.reportValidity()
    )
      return;
    const fields = new FormData(form);
    const pulseMs = Math.round(Number(fields.get("seconds")) * 1000);
    const reason = String(
      fields.get(fields.get("reason") === "Other" ? "otherReason" : "reason") ??
        "",
    ).trim();
    let issue = "";
    if (
      !Number.isInteger(pulseMs) ||
      pulseMs <= 0 ||
      pulseMs > Math.min(5000, d.unlock.maxPulseMs)
    )
      issue = "Invalid pulse duration";
    else if (reason.length < 3 || reason.length > 200)
      issue = "Enter an audit reason between 3 and 200 characters.";
    else if (fields.get("confirmed") !== "on")
      issue = "Confirm that the mechanism is clear before sending.";
    if (issue) {
      setFeedback({ id: d.id, error: true, text: issue });
      return;
    }
    pending.current = true;
    setBusy(true);
    setFeedback(null);
    let rejection = "";
    try {
      const r = await authFetch(
        apiUrl(
          "/v1/admin/devices/" + encodeURIComponent(d.id) + "/unlock-requests",
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pulseMs, reason }),
        },
      );
      const b = await r.json();
      if (!r.ok) {
        if (r.status < 500) rejection = String(b.message ?? "Request rejected");
        throw new Error("Request unsuccessful");
      }
      if (mounted.current)
        setFeedback({
          id: d.id,
          error: false,
          text: "Pulse requested. Check recent activity for the device result.",
        });
    } catch {
      if (mounted.current)
        setFeedback({
          id: d.id,
          error: true,
          text:
            rejection ||
            "Request outcome unknown. Check recent activity before trying again.",
        });
    } finally {
      const confirm = form.elements.namedItem(
        "confirmed",
      ) as HTMLInputElement | null;
      if (confirm) confirm.checked = false;
      await refresh(true);
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Hardware</p>
          <h1 id="devices-title" tabIndex={-1} className="page-title">
            Locker devices
          </h1>
          <p className="lede">
            Monitor connected lockers and manage supervised hardware tests.
          </p>
        </div>
      </header>
      {connectionError && (
        <p className="alert alert-error" role="alert">
          Device updates paused. Requests are disabled until updates resume.
        </p>
      )}
      {!connectionError && !devices && (
        <p className="loading-state">Loading devices…</p>
      )}
      {!connectionError && devices?.length === 0 && (
        <p className="empty-state">No devices provisioned yet.</p>
      )}
      <div className={styles.fleet}>
        {devices?.map((d) => (
          <section
            key={d.id}
            className={"card " + styles.device}
            aria-label={"Locker " + d.locker.code}
          >
            <header className={styles.identity}>
              <span className={styles.hardware}>
                <Cpu size={20} aria-hidden="true" />
              </span>
              <div>
                <h2>Locker {d.locker.code}</h2>
                <p className={styles.deviceId}>{d.id}</p>
              </div>
            </header>
            <DeviceStatus device={d} disconnected={!!connectionError} />
            <footer className={styles.footer}>
              <div>
                <span className={styles.smallLabel}>Latest activity</span>
                <p>
                  {d.commands[0]
                    ? statusLabel(d.commands[0].status)
                    : "No commands yet"}
                </p>
              </div>
              <button
                className={styles.manage}
                aria-haspopup="dialog"
                onClick={(e) => {
                  setSelected({ id: d.id, opener: e.currentTarget });
                }}
              >
                Manage device <ChevronRight size={15} aria-hidden="true" />
              </button>
            </footer>
          </section>
        ))}
      </div>
      {selected && (
        <DeviceDrawer
          key={selected.id}
          device={devices?.find((d) => d.id === selected.id)}
          disconnected={!!connectionError}
          close={() => setSelected(null)}
          opener={selected.opener}
          busy={busy}
          feedback={feedback}
          pulse={pulse}
        />
      )}
    </main>
  );
}
