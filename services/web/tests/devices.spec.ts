import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const when = "2026-11-06T15:30:00Z";
const fixture = (n: number) => ({
  id: "locker-bench-00" + n,
  locker: { code: "A-10" + n },
  online: n !== 3,
  lastSeen: when,
  doorState: n === 2 ? "OPEN" : "CLOSED",
  outputState: n === 4 ? "ACTIVE" : "INACTIVE",
  unlock: {
    allowed: n === 1,
    blockedReason:
      n === 2
        ? "Door must have a recent CLOSED observation"
        : "Locker unavailable",
    maxPulseMs: 5000,
    cooldownUntil: null as string | null,
  },
  commands: Array.from({ length: 5 }, (_, i) => ({
    id: "c" + i,
    status: i === 1 ? "EXPIRED_UNKNOWN" : "OUTPUT_PULSE_COMPLETED",
    issuedAt: when,
    pulseMs: 500,
    reason: "Bench test",
    resultReason: "LOCAL_DEADLINE_REACHED",
    completedAt: when,
  })),
});
type Device = ReturnType<typeof fixture>;
async function setup(
  page: Page,
  initial: Device[] = [1, 2, 3, 4].map(fixture),
) {
  const state = {
    devices: initial,
    bad: false,
    login: true,
    posts: [] as unknown[],
    reads: 0,
    pause: null as Promise<void> | null,
  };
  // Intercept every off-origin request. Tests never forward to a real API/locker.
  await page.route(
    (url) => url.origin !== "http://127.0.0.1:47890",
    async (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p === "/auth/me")
        return route.fulfill({
          status: state.login ? 200 : 401,
          json: { authenticated: state.login },
        });
      if (p.endsWith("/unlock-requests")) {
        state.posts.push(route.request().postDataJSON());
        if (state.pause) await state.pause;
        return route.fulfill({ status: 202, json: { status: "QUEUED" } });
      }
      if (p === "/v1/admin/devices") {
        state.reads++;
        return route.fulfill({
          status: state.bad ? 503 : 200,
          json: state.bad ? {} : state.devices,
        });
      }
      if (p === "/lockers")
        return route.fulfill({
          json: state.devices.map((d) => ({
            id: d.id,
            code: d.locker.code,
            location: "Lab",
            isActive: true,
            createdAt: when,
            updatedAt: when,
          })),
        });
      if (p === "/dashboard/stats")
        return route.fulfill({
          json: {
            totalLockers: 4,
            activeLockers: 4,
            inactiveLockers: 0,
            activeReservations: 0,
            pendingHolds: 0,
            confirmedReservations: 0,
            expiredReservations: 0,
            cancelledReservations: 0,
            dailyReservations: [],
            statusBreakdown: [],
            recentReservations: [],
          },
        });
      return route.abort();
    },
  );
  return state;
}
const card = (p: Page, n = 1) =>
  p.getByRole("region", { name: "Locker A-10" + n, exact: true });
const manage = (p: Page, n = 1) =>
  card(p, n).getByRole("button", { name: "Manage device" });
async function shot(p: Page, name: string) {
  if (!process.env.UI_SCREENSHOT_DIR) return;
  await mkdir(process.env.UI_SCREENSHOT_DIR, { recursive: true });
  await p.screenshot({
    path: path.join(process.env.UI_SCREENSHOT_DIR, name + ".png"),
  });
}

test("compact read-only cards map actual status and hide stale observations", async ({
  page,
}) => {
  const s = await setup(page);
  await page.goto("/devices");
  await expect(card(page).getByText("Online", { exact: true })).toBeVisible();
  await expect(card(page).getByText("Inactive", { exact: true })).toBeVisible();
  await expect(card(page, 2).getByText("Open", { exact: true })).toBeVisible();
  await expect(card(page, 3).getByText("Unknown", { exact: true })).toHaveCount(
    2,
  );
  await expect(
    card(page, 4).getByText("Energized", { exact: true }),
  ).toBeVisible();
  await expect(card(page, 1).locator("dl svg")).toHaveCount(3);
  await expect(card(page, 2).locator("svg.lucide-door-open")).toHaveCount(1);
  await expect(card(page, 1).getByRole("button")).toHaveCount(1);
  expect(s.posts).toEqual([]);
});

test("drawer traps focus, restores it, and expands only returned history", async ({
  page,
}) => {
  const s = await setup(page);
  await page.goto("/devices");
  await manage(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Locker A-101" });
  const close = dialog.getByRole("button", { name: "Close device controls" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Show more" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await expect(dialog.locator("li")).toHaveCount(3);
  await dialog.getByRole("button", { name: "Show more" }).click();
  await expect(dialog.locator("li")).toHaveCount(5);
  await dialog.getByRole("button", { name: "Show less" }).click();
  await expect(dialog.locator("li")).toHaveCount(3);
  await expect(
    dialog.getByText("No result received.", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(manage(page)).toBeFocused();
  expect(s.posts).toEqual([]);
});

test("validates a supervised pulse, retains duration, and never resends on close/reopen", async ({
  page,
}) => {
  const s = await setup(page);
  await page.goto("/devices");
  await manage(page).click();
  const d = page.getByRole("dialog");
  const send = d.getByRole("button", { name: "Send unlock pulse" });
  await d.getByRole("spinbutton").fill("5.001");
  await d.getByRole("combobox").selectOption("Other");
  await send.click();
  expect(s.posts).toEqual([]);
  await d.getByRole("spinbutton").fill("1.125");
  await d.getByLabel("Describe the reason").fill("   ");
  await d.getByRole("checkbox").check();
  await send.click();
  await expect(d.getByRole("alert")).toContainText("audit reason");
  await d.getByLabel("Describe the reason").fill("Observe test rig");
  await d.getByRole("checkbox").uncheck();
  await send.click();
  expect(s.posts).toEqual([]);
  await d.getByRole("checkbox").check();
  let release!: () => void;
  s.pause = new Promise((resolve) => {
    release = resolve;
  });
  await send.click();
  await expect.poll(() => s.posts.length).toBe(1);
  await expect(d.getByRole("button", { name: "Sending…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await manage(page).click();
  await expect(d.getByRole("spinbutton")).toHaveValue("1.125");
  await expect(d.getByRole("checkbox")).not.toBeChecked();
  s.devices[0].unlock = {
    ...s.devices[0].unlock,
    allowed: false,
    blockedReason: "Waiting for cooldown",
    cooldownUntil: when,
  };
  release();
  await expect(d.getByRole("status")).toContainText("Pulse requested");
  await expect(d.getByText(/Waiting for cooldown/)).toBeVisible();
  expect(s.posts).toEqual([{ pulseMs: 1125, reason: "Observe test rig" }]);
});

test("one poll updates card and open drawer; failure disables controls and readings recover", async ({
  page,
}) => {
  const s = await setup(page);
  await page.clock.install();
  await page.goto("/devices");
  await manage(page).click();
  const d = page.getByRole("dialog");
  const before = s.reads;
  s.devices[0].online = false;
  await page.clock.fastForward(3001);
  await expect(d.getByText("Offline", { exact: true })).toBeVisible();
  await expect(card(page).getByText("Offline", { exact: true })).toBeAttached();
  await expect(d.getByRole("spinbutton")).toHaveCount(0);
  expect(s.reads).toBe(before + 1);
  s.bad = true;
  await page.clock.fastForward(3001);
  await expect(d.getByText("Unknown", { exact: true })).toHaveCount(3);
  s.bad = false;
  s.devices[0].online = true;
  await page.clock.fastForward(3001);
  await expect(d.getByRole("spinbutton")).toBeVisible();
  expect(s.posts).toEqual([]);
});

test("distinguishes empty and failed inventory", async ({ page }) => {
  const s = await setup(page, []);
  await page.goto("/devices");
  await expect(page.getByText("No devices provisioned yet.")).toBeVisible();
  s.bad = true;
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Device updates paused" }),
  ).toBeVisible();
  await expect(page.getByText("No devices provisioned yet.")).toHaveCount(0);
});

for (const mobile of [false, true]) {
  test(
    "layout, themes and shared radii " + (mobile ? "mobile" : "desktop"),
    async ({ page }) => {
      const s = await setup(page);
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto("/devices");
      await expect(manage(page)).toBeVisible();
      await shot(page, mobile ? "devices-mobile" : "devices-desktop");
      await manage(page).click();
      const d = page.getByRole("dialog");
      const box = await d.boundingBox();
      expect(box!.width).toBe(mobile ? 390 : 458);
      await expect(d.getByRole("checkbox")).toBeVisible();
      await shot(page, mobile ? "drawer-mobile" : "drawer-desktop");
      await d.getByRole("button", { name: "Close device controls" }).click();
      await page.getByRole("button", { name: "Light", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      await expect(card(page)).toHaveCSS("border-radius", "18px");
      await shot(
        page,
        mobile ? "devices-light-mobile" : "devices-light-desktop",
      );
      for (const [url, heading] of [
        ["/lockers", "Lockers"],
        ["/", "Dashboard"],
        ["/login", "Sign in"],
      ]) {
        if (url === "/login") s.login = false;
        await page.goto(url);
        await expect(
          page.getByRole("heading", { name: heading, exact: true }).first(),
        ).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        await expect(page.locator(".card").first()).toHaveCSS(
          "border-radius",
          "18px",
        );
        if (url === "/login")
          await expect(page.getByRole("textbox").first()).toHaveCSS(
            "border-radius",
            "14px",
          );
        await shot(
          page,
          heading.toLowerCase().replace(" ", "-") +
            "-" +
            (mobile ? "mobile" : "desktop"),
        );
      }
    },
  );
}

test("shows loading and safely reports an unconfirmed request", async ({
  page,
}) => {
  const s = await setup(page);
  let unblock!: () => void;
  const wait = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  await page.route("**/v1/admin/devices", async (route) => {
    await wait;
    await route.fulfill({ json: s.devices });
  });
  await page.route("**/unlock-requests", (route) => route.abort());
  await page.goto("/devices");
  await expect(page.getByText("Loading devices…")).toBeVisible();
  unblock();
  await manage(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").selectOption("Maintenance");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Send unlock pulse" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Request outcome unknown. Check recent activity before trying again.",
  );
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
});

test("rounded confirmations keep cancellation and approval separate", async ({
  page,
}) => {
  await setup(page);
  let writes = 0;
  await page.route("**/lockers/*", (route) => {
    writes++;
    return route.fulfill({ json: {} });
  });
  await page.route(
    (url) =>
      url.pathname === "/reservations" &&
      url.origin !== "http://127.0.0.1:47890",
    (route) =>
      route.fulfill({
        json: [
          {
            id: "r1",
            lockerId: "l1",
            status: "CONFIRMED",
            startTime: when,
            endTime: when,
            expiresAt: when,
            createdAt: when,
            locker: { code: "A-101" },
          },
        ],
      }),
  );
  await page.route("**/reservations/r1/cancel", (route) => {
    writes++;
    return route.fulfill({ json: {} });
  });
  for (const [url, button, action] of [
    ["/lockers", "Deactivate", "Deactivate locker"],
    ["/reservations", "Cancel", "Cancel reservation"],
  ]) {
    await page.goto(url);
    const trigger = page
      .getByRole("button", { name: button, exact: true })
      .first();
    const before = writes;
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCSS("border-radius", "22px");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(writes).toBe(before);
    await trigger.click();
    await dialog.getByRole("button", { name: action, exact: true }).click();
    await expect.poll(() => writes).toBe(before + 1);
  }
});

test("a delayed older poll cannot overwrite the post-submit refresh", async ({
  page,
}) => {
  const s = await setup(page, [fixture(1)]);
  await page.clock.install();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  await page.route("**/v1/admin/devices", async (route) => {
    const n = ++calls;
    if (n === 2) await gate;
    const device = fixture(1);
    device.online = n < 3;
    await route.fulfill({ json: [device] });
  });
  await page.goto("/devices");
  await manage(page).click();
  await page.clock.fastForward(3001);
  await expect.poll(() => calls).toBe(2);
  const d = page.getByRole("dialog");
  await d.getByRole("combobox").selectOption("Bench test");
  await d.getByRole("checkbox").check();
  await d.getByRole("button", { name: "Send unlock pulse" }).click();
  await expect(d.getByText("Offline", { exact: true })).toBeVisible();
  release();
  await page.clock.fastForward(3001);
  await expect(d.getByText("Offline", { exact: true })).toBeVisible();
  expect(s.posts).toHaveLength(1);
});

test("keeps a selected device stable in a large collection", async ({
  page,
}) => {
  const s = await setup(
    page,
    Array.from({ length: 36 }, (_, i) => fixture(i + 1)),
  );
  await page.clock.install();
  await page.goto("/devices");
  await expect(page.getByRole("button", { name: "Manage device" })).toHaveCount(
    36,
  );
  await manage(page, 35).click();
  s.devices.reverse();
  await page.clock.fastForward(3001);
  await expect(
    page.getByRole("dialog", { name: "Locker A-1035" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
});
