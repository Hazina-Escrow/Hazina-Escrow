import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../helpers/mockApi';
import { navigateTo } from '../helpers/navigation';

test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
});

test('html element has dark class by default when no localStorage preference is set', async ({ page }) => {
    // Clear any stored theme before navigation
    await page.addInitScript(() => localStorage.removeItem('hazina-theme'));
    await navigateTo(page, '/');
    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');
});

test('clicking ThemeToggle removes the dark class', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('hazina-theme'));
    await navigateTo(page, '/');
    // Ensure we start in dark mode
    await expect(page.locator('html')).toHaveClass(/dark/);
    // Click the toggle button (aria-label contains "Switch to light mode" when dark)
    await page.getByRole('button', { name: /switch to light mode/i }).click();
    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).not.toContain('dark');
});

test('theme toggle is a round trip', async ({ page }) => {
    for (const initial of ['dark', 'light'] as const) {
        await page.addInitScript((theme) => localStorage.setItem('hazina-theme', theme), initial);
        await navigateTo(page, '/');

        const before = await page.locator('html').getAttribute('class') ?? '';
        const wasDark = before.includes('dark');

        // Toggle twice
        await page.getByRole('button', { name: /switch to (light|dark) mode/i }).click();
        await page.getByRole('button', { name: /switch to (light|dark) mode/i }).click();

        const after = await page.locator('html').getAttribute('class') ?? '';
        expect(after.includes('dark')).toBe(wasDark);
    }
});

test('theme persists to localStorage after toggle', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('hazina-theme'));
    await navigateTo(page, '/');

    await page.getByRole('button', { name: /switch to light mode/i }).click();
    const stored = await page.evaluate(() => localStorage.getItem('hazina-theme'));
    const htmlClass = await page.locator('html').getAttribute('class') ?? '';
    expect(stored === 'dark').toBe(htmlClass.includes('dark'));
});

test('theme persists across page reload', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
        await page.addInitScript((t) => localStorage.setItem('hazina-theme', t), theme);
        await navigateTo(page, '/');
        await page.reload();
        await page.waitForLoadState('networkidle');

        const htmlClass = await page.locator('html').getAttribute('class') ?? '';
        if (theme === 'light') {
            expect(htmlClass).not.toContain('dark');
        } else {
            expect(htmlClass).toContain('dark');
        }
    }
});
