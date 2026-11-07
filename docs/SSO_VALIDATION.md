# v1.2 SSO + source readability — validation

Date: 6 November 2026.

## Implemented

- Microsoft/SSO browser sign-in controls for Stage and Production.
- Separate visible Chromium login session; user completes credentials/MFA manually.
- Exact navigation allowlist during login, with explicit extra identity-provider origins.
- Fresh-client access verification before accepting the session. Stage verification requires actual sitemap XML, not merely an HTTP 200 login page.
- Target-scoped cookie/local storage/IndexedDB state and same-origin sessionStorage restoration.
- In-memory session storage and local worker IPC; no session export endpoint or session files.
- Origin binding, Stage/Production isolation, disconnect, 10-minute login timeout and one-hour reuse window for new tasks.
- Access preflight and sign-in-again feedback on lost access; ordinary capture still blocks foreign navigation.
- Browser installer now installs full Chromium, because headless shell alone cannot display login windows.
- Prettier-formatted, unminified first-party source; separate readable report template; developer guide and formatting scripts.

## Observed checks

- `npm run test:unit`: **23 passed / 0 failed**.
- SSO tests cover cookie/origin scoping; verification and lifecycle transitions using an injected browser double; closed/failed login; expiry and disconnect; local cookie-authenticated sitemap access using Playwright's real API client; blocked external redirect; runtime capture-context injection; UI sign-in/verify/disconnect behavior using a controlled adapter; API error sanitization.
- Existing configuration, matching, image comparator, report, CLI and UI tests remain passing.
- `npm run format:check`: all matched source files pass.
- `npm test`: **29 tests: 23 passed / 6 failed at Chromium startup (SIGTRAP)**. Browser-dependent assertions did not execute. This includes the new redirect-login browser acceptance test. Failures remain in the log; no browser tests were silently skipped.
- Report demo regenerated from the readable template and checked by the existing jsdom interaction test. This demonstrates report DOM behavior, not physical browser rendering.

## Not tested / not guaranteed

The real Microsoft tenant, corporate MFA, Conditional Access/device compliance, the user's Stage/Production sites, visible Chromium login on the user's OS, and real screenshots/session reuse through the full browser pipeline were not available for successful validation here. Local mocked/browser-independent tests do not establish those integrations.

`tests/sso-browser.test.js` provides a real-Chromium acceptance test against a local redirect-login fixture. It is a test double, not a Microsoft OAuth implementation. It should pass on the developer's supported local machine before client acceptance. `npm test` runs it along with the other browser acceptance tests.

A verification failure can mean incomplete login, unavailable sitemap, network failure, a different child-sitemap host, or a policy that disallows reuse. The app does not disable TLS checks, bypass MFA, acquire tokens with a password grant or change DevOps settings. A cookie-based reusable session is required for sitemap API access.

## Session lifetime detail

The UI server discards connected state for new tasks after one hour, or on disconnect/shutdown. A task already started owns its session snapshot until it completes or is cancelled. Cancel a task before disconnecting. The browser itself uses a temporary profile while signing in; no persistent profile is created by the app, but this is not a claim about secure erasure of OS-managed temporary files.

## Evidence

- `sso-unit-test-output.txt`
- `sso-full-test-output.txt`
- `format-check-output.txt`

Previous release evidence is retained under its original filenames. The guides `SSO_SETUP.md` and `DEVELOPER_GUIDE.md` describe the current release.
