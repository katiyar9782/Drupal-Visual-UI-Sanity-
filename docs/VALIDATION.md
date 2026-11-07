# Validation evidence — 5 November 2026

## Observed results

- Node.js v24.22.1 in the build environment; application requires Node 22+.
- Exact npm dependencies installed and package-lock generated.
- `npm run test:unit`: **13 passed / 0 failed**, no skipped tests.
- `npm test`: **13 passed / 4 failed**. All four failures occur when Playwright launches Chromium, before browser assertions execute.
- Chromium 141.0.7390.37 / Playwright 1.56.1 downloaded. Full Chromium and headless shell both terminated at startup with SIGTRAP. Missing `/proc` was observed; no claim is made that it is the sole cause. Initial default temp path was unavailable; a writable workspace temp directory was used for final attempts.
- Actual fixture runner: five discovered paths × desktop/mobile = ten page jobs. **Status inconclusive, exit code 3, zero confirmed findings, ten incomplete captures**. This is correct failure classification, not a clean comparison.
- Synthetic PNG comparison produces a nonzero pixel difference and embedded reference/candidate/diff images in `examples/report-demo.html`.
- jsdom executed report JavaScript and verified severity/search filters. It does not prove rendered browser image decoding or actual offline browser behavior.
- Detector DOM logic found six Paragraphs (including two nested cards), three semantic fallback elements, and excluded hidden/fake-prefix elements using a DOM fixture with synthetic geometry. This is not a measured real-browser detection rate.

## Tests that remain unverified

Real desktop/mobile screenshots and geometry; browser CSS/image rendering; form auth and storage-state browser flows; cookie isolation; navigation/method guards at runtime; asynchronous readiness/timeouts; lazy-loading completion; real-page discovery/detection; five-run zero-false-positive repeatability; controlled mutations through the full rendered pipeline; offline report image rendering and export downloads; hosted CI.

No Stage/Production client URLs or credentials were supplied. No real external website was tested or modified. No 90% detection-rate, zero-false-positive or production-readiness claim is made.

## Local sign-off steps

1. `npm ci` and `npx playwright install --with-deps chromium` on a supported workstation/CI host.
2. `npm test` must pass without skipping browser tests. Review full assertions in `tests/integration.test.js`.
3. Run clean fixtures and inspect screenshots/report, then run mutated fixtures and confirm intended mutation categories.
4. Verify sensitive-content masks and CDN allowlists on one authorized real page.
5. Run five real pages with controlled content and review matches, screenshots and inconclusive states before CI gating.

Raw evidence: `unit-test-output.txt`, `full-test-output.txt`, `fixture-run-summary.json`. The full log intentionally retains failures; it is not a successful acceptance report.
