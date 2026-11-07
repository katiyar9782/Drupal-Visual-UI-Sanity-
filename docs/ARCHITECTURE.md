# Implementation and milestone record

The implementation is a modular ESM monolith. Files are local; the target is read-only except the explicitly configured authentication form. It does not patch Drupal source, templates, modules, assets or database records.

| Milestone | Implementation | Verification obtained |
|---|---|---|
| M0 | package/lockfile, CLI, Ajv schema, YAML config, fixtures | install, help, validation pass |
| M1 | bounded XML discovery, same-origin redirects, mappings, filters | local HTTP tests pass, including basic auth |
| M2 | isolated sessions, auth adapters, stabilization, captures/retries | implemented; Chromium startup blocks browser gate |
| M3 | exact Paragraph class discovery, nesting, visibility, fallback | DOM logic pass with synthetic geometry; browser gate blocked |
| M4 | conservative hierarchy matching, ambiguity, add/remove | curated matcher tests pass |
| M5 | pixel/geometry/CSS/text/assets channels, image evidence | synthetic PNG and snapshot unit tests pass; rendered mutation gate blocked |
| M6 | standalone HTML filters/viewer/export + JSON schema | jsdom interaction/security checks pass; offline Chromium image rendering blocked |
| M7 | bounded concurrency/retries, exit codes, CI example, docs | unit status tests and actual inconclusive CLI path pass; five-repeat gate blocked |

Work followed the milestone implementation order, but M2's environment-blocked gate could not be signed off before later modules were implemented. This is an explicit incomplete acceptance gate, not an implied pass.

## Contracts

ComponentSnapshot: `id`, `pageId`, `env`, `viewport`, `type`, `selectorHint`, `parentId`, `siblingIndex`, `heading`, `textSignature`, `bbox`, `relative`, `styles`, `assetRefs`, `visibility`, `captureWarnings`, `screenshotPath`.

ComponentMatch: `id`, optional `referenceId` / `candidateId`, `status` (`matched`, `added`, `removed`, `ambiguous`), `confidence`, `reasons`.

Finding: `id`, `componentMatchId`, `pageId`, `page`, `device`, `component`, `category`, `severity`, `confidence`, `expected`, `actual`, optional `details`, `explanation`, `evidenceId`. The report's evidence map stores inline image data; snapshots also point to relative PNG files. Capture failures may exist only in page status, avoiding invented component-level evidence.

## Extension interfaces

- Detector: replace `detect` with an adapter returning the same snapshots. Add custom selectors in config for most theme variations.
- Matcher: replace `matchComponents`; do not force uncertain matches. Future providers must return contract-valid confidence/status.
- Comparator registry: call `registerComparator` before running; callback signature `(reference, candidate, comparisonPolicy) -> finding | null`, sync or async. It must not mutate source pages.
- Device registry: the config `devices` mapping already supports named profiles.
- Report/storage: `reportHtml` is separate from capture and matching; future storage can persist the versioned result object without changing report logic.
- Capability flags: result declares Paragraph detection, fallback, and disabled AI/interactions. No hidden external AI service calls.

## Deliberate MVP choices

Serial sitemap traversal; bounded page capture workers. Fresh context per page/environment maximizes auth isolation at the expense of repeated login cost. No navigation to external document origins. Same-origin assets default allowed; explicit asset origins permit CDN resources. No production-only inventory, screenshot history, side-effectful interaction tests, arbitrary extension configuration, AI analysis, full accessibility audit or automatic fixes.
