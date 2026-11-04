import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const root = mkdtempSync(join(tmpdir(), 'velto-transfer-'));
const exportPath = join(root, 'library.velto');
const badPath = join(root, 'bad.velto');
const apps = [];
const launch = async (name) => {
    const app = await electron.launch({ args: ['.', `--user-data-dir=${join(root, name)}`] });
    apps.push(app);
    return app;
};

async function stubDialogs(app, { save, open }) {
    await app.evaluate(({ dialog }, paths) => {
        dialog.showSaveDialog = async () => ({ canceled: !paths.save, filePath: paths.save });
        dialog.showOpenDialog = async () => ({ canceled: !paths.open, filePaths: paths.open ? [paths.open] : [] });
    }, { save, open });
}

try {
    const a = await launch('a');
    const pageA = await a.firstWindow();
    await pageA.evaluate(async () => {
        await window.velto.createEntry({ title: 'Refund processed', content: 'Hi %name%, refund sent.', tags: ['billing'], is_template: true });
        await window.velto.createEntry({ title: 'Meeting move', content: 'Can we meet later?', tags: ['scheduling'] });
    });
    await stubDialogs(a, { save: exportPath });
    await pageA.getByRole('button', { name: 'Settings' }).click();
    await pageA.getByRole('button', { name: 'Export library…' }).click();
    await pageA.getByText(/Exported 2 entries/).waitFor();
    await a.close();

    const file = JSON.parse(readFileSync(exportPath, 'utf8'));
    assert.equal(file.format, 'velto-library');
    assert.equal(file.entries.length, 2);

    writeFileSync(badPath, '{"not":"velto"}');
    const b = await launch('b');
    const pageB = await b.firstWindow();
    await pageB.getByRole('button', { name: 'Settings' }).click();

    await stubDialogs(b, { open: badPath });
    await pageB.getByRole('button', { name: 'Import library…' }).click();
    await pageB.getByRole('alert').getByText(/not a valid Velto library/).waitFor();

    await stubDialogs(b, { open: exportPath });
    await pageB.getByRole('button', { name: 'Import library…' }).click();
    await pageB.getByText(/2 entries · 2 new/).waitFor();
    await pageB.getByRole('button', { name: 'Import', exact: true }).click();
    await pageB.getByRole('dialog').waitFor({ state: 'detached' });
    await pageB.waitForFunction(() => document.querySelectorAll('.item').length === 2);

    await pageB.getByPlaceholder(/search/i).fill('refund');
    await pageB.waitForFunction(() => document.querySelectorAll('.item').length === 1);
    assert.equal(await pageB.locator('.item').count(), 1);

    await pageB.getByPlaceholder(/search/i).fill('');
    await pageB.getByRole('button', { name: 'Settings' }).click();
    await pageB.getByRole('button', { name: 'Import library…' }).click();
    await pageB.getByText(/2 identical/).waitFor();
    await pageB.getByRole('radio', { name: /Replace library/ }).check();
    await pageB.getByRole('button', { name: 'Import', exact: true }).click();
    await pageB.getByRole('alert').getByText(/deletes everything/).waitFor();
    await pageB.getByRole('button', { name: 'Yes, replace my library' }).click();
    await pageB.getByRole('dialog').waitFor({ state: 'detached' });
    await pageB.waitForFunction(() => document.querySelectorAll('.item').length === 2);

    const backups = join(root, 'b', 'backups');
    assert.ok(existsSync(backups) && readdirSync(backups).length === 1, 'replace saved a backup');
    await b.close();
    console.log('TRANSFER E2E PASSED');
} finally {
    await Promise.all(apps.map((app) => app.close().catch(() => undefined)));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
