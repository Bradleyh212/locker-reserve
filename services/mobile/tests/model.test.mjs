import test from "node:test";
import assert from "node:assert/strict";
import {
  availabilityUrl,
  readAvailability,
  firstStart,
  available,
  catalog,
  hour,
  overlaps,
  restoreBookings,
  validSlot,
} from "../src/model.ts";
const slot = { start: Date.UTC(2030, 0, 3, 10), hours: 2 };
test("availability includes the API prefix and exact UTC interval", () => {
  const u = new URL(availabilityUrl("https://api.example.test/api/", slot));
  assert.equal(u.pathname, "/api/public/lockers/availability");
  assert.equal(u.searchParams.get("startTime"), "2030-01-03T10:00:00.000Z");
  assert.equal(u.searchParams.get("endTime"), "2030-01-03T12:00:00.000Z");
});
test("configuration rejects credentials and insecure remote URLs", () => {
  for (const base of [
    "",
    "http://example.test",
    "https://name:pw@example.test",
    "https://example.test/?key=a",
    "file:///demo",
  ])
    assert.throws(() => availabilityUrl(base, slot));
  assert.ok(availabilityUrl("http://127.0.0.1:3001", slot));
});
test("public adapter uses only GET, accepts empty inventory and drops extra fields", async () => {
  const signal = new AbortController().signal;
  const request = async (_, init) => {
    assert.deepEqual(init, { method: "GET", credentials: "omit", signal });
    return Response.json([{ ...catalog[0], internal: "omit" }]);
  };
  assert.deepEqual(
    await readAvailability("https://example.test", slot, signal, request),
    [catalog[0]],
  );
  assert.deepEqual(
    await readAvailability("https://example.test", slot, signal, async () =>
      Response.json([]),
    ),
    [],
  );
});
test("denial and malformed responses never become demo inventory", async () => {
  for (const response of [
    new Response("", { status: 403 }),
    Response.json([{}]),
    Response.json({ data: [] }),
  ])
    await assert.rejects(
      readAvailability(
        "https://example.test",
        slot,
        new AbortController().signal,
        async () => response,
      ),
    );
});
test("demo reservations prevent overlap and allow adjoining periods", () => {
  const b = { ...slot, id: "preview-x", locker: catalog[0] };
  assert.ok(!available(slot, [b]).includes(catalog[0]));
  assert.equal(
    overlaps(slot, { start: slot.start + 2 * hour, hours: 1 }),
    false,
  );
  assert.deepEqual(restoreBookings(JSON.stringify([b])), [b]);
  assert.deepEqual(restoreBookings(null), []);
  assert.throws(() => restoreBookings("[{}]"));
});
test("rejects past and unsupported slots; default begins in the future", () => {
  assert.ok(firstStart(slot.start) > slot.start);
  assert.equal(validSlot(slot, slot.start), false);
  assert.equal(validSlot({ ...slot, hours: -1 }, 0), false);
});
