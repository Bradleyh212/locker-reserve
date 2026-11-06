import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:47890",
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1440, height: 980 },
    locale: "en-CA",
    timezoneId: "America/Toronto",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- -H 127.0.0.1 -p 47890",
    url: "http://127.0.0.1:47890/login",
    reuseExistingServer: false,
  },
});
