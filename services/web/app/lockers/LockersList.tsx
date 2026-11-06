"use client";

import { useRef, useState } from "react";
import { Archive, Cpu, Unplug, ChevronRight } from "lucide-react";
import ConfirmAction from "../components/ConfirmAction";
import { apiUrl, authFetch } from "../lib/auth";
import { getApiErrorMessage } from "../lib/ui";
import DeviceStatus, { deviceReadings } from "../devices/DeviceStatus";
import { statusLabel, type Device } from "../devices/device-model";
import styles from "./inventory.module.css";

export type Locker = {
  id: string;
  code: string;
  location: string;
  isActive: boolean;
};
type Props = {
  lockers: Locker[];
  view: "cards" | "table";
  byLocker: Map<string, Device>;
  stale: boolean;
  filtered: boolean;
  loadingHardware: boolean;
  changed: () => void;
  manage: (deviceId: string, lockerId: string, opener: HTMLElement) => void;
};
export default function LockersList({
  lockers,
  view,
  byLocker,
  stale,
  loadingHardware,
  filtered,
  changed,
  manage,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inflight = useRef(false);
  async function toggle(l: Locker) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(l.id);
    setError("");
    try {
      const res = await authFetch(
        apiUrl("/lockers/" + encodeURIComponent(l.id)),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !l.isActive }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(getApiErrorMessage(data, "Could not update locker"));
      await changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update locker");
    } finally {
      inflight.current = false;
      setBusy(null);
    }
  }
  function badge(l: Locker) {
    return (
      <span
        className={"badge " + (l.isActive ? "badge-success" : "badge-muted")}
      >
        {l.isActive ? "Active" : "Inactive"}
      </span>
    );
  }
  function actions(l: Locker, d?: Device) {
    return (
      <div className={styles.actions}>
        <ConfirmAction
          disabled={!!busy}
          className={styles.toggle}
          question={
            l.isActive
              ? {
                  title: "Deactivate locker " + l.code + "?",
                  detail:
                    "It will be hidden from public availability searches.",
                  keep: "Keep active",
                  confirm: "Deactivate locker",
                }
              : undefined
          }
          onAction={() => void toggle(l)}
        >
          {busy === l.id ? "Updating…" : l.isActive ? "Deactivate" : "Activate"}
        </ConfirmAction>
        {d ? (
          <button
            className={styles.manage}
            aria-haspopup="dialog"
            onClick={(e) => manage(d.id, l.id, e.currentTarget)}
          >
            Manage <ChevronRight size={14} />
          </button>
        ) : (
          !stale &&
          !loadingHardware && (
            <button
              className={styles.setup}
              disabled
              title="Device provisioning is performed outside the dashboard"
            >
              Device setup
            </button>
          )
        )}
      </div>
    );
  }
  const missing = loadingHardware
    ? "Loading hardware…"
    : stale
      ? "Device link unknown"
      : "No device linked";
  return (
    <>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!lockers.length ? (
        <p className="empty-state">
          {filtered
            ? "No lockers match this filter."
            : "No lockers have been created yet."}
        </p>
      ) : view === "cards" ? (
        <div className={styles.grid}>
          {lockers.map((l) => {
            const d = byLocker.get(l.id);
            return (
              <section
                key={l.id}
                className={"card " + styles.card}
                aria-label={"Locker " + l.code}
              >
                <header className={styles.cardHead}>
                  <span className={styles.mark}>
                    <Archive size={21} />
                  </span>
                  <div>
                    <h3>Locker {l.code}</h3>
                    <p>{l.location}</p>
                  </div>
                  {badge(l)}
                </header>
                {d ? (
                  <div className={styles.hardware}>
                    <p className={styles.deviceId}>
                      <Cpu size={15} />
                      {d.id}
                    </p>
                    <DeviceStatus device={d} disconnected={stale} />
                  </div>
                ) : (
                  <div className={styles.unlinked}>
                    <Unplug size={23} />
                    <div>
                      <strong>{missing}</strong>
                      <p>
                        {!loadingHardware && !stale
                          ? "Physical monitoring unavailable"
                          : "Waiting for device data."}
                      </p>
                    </div>
                  </div>
                )}
                <footer>
                  <div>
                    {d && (
                      <>
                        <span>Latest activity</span>
                        <p>
                          {d.commands[0]
                            ? statusLabel(d.commands[0].status)
                            : "No commands yet"}
                        </p>
                      </>
                    )}
                  </div>
                  {actions(l, d)}
                </footer>
              </section>
            );
          })}
        </div>
      ) : (
        <div
          className="table-wrap"
          role="region"
          tabIndex={0}
          aria-label="Locker inventory table"
        >
          <table className={"table " + styles.table}>
            <thead>
              <tr>
                {[
                  "Locker",
                  "Location",
                  "Inventory status",
                  "Device",
                  "Door",
                  "Driver",
                  "Actions",
                ].map((t) => (
                  <th scope="col" key={t}>
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lockers.map((l) => {
                const d = byLocker.get(l.id),
                  readings = d ? deviceReadings(d, stale) : [];
                const reading = (i: number) => {
                  const r = readings[i];
                  if (!r) return "—";
                  const [, value, Icon, tone] = r;
                  return (
                    <span className={styles.inline}>
                      <Icon
                        aria-hidden="true"
                        size={15}
                        className={styles[tone]}
                      />
                      {value}
                    </span>
                  );
                };
                return (
                  <tr key={l.id}>
                    <th scope="row">{l.code}</th>
                    <td>{l.location}</td>
                    <td>{badge(l)}</td>
                    <td>
                      {d ? (
                        <>
                          <strong>{d.id}</strong>
                          <br />
                          {reading(0)}
                        </>
                      ) : (
                        missing
                      )}
                    </td>
                    <td>{reading(1)}</td>
                    <td>{reading(2)}</td>
                    <td>{actions(l, d)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
