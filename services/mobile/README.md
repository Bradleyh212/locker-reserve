# LockerReserve mobile

Expo Router and TypeScript customer MVP for iOS and Android. The app starts in demo mode. A separate read-only mode searches the customer availability API. No store registration, signing credentials, administrator login or Stripe keys are needed for the Expo Go flow.

## Run on a phone

Use Node 24 LTS (24.3 or newer) and npm. From the repository checkout containing this branch:

```sh
cd services/mobile
npm ci
npm start
```

Install **Expo Go compatible with SDK 58** on your iPhone or Android phone. Connect the phone and Mac to the same trusted Wi-Fi network. Scan the Metro QR code with Camera on iPhone or the QR scanner in Expo Go on Android. Allow local network access when prompted. Keep Metro running. If the phone cannot reach the Mac, check local network permissions and Wi-Fi client isolation. Match the Expo Go SDK before troubleshooting the API. An iOS Simulator or Android emulator is optional; use the corresponding Metro shortcut with the simulator tools already installed. [Expo development setup](https://docs.expo.dev/get-started/set-up-your-environment/)

Tap **Explore campus → Browse lockers**. Change the date, start time or duration. Choose a locker, review the illustrative CAD price and confirm the payment preview. **Saved** shows previews on this device after restart. Overlapping previews remove the same locker from demo availability. The campus diagram, sample inventory and rate are illustrative. There is no customer account or physical unlock action.

## Connected availability

Set `EXPO_PUBLIC_API_BASE_URL` before starting Metro. For example, from an already allowlisted network using the existing staging web proxy:

```sh
EXPO_PUBLIC_API_BASE_URL=https://staging.lockerreserve.com/api npm start -- --clear
```

Choose **Settings → Connected API → Discover**. Only the device network used for the API needs the existing access permission. A denial is shown explicitly. Never put a secret in an EXPO_PUBLIC variable. For local phone testing use an already-trusted HTTPS customer API reachable from the phone. Loopback HTTP is supported for same-host web development. A phone’s localhost addresses the phone itself.

| Customer contract | Mobile behavior |
|---|---|
| GET /public/lockers/availability | Sends ISO startTime and endTime. Reads id, code and location. Filters locally by building or locker code. Supports disconnected, timeout, empty and access-denied states. |
| POST /public/reservations/hold; GET /public/reservations/recovery and /:id; POST /:id/cancel | Inspected, deferred until the mobile client can securely persist the 32-byte bearer proof and UUID creation key before sending a hold, then reconcile lost responses. |
| POST /public/payments/create-intent | Deferred. The existing owner-bound Stripe intent, webhook confirmation, hold expiry and recovery flow need a mobile integration and test-mode verification. The demo never requests an intent or collects card details. |
| GET /v1/customer/reservations/:id/access and customer unlock requests | Require verified ownership. Outside this MVP. No device requests or command controls are present. |

The API returns availability for a requested interval and may cache it for 30 seconds. It has no customer reservation-list endpoint and does not supply map coordinates, floor information or prices in availability. Connected lockers end at details. Demo reservations persist locally in AsyncStorage and are labeled separately from server bookings. Future native credentials belong in protected OS storage.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run export
```

The browser suite starts its own loopback Expo server on port 8193, intercepts connected availability and blocks external requests. It exercises checkout, persistence, date selection, conflict filtering, API errors, and navigation guards. Export builds Metro bundles for iOS, Android and web into the ignored dist directory. A physical-device smoke test should cover safe areas, text scaling, VoiceOver/TalkBack, Wi-Fi interruption and restarting the app.

The campus photo is extracted from the existing repository Figma prototype, and the map is an illustrative schematic. Confirm distribution rights for the photo before a public release. Stripe native checkout, secure owner recovery, server-confirmed reservation history, device testing and store signing remain separate milestones.
