"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { apiUrl } from "../lib/auth";
import { formatDateTime, getApiErrorMessage } from "../lib/ui";
import {
  forgetHold,
  getPendingHolds,
  isDurable,
  newHold,
  parseRecoveryCode,
  recoveryCode,
  rememberHold,
  usePendingHolds,
  type PendingHold,
  type Reservation,
} from "./pending-holds";
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;
type Locker = { id: string; code: string; location: string };
const headers = (r: PendingHold) => ({
  Authorization: `Bearer ${r.accessToken}`,
  "Idempotency-Key": r.requestKey,
  "Content-Type": "application/json",
});
function label(r: Reservation) {
  if (r.reconciliationRequired) return "Payment needs review";
  if (r.status === "CANCELLED") return "Canceled reservation";
  if (r.status === "EXPIRED") return "Expired hold";
  if (r.status === "CONFIRMED")
    return r.paymentState === "SUCCEEDED"
      ? "Confirmed reservation · payment received"
      : "Confirmed reservation";
  if (r.paymentState === "PROCESSING") return "Payment processing";
  if (r.paymentState === "CANCELED") return "Payment canceled";
  return "Unpaid hold";
}
export default function BookingPage() {
  const { rows } = usePendingHolds();
  const [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [location, setLocation] = useState("");
  const [lockers, setLockers] = useState<Locker[]>([]),
    [selected, setSelected] = useState("");
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [importCode, setImportCode] = useState(""),
    [backup, setBackup] = useState<PendingHold | null>(null),
    [saved, setSaved] = useState(false);
  const [active, setActive] = useState(""),
    [secret, setSecret] = useState<string | null>(null);
  const [verified, setVerified] = useState<Record<string, number>>({}),
    [tick, setTick] = useState(0);
  const backedUp = useRef(new Set<string>());
  const sequences = useRef<Record<string, number>>({});
  const busy = useRef(false),
    refreshing = useRef(false),
    activeRef = useRef("");
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const accept = useCallback(
    (record: PendingHold, reservation: Reservation) => {
      rememberHold({ ...record, reservation });
      const now = performance.now();
      setTick(now);
      setVerified((v) => ({ ...v, [record.requestKey]: now }));
      if (!reservation.canPay && activeRef.current === record.requestKey)
        setSecret(null);
    },
    [],
  );
  const refresh = useCallback(
    async (record: PendingHold) => {
      const sequence = (sequences.current[record.requestKey] ?? 0) + 1;
      sequences.current[record.requestKey] = sequence;
      const res = await fetch(apiUrl("/public/reservations/recovery"), {
        headers: headers(record),
        cache: "no-store",
      });
      if (sequences.current[record.requestKey] !== sequence)
        return (
          getPendingHolds().find((r) => r.requestKey === record.requestKey)
            ?.reservation ?? null
        );
      if (res.status === 404) {
        setVerified((v) => {
          const copy = { ...v };
          delete copy[record.requestKey];
          return copy;
        });
        return null; // An uncommitted draft can be retried with exactly the same key and terms.
      }
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          getApiErrorMessage(data, "Could not verify reservation."),
        );
      accept(record, data);
      return data as Reservation;
    },
    [accept],
  );
  useEffect(() => {
    // Redirect parameters are not proof. Reconcile using the saved bearer credential.
    if (window.location.search)
      window.history.replaceState(null, "", window.location.pathname);
    let stopped = false;
    const reconcile = async () => {
      if (refreshing.current || busy.current) return;
      refreshing.current = true;
      try {
        for (const r of getPendingHolds()) {
          if (stopped || busy.current) break;
          try {
            await refresh(r);
          } catch {
            setVerified((v) => {
              const copy = { ...v };
              delete copy[r.requestKey];
              return copy;
            });
            if (activeRef.current === r.requestKey) setSecret(null);
          }
        }
      } finally {
        refreshing.current = false;
      }
    };
    void reconcile();
    const poll = window.setInterval(() => void reconcile(), 15000);
    const clock = window.setInterval(() => setTick(performance.now()), 1000);
    const visible = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(clock);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  async function action(fn: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Request interrupted. Retry with your saved receipt.",
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  async function create(record: PendingHold) {
    const res = await fetch(apiUrl("/public/reservations/hold"), {
      method: "POST",
      headers: headers(record),
      body: JSON.stringify(record.request),
    });
    const data = await res.json();
    if (!res.ok)
      throw new Error(getApiErrorMessage(data, "Could not create hold."));
    accept(record, data);
  }
  async function resume(record: PendingHold) {
    await action(async () => {
      setSecret(null);
      setActive(record.requestKey);
      let current = await refresh(record);
      if (!current) {
        if (!record.request)
          throw new Error(
            "No committed booking was found for this recovery code.",
          );
        if (!isDurable(record) && !backedUp.current.has(record.requestKey)) {
          setBackup(record);
          setSaved(false);
          return;
        }
        await create(record);
        current = await refresh(record);
      }
      if (!current?.canPay) return;
      const res = await fetch(apiUrl("/public/payments/create-intent"), {
        method: "POST",
        headers: headers(record),
        body: JSON.stringify({ reservationId: current.id }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          getApiErrorMessage(
            data,
            "Payment setup interrupted. Your receipt is saved.",
          ),
        );
      accept(record, data.reservation);
      if (data.reservation.canPay) setSecret(data.client_secret);
    });
  }
  const selectedRecord = rows.find((r) => r.requestKey === active);
  const current = selectedRecord?.reservation;
  const checked = verified[active];
  const remaining =
    current && checked !== undefined
      ? Date.parse(current.expiresAt) -
        Date.parse(current.serverNow) -
        (Math.max(tick, checked) - checked)
      : 0;
  const showPayment =
    !!current?.canPay &&
    checked !== undefined &&
    tick - checked < 20000 &&
    remaining > 0;
  return (
    <main className="public-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Public booking</p>
          <h1>Reserve a locker</h1>
          <p>
            Hold a locker for ten minutes and recover checkout with your private
            receipt.
          </p>
        </div>
        <Link href="/login">Admin login</Link>
      </header>
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
      <section className="card card-pad">
        <h2>Recover a booking</h2>
        <label className="field">
          Recovery code
          <input
            value={importCode}
            onChange={(e) => setImportCode(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          className="button"
          disabled={loading}
          onClick={() =>
            void action(async () => {
              const r = parseRecoveryCode(importCode);
              if (!r) throw new Error("Enter a valid private recovery code.");
              if (!rememberHold(r)) {
                setBackup(r);
                setSaved(false);
              }
              if (!(await refresh(r)))
                throw new Error(
                  "No committed booking was found for this recovery code.",
                );
              setImportCode("");
            })
          }
        >
          Recover booking
        </button>
        <p>
          Keep this code private. It authorizes access to this booking and its
          payment.
        </p>
      </section>
      {backup && (
        <section className="card card-pad" role="alert">
          <h2>Save your recovery code first</h2>
          <p>
            Browser storage is unavailable. No new hold will be created until
            you save this code.
          </p>
          <label className="field">
            Private recovery code
            <textarea
              aria-label="Private recovery code"
              readOnly
              value={recoveryCode(backup)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />{" "}
            I saved this private recovery code
          </label>
          <button
            className="button"
            disabled={!saved || loading}
            onClick={() => {
              const r = backup;
              backedUp.current.add(r.requestKey);
              setBackup(null);
              void action(async () => {
                if (r.request) await create(r);
                else await refresh(r);
              });
            }}
          >
            Continue with saved code
          </button>
        </section>
      )}
      {rows.map((r) => (
        <section
          key={r.requestKey}
          className="card card-pad"
          style={{ marginTop: 16 }}
        >
          <h2>
            {r.reservation
              ? label(r.reservation) + " · " + r.reservation.locker.code
              : "Saved booking request"}
          </h2>
          {r.reservation && (
            <>
              <p>
                {formatDateTime(r.reservation.startTime)} –{" "}
                {formatDateTime(r.reservation.endTime)}
              </p>
              <p>
                Original hold deadline:{" "}
                {formatDateTime(r.reservation.expiresAt)}
              </p>
            </>
          )}
          {verified[r.requestKey] === undefined && (
            <p>
              Verify server status before continuing. Cached details are not
              payment confirmation.
            </p>
          )}
          <details>
            <summary>Private recovery code</summary>
            <code>{recoveryCode(r)}</code>
          </details>
          <button
            className="button"
            disabled={loading}
            onClick={() => void resume(r)}
          >
            Check status / continue payment
          </button>
          {r.reservation?.reconciliationRequired && (
            <p role="status">
              A payment needs reconciliation. Do not pay again. Keep your
              receipt and contact support.
            </p>
          )}
          {r.reservation?.paymentState === "PROCESSING" && (
            <p role="status">
              Payment is processing. Keep this receipt; you do not need to pay
              again.
            </p>
          )}
          {verified[r.requestKey] !== undefined &&
            r.reservation &&
            ((r.reservation.status === "CONFIRMED" &&
              r.reservation.paymentState === "SUCCEEDED") ||
              (["CANCELLED", "EXPIRED"].includes(r.reservation.status) &&
                (!r.reservation.hasPayment ||
                  r.reservation.paymentState === "CANCELED"))) && (
              <button
                className="button button-secondary"
                onClick={() => forgetHold(r.requestKey)}
              >
                Remove saved receipt
              </button>
            )}
        </section>
      ))}
      <form
        className="card card-pad form-grid"
        style={{ marginTop: 20 }}
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            if (!start || !end || new Date(end) <= new Date(start))
              throw new Error("Choose a valid start and end time.");
            setSecret(null);
            setActive("");
            const query = new URLSearchParams({
              startTime: new Date(start).toISOString(),
              endTime: new Date(end).toISOString(),
              ...(location.trim() ? { location: location.trim() } : {}),
            });
            const res = await fetch(
              apiUrl("/public/lockers/availability?" + query),
              { cache: "no-store" },
            );
            const data = await res.json();
            if (!res.ok)
              throw new Error(
                getApiErrorMessage(data, "Availability unavailable."),
              );
            setLockers(data);
            setSelected(data[0]?.id ?? "");
          });
        }}
      >
        <label className="field">
          Start time
          <input
            type="datetime-local"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="field">
          End time
          <input
            type="datetime-local"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="field">
          Location
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <button className="button" disabled={loading}>
          Check availability
        </button>
      </form>
      {lockers.length > 0 && (
        <section className="card card-pad">
          <h2>Available lockers</h2>
          <label className="field">
            Locker
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {lockers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} · {l.location}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button"
            disabled={loading || !selected}
            onClick={() =>
              void action(async () => {
                const request = {
                  lockerId: selected,
                  startTime: new Date(start).toISOString(),
                  endTime: new Date(end).toISOString(),
                };
                const existing = getPendingHolds().find(
                  (r) =>
                    r.request &&
                    JSON.stringify(r.request) === JSON.stringify(request),
                );
                if (existing) {
                  await refresh(existing);
                  return;
                }
                const r = newHold(request); // Persist proof before any request can commit remotely.
                if (!rememberHold(r)) {
                  setBackup(r);
                  setSaved(false);
                  return;
                }
                await create(r);
              })
            }
          >
            Create hold
          </button>
        </section>
      )}
      {secret && selectedRecord && showPayment && (
        <section className="card card-pad">
          <h2>Checkout</h2>
          {stripePromise ? (
            <Elements
              key={secret}
              stripe={stripePromise}
              options={{ clientSecret: secret }}
            >
              <PublicPaymentForm
                beforeConfirm={async () =>
                  !!(await refresh(selectedRecord))?.canPay
                }
                onComplete={async () => {
                  setSecret(null);
                  await refresh(selectedRecord);
                }}
                returnKey={active}
              />
            </Elements>
          ) : (
            <p role="alert">Stripe is not configured.</p>
          )}
        </section>
      )}
    </main>
  );
}
function PublicPaymentForm({
  beforeConfirm,
  onComplete,
  returnKey,
}: {
  beforeConfirm: () => Promise<boolean>;
  onComplete: () => Promise<void>;
  returnKey: string;
}) {
  const stripe = useStripe(),
    elements = useElements();
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const busy = useRef(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!stripe || !elements || busy.current) return;
        busy.current = true;
        setLoading(true);
        setError("");
        void (async () => {
          try {
            if (!(await beforeConfirm()))
              throw new Error(
                "Reservation is no longer payable. Check its server status.",
              );
            const result = await stripe.confirmPayment({
              elements,
              confirmParams: {
                return_url:
                  window.location.origin +
                  "/book?checkout=" +
                  encodeURIComponent(returnKey),
              },
              redirect: "if_required",
            });
            if (result.error)
              throw new Error(
                result.error.message ?? "Payment was not completed.",
              );
            // Succeeded and processing both require server-side reconciliation, never local confirmation.
            await onComplete();
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Payment interrupted. Keep your receipt and check its status.",
            );
          } finally {
            busy.current = false;
            setLoading(false);
          }
        })();
      }}
    >
      <PaymentElement />
      <button className="button" disabled={!stripe || loading}>
        {loading ? "Processing…" : "Submit payment"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
