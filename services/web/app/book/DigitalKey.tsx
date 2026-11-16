"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../lib/auth";
import { formatDateTime, getApiErrorMessage } from "../lib/ui";
import {
  getPendingHolds,
  isDurable,
  recoveryCode,
  rememberHold,
  type PendingHold,
} from "./pending-holds";

type Command = {
  commandId: string;
  status: string;
  issuedAt: string;
  expiresAt: string;
  deliveredAt: string | null;
  completedAt: string | null;
  acknowledged: boolean;
};
type Readiness = {
  paymentState: string;
  serverNow: string;
  available: boolean;
  code: string;
  retryAt?: string;
  commands: Command[];
  door: null | { state: string; observedAt: string | null; fresh: boolean };
};
const labels: Record<string, string> = {
  PENDING: "Request accepted",
  DELIVERY_ATTEMPTED: "Delivery attempted",
  OUTPUT_PULSE_COMPLETED: "Pulse completion reported",
  OUTCOME_UNKNOWN: "Unknown command outcome",
  REJECTED: "Device rejected the request",
  FAILED: "Device reported a failure",
};

export default function DigitalKey({ record }: { record: PendingHold }) {
  const id = record.reservation!.id,
    token = record.accessToken,
    creationKey = record.requestKey;
  const [state, setState] = useState<Readiness | null>(null);
  const [verified, setVerified] = useState(false),
    [error, setError] = useState("");
  const [sending, setSending] = useState(false),
    [backup, setBackup] = useState<PendingHold | null>(null),
    [saved, setSaved] = useState(false);
  const [lastRequest, setLastRequest] = useState<Command | null>(null);
  const busy = useRef(false),
    sequence = useRef(0);
  const headers = useCallback(
    () => ({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }),
    [token],
  );
  const refresh = useCallback(async () => {
    const n = ++sequence.current;
    const response = await fetch(
      apiUrl(`/v1/customer/reservations/${encodeURIComponent(id)}/access`),
      {
        headers: headers(),
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        getApiErrorMessage(data, "Could not verify the digital key."),
      );
    const key = getPendingHolds().find(
      (r) => r.requestKey === creationKey,
    )?.unlockRequestKey;
    let command: Command | null = null;
    if (key) {
      const lookup = await fetch(
        apiUrl(
          `/v1/customer/reservations/${encodeURIComponent(id)}/unlock-requests`,
        ),
        {
          headers: { ...headers(), "Idempotency-Key": key },
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        },
      );
      if (lookup.status !== 404) {
        const value = await lookup.json();
        if (!lookup.ok)
          throw new Error(
            getApiErrorMessage(value, "Could not recover the unlock request."),
          );
        command = value;
      }
    }
    if (sequence.current !== n) return;
    setState(data);
    setLastRequest(command);
    setVerified(true);
    setError("");
  }, [id, creationKey, headers]);
  useEffect(() => {
    const invalidate = () => {
      sequence.current++;
    };
    let stopped = false,
      reading = false;
    const poll = async () => {
      if (stopped || reading || busy.current) return;
      reading = true;
      try {
        await refresh();
      } catch (e) {
        if (!stopped) {
          setVerified(false);
          setError(
            e instanceof Error
              ? e.message
              : "Connection unavailable. No unlock was retried.",
          );
        }
      } finally {
        reading = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 3000);
    const visible = () => {
      if (document.visibilityState === "visible") {
        setVerified(false);
        void poll();
      }
    };
    const stale = () => {
      setVerified(false);
      sequence.current++;
    };
    window.addEventListener("focus", visible);
    window.addEventListener("offline", stale);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      invalidate();
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      window.removeEventListener("offline", stale);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  async function send(key: string) {
    if (busy.current) return;
    busy.current = true;
    sequence.current++;
    setSending(true);
    setVerified(false);
    setError("");
    try {
      const response = await fetch(
        apiUrl(
          `/v1/customer/reservations/${encodeURIComponent(id)}/unlock-requests`,
        ),
        {
          method: "POST",
          headers: { ...headers(), "Idempotency-Key": key },
          body: "{}",
          signal: AbortSignal.timeout(8000),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          getApiErrorMessage(data, "Unlock request was not accepted."),
        );
      setLastRequest(data);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Request interrupted. Check status before trying again.",
      );
    } finally {
      busy.current = false;
      setSending(false);
      // Recovery is GET-only. Never repeat the POST after an uncertain response.
      try {
        await refresh();
      } catch {
        setVerified(false);
      }
    }
  }
  function prepare() {
    if (busy.current || !verified || !state?.available) return;
    const current =
      getPendingHolds().find((r) => r.requestKey === creationKey) ?? record;
    const key =
      current.unlockRequestKey && !lastRequest
        ? current.unlockRequestKey
        : crypto.randomUUID();
    const next = { ...current, unlockRequestKey: key };
    const durable = rememberHold(next) && isDurable(next);
    if (!durable) {
      setBackup(next);
      setSaved(false);
      return;
    }
    void send(key);
  }
  const commands = [
    ...(lastRequest ? [lastRequest] : []),
    ...(state?.commands ?? []).filter(
      (c) => c.commandId !== lastRequest?.commandId,
    ),
  ];
  return (
    <section
      className="card card-pad"
      aria-label={`Digital key for ${record.reservation!.locker.code}`}
      style={{ marginTop: 12 }}
    >
      <h3>Digital key · {record.reservation!.locker.code}</h3>
      <p>
        {record.reservation!.locker.location} ·{" "}
        {formatDateTime(record.reservation!.startTime)} —{" "}
        {formatDateTime(record.reservation!.endTime)}
      </p>
      <p>
        {verified && state?.paymentState === "SUCCEEDED"
          ? "Payment confirmed by server"
          : "Payment is not eligible for access"}
      </p>
      <p role="status">
        {sending
          ? "Sending one unlock request…"
          : !verified
            ? "Verifying current eligibility…"
            : state?.available
              ? "Ready for an explicit unlock request"
              : state?.code === "COOLDOWN"
                ? `Cooling down until ${formatDateTime(state.retryAt!)}`
                : state?.code === "RESERVATION_INELIGIBLE"
                  ? "Reservation is outside its access window or payment is restricted"
                  : "Locker unavailable; check door, connection or contact support"}
      </p>
      {error && <p role="alert">{error} No unlock is retried automatically.</p>}
      {state?.door && (
        <p>
          Door observation:{" "}
          <strong>
            {verified && state.door.fresh ? state.door.state : "UNKNOWN"}
          </strong>
          {state.door.observedAt &&
            ` · ${formatDateTime(state.door.observedAt)}`}
          {!verified || !state.door.fresh ? " · stale or unavailable" : ""}
        </p>
      )}
      <button
        type="button"
        className="button button-primary"
        disabled={!verified || !state?.available || sending || !!backup}
        onClick={prepare}
      >
        Unlock assigned locker
      </button>
      <button
        type="button"
        className="button button-secondary"
        disabled={sending}
        onClick={() => {
          setVerified(false);
          void refresh().catch((e) => {
            setVerified(false);
            setError(e instanceof Error ? e.message : "Status unavailable");
          });
        }}
      >
        Check unlock status
      </button>
      {backup && (
        <section role="alert">
          <p>
            Browser storage is unavailable. Save this private recovery code
            before sending. It includes this request key.
          </p>
          <textarea
            aria-label="Digital key recovery code"
            readOnly
            value={recoveryCode(backup)}
          />
          <label>
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />
            I saved this digital key recovery code
          </label>
          <button
            type="button"
            className="button"
            disabled={!saved || sending || !verified || !state?.available}
            onClick={() => {
              const key = backup.unlockRequestKey!;
              setBackup(null);
              void send(key);
            }}
          >
            Send this unlock request
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setBackup(null)}
          >
            Cancel
          </button>
        </section>
      )}
      {commands.length > 0 && (
        <ol aria-label="Your unlock requests">
          {commands.map((c) => (
            <li key={c.commandId}>
              <strong>{labels[c.status] ?? c.status}</strong>
              {c.acknowledged && (
                <p>
                  Historical uncertainty reviewed by an operator; this is not
                  proof of pulse completion.
                </p>
              )}
              {c.deliveredAt && (
                <p>Delivery attempted: {formatDateTime(c.deliveredAt)}</p>
              )}
              {c.completedAt && (
                <p>Device report received: {formatDateTime(c.completedAt)}</p>
              )}
              {c.status === "OUTCOME_UNKNOWN" && (
                <p>
                  The outcome is uncertain. Do not assume the door opened.
                  Contact support.
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      <p>
        Delivery and reported pulse completion do not prove that the mechanical
        latch unlocked. Door observations are reported separately.
      </p>
    </section>
  );
}
