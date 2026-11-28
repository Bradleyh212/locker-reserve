import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 45000,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:8193",
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npx expo start --web --localhost --port 8193",
    url: "http://127.0.0.1:8193",
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      EXPO_PUBLIC_API_BASE_URL: "https://locker-api.invalid",
      EXPO_NO_TELEMETRY: "1",
      CI: "1",
    },
  },
});
