# Implementation Plan: Frontend Testing Infrastructure

## Overview

Add `AgentPage.test.tsx` and `utils.test.ts`, extract `localizeScale` to a testable utility, and install `fast-check` for property-based testing. All work builds incrementally — utilities first, then the page component tests.

## Tasks

- [x] 1. Install fast-check and extract localizeScale
  - [x] 1.1 Add fast-check dev dependency
    - Run `npm install --save-dev fast-check` in the `frontend/` directory
    - Verify it appears in `package.json` devDependencies
    - _Requirements: 4.1, 4.2, 4.3, 7.1, 7.2, 7.3_

  - [x] 1.2 Extract localizeScale to `frontend/src/lib/agentUtils.ts`
    - Create `agentUtils.ts` exporting `localizeScale(value: string, t: (key: string) => string): string`
    - Update `AgentPage.tsx` to import and call `localizeScale` from `agentUtils.ts`
    - Ensure no behavior change — all existing rendering still works
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 2. Property tests for utility functions
  - [x] 2.1 Create `frontend/src/lib/utils.test.ts` with property tests for `formatUSDC` and `truncateAddress`
    - Import `fc` from `fast-check`
    - Write property test for `formatUSDC` always containing a decimal point (Property 6)
    - Write property test for `truncateAddress` never lengthening the input (Property 7)
    - Write property test for `truncateAddress` ellipsis and prefix for long addresses (Property 8)
    - Each test annotated with `// Feature: frontend-testing-infrastructure, Property N: ...`
    - _Requirements: 7.1, 7.2, 7.3_

  - [x]* 2.2 Write property tests for localizeScale in `frontend/src/lib/agentUtils.test.ts`
    - Property 3: non-empty output for all known values × all supported locales
    - Property 4: passthrough for unrecognized values (use `fc.string()` filtered to exclude known values)
    - Property 5: case-insensitivity for known values
    - Each test annotated with `// Feature: frontend-testing-infrastructure, Property N: ...`
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. Checkpoint — run existing tests
  - Ensure all existing tests pass with `npm run test` in `frontend/`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. AgentPage example tests — query input and submission
  - [x] 4.1 Create `frontend/src/pages/AgentPage.test.tsx` with render helper and mock setup
  - [x] 4.2 Write example tests for query input validation
  - [x] 4.3 Write example tests for query submission interactions

- [x] 5. AgentPage example tests — loading and error states
  - [x] 5.1 Write example tests for loading state
  - [x] 5.2 Write example tests for error state and retry

- [x] 6. AgentPage tests — result rendering
  - [x] 6.1 Write example test for demo badge visibility

- [x] 7. Final checkpoint — full test suite
