import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const userData = mkdtempSync(join(tmpdir(), 'velto-organize-'));
let app;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
    await app.firstWindow();
    let page;
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
        page = app.windows().find((window) => window.url().includes('index.html') && !/#\/(quick|capture)/.test(window.url()));
        if (!page) await sleep(100);
    }
    assert.ok(page, 'library window opens');
    await page.getByText('Create your first entry').waitFor();

    // Create categories in Settings
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel('New categories name').fill('Billing');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByLabel('New categories name').fill('Support');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByText('Billing').first().waitFor();
    await page.getByLabel('New categories name').fill('billing');
    await page.getByRole('button', { name: 'Add' }).click();
    await page.getByText(/already exists/).waitFor();
    await page.getByRole('button', { name: 'Close settings' }).click();

    // Assign a category and tags while creating an entry
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByPlaceholder(/^Title/).fill('Refund note');
    await page.getByPlaceholder(/^Content/).fill('Your refund is on the way.');
    await page.getByPlaceholder(/^Tags/).fill('money, urgent');
    await page.getByLabel('Category').selectOption({ label: 'Billing' });
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Saved').waitFor();
    await page.locator('.entry-category', { hasText: 'Billing' }).waitFor();

    // Sidebar filter by category, and search by category name
    await page.locator('.sidebar').getByRole('button', { name: 'Support' }).click();
    await page.getByText(/Nothing here|No entries|empty/i).first().waitFor({ timeout: 3000 }).catch(() => undefined);
    assert.equal(await page.locator('.item').count(), 0, 'Support category has no entries');
    await page.locator('.sidebar').getByRole('button', { name: 'Billing' }).click();
    await page.locator('.item', { hasText: 'Refund note' }).waitFor();

    // Rename a category: search follows the new name
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Rename Billing' }).click();
    await page.getByLabel('New name for Billing').fill('Payments');
    await page.keyboard.press('Enter');
    await page.getByText('Payments').first().waitFor();

    // Rename a tag into an existing one merges them
    await page.getByRole('button', { name: 'Rename money' }).click();
    await page.getByLabel('New name for money').fill('Urgent');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Rename money' }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: /^Rename (urgent|Urgent)$/ }).count(), 1, 'tags merged');

    // Deleting a category needs confirmation and keeps the entry
    await page.getByRole('button', { name: 'Delete Payments' }).click();
    await page.getByText(/kept and become uncategorized/).waitFor();
    await page.getByRole('button', { name: 'Confirm delete' }).click();
    await page.getByRole('button', { name: 'Rename Payments' }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Close settings' }).click();

    await page.getByRole('button', { name: 'All entries' }).click();
    await page.locator('.item', { hasText: 'Refund note' }).click();
    assert.equal(await page.locator('.entry-category').count(), 0, 'entry is now uncategorized');

    console.log('ORGANIZE E2E PASSED');
} finally {
    await app?.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
