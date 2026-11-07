**New in v1.2:** Microsoft/SSO interactive sign-in and fully formatted source. Read `SSO_SETUP.md` for login instructions and `DEVELOPER_GUIDE.md` to modify the code.

# Visual UI Studio — start here (v1.2)

Your regular workflow is now a browser form. No YAML editing, `.env` editing or terminal command is needed for each comparison.

## First launch on Ubuntu / Linux

1. Extract the ZIP into a new folder. Keep the complete `drupal-ui-regression` folder together.
2. Use Node.js 22. If you previously installed it through nvm, the launcher selects it when available. Your existing installed Playwright browser cache is reused.
3. Right-click `Start-Linux.sh` → Properties → Permissions → allow executing as a program. Choose **Run as a Program** (or the equivalent file-manager action).
4. On first launch, dependencies install automatically if absent. A small local server starts and opens **http://127.0.0.1:4173** in your browser. Keep the launcher window open while working.
5. Optional: make `Install-Linux-Shortcut.sh` executable and run it once in the same way. Then launch **Visual UI Studio** from your Applications menu. Keep the extracted folder in place; reinstall the shortcut if you move it.

Linux file managers differ. If yours only opens shell files in an editor, the one-time terminal fallback is `bash Start-Linux.sh`. For the Applications shortcut, run `bash Install-Linux-Shortcut.sh` once. Subsequent launches use the application menu, with no typed commands.

Windows: double-click `Start-Windows.cmd`. macOS: allow execution and open `Start-Mac.command` (OS security permissions may require an initial Terminal launch). Those launchers are supplied but not tested on Windows/macOS here. Existing users can also use `npm start` once to open the UI.

## Use the screen

1. Enter your **Stage sitemap URL**. Stage origin is inferred automatically.
2. Enter your **Production website URL**. This is required because the tool cannot infer the correct Production domain from a Stage sitemap.
3. Choose **Public website**, **Username & password (Basic Auth)**, or **Microsoft / SSO — sign in with browser** for each environment. Enter actual credentials into the UI fields—not environment variable names. Passwords are held in memory and are not written to config/settings files. Do not share them in chat.
4. Choose desktop/mobile and the maximum number of pages (default 5, up to 1000).
5. Click **Fetch pages** to preview Stage → Production URL pairs, or **Compare websites** to fetch and compare directly.
6. Watch progress. Click **Open full report** when finished. The report opens in a new tab with screenshots, filters and differences. Earlier completed runs are available under Previous comparisons.

For your project, enter:

- Stage sitemap: `https://stage-bs-drinksmart.sites-beamsuntory.com/sitemap.xml`
- Production: `https://www.drinksmart.com`
- Stage access: Basic Auth (enter credentials locally).

These addresses are configuration examples supplied by you. This release has not tested that external site or resolved its unknown sitemap redirect.

## Try without a real website

Click **Try local sample**, then **Fetch pages** or **Compare websites**. The app starts five Drupal-like fixture routes itself. You do not need a separate fixture terminal. Sample pages include deliberate changes, so a regression result is expected. The sample button replaces form settings with fixture values and clears credential fields.

## Browser setup

If you have not installed Chromium, click **Install / repair browser**. Progress appears in Results & progress. This installs full Chromium for interactive sign-in and the headless shell for comparisons. Click **Cancel task** to stop a running installation or comparison. Installation requires network access; OS browser libraries may still require your system administrator or the existing Linux setup command in README. This is a local web application, not a compiled desktop installer bundled with Node/Chromium.

## Advanced options are also in the UI

- CDN origins: add exact asset origins, comma-separated or one per line.
- Different paths: `/stage-path => /production-path`, one per line.
- Ignore dynamic areas: CSS selectors, one per line.
- Allow HTTP: enabled for sample localhost sites; explicit opt-in for other HTTP targets.

An **Unsafe URL** error now shows expected and received origin/path in the UI. It may indicate a redirect or nested sitemap on another origin. The app does not silently follow those URLs or forward credentials to them. Correct the sitemap address in the form after verifying the intended destination.

## What is saved / what needs review

Non-secret settings are remembered in this browser. Usernames and passwords are excluded; enter them again after a page reload. Reports are saved under the project's `runs` folder. Reports can contain website content/screenshots; share them only with intended reviewers. No target Drupal source changes are made.

Microsoft/SSO browser sign-in is now available in the UI: see `SSO_SETUP.md`. Existing form-login and storage-state CLI adapters remain available. Production-only pages absent from Stage's sitemap are not discovered. Inconclusive means a capture did not complete, not that the page passed.

## Validation status

New local API, Basic Auth discovery, form submission, URL preview, report/history access, credential exclusion and UI DOM interaction tests run automatically. Browser screenshot/comparison acceptance remains blocked in this build environment by Chromium startup failure; the UI real-browser acceptance test is provided in `tests/ui-browser.test.js`. See `docs/UI_VALIDATION.md` for exact results. Your working local Chromium installation is required for visual comparisons.
