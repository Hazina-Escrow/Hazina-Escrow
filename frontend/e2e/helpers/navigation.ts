import type { Page } from '@playwright/test';

/**
 * Navigate to a path and wait for the network to settle.
 */
export async function navigateTo(page: Page, path: string): Promise<void> {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
}
