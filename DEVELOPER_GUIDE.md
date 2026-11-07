# Developer guide — readable source, no minification

All first-party JavaScript, HTML and CSS is supplied as formatted source. There is no bundler or minification step. Files under `ui/` are served directly. Dependencies are installed from npm; their internal distributions are outside this project's source-formatting policy.

## Setup and commands

```bash
npm ci
npm start
npm run test:unit
npm run format:check
npm run format
```

For browser acceptance on a supported machine:

```bash
npx playwright install chromium
npm test
```

Node 22 is the recommended runtime for this release. `package-lock.json` pins dependency versions. Prettier is pinned as a development dependency. `format:check` covers source, UI, tests, fixtures, scripts, configuration, schemas and top-level guides. Shell launchers use regular readable shell/batch code and are not processed by Prettier.

## Where to make changes

| Area                 | Files                                          | Purpose                                                          |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Form layout          | `ui/index.html`                                | Inputs, environment settings and SSO controls                    |
| UI appearance        | `ui/style.css`                                 | Responsive layout, components and states                         |
| UI behavior          | `ui/app.js`                                    | Form handling, API requests, task progress, auth status          |
| Local API            | `src/ui-server.js`                             | Localhost server, token/origin checks, task isolation and routes |
| Browser sign-in      | `src/browser-auth.js`                          | Login browser lifecycle, origin policy, verification and expiry  |
| Runtime auth data    | `src/session-state.js`                         | In-memory worker session storage; never serialize to reports     |
| Worker               | `src/ui-worker.js`                             | Session preflight and execution in a separate process            |
| Config               | `src/config.js`                                | Defaults and validation; browserSession is runtime-only          |
| Sitemap              | `src/sitemap.js`                               | Bounded discovery and URL mapping                                |
| Capture              | `src/capture.js`                               | Isolated contexts, session restoration, readiness, screenshots   |
| Detection/matching   | `src/detect.js`, `src/match.js`                | Paragraph extraction and conservative pairing                    |
| Comparators          | `src/compare.js`                               | Pixel/geometry/styles/content/assets and extension registry      |
| Run orchestration    | `src/runner.js`                                | Scheduling, progress, outcomes and artifacts                     |
| Report rendering     | `src/report.js`                                | Safe JSON injection into the offline template                    |
| Report layout/script | `src/report-template.html`                     | Readable standalone HTML, inline CSS and client JS               |
| Fixtures             | `fixtures/server.js`, `fixtures/sso-server.js` | Drupal-like pages and local redirect-login test double           |
| Tests                | `tests/*.test.js`                              | Unit, HTTP, DOM and browser acceptance checks                    |

## SSO data flow

UI sign-in request → BrowserAuth opens a visible isolated browser → user signs in and completes MFA → UI Verify sign-in → fresh API client checks protected sitemap → target-scoped state retained in memory → state sent over local process IPC to the worker → preflight verifies access → capture contexts receive that state → results omit session material.

The browserSession auth type does not contain cookies or tokens in config. `session-state.js` supplies them only at runtime. CLI-only use of browserSession without a UI session is unsupported; the existing storageState CLI adapter remains separate.

## Extension rules

- Add auth providers through the sign-in adapter without embedding user passwords in config or handling MFA automatically.
- Preserve origin binding, fresh-client verification and expiry/disconnect semantics.
- Do not add Microsoft domains to the normal capture navigation allowlist. Interactive login and read-only capture have different policies.
- Keep session material out of API status, task history, errors, reports and application logs. Returning the full BrowserAuth entry from an API would expose secrets.
- Extend screenshot audits with `registerComparator`; keep report schema compatibility.
- Render website-derived text with textContent. Preserve JSON `<` escaping in `reportHtml`; it prevents script-tag breakout.
- The report template uses a JSON-string placeholder named `__REPORT_DATA__`. Replace through a callback so `$` sequences in page text stay literal.

## Tests and what they prove

`browser-auth.test.js` checks state transitions with a fake browser, exact origin rules, state scoping, expiry, disconnect, fresh-client cookie verification on HTTP fixtures, and capture-context injection. `sso-ui.test.js` checks real local API/UI controls with an injected auth adapter. These do not prove Microsoft OAuth/MFA compatibility.

`sso-browser.test.js` uses a local redirect-login test double and real Chromium to exercise session reuse through discovery and capture. It deliberately uses a fixed fixture token; it is not a production identity provider or OAuth implementation. `ui-browser.test.js` tests the ordinary UI workflow. These tests fail rather than silently skip when Chromium is unavailable.

See `docs/SSO_VALIDATION.md` for the results obtained in this environment and remaining acceptance gates.
