# Microsoft / SSO sign-in — v1.2

## Update your local copy

1. Stop the old app's launcher window with Ctrl+C. This avoids running the old server on port 4173.
2. Extract the updated ZIP into a new folder. Open `START_HERE.md` there.
3. Run `bash Start-Linux.sh` once, or use your file manager's Run as a Program action. If you use the Applications-menu shortcut, run `bash Install-Linux-Shortcut.sh` once from the new folder to update its location.
4. Reload the browser page. Its title now includes **v1.2 SSO**.

Dependencies install automatically if absent. Keep Node 22 for this release. Your existing browser cache can be reused.

## First-time sign-in browser setup

The earlier `--only-shell` installation supports headless comparisons but cannot open an interactive login window. In the UI, click **Install / repair browser** once. This version installs full Chromium and its headless shell. Keep the app running until installation completes. If system browser libraries are missing, the Linux setup instructions in README still apply.

## Your Stage site

Enter:

- Stage sitemap: `https://stage-bs-drinksmart.sites-beamsuntory.com/sitemap.xml`
- Production URL: `https://www.drinksmart.com`
- Stage access: **Microsoft / SSO — sign in with browser**
- Production access: **Public website**, unless Production also requires authentication.

Then:

1. Click **Sign in to Stage**. A separate Chromium window opens the protected sitemap and follows the Microsoft login flow.
2. Enter your Microsoft credentials directly in that window and complete MFA normally. The tool does not type, collect or bypass your Microsoft password/MFA.
3. Once the browser returns to the Stage website, return to the tool and click **Verify sign-in**. Keep the login window open until verification finishes.
4. The tool checks whether a fresh client can fetch a real XML sitemap using the session. On success the status is **connected**, and the sign-in window closes.
5. Click **Fetch pages** or **Compare websites**. Open the report when the run finishes.

Production has the same optional browser-sign-in controls. Its verification checks access to the Production origin; it does not require a Production sitemap.

## Session lifetime

- Session state is held in application memory, not saved in YAML, `.env`, a session JSON file, localStorage or a report.
- Only cookies applicable to the selected website and that website's storage are reused. Microsoft identity-provider storage is not exported into comparison sessions.
- Stage and Production sessions are keyed separately and must match the configured origin exactly.
- Click **Disconnect** to remove the session. Stop/restart the app and you must sign in again.
- An interactive login has a 10-minute timeout. A connected session is discarded for new tasks after one hour; the server may expire it sooner. An already-running task retains its snapshot until completion/cancellation. Each new task checks access again, and lost access prompts sign-in again.
- Comparison contexts remain read-only GET/HEAD and do not follow cross-origin navigation. Identity-provider navigation is allowed only in the explicit interactive sign-in window.
- Playwright uses a temporary browser profile while the login window is open. It is closed after verification/disconnect; the application does not persist or export that profile. This is not a secure-erasure guarantee for OS-managed temporary storage.

## If another login domain is blocked

Microsoft login origins are included. If your organization federates to a different identity provider, the UI displays the blocked **origin**, with no query tokens. Confirm that origin with your DevOps team and enter it under **Additional organization login origins**, then restart sign-in. This field applies to the interactive login only; it does not weaken the normal Stage/Production navigation boundary.

Do not add arbitrary domains or forward Basic Auth credentials to Microsoft. Basic Auth and Microsoft/SSO remain distinct access options.

## If verification fails

Verification deliberately checks more than “the browser landed on Stage.” It must successfully fetch the XML sitemap in a fresh client. Finish MFA, confirm you have access to the requested sitemap, and verify again.

Some Conditional Access rules require a managed device, enterprise browser profile, device-bound tokens or restrictions that prevent Playwright session reuse. This implementation does not bypass those policies or promise universal Microsoft SSO compatibility. Ask DevOps for an approved testing approach if your policy rejects the separate browser or session reuse. Bearer-token-only sitemap endpoints requiring application-generated Authorization headers are not supported by this cookie-based sitemap flow.

An **Unsafe URL** after sign-in can still mean that the sitemap index references a different host. Auth does not automatically rewrite cross-origin child sitemaps. An expired/missing session can also redirect to sign-in; the UI provides a sign-in-again error for failed preflight or detected auth redirects.

## Validation limits

Microsoft tenant access, real credentials and MFA were not available here. Local unit/API/DOM tests and cookie-authenticated sitemap checks passed. Real Chromium acceptance tests remain blocked by browser startup in the build environment. See `docs/SSO_VALIDATION.md`. The source is implemented, but the real client SSO integration still needs validation on your machine.
