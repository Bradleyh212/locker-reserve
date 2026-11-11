import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const when = "2026-11-06T15:30:00Z";
const fixture = (n: number) => ({
  id: "locker-bench-00" + n,
  lockerId: "inventory-" + n,
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
    lockers: initial.map((d) => ({
      id: d.lockerId,
      code: d.locker.code,
      location: "Site - Floor 1",
      isActive: true,
      createdAt: when,
      updatedAt: when,
    })),
    inventoryReads: 0,
    creations: [] as unknown[],
    patches: [] as unknown[],
    serverTime: null as number | null,
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
          headers:
            state.serverTime === null
              ? {}
              : {
                  Date: new Date(state.serverTime).toUTCString(),
                  "Access-Control-Expose-Headers": "Date",
                },
        });
      }
      if (p === "/lockers") {
        if (route.request().method() === "POST") {
          const data = route.request().postDataJSON();
          state.creations.push(data);
          if (data.code === "DUPLICATE")
            return route.fulfill({
              status: 409,
              json: { message: "Locker code already exists" },
            });
          const locker = {
            id: "created-" + state.creations.length,
            ...data,
            createdAt: when,
            updatedAt: when,
          };
          state.lockers.push(locker);
          return route.fulfill({ status: 201, json: locker });
        }
        state.inventoryReads++;
        return route.fulfill({ json: state.lockers });
      }
      if (p.startsWith("/lockers/") && route.request().method() === "PATCH") {
        const l = state.lockers.find((l) => l.id === p.split("/").at(-1));
        if (!l) return route.fulfill({ status: 404, json: {} });
        const patch = route.request().postDataJSON();
        state.patches.push(patch);
        Object.assign(l, patch);
        return route.fulfill({ json: l });
      }
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
  card(p, n).getByRole("button", { name: "Manage", exact: true });
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
  await page.goto("/lockers");
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
  await expect(
    card(page, 1).getByRole("button", { name: /pulse|unlock/i }),
  ).toHaveCount(0);
  expect(s.posts).toEqual([]);
});

test("drawer traps focus, restores it, and expands only returned history", async ({
  page,
}) => {
  const s = await setup(page);
  await page.goto("/lockers");
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
  await page.goto("/lockers");
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
  await page.goto("/lockers");
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
  await page.goto("/lockers");
  await expect(
    page.getByText("No lockers have been created yet."),
  ).toBeVisible();
  s.bad = true;
  s.lockers.push({
    id: "u",
    code: "U",
    location: "Lab",
    isActive: true,
    createdAt: when,
    updatedAt: when,
  });
  await page.reload();
  await expect(
    page.getByRole("alert").filter({ hasText: "Device updates paused" }),
  ).toBeVisible();
  await expect(page.getByText("No lockers have been created yet.")).toHaveCount(
    0,
  );
});

for (const mobile of [false, true]) {
  test(
    "layout, themes and shared radii " + (mobile ? "mobile" : "desktop"),
    async ({ page }) => {
      const s = await setup(page);
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      s.lockers.splice(1, 0, {
        id: "unlinked",
        code: "B-201",
        location: "Site - Floor 2",
        isActive: false,
        createdAt: when,
        updatedAt: when,
      });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto("/lockers");
      await expect(manage(page)).toBeVisible();
      if (mobile) await card(page).scrollIntoViewIfNeeded();
      await shot(page, mobile ? "inventory-mobile" : "inventory-desktop");
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
  await page.goto("/lockers");
  await expect(page.getByText("Loading hardware…").first()).toBeVisible();
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
  await page.goto("/lockers");
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
  await page.goto("/lockers");
  await expect(
    page.getByRole("button", { name: "Manage", exact: true }),
  ).toHaveCount(36);
  await manage(page, 35).click();
  s.devices.reverse();
  await page.clock.fastForward(3001);
  await expect(
    page.getByRole("dialog", { name: "Locker A-1035" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("legacy URL redirects to one sidebar destination; metrics and association use IDs", async ({
  page,
}) => {
  const s = await setup(page, [fixture(1), fixture(3)]);
  // IDs intentionally differ from display codes and device IDs.
  s.devices[0].locker.code = "Unrelated display name";
  s.lockers.push({
    id: "solo",
    code: "B-201",
    location: "Site - Floor 2",
    isActive: false,
    createdAt: when,
    updatedAt: when,
  });
  await page.goto("/devices");
  await expect(page).toHaveURL(/\/lockers$/);
  await expect(
    page.getByRole("link", { name: "Devices", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Lockers", exact: true }),
  ).toHaveCount(1);
  const metrics = page.locator("dl").first();
  for (const [label, count] of [
    ["Total lockers", "3"],
    ["Active lockers", "2"],
    ["Online devices", "1"],
  ]) {
    await expect(
      metrics.locator("div").filter({ hasText: label }).locator("dd"),
    ).toHaveText(count);
  }
  await expect(card(page).getByText("locker-bench-001")).toBeVisible();
  const solo = page.getByRole("region", { name: "Locker B-201" });
  await expect(solo.getByText("No device linked")).toBeVisible();
  await expect(
    solo.getByRole("button", { name: "Device setup" }),
  ).toBeDisabled();
  expect(s.posts).toEqual([]);
});

test("table preference survives reload, filters both views and manages the same linked device", async ({
  page,
}) => {
  const s = await setup(page);
  await page.clock.install();
  await page.goto("/lockers");
  await expect(manage(page)).toBeVisible();
  const reads = [s.reads, s.inventoryReads];
  await page.getByRole("button", { name: "Table", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "Table", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const row = page.getByRole("row").filter({ hasText: "A-101" });
  await expect(row.getByText("Closed")).toBeVisible();
  await row.getByRole("button", { name: "Manage", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Locker A-101" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox").fill("A-102");
  await expect(page.getByRole("row").filter({ hasText: "A-101" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Cards", exact: true }).click();
  await expect(card(page, 2)).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  expect([s.reads, s.inventoryReads]).toEqual(reads);
  await page.reload();
  await expect(page.getByRole("table")).toBeVisible();
  await shot(page, "inventory-table");
});

test("add locker validates, handles a conflict, creates an inactive unlinked row and preserves activation actions", async ({
  page,
}) => {
  const s = await setup(page);
  await page.goto("/lockers");
  await expect(manage(page)).toBeVisible();
  await page.getByRole("button", { name: "Add locker", exact: true }).click();
  const d = page.getByRole("dialog", { name: "Add locker" });
  await expect(
    d.getByRole("button", { name: "Create", exact: true }),
  ).toBeDisabled();
  await shot(page, "add-locker");
  await d.getByLabel("Code").fill("DUPLICATE");
  await d.getByLabel("Location").fill("Floor 2");
  await d.getByRole("button", { name: "Create", exact: true }).click();
  await expect(d.getByText("Locker code already exists")).toBeVisible();
  await d.getByLabel("Code").fill("B-202");
  await d.getByRole("checkbox").uncheck();
  await d.getByRole("button", { name: "Create", exact: true }).click();
  const item = page.getByRole("region", { name: "Locker B-202" });
  await expect(item.getByText("Inactive", { exact: true })).toBeVisible();
  await item.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(item.getByText("Active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "B-202" });
  await row.getByRole("button", { name: "Deactivate" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Deactivate locker" })
    .click();
  await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
  expect(s.patches).toEqual([{ isActive: true }, { isActive: false }]);
  expect(s.creations.at(-1)).toEqual({
    code: "B-202",
    location: "Floor 2",
    isActive: false,
  });
});

test("server-clock cooldown counts down, rechecks at zero, and never pulses", async ({
  page,
}) => {
  const s = await setup(page, [fixture(1)]);
  await page.clock.install({ time: new Date("2035-01-01T00:00:00Z") });
  const start = Date.parse("2026-11-06T15:30:00Z");
  s.serverTime = start;
  s.devices[0].unlock = {
    ...s.devices[0].unlock,
    allowed: false,
    blockedReason: "Waiting for cooldown",
    cooldownUntil: new Date(start + 5000).toISOString(),
  };
  await page.goto("/lockers");
  await manage(page).click();
  const d = page.getByRole("dialog");
  await expect(d.getByRole("timer")).toContainText("Retry in 5s");
  for (let i = 1; i <= 5; i++) {
    s.serverTime = start + i * 1000;
    await page.clock.runFor(1000);
    await expect(d.getByRole("timer")).toContainText(
      i < 5 ? "Retry in " + (5 - i) + "s" : "Checking availability",
    );
  }
  await expect(d.getByRole("spinbutton")).toHaveCount(0);
  const reads = s.reads;
  s.devices[0].unlock = {
    ...s.devices[0].unlock,
    allowed: true,
    cooldownUntil: null,
  };
  await page.clock.runFor(3001);
  await expect(d.getByRole("spinbutton")).toBeVisible();
  expect(s.reads).toBeGreaterThan(reads);
  expect(s.posts).toEqual([]);
});

for (const [delta, label] of [
  [85000, "1m 25s"],
  [7800000, "2h 10m"],
] as const) {
  test("formats long cooldown " + label, async ({ page }) => {
    const s = await setup(page, [fixture(1)]);
    s.serverTime = Date.parse(when);
    s.devices[0].unlock = {
      ...s.devices[0].unlock,
      allowed: false,
      blockedReason: "Waiting for cooldown",
      cooldownUntil: new Date(s.serverTime + delta).toISOString(),
    };
    await page.goto("/lockers");
    await manage(page).click();
    await expect(page.getByRole("timer")).toContainText("Retry in " + label);
  });
}

test("unavailable hardware does not label a locker unlinked or count it as offline", async ({
  page,
}) => {
  const s = await setup(page, [fixture(1)]);
  s.bad = true;
  await page.goto("/lockers");
  await expect(card(page).getByText("Device link unknown")).toBeVisible();
  await expect(card(page).getByText("No device linked")).toHaveCount(0);
  await expect(
    page
      .locator("dl")
      .first()
      .locator("div")
      .filter({ hasText: "Online devices" })
      .locator("dd"),
  ).toHaveText("—");
});

test("mobile inventory table scrolls independently and keeps Manage usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto("/lockers");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const wrap = page.getByRole("region", { name: "Locker inventory table" });
  await expect(wrap).toBeVisible();
  expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await wrap
    .getByRole("button", { name: "Manage", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Locker A-101" }),
  ).toBeVisible();
});


test("Solenoid uses Zap in cards, table and drawer and preserves status order", async ({ page }) => {
  await setup(page, [fixture(1)]);
  await page.goto("/lockers");
  await expect(card(page).locator("dt")).toHaveText(["Connection", "Door", "Solenoid"]);
  await expect(card(page).locator("svg.lucide-zap")).toHaveCount(1);
  await expect(card(page).getByText("Driver", { exact: true })).toHaveCount(0);
  await manage(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("dt")).toHaveText(["Connection", "Door", "Solenoid"]);
  await expect(dialog.locator("svg.lucide-zap")).toHaveCount(1);
  await expect(dialog.getByText(/Solenoid shows the last device-reported output/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Solenoid", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Driver", exact: true })).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "A-101" });
  await expect(row.locator("svg.lucide-zap")).toHaveCount(1);
  await expect(row.getByText("Inactive", { exact: true })).toBeVisible();
});

for (const commandStatus of ["QUEUED", "PENDING", "DELIVERED", "OUTPUT_PULSE_COMPLETED"]) {
  test("500 ms " + commandStatus + " command does not imply current energization", async ({ page }) => {
    const device = fixture(1);
    device.commands[0].status = commandStatus;
    device.commands[0].pulseMs = 500;
    const s = await setup(page, [device]);
    await page.goto("/lockers");
    await expect(card(page).getByText("Inactive", { exact: true })).toBeVisible();
    await expect(card(page).getByText("Energized", { exact: true })).toHaveCount(0);
    expect(s.posts).toEqual([]);
  });
}

for (const outputState of ["INACTIVE", "ACTIVE", "UNKNOWN"]) {
  test("Solenoid maps reported " + outputState + " and hides it after disconnect", async ({ page }) => {
    const device = fixture(1);
    device.outputState = outputState;
    const s = await setup(page, [device]);
    await page.clock.install();
    await page.goto("/lockers");
    await manage(page).click();
    const reading = page.getByRole("dialog").locator("dl > div").filter({ has: page.locator("dt", { hasText: "Solenoid" }) });
    await expect(reading.locator("dd")).toHaveText(outputState === "ACTIVE" ? "Energized" : outputState === "INACTIVE" ? "Inactive" : "Unknown");
    await expect(reading.locator("svg.lucide-zap")).toHaveCount(1);
    s.devices[0].online = false;
    await page.clock.fastForward(3001);
    await expect(reading.locator("dd")).toHaveText("Unknown");
    s.bad = true;
    await page.clock.fastForward(3001);
    await expect(reading.locator("dd")).toHaveText("Unknown");
    expect(s.posts).toEqual([]);
  });
}
