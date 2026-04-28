# Implementation Plan: E2E Testing with Playwright

## Overview

Install Playwright, configure it for the Hazina frontend, create API mock helpers and fixtures, implement five spec files covering the major user flows, and wire up a new `test-e2e` CI job.

## Tasks

- [ ] 1. Install Playwright and configure the test runner
  - Install `@playwright/test` as a dev dependency in `frontend/`
  - Create `frontend/playwright.config.ts` with `testDir: './e2e'`, `baseURL: 'http://localhost:5173'`, Chromium-only project, and `webServer` config pointing to `npm run dev`
  - Add `"test:e2e": "playwright test"` and `"test:e2e:ui": "playwright test --ui"` scripts to `frontend/package.json`
  - Update `frontend/vitest.config.ts` coverage `exclude` list to also exclude `e2e/**` so Playwright spec files are not picked up by Vitest
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [ ] 2. Create fixture files and shared helpers
  - [ ] 2.1 Create fixture JSON files in `frontend/e2e/fixtures/`
    - `stats.json` — matches `Stats` interface (totalDatasets, totalQueries, totalUsdcEarned, totalTransactions)
    - `datasets.json` — matches `PaginatedDatasets` interface with at least one valid `DatasetMeta` entry
    - `queryInitiate.json` — matches `{ payment: { paymentAddress, amount, memo } }`
    - `queryResult.json` — matches `QueryResult` interface with `success: true`, `demo: true`, `ai.summary`, and `transaction`
    - `createDataset.json` — matches `{ success: true, dataset: DatasetMeta }`
    - _Requirements: 3.1, 3.5, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 2.2 Write property test: fixture data satisfies API runtime validation
    - **Property 2: Fixture data satisfies API runtime validation**
    - Import each fixture and run it through the corresponding validator from `src/lib/api.ts`; assert no `ApiValidationError` is thrown
    - _Requirements: 3.5_

  - [ ] 2.3 Create `frontend/e2e/helpers/mockApi.ts`
    - Implement `setupApiMocks(page: Page)` that registers `page.route()` handlers for all five fixture endpoints
    - Use glob patterns (`**/api/...`) so routes match regardless of `VITE_API_URL`
    - _Requirements: 2.1, 2.7, 2.8, 3.2, 3.4_

  - [ ] 2.4 Create `frontend/e2e/helpers/navigation.ts`
    - Implement `navigateTo(page, path)` that calls `page.goto(path)` then `page.waitForLoadState('networkidle')`
    - _Requirements: 3.3_

- [ ] 3. Implement landing page spec
  - [ ] 3.1 Create `frontend/e2e/specs/landing.spec.ts`
    - `beforeEach`: call `setupApiMocks(page)`
    - Test: h1 is visible on load
    - Test: hero CTA links to `/sell` and `/marketplace` are present
    - Test: at least one stat card is visible after mocked stats load
    - Test: at least one dataset card is visible in the featured section
    - Test: clicking "Browse Marketplace" CTA navigates to `/marketplace`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 4. Implement marketplace spec
  - [ ] 4.1 Create `frontend/e2e/specs/marketplace.spec.ts`
    - `beforeEach`: call `setupApiMocks(page)` and navigate to `/marketplace`
    - Test: search input, sort select, and dataset cards are visible on load
    - Test: empty state is shown when API returns empty `data` array
    - _Requirements: 5.1, 5.5_

  - [ ]* 4.2 Write property test: search input sends search query parameter
    - **Property 3: Search input sends search query parameter**
    - Use `test.each` over a set of search strings; for each, type into the search input and assert the intercepted request URL contains `search=<value>`
    - _Requirements: 5.2_

  - [ ]* 4.3 Write property test: type filter pill sends type query parameter
    - **Property 4: Type filter pill sends type query parameter**
    - Use `test.each` over all type filter values; for each, click the pill and assert the intercepted request URL contains `type=<value>` and the pill has the active class
    - _Requirements: 5.3_

  - [ ]* 4.4 Write property test: sort select sends sort query parameter
    - **Property 5: Sort select sends sort query parameter**
    - Use `test.each` over all sort option values; for each, select the option and assert the intercepted request URL contains `sort=<value>`
    - _Requirements: 5.4_

  - [ ]* 4.5 Write property test: clear search restores no-search state
    - **Property 6: Clear search restores no-search state**
    - Type a search string, then click the X button; assert the input is empty and the next request URL has no `search` param
    - _Requirements: 5.6_

- [ ] 5. Checkpoint — Ensure all tests pass
  - Run `npm run test:e2e` locally; ensure landing and marketplace specs pass. Ask the user if questions arise.

- [ ] 6. Implement dataset query demo flow spec
  - [ ] 6.1 Create `frontend/e2e/specs/queryFlow.spec.ts`
    - `beforeEach`: call `setupApiMocks(page)` and navigate to `/marketplace`
    - Test: clicking "Query" on a dataset card opens the QueryModal with the dataset name visible
    - Test: "Proceed to Payment" button is visible on the details step
    - Test: demo mode checkbox is checked by default on the payment step
    - Test: clicking "Get AI Analysis" shows the verifying step
    - Test: after demo query resolves, result step shows AI summary text
    - Test: "Done" button on result step closes the modal
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 6.2 Write property test: Escape key closes modal from any non-terminal step
    - **Property 7: Escape key closes QueryModal from any non-terminal step**
    - Use `test.each` over `['details', 'payment']` steps; for each, open the modal, advance to that step, press Escape, and assert the modal is no longer visible
    - _Requirements: 6.7_

- [ ] 7. Implement theme toggle spec
  - [ ] 7.1 Create `frontend/e2e/specs/themeToggle.spec.ts`
    - `beforeEach`: call `setupApiMocks(page)` and navigate to `/`
    - Test: `<html>` has `dark` class by default when no localStorage preference is set
    - Test: clicking ThemeToggle removes the `dark` class
    - _Requirements: 7.1, 7.2_

  - [ ]* 7.2 Write property test: theme toggle is a round trip
    - **Property 8: Theme toggle is a round trip**
    - For both initial states (dark and light, set via `localStorage` before navigation), click ThemeToggle twice and assert `<html>` class returns to its original state
    - _Requirements: 7.3_

  - [ ]* 7.3 Write property test: theme toggle persists to localStorage
    - **Property 9: Theme toggle persists to localStorage**
    - After each toggle, evaluate `localStorage.getItem('hazina-theme')` and assert it equals `'dark'` iff `<html>` has the `dark` class
    - _Requirements: 7.4_

  - [ ]* 7.4 Write property test: theme persists across page reload
    - **Property 10: Theme persists across page reload**
    - Set `localStorage['hazina-theme']` to `'light'` before navigation; reload the page; assert `<html>` does not have the `dark` class. Repeat for `'dark'`.
    - _Requirements: 7.5_

- [ ] 8. Implement sell form validation spec
  - [ ] 8.1 Create `frontend/e2e/specs/sellForm.spec.ts`
    - `beforeEach`: call `setupApiMocks(page)` and navigate to `/sell`
    - Test: submit button is disabled when all fields are empty
    - Test: filling all required fields with valid data enables the submit button
    - Test: submitting the form with valid data and mocked API success shows the success screen
    - _Requirements: 8.1, 8.4, 8.5_

  - [ ]* 8.2 Write property test: invalid Stellar wallet address shows validation error
    - **Property 11: Invalid Stellar wallet address shows validation error**
    - Use `test.each` over a set of invalid addresses (empty, too short, wrong prefix, lowercase); for each, enter it into the wallet field and assert the error message is visible
    - _Requirements: 8.2_

  - [ ]* 8.3 Write property test: invalid JSON shows JSON error
    - **Property 12: Invalid JSON in data textarea shows JSON error**
    - Use `test.each` over a set of invalid JSON strings (`{`, `undefined`, `[1,2,`); for each, enter it into the data textarea and assert the JSON error message is visible
    - _Requirements: 8.3_

  - [ ]* 8.4 Write property test: price preset button updates price input
    - **Property 13: Price preset button updates price input**
    - Use `test.each` over all six price preset values (0.01, 0.02, 0.05, 0.1, 0.25, 0.5); for each, click the preset button and assert the price input value equals the preset
    - _Requirements: 8.6_

- [ ] 9. Add test-e2e CI job
  - Add a `test-e2e` job to `.github/workflows/test-coverage.yml` after the existing jobs
  - Job runs on `ubuntu-latest` with `working-directory: frontend`
  - Steps: checkout → setup Node 20 → `npm install` → `npx playwright install --with-deps chromium` → `npm run test:e2e`
  - Add `actions/upload-artifact@v4` step with `if: failure()` to upload `frontend/playwright-report/` as `playwright-report`
  - Do not modify the existing `test-frontend` job
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

- [ ] 10. Final checkpoint — Ensure all tests pass
  - Run `npm run test:e2e` and confirm all five spec files pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The valid Stellar address used in tests is `GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE` (56 chars, passes `/^G[A-Z2-7]{55}$/`)
- Playwright's `page.route()` handlers are cleared automatically between tests; `setupApiMocks` must be called in `beforeEach`
- The `testDir: './e2e'` config ensures Vitest and Playwright do not discover each other's test files
- Property tests use `test.each` for parameterization; no additional PBT library is required for most properties
