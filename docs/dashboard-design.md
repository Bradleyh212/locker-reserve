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

The Devices grid shows one read-only card per locker. Connection follows the API's online flag. A failed refresh makes connection unknown. Door and Lock show unknown for stale observations. Lock describes the reported driver output: inactive or energized. Only the management drawer contains the supervised test. A single three-second poll feeds the cards and open drawer, and the drawer shows the first three recent commands, expandable to all records returned by the API.

The drawer uses a native modal dialog, restores focus to the opener, supports Escape and contains keyboard focus. Opening, editing, dismissing and viewing activity never send commands. Each submission requires a reason, explicit confirmation and a bounded duration (0.001 s steps, at most 5 s and the server limit). An interrupted submission prompts the operator to check activity.

For browser tests, build the web app, install the Playwright Chromium browser, then run `npm run test:web` from `services/web`. Tests run an isolated production build with intercepted API responses. `PW_CHANNEL=chrome` uses installed Chrome locally. Set `UI_SCREENSHOT_DIR` to capture sample views. CI runs the suite in the web job.
