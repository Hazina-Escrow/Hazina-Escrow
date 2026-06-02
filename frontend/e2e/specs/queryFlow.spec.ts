import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../helpers/mockApi';
import { navigateTo } from '../helpers/navigation';

test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await navigateTo(page, '/marketplace');
});

test('clicking Query on a dataset card opens the QueryModal with dataset name', async ({ page }) => {
    // Find the first "Query" / "Buy" button on a dataset card
    const queryBtn = page.getByRole('button', { name: /query|buy/i }).first();
    await queryBtn.click();
    // The modal should appear — it shows the dataset name
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('dialog')).toContainText('Whale Wallet Tracker');
});

test('"Proceed to Payment" button is visible on the details step', async ({ page }) => {
    await page.getByRole('button', { name: /query|buy/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
        page.getByRole('button', { name: /proceed to payment|continue/i }),
    ).toBeVisible({ timeout: 5_000 });
});

test('demo mode checkbox is checked by default on the payment step', async ({ page }) => {
    await page.getByRole('button', { name: /query|buy/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Advance to payment step
    await page.getByRole('button', { name: /proceed to payment|continue/i }).click();
    const demoCheckbox = page.getByRole('checkbox', { name: /demo/i });
    await expect(demoCheckbox).toBeChecked({ timeout: 5_000 });
});

test('clicking "Get AI Analysis" shows the verifying step', async ({ page }) => {
    await page.getByRole('button', { name: /query|buy/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /proceed to payment|continue/i }).click();
    await page.getByRole('button', { name: /get ai analysis|analyze|submit/i }).click();
    // Verifying step shows a loading/verifying indicator
    await expect(
        page.locator('[role="dialog"]').getByText(/verifying|processing|analyzing/i),
    ).toBeVisible({ timeout: 8_000 });
});

test('after demo query resolves, result step shows AI summary text', async ({ page }) => {
    await page.getByRole('button', { name: /query|buy/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /proceed to payment|continue/i }).click();
    await page.getByRole('button', { name: /get ai analysis|analyze|submit/i }).click();
    // The fixture ai.summary text should appear in the result step
    await expect(
        page.locator('[role="dialog"]').getByText(/whale activity|accumulation/i),
    ).toBeVisible({ timeout: 10_000 });
});

test('"Done" button on result step closes the modal', async ({ page }) => {
    await page.getByRole('button', { name: /query|buy/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /proceed to payment|continue/i }).click();
    await page.getByRole('button', { name: /get ai analysis|analyze|submit/i }).click();
    await expect(
        page.locator('[role="dialog"]').getByText(/whale activity|accumulation/i),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /done|close/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3_000 });
});

// Property 7: Escape key closes QueryModal from details and payment steps
for (const step of ['details', 'payment'] as const) {
    test(`Escape key closes modal from ${step} step`, async ({ page }) => {
        await page.getByRole('button', { name: /query|buy/i }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();

        if (step === 'payment') {
            await page.getByRole('button', { name: /proceed to payment|continue/i }).click();
        }

        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3_000 });
    });
}
