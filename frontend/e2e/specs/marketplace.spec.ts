import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../helpers/mockApi';
import { navigateTo } from '../helpers/navigation';

test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await navigateTo(page, '/marketplace');
});

test('search input, sort select, and dataset cards are visible on load', async ({ page }) => {
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await expect(page.locator('select').first()).toBeVisible();
    // At least one dataset card from the fixture
    const cards = page.locator('[class*="grid"] .glass-card, [class*="grid"] [class*="card"]');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
});

test('empty state is shown when API returns empty data array', async ({ page }) => {
    // Override datasets route to return empty list
    await page.route('**/api/v1/datasets**', route =>
        route.fulfill({
            json: { data: [], total: 0, page: 1, totalPages: 1 },
        }),
    );
    await navigateTo(page, '/marketplace');
    // Empty state heading
    await expect(page.locator('h3').filter({ hasText: /no results|no datasets/i }).first()).toBeVisible({
        timeout: 10_000,
    });
});
