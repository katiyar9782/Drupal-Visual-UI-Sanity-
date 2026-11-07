# UI release 1.1 — validation and limits

Date: 5 November 2026.

## Delivered

Local browser UI + localhost API, isolated worker processes, form-to-config validation, public/Basic Auth access, sitemap URL-pair preview, desktop/mobile controls, page limit, CDN/path/mask options, comparison progress, cancel task, report links/history, sample fixtures started from the UI, browser installation action, and platform launchers. The prior CLI remains available. Sitemap failures now identify expected and received origin/path without URL credentials or query values.

## Executed checks

- `npm run test:unit`: **16 passed, 0 failed**.
- Local HTTP tests exercise real fixture discovery, Basic Auth, five page pairs, blocked foreign sitemap redirect, API token/origin checks, child-process result delivery, cancellation, and persisted report/history serving.
- The missing-browser path was deliberately exercised through the API; it writes and displays an inconclusive result, never a clean pass.
- UI JavaScript runs in jsdom with the real local server. Tests click Try local sample and Fetch pages, assert five rendered table rows, capture JavaScript errors, and check credentials are excluded from saved settings.
- Non-browser comparator/config/matcher/report/CLI tests remain passing.
- `npm test`: **21 tests: 16 passed, 5 failed at Chromium launch**. This includes the new real-browser UI acceptance test, plus the four original browser-dependent tests. No skipped tests are disguised as passes.
- Linux/macOS shell launchers pass `bash -n` syntax checks; package-lock refreshed. The desktop shortcut and automatic browser-opening integration were not tested on a graphical desktop here. Windows/macOS launcher execution remains untested.

## Not established by these tests

Actual rendered UI layout/screenshots, successful browser comparisons via UI, screenshot repeatability, actual browser installation from the UI, all platform launchers, and the user's external Stage/Production website. Chromium still terminates at startup in this restricted build environment. jsdom proves DOM behavior, not browser rendering. Existing user-side working Chromium can be reused.

Run `npm test` on a supported local machine for browser acceptance. `tests/ui-browser.test.js` opens the real UI, starts sample fixtures, fetches URLs, compares a page and opens the report. This test is supplied but did not pass here because Chromium could not start.

## Scope and remaining limits

The app still requires Node and a local server; the launcher starts that server. It is not a standalone compiled desktop application or hosted service. First setup may require executable permissions, Node installation or OS browser dependencies. Daily comparisons need only the UI after launch. Stage origin is inferred from the sitemap; Production URL is required. The maximum page limit is explicit (default 5). The UI supports Basic Auth and public access; form-login/SSO/storage-state workflows remain CLI-only. Reports may contain sensitive page content; credentials are excluded from saved form settings and held only in memory for task execution. Existing screenshots/content masking limitations remain in README.

Evidence: `ui-unit-test-output.txt`, `ui-full-test-output.txt`. Original v1 test logs remain for historical context.
