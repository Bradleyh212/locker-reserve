# Dashboard surfaces and device controls

The radius scale lives in `services/web/app/globals.css`. All themes inherit the same geometry.

| Token | Radius | Use |
| --- | --- | --- |
| `--radius-sm` | 10px | Small icon tiles and the inner theme segment |
| `--radius-md` | 14px | Buttons, inputs, selects, textareas, navigation, alerts and menu surfaces |
| `--radius-lg` | 18px | Cards, status panels, segmented-control shells and table containers |
| `--radius-xl` | 22px | Dialog surfaces |
| `--radius-2xl` | 26px | Floating desktop management drawer |
| `--radius-pill` | 9999px | Badges, avatar and circular indicators |

The recent-reservations table sits flush inside a clipping card and inherits the outer silhouette. The full-screen mobile drawer meets the screen edges squarely. Native checkboxes and platform select menus keep browser geometry. Focus indicators remain outside controls; tables scroll horizontally inside their rounded wrapper.

The admin sidebar links to `/lockers`. Bookmarks to `/devices` redirect there. Inventory loads from `GET /lockers`, and one three-second poll reads `GET /v1/admin/devices`. Both views join the device’s `lockerId` to the inventory primary key. Cards are the default. The Cards/Table choice is stored in localStorage. Filtering or changing views reuses the current data. Counts summarize the whole inventory independently of the filter.

Each linked locker offers **Manage** in either view. Unlinked lockers show a disabled setup action because device provisioning is an operator workflow outside this dashboard. A failed hardware fetch displays unknown linkage or stale readings. Driver means reported GPIO output. The drawer shows three recent commands initially and can expand to the available history. Add locker opens the existing validated form in a modal. Activation and confirmed deactivation are available in both views.

The cooldown timer uses the API deadline and its HTTP Date header, exposed to the configured dashboard origin. Monotonic elapsed time between polls avoids dependence on changes to the browser’s wall clock. HTTP Date precision is one second. If the header is unavailable, the display falls back to browser time. At zero the drawer rechecks availability and waits for the API to allow a new request. The timer never submits a command.

The drawer uses a native modal dialog, restores focus to the opener, supports Escape and contains keyboard focus. Opening, editing, dismissing and viewing activity never send commands. Each submission requires a reason, explicit confirmation and a bounded duration (0.001 s steps, at most 5 s and the server limit). An interrupted submission prompts the operator to check activity.

For browser tests, build the web app, install the Playwright Chromium browser, then run `npm run test:web` from `services/web`. Tests run an isolated production build with intercepted API responses. `PW_CHANNEL=chrome` uses installed Chrome locally. Set `UI_SCREENSHOT_DIR` to capture sample views. CI runs the suite in the web job.
