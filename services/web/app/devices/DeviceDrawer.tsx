import { useEffect, useRef, useState } from "react";
import { X, ChevronDown, Clock3 } from "lucide-react";
import { formatDateTime } from "../lib/ui";
import DeviceStatus from "./DeviceStatus";
import PulseFields from "./PulseFields";
import { statusLabel, readable, type Device } from "./device-model";
import styles from "./devices.module.css";

export type Feedback = { id: string; error: boolean; text: string };
export default function DeviceDrawer({
  device,
  disconnected,
  close,
  opener,
  busy,
  feedback,
  pulse,
}: {
  device?: Device;
  disconnected: boolean;
  close: () => void;
  opener: HTMLElement | null;
  busy: boolean;
  feedback: Feedback | null;
  pulse: (d: Device, form: HTMLFormElement) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    dialog.querySelector("button")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previous;
      if (opener?.isConnected) opener.focus();
      else document.getElementById("devices-title")?.focus();
    };
  }, [opener]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="device-title"
      className={styles.drawer}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          close();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const controls = [
          ...e.currentTarget.querySelectorAll<HTMLElement>(
            "button:enabled, input:enabled, select:enabled, summary, a[href]",
          ),
        ].filter(
          (el) => el.getClientRects().length && !el.matches(":disabled"),
        );
        const target = e.shiftKey ? controls.at(-1) : controls[0];
        if (
          document.activeElement ===
          (e.shiftKey ? controls[0] : controls.at(-1))
        ) {
          e.preventDefault();
          target?.focus();
        }
      }}
    >
      <header className={styles.drawerHead}>
        <div>
          <h2 id="device-title">
            {device ? "Locker " + device.locker.code : "Device unavailable"}
          </h2>
          {device && (
            <p className={styles.deviceId}>Device controls · {device.id}</p>
          )}
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close device controls"
          onClick={close}
        >
          <X size={19} />
        </button>
      </header>
      {device ? (
        <div className={styles.drawerBody}>
          <section aria-label="Live device status">
            <DeviceStatus device={device} disconnected={disconnected} large />
            <p className={styles.lastSeen}>
              <Clock3 size={14} aria-hidden="true" />
              Last seen{" "}
              {device.lastSeen ? (
                <time dateTime={device.lastSeen}>
                  {formatDateTime(device.lastSeen)}
                </time>
              ) : (
                "never"
              )}
            </p>
            <p className={styles.caption}>
              Lock shows driver output. The latch position is unverified.
            </p>
          </section>
          <section className={styles.panel}>
            <h3>Supervised unlock test</h3>
            {device.online && device.unlock.allowed && !disconnected ? (
              <>
                <p>
                  Only perform a test while physically observing the locker
                  mechanism.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    pulse(device, e.currentTarget);
                  }}
                >
                  <fieldset disabled={busy} className={styles.controls}>
                    <legend className="sr-only">
                      Unlock test for {device.locker.code}
                    </legend>
                    <PulseFields device={device} />
                    <button type="submit" className="button">
                      {busy ? "Sending…" : "Send unlock pulse"}
                    </button>
                  </fieldset>
                </form>
              </>
            ) : (
              <p>
                {disconnected
                  ? "Waiting for a fresh device update."
                  : device.unlock.blockedReason ||
                    "Waiting for a safe device state."}
                {device.unlock.cooldownUntil && !disconnected && (
                  <span>
                    {" "}
                    Retry after{" "}
                    {new Date(device.unlock.cooldownUntil).toLocaleTimeString()}
                    .
                  </span>
                )}
              </p>
            )}
          </section>
          {feedback?.id === device.id && (
            <p
              className={"alert " + (feedback.error ? "alert-error" : "")}
              role={feedback.error ? "alert" : "status"}
            >
              {feedback.text}
            </p>
          )}
          <section className={styles.history}>
            <h3>Recent activity</h3>
            {device.commands.length ? (
              <ol>
                {device.commands.slice(0, expanded ? undefined : 3).map((c) => (
                  <li key={c.id}>
                    <strong>{statusLabel(c.status)}</strong>
                    <time dateTime={c.issuedAt}>
                      {formatDateTime(c.issuedAt)}
                    </time>
                    <p>
                      {c.pulseMs / 1000} s · {c.reason}
                    </p>
                    {c.status === "EXPIRED_UNKNOWN" && (
                      <p>No result received. The pulse may have occurred.</p>
                    )}
                    {c.resultReason && (
                      <details>
                        <summary>Device report</summary>
                        <p>{readable(c.resultReason)}</p>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.caption}>No commands yet.</p>
            )}
            {device.commands.length > 3 && (
              <button
                className={styles.more}
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? "Show less" : "Show more"}{" "}
                <ChevronDown size={15} aria-hidden="true" />
              </button>
            )}
          </section>
        </div>
      ) : (
        <p className={styles.drawerBody}>This device is no longer listed.</p>
      )}
    </dialog>
  );
}
