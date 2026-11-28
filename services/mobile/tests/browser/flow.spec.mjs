import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ["127.0.0.1", "localhost"].includes(host)
      ? route.continue()
      : route.abort();
  });
});
test("checkout preview persists across reload and blocks overlapping demo bookings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore campus" }).click();
  await page.getByRole("button", { name: "Browse lockers" }).click();
  await page.getByRole("button", { name: "Change date and time" }).click();
  await page.getByRole("button", { name: "4 hours", exact: true }).click();
  await page.getByRole("button", { name: "Show availability" }).click();
  await page
    .getByRole("button", { name: "L-104 at University Centre" })
    .click();
  await page.getByRole("button", { name: "Review reservation" }).click();
  await expect(page.getByText("$8.00 CAD")).toBeVisible();
  await page
    .getByRole("button", { name: "Continue to payment preview" })
    .click();
  await page.getByRole("button", { name: "Confirm demo reservation" }).click();
  await expect(
    page.getByRole("heading", { name: "Demo reservation saved" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View my reservations" }).click();
  await page.reload();
  await expect(page.getByText("L-104", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await expect(page.getByText("3 AVAILABLE")).toBeVisible();
});
test("customer availability handles denied networks, retries, empty filters and real details", async ({
  page,
}) => {
  let calls = 0;
  await page.route("https://locker-api.invalid/**", (route) => {
    expect(route.request().method()).toBe("GET");
    expect(new URL(route.request().url()).pathname).toBe(
      "/public/lockers/availability",
    );
    return route.fulfill(
      ++calls === 1
        ? { status: 403 }
        : { json: [{ id: "test", code: "TEST-42", location: "Fixture hall" }] },
    );
  });
  await page.goto("/settings");
  await page.getByRole("button", { name: "Connected API" }).click();
  await page.getByRole("button", { name: "Discover", exact: true }).click();
  await expect(
    page.getByText("This network is outside the staging allowlist."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await page.getByLabel("Search lockers").fill("nonexistent");
  await expect(page.getByText("No matching lockers")).toBeVisible();
  await page.getByLabel("Search lockers").fill("");
  await page.getByRole("button", { name: "TEST-42 at Fixture hall" }).click();
  await expect(page.getByText("Available for this window")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review reservation" }),
  ).toHaveCount(0);
});
test("checkout deep link requires a selection on a narrow phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/payment");
  await expect(
    page.getByRole("heading", { name: "Choose your locker" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("illustrative map pins filter available demo lockers and toggle back", async ({
  page,
}) => {
  await page.goto("/discover");
  await page.getByRole("button", { name: "Campus map" }).click();
  const pin = page.getByRole("button", { name: "Filter by University Centre" });
  await pin.click();
  await expect(page.getByText("2 AVAILABLE")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "S-102 at STEM Complex" }),
  ).toHaveCount(0);
  await pin.click();
  await expect(page.getByText("4 AVAILABLE")).toBeVisible();
});
