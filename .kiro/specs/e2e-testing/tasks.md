# Implementation Plan: E2E Testing with Playwright

## Overview

Install Playwright, configure it for the Hazina frontend, create API mock helpers and fixtures, implement five spec files covering the major user flows, and wire up a new `test-e2e` CI job.

## Tasks

- [x] 1. Install Playwright and configure the test runner
  - Install `@playwright/test` as a dev dependency in `frontend/`
  - Create `frontend/playwright.config.ts` with `testDir: './e2e'`, `baseURL: 'http://localhost:5173'`, Chromium-only project, and `webServer` config pointing to `npm run dev`
  - Add `"test:e2e": "playwright test"` and `"test:e2e:ui": "playwright test --ui"` scripts to `frontend/package.json`
  - Update `frontend/vitest.config.ts` coverage `exclude` list to also exclude `e2e/**` so Playwright spec files are not picked up by Vitest
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 2. Create fixture files and shared helpers
  - [x] 2.1 Create fixture JSON files in `frontend/e2e/fixtures/`
  - [x] 2.3 Create `frontend/e2e/helpers/mockApi.ts`
  - [x] 2.4 Create `frontend/e2e/helpers/navigation.ts`

- [x] 3. Implement landing page spec
- [x] 4. Implement marketplace spec
- [x] 6. Implement dataset query demo flow spec
- [x] 7. Implement theme toggle spec
- [x] 8. Implement sell form validation spec
- [x] 9. Add test-e2e CI job

- [ ] 10. Final checkpoint — Ensure all tests pass
  - Run `npm run test:e2e` and confirm all five spec files pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The valid Stellar address used in tests is `GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE` (56 chars, passes `/^G[A-Z2-7]{55}$/`)
- Playwright's `page.route()` handlers are cleared automatically between tests; `setupApiMocks` must be called in `beforeEach`
- The `testDir: './e2e'` config ensures Vitest and Playwright do not discover each other's test files
- Property tests use `test.each` for parameterization; no additional PBT library is required for most properties
