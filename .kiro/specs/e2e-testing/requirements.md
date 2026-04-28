# Requirements Document

## Introduction

This feature adds Playwright-based end-to-end (E2E) testing to the Hazina Data Escrow frontend. The E2E suite covers the five major user flows (landing page, marketplace search/filter, dataset query demo, theme toggle, and sell form validation) using mocked API responses via `page.route()`. The suite runs in CI as a separate job so it does not interfere with the existing Vitest coverage job.

## Glossary

- **E2E_Suite**: The Playwright test suite installed in `frontend/` that exercises the application through a real browser.
- **API_Mock**: A Playwright `page.route()` handler that intercepts `/api/*` requests and returns fixture JSON, replacing the real Express backend.
- **Fixture**: A static JSON file stored under `frontend/e2e/fixtures/` that represents a canned API response.
- **Spec_File**: A single Playwright test file (`.spec.ts`) covering one major user flow.
- **Config**: The `playwright.config.ts` file at `frontend/playwright.config.ts` that configures browsers, base URL, and timeouts.
- **CI_Job**: The `test-e2e` GitHub Actions job added to `.github/workflows/test-coverage.yml`.
- **Demo_Mode**: The query flow path where the "Use demo mode" checkbox is checked, bypassing real Stellar payment verification.
- **Theme_Toggle**: The `ThemeToggle` button component that adds/removes the `dark` class on `<html>` and persists the choice in `localStorage`.

## Requirements

### Requirement 1: Playwright Installation and Configuration

**User Story:** As a developer, I want Playwright configured in the frontend project, so that I can run browser-based E2E tests with a single command.

#### Acceptance Criteria

1. THE E2E_Suite SHALL be configured via `frontend/playwright.config.ts` using the `@playwright/test` package.
2. THE Config SHALL target Chromium only for the initial setup, with `use.headless` set to `true`.
3. THE Config SHALL set `baseURL` to `http://localhost:5173` to match the Vite dev server port.
4. THE Config SHALL set a `webServer` entry that runs `npm run dev` in `frontend/` and waits for `http://localhost:5173` to be ready before tests start.
5. THE Config SHALL set `testDir` to `./e2e` so Playwright discovers only E2E specs and does not pick up Vitest unit tests.
6. WHEN the `webServer` process is already running, THE Config SHALL reuse the existing server rather than starting a new one (`reuseExistingServer: true`).
7. THE E2E_Suite SHALL add a `test:e2e` script to `frontend/package.json` that runs `playwright test`.
8. THE E2E_Suite SHALL add a `test:e2e:ui` script to `frontend/package.json` that runs `playwright test --ui` for local debugging.

---

### Requirement 2: API Mocking Strategy

**User Story:** As a developer, I want all `/api/*` requests intercepted by Playwright fixtures, so that E2E tests run without a real backend and produce deterministic results.

#### Acceptance Criteria

1. THE API_Mock SHALL intercept all requests matching `/api/**` using `page.route()` before any test navigates to a page.
2. WHEN a test navigates to a page that triggers `GET /api/datasets/stats`, THE API_Mock SHALL respond with a fixture containing `totalDatasets`, `totalQueries`, `totalUsdcEarned`, and `totalTransactions` as finite numbers.
3. WHEN a test navigates to a page that triggers `GET /api/datasets`, THE API_Mock SHALL respond with a fixture containing a `data` array of `DatasetMeta` objects, a `total` count, a `page` number, and a `totalPages` count.
4. WHEN a test triggers `POST /api/query/:id`, THE API_Mock SHALL respond with a fixture containing a `payment` object with `paymentAddress`, `amount`, and `memo` fields.
5. WHEN a test triggers `POST /api/verify/:id/demo`, THE API_Mock SHALL respond with a fixture containing a `QueryResult` object including `success: true`, `data`, `ai.summary`, and a `transaction` object.
6. WHEN a test triggers `POST /api/datasets`, THE API_Mock SHALL respond with a fixture containing `success: true` and a `dataset` object.
7. THE API_Mock helpers SHALL be defined in a shared `frontend/e2e/helpers/mockApi.ts` file and re-used across all Spec_Files.
8. IF a route is not explicitly mocked, THE API_Mock SHALL allow the request to pass through so unexpected calls do not silently succeed with wrong data.

---

### Requirement 3: Test Fixtures and Helpers

**User Story:** As a developer, I want shared fixtures and helper utilities, so that test setup is consistent and not duplicated across spec files.

#### Acceptance Criteria

1. THE E2E_Suite SHALL store canned API response JSON in `frontend/e2e/fixtures/` with one file per API endpoint group (e.g., `datasets.json`, `stats.json`, `queryResult.json`).
2. THE E2E_Suite SHALL provide a `setupApiMocks(page)` helper in `frontend/e2e/helpers/mockApi.ts` that registers all standard route handlers in a single call.
3. THE E2E_Suite SHALL provide a `navigateTo(page, path)` helper in `frontend/e2e/helpers/navigation.ts` that calls `page.goto(path)` and waits for the network to be idle.
4. WHEN `setupApiMocks` is called, THE API_Mock SHALL register handlers for all endpoints listed in Requirement 2 acceptance criteria 2–6.
5. THE Fixture files SHALL contain data that satisfies the runtime validation performed by `src/lib/api.ts` (all required fields present with correct types).

---

### Requirement 4: Landing Page Test Suite

**User Story:** As a developer, I want automated tests for the landing page, so that regressions in the hero section and featured dataset cards are caught before deployment.

#### Acceptance Criteria

1. WHEN the landing page loads, THE E2E_Suite SHALL verify that the `<h1>` element is visible.
2. WHEN the landing page loads, THE E2E_Suite SHALL verify that the hero CTA links to `/sell` and `/marketplace` are present and visible.
3. WHEN the landing page loads with mocked stats, THE E2E_Suite SHALL verify that at least one stat card is visible in the hero section.
4. WHEN the landing page loads with mocked datasets, THE E2E_Suite SHALL verify that the featured dataset section renders at least one dataset card.
5. WHEN a user clicks the "Browse Marketplace" CTA, THE E2E_Suite SHALL verify that the browser navigates to `/marketplace`.

---

### Requirement 5: Marketplace Search, Filter, and Sort Test Suite

**User Story:** As a developer, I want automated tests for the marketplace page, so that search, filter, and sort interactions are verified end-to-end.

#### Acceptance Criteria

1. WHEN the marketplace page loads, THE E2E_Suite SHALL verify that the search input, sort select, and at least one dataset card are visible.
2. WHEN a user types into the search input, THE E2E_Suite SHALL verify that the API_Mock receives a request containing the search term as a query parameter.
3. WHEN a user clicks a type-filter pill, THE E2E_Suite SHALL verify that the pill becomes active (has the gold background class) and the API_Mock receives a request with the corresponding `type` query parameter.
4. WHEN a user changes the sort select, THE E2E_Suite SHALL verify that the API_Mock receives a request with the updated `sort` query parameter.
5. WHEN the API_Mock returns an empty `data` array, THE E2E_Suite SHALL verify that the "no results" empty state is displayed.
6. WHEN a user clicks the clear-search button (X icon), THE E2E_Suite SHALL verify that the search input is emptied and the API_Mock receives a new request without a `search` parameter.

---

### Requirement 6: Dataset Query Demo Flow Test Suite

**User Story:** As a developer, I want automated tests for the dataset query flow, so that the 402 modal, demo mode bypass, and result display are verified end-to-end.

#### Acceptance Criteria

1. WHEN a user clicks the "Query" button on a dataset card, THE E2E_Suite SHALL verify that the QueryModal opens and displays the dataset name.
2. WHEN the QueryModal is on the details step, THE E2E_Suite SHALL verify that the "Proceed to Payment" button is visible and clickable.
3. WHEN the user advances to the payment step, THE E2E_Suite SHALL verify that the demo mode checkbox is checked by default.
4. WHEN the user clicks "Get AI Analysis" with demo mode enabled, THE E2E_Suite SHALL verify that the verifying step is displayed.
5. WHEN the demo query API call resolves, THE E2E_Suite SHALL verify that the result step is displayed with the AI summary text visible.
6. WHEN the result step is displayed, THE E2E_Suite SHALL verify that the "Done" button closes the modal.
7. WHEN the QueryModal is open, THE E2E_Suite SHALL verify that pressing the Escape key closes the modal.

---

### Requirement 7: Theme Toggle Test Suite

**User Story:** As a developer, I want automated tests for the theme toggle, so that dark/light mode switching and persistence are verified end-to-end.

#### Acceptance Criteria

1. WHEN the application loads without a stored theme preference, THE E2E_Suite SHALL verify that the `<html>` element has the `dark` class applied by default.
2. WHEN a user clicks the ThemeToggle button, THE E2E_Suite SHALL verify that the `dark` class is removed from `<html>`.
3. WHEN a user clicks the ThemeToggle button a second time, THE E2E_Suite SHALL verify that the `dark` class is re-added to `<html>`.
4. WHEN a user toggles the theme, THE E2E_Suite SHALL verify that `localStorage` contains the key `hazina-theme` with the updated value.
5. WHEN the page is reloaded after a theme change, THE E2E_Suite SHALL verify that the previously selected theme is restored from `localStorage`.

---

### Requirement 8: Sell Form Validation Test Suite

**User Story:** As a developer, I want automated tests for the sell form, so that field validation and submission behaviour are verified end-to-end.

#### Acceptance Criteria

1. WHEN the sell page loads, THE E2E_Suite SHALL verify that the submit button is disabled when required fields are empty.
2. WHEN a user enters an invalid Stellar wallet address, THE E2E_Suite SHALL verify that the inline validation error message is displayed.
3. WHEN a user enters invalid JSON in the data textarea, THE E2E_Suite SHALL verify that the JSON error message is displayed.
4. WHEN a user fills all required fields with valid data, THE E2E_Suite SHALL verify that the submit button becomes enabled.
5. WHEN a user submits the form with valid data and the API_Mock returns success, THE E2E_Suite SHALL verify that the success screen is displayed.
6. WHEN a user clicks a price preset button, THE E2E_Suite SHALL verify that the price input updates to the selected preset value.

---

### Requirement 9: CI Integration

**User Story:** As a developer, I want the E2E suite to run in CI as a separate job, so that it does not break the existing coverage job and failures are clearly attributed to E2E tests.

#### Acceptance Criteria

1. THE CI_Job SHALL be named `test-e2e` and added to `.github/workflows/test-coverage.yml`.
2. THE CI_Job SHALL run on `ubuntu-latest` with `working-directory: frontend`.
3. THE CI_Job SHALL install Node.js 20 and npm dependencies before running tests.
4. THE CI_Job SHALL run `npx playwright install --with-deps chromium` to install the Chromium browser and its OS dependencies.
5. THE CI_Job SHALL run `npm run test:e2e` to execute the E2E suite.
6. THE CI_Job SHALL upload Playwright HTML reports as a GitHub Actions artifact named `playwright-report` on failure, using `if: failure()`.
7. THE existing `test-frontend` job SHALL NOT be modified; the `test-e2e` job SHALL be independent.
8. IF the E2E suite fails, THE CI_Job SHALL exit with a non-zero status code so the pull request check is marked as failed.
