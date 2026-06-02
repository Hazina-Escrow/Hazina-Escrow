import { test, expect } from '@playwright/test';
import { setupApiMocks } from '../helpers/mockApi';
import { navigateTo } from '../helpers/navigation';

const VALID_WALLET = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE';
const VALID_JSON = '{"key":"value"}';

test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await navigateTo(page, '/sell');
});

test('submit button is disabled when all fields are empty', async ({ page }) => {
    // Clear localStorage draft so form starts empty
    await page.evaluate(() => localStorage.removeItem('hazina_sell_form_draft'));
    await page.reload();
    await page.waitForLoadState('networkidle');

    const submitBtn = page.getByRole('button', { name: /publish dataset|list dataset/i });
    await expect(submitBtn).toBeDisabled();
});

test('filling all required fields with valid data enables the submit button', async ({ page }) => {
    await page.getByPlaceholder(/dataset name/i).fill('My Dataset');
    await page.getByPlaceholder(/describe your dataset/i).fill('A useful dataset for testing.');
    await page.locator('input[placeholder*="wallet"], input[placeholder*="G..."]').fill(VALID_WALLET);

    // Fill the JSON textarea
    const textarea = page.locator('textarea').last();
    await textarea.fill(VALID_JSON);

    const submitBtn = page.getByRole('button', { name: /publish dataset|list dataset/i });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
});

test('submitting the form with valid data shows the success screen', async ({ page }) => {
    await page.getByPlaceholder(/dataset name/i).fill('My Dataset');
    await page.getByPlaceholder(/describe your dataset/i).fill('A useful dataset for testing.');
    await page.locator('input[placeholder*="wallet"], input[placeholder*="G..."]').fill(VALID_WALLET);
    const textarea = page.locator('textarea').last();
    await textarea.fill(VALID_JSON);

    const submitBtn = page.getByRole('button', { name: /publish dataset|list dataset/i });
    await submitBtn.click();

    // Confirmation dialog — click Publish
    await page.getByRole('button', { name: /^publish$/i }).click();

    // Success screen shows a checkmark and success message
    await expect(page.locator('text=/listing live|live now|dataset live/i').first()).toBeVisible({
        timeout: 10_000,
    });
});

// Property 11: invalid Stellar wallet address shows validation error
const invalidAddresses = [
    { label: 'empty', value: ' ' },
    { label: 'too short', value: 'GABC123' },
    { label: 'wrong prefix', value: 'AABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE' },
    { label: 'lowercase', value: 'gabc1234567890abcdefghijklmnopqrstuvwxyz1234567890abcde' },
];

for (const { label, value } of invalidAddresses) {
    test(`invalid wallet address (${label}) shows validation error`, async ({ page }) => {
        const walletInput = page.locator('input[placeholder*="wallet"], input[placeholder*="G..."]');
        await walletInput.fill(value);
        await walletInput.blur();
        await expect(page.locator('text=/valid stellar|public key/i').first()).toBeVisible({ timeout: 3_000 });
    });
}

// Property 12: invalid JSON shows JSON error
const invalidJsonStrings = ['{', 'undefined', '[1,2,'];

for (const jsonStr of invalidJsonStrings) {
    test(`invalid JSON "${jsonStr}" shows JSON error`, async ({ page }) => {
        const textarea = page.locator('textarea').last();
        await textarea.fill(jsonStr);
        await textarea.blur();
        await expect(page.locator('text=/invalid json/i').first()).toBeVisible({ timeout: 3_000 });
    });
}

// Property 13: price preset button updates price input
const pricePresets = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5];

for (const preset of pricePresets) {
    test(`price preset $${preset} updates price input`, async ({ page }) => {
        await page.getByRole('button', { name: `$${preset}` }).click();
        const priceInput = page.locator('input[type="number"]').first();
        await expect(priceInput).toHaveValue(String(preset));
    });
}
