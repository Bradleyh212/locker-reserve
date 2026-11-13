import { useMemo, useSyncExternalStore } from "react";
import { apiUrl } from "../lib/auth";
export type Reservation = {
  id: string;
  lockerId: string;
  startTime: string;
  endTime: string;
  expiresAt: string;
  serverNow: string;
  locker: { code: string; location: string };
  status: "HOLD" | "CONFIRMED" | "CANCELLED" | "EXPIRED";
  paymentState: string;
  canPay: boolean;
  hasPayment: boolean;
  reconciliationRequired: boolean;
  amount: number;
  currency: string;
};
export type PendingHold = {
  requestKey: string;
  accessToken: string;
  request?: { lockerId: string; startTime: string; endTime: string };
  reservation?: Reservation;
};
const key = "locker:owned-checkouts:v1:" + apiUrl("");
const changed = "locker:owned-checkouts-changed";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const token = /^[A-Za-z0-9_-]{43}$/;
let memory = "[]";
let blocked = false;
function snapshot() {
  if (typeof window === "undefined") return "[]";
  try {
    if (!blocked) return sessionStorage.getItem(key) ?? memory;
  } catch {
    blocked = true;
  }
  return memory;
}
function parse(raw: string): PendingHold[] {
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(
        (r: PendingHold) =>
          r && uuid.test(r.requestKey) && token.test(r.accessToken),
      )
      .map((r: PendingHold) => {
        const reservation = r.reservation;
        const valid =
          reservation &&
          typeof reservation.id === "string" &&
          typeof reservation.locker?.code === "string" &&
          typeof reservation.locker.location === "string" &&
          ["HOLD", "CONFIRMED", "CANCELLED", "EXPIRED"].includes(
            reservation.status,
          ) &&
          [
            reservation.startTime,
            reservation.endTime,
            reservation.serverNow,
            reservation.expiresAt,
          ].every(
            (t) => typeof t === "string" && Number.isFinite(Date.parse(t)),
          );
        return {
          requestKey: r.requestKey,
          accessToken: r.accessToken,
          ...(r.request &&
          typeof r.request.lockerId === "string" &&
          [r.request.startTime, r.request.endTime].every(
            (t) => typeof t === "string" && Number.isFinite(Date.parse(t)),
          )
            ? { request: r.request }
            : {}),
          ...(valid ? { reservation } : {}),
        };
      });
  } catch {
    return [];
  }
}
export function getPendingHolds() {
  return parse(snapshot());
}
export function isDurable(row: PendingHold) {
  try {
    return parse(sessionStorage.getItem(key) ?? "[]").some(
      (r) =>
        r.requestKey === row.requestKey && r.accessToken === row.accessToken,
    );
  } catch {
    return false;
  }
}
function write(rows: PendingHold[]) {
  memory = JSON.stringify(rows);
  let durable = false;
  if (!blocked) {
    try {
      sessionStorage.setItem(key, memory);
      durable = true;
    } catch {
      blocked = true;
    }
  }
  window.dispatchEvent(new Event(changed));
  return durable;
}
export function rememberHold(row: PendingHold) {
  const previous = getPendingHolds().find(
    (r) => r.requestKey === row.requestKey,
  );
  return write([
    { ...previous, ...row },
    ...getPendingHolds().filter((r) => r.requestKey !== row.requestKey),
  ]);
}
export function forgetHold(key: string) {
  write(getPendingHolds().filter((r) => r.requestKey !== key));
}
export function newHold(
  request: NonNullable<PendingHold["request"]>,
): PendingHold {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const accessToken = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return { requestKey: crypto.randomUUID(), accessToken, request };
}
export const recoveryCode = (r: PendingHold) =>
  `LR1.${r.requestKey}.${r.accessToken}`;
export function parseRecoveryCode(code: string): PendingHold | null {
  const [version, requestKey, accessToken, extra] = code.trim().split(".");
  return version === "LR1" &&
    !extra &&
    uuid.test(requestKey ?? "") &&
    token.test(accessToken ?? "")
    ? { requestKey, accessToken }
    : null;
}
function subscribe(update: () => void) {
  window.addEventListener(changed, update);
  return () => window.removeEventListener(changed, update);
}
export function usePendingHolds() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "[]");
  // The snapshot is a stable string; records are merely local hints until the server verifies them.
  return { rows: useMemo(() => parse(raw), [raw]), raw };
}
