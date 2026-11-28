export type Locker = { id: string; code: string; location: string };
export type Slot = { start: number; hours: number };
export type Booking = Slot & { id: string; locker: Locker };
export type Mode = "demo" | "live";
export const hour = 3_600_000;
export const demoRate = 2;
export const catalog: Locker[] = [
  { id: "uc-104", code: "L-104", location: "University Centre" },
  { id: "uc-108", code: "L-108", location: "University Centre" },
  { id: "mo-203", code: "M-203", location: "Morisset Library" },
  { id: "st-102", code: "S-102", location: "STEM Complex" },
];
export function firstStart(now = Date.now()) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next.getTime();
}
export function overlaps(a: Slot, b: Slot) {
  return (
    a.start < b.start + b.hours * hour && b.start < a.start + a.hours * hour
  );
}
export function available(slot: Slot, bookings: Booking[]) {
  return catalog.filter(
    (l) => !bookings.some((b) => b.locker.id === l.id && overlaps(slot, b)),
  );
}
export function validSlot(slot: Slot, now = Date.now()) {
  return (
    Number.isFinite(slot.start) &&
    slot.start > now &&
    [1, 2, 4].includes(slot.hours)
  );
}
export function isLocker(value: unknown): value is Locker {
  if (!value || typeof value !== "object") return false;
  return ["id", "code", "location"].every(
    (k) =>
      typeof Reflect.get(value, k) === "string" &&
      Reflect.get(value, k).trim().length > 0,
  );
}
export function restoreBookings(text: string | null): Booking[] {
  const values: unknown = JSON.parse(text ?? "[]");
  if (
    !Array.isArray(values) ||
    !values.every(
      (v) =>
        v &&
        typeof v.id === "string" &&
        isLocker(v.locker) &&
        catalog.some((l) => l.id === v.locker.id) &&
        Number.isSafeInteger(v.start) &&
        [1, 2, 4].includes(v.hours),
    )
  )
    throw Error("Saved previews could not be read.");
  return values;
}
export function availabilityUrl(base: string, slot: Slot) {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw Error(
      "Configure EXPO_PUBLIC_API_BASE_URL to browse connected lockers.",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !(url.protocol === "https:" || (local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error(
      "Use an HTTPS API address without credentials, query parameters or a fragment.",
    );
  url.pathname =
    url.pathname.replace(/\/$/, "") + "/public/lockers/availability";
  url.searchParams.set("startTime", new Date(slot.start).toISOString());
  url.searchParams.set(
    "endTime",
    new Date(slot.start + slot.hours * hour).toISOString(),
  );
  return url.toString();
}
export async function readAvailability(
  base: string,
  slot: Slot,
  signal: AbortSignal,
  request = fetch,
): Promise<Locker[]> {
  const response = await request(availabilityUrl(base, slot), {
    method: "GET",
    credentials: "omit",
    signal,
  });
  if (!response.ok)
    throw Error(
      response.status === 403
        ? "This network is outside the staging allowlist."
        : "Availability is temporarily unavailable.",
    );
  const rows: unknown = await response.json();
  if (!Array.isArray(rows) || !rows.every(isLocker))
    throw Error("The availability response was unexpected.");
  return rows.map(({ id, code, location }) => ({ id, code, location }));
}
export const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
export const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
