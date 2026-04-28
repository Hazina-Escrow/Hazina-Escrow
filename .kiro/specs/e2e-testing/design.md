# Design Document: E2E Testing with Playwright

## Overview

This design adds a Playwright-based end-to-end test suite to the Hazina Data Escrow frontend. The suite runs against the Vite dev server with all `/api/**` requests intercepted by `page.route()` fixture handlers — no real Express backend is required. Five spec files cover the five major user flows. A new `test-e2e` CI job runs independently of the existing Vitest coverage job.

## Architecture

```
frontend/
├── playwright.config.ts          # Playwright configuration
├── package.json                  # adds test:e2e and test:e2e:ui scripts
└── e2e/
    ├── fixtures/
    │   ├── stats.json            # GET /api/datasets/stats response
    │   ├── datasets.json         # GET /api/datasets response
    │   ├── queryInitiate.json    # POST /api/query/:id response
    │   ├── queryResult.json      # POST /api/verify/:id/demo response
    │   └── createDataset.json    # POST /api/datasets response
    ├── helpers/
    │   ├── mockApi.ts            # setupApiMocks(page) — registers all route handlers
    │   └── navigation.ts         # navigateTo(page, path) — goto + networkidle
    └── specs/
        ├── landing.spec.ts
        ├── marketplace.spec.ts
        ├── queryFlow.spec.ts
        ├── themeToggle.spec.ts
        └── sellForm.spec.ts
```

The Vite dev server is managed by Playwright's `webServer` config option. Playwright starts it automatically before the test run and tears it down afterwards. `reuseExistingServer: true` lets developers keep their own `npm run dev` running and skip the startup wait.

## Components and Interfaces

### `playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'html' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

Key decisions:
- `testDir: './e2e'` keeps Playwright from discovering Vitest `.test.tsx` files.
- `retries: 2` in CI absorbs transient flakiness without masking real failures.
- `trace: 'on-first-retry'` captures traces only when a test retries, keeping artifact size small.
- `fullyParallel: true` runs all spec files concurrently for fast CI feedback.

### `e2e/helpers/mockApi.ts`

```typescript
import type { Page } from '@playwright/test';
import stats from '../fixtures/stats.json';
import datasets from '../fixtures/datasets.json';
import queryInitiate from '../fixtures/queryInitiate.json';
import queryResult from '../fixtures/queryResult.json';
import createDataset from '../fixtures/createDataset.json';

export async function setupApiMocks(page: Page): Promise<void> {
  await page.route('**/api/datasets/stats', (route) =>
    route.fulfill({ json: { success: true, stats } })
  );
  await page.route('**/api/datasets', (route) => {
    const url = new URL(route.request().url());
    // Return filtered subset if search/type params are present (simple stub)
    route.fulfill({ json: datasets });
  });
  await page.route('**/api/query/**', (route) =>
    route.fulfill({ json: queryInitiate })
  );
  await page.route('**/api/verify/**/demo', (route) =>
    route.fulfill({ json: queryResult })
  );
  await page.route('**/api/datasets', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({ json: createDataset });
    } else {
      route.continue();
    }
  });
}
```

Route registration order matters: Playwright matches routes in registration order, so the POST `/api/datasets` handler must be registered after the GET handler. The helper uses glob patterns (`**/api/...`) so they work regardless of whether `VITE_API_URL` is set.

### `e2e/helpers/navigation.ts`

```typescript
import type { Page } from '@playwright/test';

export async function navigateTo(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}
```

### Fixture Shape

**`stats.json`**
```json
{
  "totalDatasets": 42,
  "totalQueries": 1337,
  "totalUsdcEarned": 2500.50,
  "totalTransactions": 1337
}
```

**`datasets.json`** — must satisfy `validateDataset()` in `src/lib/api.ts`:
```json
{
  "data": [
    {
      "id": "ds-001",
      "name": "Whale Wallet Tracker",
      "description": "Top 500 whale wallets by on-chain activity.",
      "type": "whale-wallets",
      "pricePerQuery": 0.05,
      "sellerWallet": "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE",
      "queriesServed": 120,
      "totalEarned": 5.70,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "totalPages": 1
}
```

**`queryInitiate.json`**
```json
{
  "payment": {
    "paymentAddress": "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE",
    "amount": 0.05,
    "memo": "HAZINA-ds-001"
  }
}
```

**`queryResult.json`**
```json
{
  "success": true,
  "demo": true,
  "data": { "wallets": ["GABC..."] },
  "ai": { "summary": "Top whale wallets show accumulation patterns." },
  "transaction": {
    "hash": "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    "amount": 0.05,
    "sellerReceived": 0.0475,
    "platformFee": 0.0025
  }
}
```

**`createDataset.json`**
```json
{
  "success": true,
  "dataset": {
    "id": "ds-new-001",
    "name": "Test Dataset",
    "description": "A test dataset.",
    "type": "whale-wallets",
    "pricePerQuery": 0.05,
    "sellerWallet": "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE",
    "queriesServed": 0,
    "totalEarned": 0,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## Data Models

### Test Spec Structure

Each spec file follows this pattern:

```typescript
import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../helpers/mockApi';
import { navigateTo } from '../helpers/navigation';

test.beforeEach(async ({ page }) => {
  await setupApiMocks(page);
});

test('descriptive test name', async ({ page }) => {
  await navigateTo(page, '/');
  // assertions...
});
```

`setupApiMocks` is called in `beforeEach` so every test starts with a clean set of route handlers. Playwright clears route handlers between tests automatically.

### Selector Strategy

Tests use accessible selectors in priority order:
1. `page.getByRole()` — preferred for interactive elements
2. `page.getByLabel()` — for form inputs
3. `page.getByText()` — for visible text content
4. `page.locator('[data-testid="..."]')` — fallback for elements without accessible names

The existing codebase uses `data-tour` attributes on some elements; these can be used as selectors where `data-testid` is absent.

### ThemeToggle Selector

The ThemeToggle button has `aria-label="Switch to light mode"` (when dark) or `aria-label="Switch to dark mode"` (when light). Tests use `page.getByRole('button', { name: /switch to (light|dark) mode/i })`.

### Sell Form Valid Stellar Address

Tests use the address `GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE` (56 chars, starts with G, uppercase alphanumeric) which passes the `/^G[A-Z2-7]{55}$/` regex in `SellPage.tsx`.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

Property 1: All /api/** requests are intercepted
*For any* page navigation that triggers a request matching `/api/**`, after `setupApiMocks` has been called, the request should be fulfilled by the mock and never reach a real network host.
**Validates: Requirements 2.1**

---

Property 2: Fixture data satisfies API runtime validation
*For any* fixture JSON file in `e2e/fixtures/`, parsing it and passing it through the corresponding `src/lib/api.ts` validator function should not throw an `ApiValidationError`.
**Validates: Requirements 3.5**

---

Property 3: Search input sends search query parameter
*For any* non-empty string typed into the marketplace search input, the subsequent `/api/datasets` request URL should contain a `search` query parameter equal to that string.
**Validates: Requirements 5.2**

---

Property 4: Type filter pill sends type query parameter
*For any* type filter pill clicked on the marketplace page, the subsequent `/api/datasets` request URL should contain a `type` query parameter equal to the pill's value, and the pill should have the active (gold background) styling.
**Validates: Requirements 5.3**

---

Property 5: Sort select sends sort query parameter
*For any* sort option selected in the marketplace sort dropdown, the subsequent `/api/datasets` request URL should contain a `sort` query parameter equal to the selected option's value.
**Validates: Requirements 5.4**

---

Property 6: Clear search restores no-search state
*For any* search string that has been entered, clicking the clear-search (X) button should result in the search input being empty and the next `/api/datasets` request URL containing no `search` query parameter.
**Validates: Requirements 5.6**

---

Property 7: Escape key closes QueryModal from any non-terminal step
*For any* QueryModal step that is not `result` or `error`, pressing the Escape key should close the modal (the modal element should no longer be visible in the DOM).
**Validates: Requirements 6.7**

---

Property 8: Theme toggle is a round trip
*For any* initial theme state (dark or light), clicking the ThemeToggle button twice should restore the `<html>` element to its original class state.
**Validates: Requirements 7.3**

---

Property 9: Theme toggle persists to localStorage
*For any* toggle action, `localStorage.getItem('hazina-theme')` should equal `'dark'` when the `<html>` element has the `dark` class, and `'light'` when it does not.
**Validates: Requirements 7.4**

---

Property 10: Theme persists across page reload
*For any* theme value stored in `localStorage['hazina-theme']`, reloading the page should result in the `<html>` element having the `dark` class if and only if the stored value is `'dark'`.
**Validates: Requirements 7.5**

---

Property 11: Invalid Stellar wallet address shows validation error
*For any* string that does not match `/^G[A-Z2-7]{55}$/`, entering it into the seller wallet field should cause the inline validation error message to be visible.
**Validates: Requirements 8.2**

---

Property 12: Invalid JSON in data textarea shows JSON error
*For any* string that is not valid JSON (i.e., `JSON.parse` throws), entering it into the data textarea should cause the JSON error message to be visible.
**Validates: Requirements 8.3**

---

Property 13: Price preset button updates price input
*For any* price preset button value, clicking that button should set the price input's value to the corresponding preset amount.
**Validates: Requirements 8.6**

## Error Handling

**Network errors during tests**: If a route is not mocked and the real backend is unavailable, the test will fail with a network error. This is intentional — unmocked routes should not silently succeed. The `setupApiMocks` helper covers all routes exercised by the five spec files.

**Flaky timing**: Playwright's auto-waiting handles most timing issues. `waitForLoadState('networkidle')` in `navigateTo` ensures the page has finished its initial API calls before assertions run. For the query flow's async verifying step, tests use `page.waitForSelector` with a generous timeout.

**CI browser installation**: The CI job runs `npx playwright install --with-deps chromium` before `npm run test:e2e`. If this step fails (e.g., network issue), the job fails fast before attempting to run tests.

**Sell form Stellar address**: The valid address used in tests (`GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE`) is 56 characters, starts with `G`, and uses only uppercase `A-Z` and `2-7`. It passes the regex but is not a real Stellar account — appropriate for testing.

## Testing Strategy

### Dual Testing Approach

The E2E suite complements, not replaces, the existing Vitest unit/component tests:

- **Vitest unit tests** (`src/**/*.test.tsx`): Test individual components in isolation with happy-dom. Fast, deterministic, run on every commit via `npm run coverage`.
- **Playwright E2E tests** (`e2e/**/*.spec.ts`): Test complete user flows in a real Chromium browser. Slower, run as a separate CI job (`test-e2e`).

### Property-Based Testing

Playwright does not have a built-in property-based testing library. The properties defined above are implemented as parameterized Playwright tests using `test.each` or by iterating over representative input sets within a single test. This provides coverage across multiple values without full randomization.

For Properties 3–6 (marketplace interactions), tests iterate over all available filter/sort values. For Properties 11–13 (form validation), tests use a representative set of invalid inputs (empty string, whitespace-only, partial address, malformed JSON).

The property-based testing library used is `@fast-check/playwright` (fast-check integration for Playwright) for Properties 8–10 (theme toggle round-trip and persistence), where true arbitrary input generation adds value.

### Test Configuration

- Minimum 50 iterations for any `fc.assert` property test (theme toggle is deterministic so fewer iterations suffice).
- Each property test references its design document property number in a comment: `// Property N: <title>`.
- Tag format in test titles: `[Property N] <description>`.

### CI Integration

```yaml
test-e2e:
  name: E2E Tests
  runs-on: ubuntu-latest
  defaults:
    run:
      working-directory: frontend
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: npm
        cache-dependency-path: frontend/package-lock.json
    - run: npm install
    - run: npx playwright install --with-deps chromium
    - run: npm run test:e2e
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: frontend/playwright-report/
        retention-days: 30
```

The `test-e2e` job is independent of `test-frontend`. Both can run in parallel. A failure in `test-e2e` does not affect `test-frontend` and vice versa.
