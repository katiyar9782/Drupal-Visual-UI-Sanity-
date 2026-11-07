# Visual UI Studio v1.2 — browser sign-in and readable source

Use [SSO_SETUP.md](SSO_SETUP.md) for Microsoft login/MFA and session reuse. All first-party source is formatted and unminified; see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md). Current test evidence is in `docs/SSO_VALIDATION.md`. Previous release notes below are retained for context.

# Visual UI Studio v1.1 — browser interface added

**Start with [START_HERE.md](START_HERE.md).** Use `Start-Linux.sh`, `Start-Windows.cmd`, `Start-Mac.command`, or `npm start` to open the UI. Enter sitemap/Production URLs and credentials in the form; fetch pages, compare, and open reports without editing YAML. CLI instructions below remain available for advanced use. The original validation record below is retained; current UI results are in `docs/UI_VALIDATION.md`.

# Drupal Visual UI Regression MVP

A local, read-only Node.js CLI for comparing Stage with Production. Production is the reference. No Drupal module, Twig, theme, source, configuration or deployed asset changes are required. Tool-side browser normalization affects only disposable browser sessions.

**Validation status:** implementation delivered; browser acceptance gates are not yet passed. In this build environment, **13 non-browser tests passed; 4 browser-dependent tests failed at Chromium startup (SIGTRAP)**. The included actual fixture run discovered five pages / ten device jobs and correctly returned `inconclusive` (exit 3). The report demo uses explicitly labelled synthetic images. Do not interpret either as a successful website regression run. See `docs/VALIDATION.md` and the retained test logs.

## 1. Install

Use Node.js 22+ and npm on a developer workstation. All direct dependencies and the lockfile are pinned. The package uses Playwright 1.56.1 / Chromium build 1194 (141.0.7390.37); use the same OS/fonts/browser for repeat comparisons. This is a reproducibility pin, not a claim that it is the newest browser.

```bash
npm ci
npx playwright install chromium
# Linux CI or missing browser libraries:
npx playwright install --with-deps chromium
npm run validate
npm run test:unit
```

The repository ZIP excludes `node_modules` and downloaded browsers. Installation requires network access to npm and Playwright downloads. Browser installation may need your IT team's proxy configuration and OS package permissions. `PLAYWRIGHT_BROWSERS_PATH` can point to a writable browser cache. `PLAYWRIGHT_EXECUTABLE_PATH` is an optional diagnostic override; it changes reproducibility and should not be used for acceptance baselines without recording the browser version.

## 2. Run local fixtures first

Terminal A:

```bash
npm run fixtures
```

This binds **only localhost**: Stage at `http://127.0.0.1:4171`, Production at `http://127.0.0.1:4172`. Fixtures have five routes, nested/repeated Paragraphs, semantic fallback, a hidden component, lazy images, a sitemap index, basic auth and a local form-login test endpoint. All credentials used by automated fixture tests are synthetic.

Terminal B:

```bash
npm run discover -- --config configs/fixtures.yaml
npm run test:visual -- --config configs/fixtures.yaml --limit 5
npm run report:open -- --run latest --config configs/fixtures.yaml
```

`report:open` prints an absolute report path; open that file in your browser. It deliberately does not launch an OS-specific shell command. The HTML is standalone: inline CSS/JS and base64 images, no server/CDN/network needed. Use search, severity/device/category filters, expandable evidence, and JSON export.

Expected on a working browser: mutations return exit **1** and findings on `/home` (padding/font), `/about` (broken image), `/services` (inserted section), `/news` (image fit), `/contact` (removed section). A high-severity difference means policy violation, not necessarily an unintended product defect.

For an unchanged fixture comparison, stop Terminal A, then:

```bash
npm run fixtures -- --clean
npm run test:visual -- --config configs/fixtures.yaml
```

For single-page comparison:

```bash
npm run test:visual -- --config configs/single.yaml
```

## 3. Run all acceptance tests

Stop manually started fixtures if you want ports free; automated tests use random local ports.

```bash
npm test
# Browser integration only (5 repeat clean runs + mutated five-page run):
npm run test:integration
```

The complete suite does not silently skip unavailable Chromium. A browser failure fails the tests. Integration assertions require five unchanged runs to produce zero findings, correct injected mutation categories, rendered offline report images and filters, auth isolation, storage-state login, and read-only routing. Five-repeat checks use **two pages × two devices**; the mutation run uses all five pages × two devices. These browser assertions are provided but have not passed in the build environment.

## 4. Configure a real Drupal site

Copy `configs/client.yaml`, replace both origins and the Stage sitemap URL, and add exact CDN origins under each environment's `assetOrigins`. By default, external assets are blocked; missing CDN configuration can cause broken-asset differences. Browser document navigation stays on that environment's exact origin. HTTPS is required unless `allowHttp: true` is explicitly set for local development.

Start with one known page and a small limit. Verify real markup uses exact `paragraph--type--BUNDLE` classes; custom themes that remove them need tool-side `customSelectors`. Discovery never modifies target source.

```bash
cp .env.example .env
# Edit .env locally; do not commit it.
node --env-file=.env src/cli.js validate --config configs/client.yaml
node --env-file=.env src/cli.js discover --config configs/client.yaml
node --env-file=.env src/cli.js run --config configs/client.yaml --limit 1
```

Configuration paths, storage-state paths and outputDir resolve from your current working directory; run commands at repository root. Do not put credentials in config URL strings or sitemap query parameters. Discovery log output omits query strings; internal URL mapping retains them. Reports also omit URL queries and credentials. Review screenshot privacy before sharing reports: arbitrary personal content is not automatically classified/redacted. Configure `capture.redactSelectors` for sensitive blocks and `capture.masks` for dynamic widgets. Inputs/textareas are hidden during capture, and known secret environment values are redacted from serialized output; **text redaction is not image OCR**.

### Authentication

Each page/environment/device gets an independent browser context. Cookies are not shared between Stage and Production or retries.

```yaml
# No authentication
auth: {type: none}
# Basic authentication (also applies to sitemap reads)
auth: {type: httpBasic, usernameEnv: STAGE_USER, passwordEnv: STAGE_PASS}
# Existing Playwright storage state, file path held in environment variable
auth: {type: storageState, pathEnv: STAGE_STORAGE_STATE}
# Explicit opt-in local form login; use actual selectors from your login page
auth:
  type: form
  loginPath: /user/login
  usernameSelector: '#edit-name'
  passwordSelector: '#edit-pass'
  submitSelector: '#edit-submit'
  successSelector: '.authenticated-marker'
  usernameEnv: STAGE_USER
  passwordEnv: STAGE_PASS
```

Form auth submits the configured login form only; POST is allowed on the environment origin during the login phase. All subsequent browser requests allow GET/HEAD only. No interaction crawling, destructive buttons or content submission are performed. MFA/SSO flows are not automated; use locally prepared storage state if your access policy allows it. State files contain credentials and belong in ignored `.auth/`. Do not share them with reports. Authenticated sitemap reads reuse the Stage context's API request client, with redirect validation.

### Config controls

- `schemaVersion: 1`: required, validated using Ajv; unknown top-level options fail.
- `mode: sitemap` + `sitemapUrl`, or `mode: single` + `paths`.
- `mapping.overrides`: exact Stage path+query to Production path+query; cross-origin results rejected.
- `mapping.include` / `exclude`: regular expressions on Stage path+query. Exclusions take precedence.
- `mapping.trailingSlash`: `preserve`, `remove`, `add`; applies to Production mapping. Unexpected final path/query redirects are inconclusive; configure canonical paths explicitly.
- `devices`: named viewport profiles with width, height, dpr, optional isMobile. Defaults: desktop 1440×900, mobile 390×844, DPR 1. Mobile is viewport/touch emulation, not a physical device or mobile UA preset.
- `limits`: bounded maxPages, concurrency (1–4), sitemapDepth, maxSitemaps, timeoutMs, retries, maxComponents and maxScrollSteps.
- `capture.readySelector`: application readiness marker; timeout becomes inconclusive.
- `capture.masks`: hide dynamic blocks in the browser copy. `redactSelectors`: also replace text in selected browser DOM blocks. Choose selectors on both environments.
- `capture.settleMs`: geometry sampling interval; default 100 ms. Waits for fonts/image completion and performs bounded lazy-load scrolling. It cannot prove indefinite visual stability.
- `comparison`: geometry tolerance, Pixelmatch pixel threshold, maximum changed-pixel ratio, CSS property whitelist.
- `outputDir`: default `runs`. Every run has a unique timestamp/ID and `latest.txt` pointer.

Full shape: `schemas/config-v1.schema.json`. Examples: `configs/`.

## 5. Evidence and policies

Each run writes `results.json`, `report.html`, and `images/*.png`. JSON includes snapshots (hierarchy, selector, type, heading, normalized visible text, geometry, selected CSS and assets), matches, confidence, findings and run/browser metadata. Report JSON schema is versioned separately.

Matching prioritizes same hierarchy/type and unique heading, then a unique type under the matched parent. Reordering or a middle insertion does not blindly shift pairs. Repeated indistinguishable types remain ambiguous; unresolved descendants are review-only. No AI matching is enabled.

Comparators are independent: pixel, geometry, CSS, text and asset channels. Images are padded to a common canvas **without scaling**, preserving dimensions. Pixelmatch highlights changed pixels in pink. Geometry compares width/height and parent-relative offsets; absolute document Y is intentionally not a standalone failure signal. Nested changes can generate both child and container findings. Asset URLs normalize origin and query; this avoids signed-URL noise but may miss query-only asset changes unless pixels change.

Exit codes:

| Code | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| 0    | Clean or review-only result; inspect status/findings for medium/low/ambiguous differences |
| 1    | Confirmed high/critical findings with confidence ≥ 0.85                                   |
| 2    | Configuration, sitemap, authentication/discovery or other fatal CLI error                 |
| 3    | Inconclusive browser/capture/comparison; takes precedence over code 1                     |

A run with any incomplete page is never labelled clean. Missing pages/HTTP failures are inconclusive, not confirmed missing Paragraphs. Only paths discovered from Stage are compared; Production-only pages absent from Stage sitemap are not discovered in this MVP.

## 6. Extension points

`src/config.js` → `sitemap.js` → `capture.js` → `detect.js` → `match.js` → `compare.js` → `report.js`; `runner.js` orchestrates these modules. No database or service backend is needed.

`detect(page, config, metadata)` returns ComponentSnapshots. `matchComponents(reference, candidate)` returns ComponentMatches. `registerComparator(name, fn)` adds an independent audit channel returning a finding or null. `reportHtml(result)` consumes the same versioned report contract. See `docs/ARCHITECTURE.md`. Future action recipes, AI matching, history storage and additional device profiles can use these boundaries; they are not implemented capabilities.

## 7. Troubleshooting and limits

- Browser unavailable/SIGTRAP: check OS support, system libraries, writable temp/cache directories and process support. Reinstall pinned Chromium. This build environment lacked `/proc` and Chromium terminated at startup; no browser acceptance claims were made.
- Inconclusive scrolling: increase maxScrollSteps or mask unbounded feeds. Infinite pages are not fully crawled.
- Login redirect/inconclusive: supply explicit auth and canonical routes. Same-origin path changes are intentionally not silently accepted.
- Too many findings: align content/locales/fonts/experiments, mask known dynamic content, then tune thresholds. Do not suppress genuine layout differences merely to obtain green runs.
- Forms/cookies/CSP/shadow DOM/cross-origin iframes/canvas/carousels: project-specific handling may be required. Shadow DOM and iframe Paragraph discovery are not implemented; fixed carousel slide recipes are not implemented.
- Screenshots can contain client information; review selectors, storage access and retention. Runs are local files and have no automatic retention policy.
- CI example: `.github/workflows/visual.yml`. Hosted CI and real client URLs/credentials were not available for validation.

## Included outputs

`examples/report-demo.html`: interactive simulated report, real pixel comparison of synthetic PNGs. Regenerate with `npm run demo:report`.

`examples/fixture-run/`: actual five-page fixture discovery/report attempt, marked inconclusive due to browser startup failure. `docs/` holds validation status and raw test evidence.
