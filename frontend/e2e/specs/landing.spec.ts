import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../helpers/mockApi';
import { navigateTo } from '../helpers/navigation';

test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
});

test('h1 is visible on load', async ({ page }) => {
    await navigateTo(page, '/');
    await expect(page.locator('h1').first()).toBeVisible();
});

test('hero CTA links to /sell and /marketplace are present', async ({ page }) => {
    await navigateTo(page, '/');
    await expect(page.locator('a[href="/sell"]').first()).toBeVisible();
    await expect(page.locator('a[href="/marketplace"]').first()).toBeVisible();
});

test('at least one stat card is visible after mocked stats load', async ({ page }) => {
    await navigateTo(page, '/');
    // Stat cards contain a number (from useCountUp) and a label
    const statCards = page.locator('.glass-card-gold');
    await expect(statCards.first()).toBeVisible();
});

test('at least one dataset card is visible in the featured section', async ({ page }) => {
    await navigateTo(page, '/');
    // DatasetCard renders inside the featured section grid
    const cards = page.locator('[class*="grid"] .glass-card, [class*="grid"] [class*="card"]');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
});

test('clicking "Browse Marketplace" CTA navigates to /marketplace', async ({ page }) => {
    await navigateTo(page, '/');
    // The bottom CTA that says "Browse Marketplace" or equivalent
    const cta = page.locator('a[href="/marketplace"]').last();
    await cta.click();
    await expect(page).toHaveURL(/\/marketplace/);
});
