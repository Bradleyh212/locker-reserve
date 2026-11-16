import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:47890";
const creationKey = "11111111-1111-4111-8111-111111111111";
const token = "A".repeat(43);
const storageKey = "locker:owned-checkouts:v1:http://127.0.0.1:3001/";
const privateCode = `LR1.${creationKey}.${token}`;
type Command = {
  commandId: string;
  status: string;
  issuedAt: string;
  expiresAt: string;
  deliveredAt: string | null;
  completedAt: string | null;
  acknowledged: boolean;
};
async function setup(page: Page, blocked = false) {
  const now = Date.now();
  const reservation = {
    id: "owned-reservation",
    lockerId: "assigned-locker",
    locker: { code: "K-101", location: "Customer test location" },
    startTime: new Date(now - 1000).toISOString(),
    endTime: new Date(now + 3600000).toISOString(),
    expiresAt: new Date(now + 600000).toISOString(),
    serverNow: new Date(now).toISOString(),
    status: "CONFIRMED",
    paymentState: "SUCCEEDED",
    canPay: false,
    hasPayment: true,
    reconciliationRequired: false,
    amount: 500,
    currency: "cad",
  };
  const state = {
    reservation,
    commands: new Map<string, Command>(),
    posts: [] as string[],
    lost: false,
    fail: false,
    allow: true,
    door: "CLOSED",
    fresh: true,
    pause: null as Promise<void> | null,
    reads: 0,
    recoveryReads: 0,
    pauseRecovery: null as Promise<void> | null,
  };
  await page.addInitScript(
    ({ storageKey, creationKey, token, reservation, blocked }) => {
      if (blocked) {
        Storage.prototype.setItem = () => {
          throw new DOMException("Blocked", "SecurityError");
        };
        Storage.prototype.getItem = () => {
          throw new DOMException("Blocked", "SecurityError");
        };
      } else if (!sessionStorage.getItem(storageKey))
        sessionStorage.setItem(
          storageKey,
          JSON.stringify([
            { requestKey: creationKey, accessToken: token, reservation },
          ]),
        );
    },
    { storageKey, creationKey, token, reservation, blocked },
  );
  await page.route(
    (url) => url.origin !== origin,
    async (route) => {
      const request = route.request(),
        p = new URL(request.url()).pathname;
      const authorized = request.headers().authorization === `Bearer ${token}`;
      if (p === "/auth/me") return route.fulfill({ status: 401, json: {} });
      if (p === "/public/reservations/recovery") {
        state.recoveryReads++;
        const pause = state.pauseRecovery;
        state.pauseRecovery = null;
        if (pause) await pause;
        return route.fulfill({
          status: authorized ? 200 : 404,
          json: authorized ? reservation : { message: "Not found" },
        });
      }
      if (p.startsWith("/v1/customer/")) {
        if (!authorized) return route.fulfill({ status: 404, json: {} });
        if (p.endsWith("/access")) {
          state.reads++;
          if (state.fail) return route.abort();
          const data = {
            serverNow: new Date().toISOString(),
            paymentState: reservation.paymentState,
            available:
              state.allow &&
              reservation.status === "CONFIRMED" &&
              reservation.paymentState === "SUCCEEDED",
            code:
              reservation.paymentState !== "SUCCEEDED"
                ? "RESERVATION_INELIGIBLE"
                : state.allow
                  ? "READY"
                  : "LOCKER_UNAVAILABLE",
            commands: [...state.commands.values()],
            door: {
              state: state.door,
              observedAt: new Date().toISOString(),
              fresh: state.fresh,
            },
          };
          const pause = state.pause;
          state.pause = null;
          if (pause) await pause;
          return route.fulfill({ json: data });
        }
        if (p.endsWith("/unlock-requests")) {
          const key = request.headers()["idempotency-key"];
          if (request.method() === "GET")
            return route.fulfill({
              status: state.commands.has(key) ? 200 : 404,
              json: state.commands.get(key) ?? {},
            });
          state.posts.push(key);
          const existing = state.commands.get(key);
          if (!existing) {
            state.commands.set(key, {
              commandId: "command-" + state.commands.size,
              status: "PENDING",
              issuedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 10000).toISOString(),
              deliveredAt: null,
              completedAt: null,
              acknowledged: false,
            });
            state.allow = false;
          }
          if (state.lost) {
            state.lost = false;
            return route.abort();
          }
          return route.fulfill({ status: 202, json: state.commands.get(key) });
        }
      }
      return route.fulfill({ status: 404, json: {} });
    },
  );
  await page.goto("/book");
  if (blocked) {
    await page.getByLabel("Recovery code", { exact: true }).fill(privateCode);
    await page
      .getByRole("button", { name: "Recover booking", exact: true })
      .click();
  }
  return state;
}
const unlock = (page: Page) =>
  page.getByRole("button", { name: "Unlock assigned locker", exact: true });
const check = (page: Page) =>
  page.getByRole("button", { name: "Check unlock status", exact: true });

test("retains the paid receipt as a digital key, persists request key before POST, and never unlocks on refresh/navigation", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(
    page.getByRole("heading", { name: "Digital key · K-101" }),
  ).toBeVisible();
  await expect(
    page.getByText("Customer test location", { exact: false }).last(),
  ).toBeVisible();
  await expect(unlock(page)).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Remove saved receipt" }),
  ).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
  await unlock(page).dblclick();
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
  const stored = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!)[0],
    storageKey,
  );
  expect(stored.unlockRequestKey).toBe(state.posts[0]);
  await page.reload();
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  await page.goto("/availability");
  await page.goBack();
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test("recovers a lost unlock response by GET and keeps one command after refresh", async ({
  page,
}) => {
  const state = await setup(page);
  state.lost = true;
  await expect(unlock(page)).toBeEnabled();
  await unlock(page).click();
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(state.commands.size).toBe(1);
});

test("shows delivery, pulse report, and door observation independently; unknown outcomes do not retry", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(unlock(page)).toBeEnabled();
  await unlock(page).click();
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  const c = [...state.commands.values()][0];
  c.status = "DELIVERY_ATTEMPTED";
  c.deliveredAt = new Date().toISOString();
  await check(page).click();
  await expect(
    page.getByText("Delivery attempted", { exact: true }),
  ).toBeVisible();
  c.status = "OUTPUT_PULSE_COMPLETED";
  c.completedAt = new Date().toISOString();
  await check(page).click();
  await expect(
    page.getByText("Pulse completion reported", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("CLOSED", { exact: true })).toBeVisible();
  state.door = "OPEN";
  await check(page).click();
  await expect(page.getByText("OPEN", { exact: true })).toBeVisible();
  c.status = "OUTCOME_UNKNOWN";
  await check(page).click();
  await expect(
    page.getByText("Unknown command outcome", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Unknown command outcome", { exact: true }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test("requires an exported per-request recovery code when browser storage fails and imports it without posting", async ({
  page,
}) => {
  const state = await setup(page, true);
  await expect(unlock(page)).toBeEnabled();
  await unlock(page).click();
  expect(state.posts).toHaveLength(0);
  const code = await page
    .getByRole("textbox", { name: "Digital key recovery code", exact: true })
    .inputValue();
  expect(code).toContain(".UK.");
  await expect(
    page.getByRole("button", { name: "Send this unlock request" }),
  ).toBeDisabled();
  await page.getByLabel("I saved this digital key recovery code").check();
  await page.getByRole("button", { name: "Send this unlock request" }).click();
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByLabel("Recovery code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Recover booking", exact: true })
    .click();
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  expect(state.posts).toHaveLength(1);
});

test("disables access on connection failure and stale observations, then recovers by GET only", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(unlock(page)).toBeEnabled();
  state.fail = true;
  await check(page).click();
  await expect(unlock(page)).toBeDisabled();
  state.fail = false;
  state.allow = false;
  state.fresh = false;
  await check(page).click();
  await expect(page.getByText("UNKNOWN", { exact: true })).toBeVisible();
  await expect(unlock(page)).toBeDisabled();
  state.fresh = true;
  state.allow = true;
  await check(page).click();
  await expect(unlock(page)).toBeEnabled();
  expect(state.posts).toHaveLength(0);
});

test("cannot use cached paid details when current server payment is restricted", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(unlock(page)).toBeEnabled();
  state.reservation.paymentState = "RECONCILIATION_REQUIRED";
  state.reservation.reconciliationRequired = true;
  await check(page).click();
  await expect(unlock(page)).toBeDisabled();
  await expect(
    page.getByText("Payment is not eligible for access"),
  ).toBeVisible();
  expect(state.posts).toHaveLength(0);
});

test("an older digital-key response cannot replace a newer door/readiness observation", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(unlock(page)).toBeEnabled();
  let release!: () => void;
  state.pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const count = state.reads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => state.reads).toBeGreaterThan(count);
  state.allow = false;
  state.door = "OPEN";
  await check(page).click();
  await expect(page.getByText("OPEN", { exact: true })).toBeVisible();
  release();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("OPEN", { exact: true })).toBeVisible();
  await expect(unlock(page)).toBeDisabled();
  expect(state.posts).toHaveLength(0);
});

test("a delayed booking refresh cannot overwrite the latest unlock idempotency key", async ({
  page,
}) => {
  const state = await setup(page);
  await expect(unlock(page)).toBeEnabled();
  await unlock(page).click();
  await expect(
    page.getByText("Request accepted", { exact: true }),
  ).toBeVisible();
  const first = [...state.commands.values()][0];
  first.status = "OUTPUT_PULSE_COMPLETED";
  state.allow = true;
  await check(page).click();
  await expect(unlock(page)).toBeEnabled();
  let release!: () => void;
  state.pauseRecovery = new Promise<void>((resolve) => {
    release = resolve;
  });
  const count = state.recoveryReads;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => state.recoveryReads).toBeGreaterThan(count);
  await expect(unlock(page)).toBeEnabled();
  await unlock(page).click();
  await expect.poll(() => state.posts.length).toBe(2);
  const latest = state.posts[1];
  expect(latest).not.toBe(state.posts[0]);
  release();
  await page.waitForLoadState("networkidle");
  const rows = await page.evaluate(
    (key) => JSON.parse(sessionStorage.getItem(key)!),
    storageKey,
  );
  expect(rows[0].unlockRequestKey).toBe(latest);
});
