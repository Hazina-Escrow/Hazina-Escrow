import type { Page } from '@playwright/test';
import stats from '../fixtures/stats.json';
import datasets from '../fixtures/datasets.json';
import queryInitiate from '../fixtures/queryInitiate.json';
import queryResult from '../fixtures/queryResult.json';
import createDataset from '../fixtures/createDataset.json';

/**
 * Registers page.route() handlers for all fixture endpoints.
 * Uses glob patterns so routes match regardless of VITE_API_URL.
 */
export async function setupApiMocks(page: Page): Promise<void> {
    // Stats
    await page.route('**/api/v1/datasets/stats', route =>
        route.fulfill({ json: stats }),
    );

    // Datasets list
    await page.route('**/api/v1/datasets?**', route =>
        route.fulfill({ json: datasets }),
    );
    // Datasets list (no query string)
    await page.route('**/api/v1/datasets', route => {
        if (route.request().method() === 'GET') {
            return route.fulfill({ json: datasets });
        }
        if (route.request().method() === 'POST') {
            return route.fulfill({ json: createDataset });
        }
        return route.continue();
    });

    // Query initiation
    await page.route('**/api/v1/query/**', route =>
        route.fulfill({ json: queryInitiate }),
    );

    // Demo query / verify
    await page.route('**/api/v1/verify/**/demo', route =>
        route.fulfill({ json: queryResult }),
    );
    await page.route('**/api/v1/verify/**', route =>
        route.fulfill({ json: queryResult }),
    );

    // Individual dataset
    await page.route('**/api/v1/datasets/ds-*', route => {
        if (route.request().method() === 'GET') {
            return route.fulfill({ json: { success: true, dataset: datasets.data[0] } });
        }
        return route.continue();
    });

    // WebSocket — stub to avoid connection errors
    await page.route('**/ws**', route => route.abort());
}
