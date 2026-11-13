import { test, expect, type Page } from "@playwright/test";
const origin = "http://127.0.0.1:47890";
type Receipt = {
  id: string;
  lockerId: string;
  locker: { code: string; location: string };
  startTime: string;
  endTime: string;
  expiresAt: string;
  serverNow: string;
  status: string;
  paymentState: string;
  canPay: boolean;
  hasPayment: boolean;
  reconciliationRequired: boolean;
  amount: number;
  currency: string;
};
async function setup(page: Page, blocked = false) {
  if (blocked)
    await page.addInitScript(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException("Blocked", "SecurityError");
      };
      Storage.prototype.getItem = function () {
        throw new DOMException("Blocked", "SecurityError");
      };
    });
  const state = {
    holdPosts: 0,
    intentPosts: 0,
    lookups: 0,
    pauseLookup: null as Promise<void> | null,
    lost: false,
    failSetup: false,
    records: new Map<string, { token: string; r: Receipt }>(),
    now: Date.now(),
  };
  await page.route(
    (url) => url.origin !== origin,
    async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        p = url.pathname;
      if (url.hostname === "js.stripe.com")
        return route.fulfill({
          contentType: "application/javascript",
          body: `
      window.Stripe=function(){return {
        _registerWrapper(){},registerAppInfo(){},createToken(){},createPaymentMethod(){},confirmCardPayment(){},
        elements(){return {create(){return {mount(target){const el=document.createElement('p');el.textContent='Mock payment details';target.appendChild(el);},on(){},off(){},destroy(){},unmount(){},update(){}};},update(){},on(){},off(){}};},
        async confirmPayment(options){if(window.__throwStripe)throw new Error('Mock provider interruption');window.__lastStripeReturn=options.confirmParams.return_url;window.__mockConfirmed=true;return {paymentIntent:{status:'processing'}};}
      };};`,
        });
      if (p === "/public/lockers/availability")
        return route.fulfill({
          json: [
            {
              id: "fixture-locker",
              code: "B-101",
              location: "Mock-only",
              isActive: true,
            },
          ],
        });
      if (p === "/auth/me") return route.fulfill({ status: 401, json: {} });
      const key = request.headers()["idempotency-key"],
        token = request.headers()["authorization"];
      if (p === "/public/reservations/hold") {
        state.holdPosts++;
        let saved = state.records.get(key);
        if (saved && saved.token !== token)
          return route.fulfill({
            status: 404,
            json: { message: "Reservation resource not found" },
          });
        if (!saved) {
          const body = request.postDataJSON();
          saved = {
            token,
            r: {
              ...body,
              id: "booking-" + state.records.size,
              locker: { code: "B-101", location: "Mock-only" },
              expiresAt: new Date(state.now + 600000).toISOString(),
              serverNow: new Date(state.now).toISOString(),
              status: "HOLD",
              paymentState: "UNPAID",
              canPay: true,
              hasPayment: false,
              reconciliationRequired: false,
              amount: 500,
              currency: "cad",
            },
          };
          state.records.set(key, saved);
        }
        if (state.lost) {
          state.lost = false;
          return route.abort();
        }
        return route.fulfill({ status: 201, json: saved.r });
      }
      if (p === "/public/reservations/recovery") {
        state.lookups++;
        const saved = state.records.get(key);
        if (!saved || saved.token !== token)
          return route.fulfill({
            status: 404,
            json: { message: "Reservation resource not found" },
          });
        const response = {
          ...saved.r,
          serverNow: new Date(state.now).toISOString(),
        };
        const pause = state.pauseLookup;
        state.pauseLookup = null;
        if (pause) await pause;
        return route.fulfill({ json: response });
      }
      if (p === "/public/payments/create-intent") {
        state.intentPosts++;
        const saved = state.records.get(key);
        if (!saved || saved.token !== token)
          return route.fulfill({
            status: 404,
            json: { message: "Reservation resource not found" },
          });
        if (state.failSetup)
          return route.fulfill({
            status: 503,
            json: { message: "Temporary payment setup interruption" },
          });
        saved.r.hasPayment = true;
        return route.fulfill({
          status: 201,
          json: {
            reservation: saved.r,
            client_secret: saved.r.canPay ? "pi_fixture_secret_private" : null,
            amount: 500,
            currency: "cad",
          },
        });
      }
      // Every off-origin request is intercepted; no Stripe API or physical device is contacted.
      return route.fulfill({ status: 404, json: {} });
    },
  );
  return state;
}
async function choose(page: Page) {
  await page.goto("/book");
  await page.getByLabel("Start time", { exact: true }).fill("2026-12-15T10:00");
  await page.getByLabel("End time", { exact: true }).fill("2026-12-15T11:00");
  await page
    .getByRole("button", { name: "Check availability", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Available lockers", exact: true }),
  ).toBeVisible();
}
const resume = (page: Page) =>
  page.getByRole("button", {
    name: "Check status / continue payment",
    exact: true,
  });

test("recovers a committed hold after its creation response is lost, without another creation", async ({
  page,
}) => {
  const state = await setup(page);
  state.lost = true;
  await choose(page);
  await page.getByRole("button", { name: "Create hold", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.holdPosts).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Unpaid hold · B-101", exact: true }),
  ).toBeVisible();
  await resume(page).click();
  await expect(
    page.getByRole("heading", { name: "Checkout", exact: true }),
  ).toBeVisible();
  expect(state.holdPosts).toBe(1);
  expect(state.intentPosts).toBe(1);
});
test("preserves receipts over refresh/navigation and reuses payment setup after interruption", async ({
  page,
}) => {
  const state = await setup(page);
  await choose(page);
  await page.getByRole("button", { name: "Create hold", exact: true }).click();
  state.failSetup = true;
  await resume(page).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Temporary payment setup interruption" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "Admin login", exact: true }).click();
  await expect(page).toHaveURL(origin + "/login");
  await page.goBack();
  state.failSetup = false;
  await resume(page).click();
  await expect(
    page.getByRole("heading", { name: "Checkout", exact: true }),
  ).toBeVisible();
  expect(state.holdPosts).toBe(1);
  expect(state.intentPosts).toBe(2);
});
test("requires an exported proof before creating a hold when storage is blocked", async ({
  page,
}) => {
  const state = await setup(page, true);
  await choose(page);
  await page.getByRole("button", { name: "Create hold", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Save your recovery code first" }),
  ).toBeVisible();
  expect(state.holdPosts).toBe(0);
  await resume(page).click();
  expect(state.holdPosts).toBe(0); // Draft retry cannot bypass backup.
  const code = await page
    .getByRole("textbox", { name: "Private recovery code", exact: true })
    .inputValue();
  await page.getByLabel("I saved this private recovery code").check();
  await page
    .getByRole("button", { name: "Continue with saved code", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unpaid hold · B-101" }),
  ).toBeVisible();
  expect(state.holdPosts).toBe(1);
  await page.reload();
  await page.getByLabel("Recovery code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Recover booking", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unpaid hold · B-101" }),
  ).toBeVisible();
  expect(state.holdPosts).toBe(1);
});
test("prevents duplicate creation from rapid clicks", async ({ page }) => {
  const state = await setup(page);
  await choose(page);
  await page
    .getByRole("button", { name: "Create hold", exact: true })
    .dblclick();
  await expect(
    page.getByRole("heading", { name: "Unpaid hold · B-101" }),
  ).toBeVisible();
  expect(state.holdPosts).toBe(1);
});
for (const status of ["CANCELLED", "EXPIRED", "CONFIRMED"] as const)
  test(
    "reconciles " + status + " server state before exposing payment UI",
    async ({ page }) => {
      const state = await setup(page);
      await choose(page);
      await page
        .getByRole("button", { name: "Create hold", exact: true })
        .click();
      const saved = [...state.records.values()][0];
      saved.r.status = status;
      saved.r.canPay = false;
      saved.r.paymentState = status === "CONFIRMED" ? "SUCCEEDED" : "CANCELED";
      await page.reload();
      await resume(page).click();
      await expect(
        page.getByRole("heading", { name: "Checkout", exact: true }),
      ).toHaveCount(0);
      expect(state.intentPosts).toBe(0);
      await expect(
        page.getByRole("button", { name: "Remove saved receipt", exact: true }),
      ).toBeVisible();
    },
  );
test("uses server timing when the browser wall clock is wrong", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2050-01-01T00:00:00Z"));
  const state = await setup(page);
  await choose(page);
  await page.getByRole("button", { name: "Create hold", exact: true }).click();
  await resume(page).click();
  await expect(
    page.getByRole("heading", { name: "Checkout", exact: true }),
  ).toBeVisible();
  expect(state.intentPosts).toBe(1);
});
test("keeps processing receipts and reconciles redirect parameters using stored proof", async ({
  page,
}) => {
  const state = await setup(page);
  await choose(page);
  await page.getByRole("button", { name: "Create hold", exact: true }).click();
  await resume(page).click();
  await expect(
    page.getByText("Mock payment details", { exact: true }),
  ).toBeVisible();
  const [key, saved] = [...state.records.entries()][0];
  await page
    .getByRole("button", { name: "Submit payment", exact: true })
    .click();
  // Provider completion is not local reservation confirmation.
  await expect(
    page.getByRole("heading", { name: "Unpaid hold · B-101", exact: true }),
  ).toBeVisible();
  saved.r.paymentState = "PROCESSING";
  saved.r.canPay = false;
  await page.goto(
    "/book?checkout=" +
      key +
      "&payment_intent=pi_fixture&payment_intent_client_secret=untrusted",
  );
  await expect(page).toHaveURL(origin + "/book");
  await expect(
    page.getByRole("heading", {
      name: "Payment processing · B-101",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove saved receipt", exact: true }),
  ).toHaveCount(0);
  saved.r.paymentState = "SUCCEEDED";
  saved.r.status = "CONFIRMED";
  await resume(page).click();
  await expect(
    page.getByRole("heading", {
      name: "Confirmed reservation · payment received · B-101",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.holdPosts).toBe(1);
  expect(state.intentPosts).toBe(1);
});
test("does not trust a redirect without a stored ownership proof", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/book?checkout=unknown&payment_intent_client_secret=fake");
  await expect(page).toHaveURL(origin + "/book");
  expect(state.lookups).toBe(0);
  expect(state.intentPosts).toBe(0);
});

test("ignores malformed stored data and invalid recovery codes without contacting a reservation endpoint", async ({
  page,
}) => {
  const state = await setup(page);
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "locker:owned-checkouts:v1:http://127.0.0.1:3001/",
      "{broken",
    ),
  );
  await page.goto("/book");
  await page.getByLabel("Recovery code", { exact: true }).fill("not-a-proof");
  await page
    .getByRole("button", { name: "Recover booking", exact: true })
    .click();
  await expect(
    page.getByText("Enter a valid private recovery code.", { exact: true }),
  ).toBeVisible();
  expect(state.lookups).toBe(0);
  expect(state.holdPosts).toBe(0);
});
test("a thrown payment error retains the receipt and releases the submit guard", async ({
  page,
}) => {
  const state = await setup(page);
  await choose(page);
  await page.getByRole("button", { name: "Create hold", exact: true }).click();
  await resume(page).click();
  await expect(
    page.getByText("Mock payment details", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __throwStripe: boolean }).__throwStripe = true;
  });
  await resume(page).click();
  await page
    .getByRole("button", { name: "Submit payment", exact: true })
    .click();
  await expect(
    page.getByText("Mock provider interruption", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit payment", exact: true }),
  ).toBeEnabled();
  expect(state.holdPosts).toBe(1);
});
test("a delayed older status response cannot overwrite a newer verified outcome", async ({
  page,
}) => {
  const state = await setup(page);
  await choose(page);
  await page.getByRole("button", { name: "Create hold", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Create hold", exact: true }),
  ).toBeEnabled();
  const [saved] = [...state.records.values()];
  let release!: () => void;
  state.pauseLookup = new Promise<void>((r) => {
    release = r;
  });
  const count = state.lookups;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => state.lookups).toBeGreaterThan(count);
  saved.r.status = "CONFIRMED";
  saved.r.paymentState = "SUCCEEDED";
  saved.r.canPay = false;
  await resume(page).click();
  await expect(
    page.getByRole("heading", {
      name: "Confirmed reservation · payment received · B-101",
      exact: true,
    }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", {
      name: "Confirmed reservation · payment received · B-101",
      exact: true,
    }),
  ).toBeVisible();
  expect(state.intentPosts).toBe(0);
});
