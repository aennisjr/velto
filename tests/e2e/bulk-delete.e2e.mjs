import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const userData = mkdtempSync(join(tmpdir(), 'velto-bulk-delete-'));
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

    await page.evaluate(async () => {
        await Promise.all([
            window.velto.createEntry({ title: 'Delete alpha', content: 'first bulk delete target' }),
            window.velto.createEntry({ title: 'Delete beta', content: 'second bulk delete target' }),
            window.velto.createEntry({ title: 'Keep gamma', content: 'entry to keep' }),
        ]);
    });
    await page.reload();
    await page.getByRole('button', { name: 'Select', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await page.getByRole('group', { name: 'Bulk actions' }).waitFor();
    await page.getByRole('option', { name: 'Select Delete alpha' }).click();
    await page.getByRole('option', { name: 'Select Delete beta' }).click();
    assert.equal(await page.getByText('2 selected').count(), 1);

    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Delete selected' }).click();
    assert.equal((await page.evaluate(() => window.velto.listEntries({ view: 'all' }))).length, 3, 'cancel leaves entries unchanged');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete selected' }).click();
    await page.getByText('Deleted 2 entries', { exact: true }).waitFor();
    const entries = await page.evaluate(() => window.velto.listEntries({ view: 'all' }));
    assert.deepEqual(entries.map((entry) => entry.title), ['Keep gamma']);
    assert.equal((await page.evaluate(() => window.velto.searchEntries('bulk delete'))).length, 0, 'deleted entries leave full-text search');

    console.log('BULK DELETE E2E PASSED');
} finally {
    await app?.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
