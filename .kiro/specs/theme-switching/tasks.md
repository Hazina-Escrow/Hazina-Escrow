# Implementation Plan: Theme Switching

## Overview

Implement a centralized theme management system using React Context, refactor `ThemeToggle` to consume it, wire the provider into `main.tsx`, and configure Tailwind's `class` dark mode strategy.

## Tasks

- [x] 1. Configure Tailwind dark mode strategy
  - Add `darkMode: 'class'` to `tailwind.config.js`
  - _Requirements: 6.1_

- [x] 2. Create ThemeContext with provider and hook
  - Create `frontend/src/context/ThemeContext.tsx`
  - Implement `getInitialTheme()` — reads `localStorage`, falls back to `prefers-color-scheme`, defaults to `"dark"`
  - Implement `ThemeProvider` — owns `theme` state, syncs `dark` class on `document.documentElement` and writes to `localStorage` in a `useEffect`
  - Implement `useTheme` hook — consumes context, throws descriptive error if used outside provider
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3_

  - [x]* 2.1 Write property test: toggle is an involution
  - [x]* 2.2 Write property test: localStorage persistence on toggle
  - [x]* 2.3 Write property test: DOM class reflects theme state
  - [x]* 2.4 Write property test: stored valid value takes precedence over OS preference
  - [x]* 2.5 Write property test: invalid stored value falls back to OS preference
  - [x]* 2.6 Write edge-case test: useTheme outside provider throws

- [x] 3. Checkpoint — Ensure all ThemeContext tests pass

- [x] 4. Refactor ThemeToggle to consume useTheme
  - Remove all local state (`useState`, `useEffect`, `getInitialIsDark`) from `ThemeToggle.tsx`
  - Replace with `const { theme, toggleTheme } = useTheme()`
  - Render Sun icon + `aria-label="Switch to light mode"` when `theme === "dark"`
  - Render Moon icon + `aria-label="Switch to dark mode"` when `theme === "light"`
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 4.1 Write property test: ThemeToggle icon and label match theme
  - [x]* 4.2 Write unit test: clicking ThemeToggle calls toggleTheme

- [x] 6. Final checkpoint — Ensure all tests pass
