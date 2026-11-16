import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const userData = mkdtempSync(join(tmpdir(), 'velto-quick-'));
const args = ['.', `--user-data-dir=${userData}`];
let app;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quickVisible = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('#/quick'));
    return { visible: w.isVisible(), focused: w.isFocused() };
});

async function toggleViaSecondInstance() {
    const second = spawn(electronPath, [...args, '--quick-search'], { stdio: 'ignore' });
    await new Promise((resolve) => second.on('exit', resolve));
    await sleep(400);
}

try {
    app = await electron.launch({ args });
    await app.firstWindow();
    let library;
    for (let i = 0; i < 100 && !library; i++) {
        library = app.windows().find((p) => p.url().includes('index.html') && !/#\/(quick|capture)/.test(p.url()));
        if (!library) await sleep(100);
    }
    await library.getByText('Create your first entry').waitFor();

    for (const [title, content, extra] of [
        ['Refund policy', 'Refunds are processed within 5 business days.', {}],
        ['Shipping delay', 'Your order is delayed.', {}],
        ['Greeting', 'Hello %name%, welcome to %company%!', { is_template: true }],
    ]) {
        await library.evaluate((payload) => window.velto.createEntry(payload), { title, content, ...extra });
    }

    // The window exists hidden and uses a locked-down renderer
    let quick;
    for (let i = 0; i < 50 && !quick; i++) {
        quick = app.windows().find((p) => p.url().includes('#/quick'));
        if (!quick) await sleep(100);
    }
    assert.ok(quick, 'quick search window exists');
    assert.equal((await quickVisible()).visible, false, 'hidden at startup');
    assert.equal(await quick.evaluate(() => typeof require), 'undefined');

    // Opening shows and focuses it, with recent/all entries listed
    await toggleViaSecondInstance();
    assert.equal((await quickVisible()).visible, true, 'shown by toggle');
    await quick.getByRole('option').first().waitFor();
    assert.equal(await quick.getByRole('option').count(), 3);
    assert.equal(await quick.evaluate(() => document.activeElement?.tagName), 'INPUT', 'input is focused');

    // Typing filters, Enter copies and hides
    await quick.getByRole('combobox').fill('refund');
    await quick.getByRole('option', { name: /Refund policy/ }).waitFor();
    await quick.waitForFunction(() => document.querySelectorAll('[role=option]').length === 1);
    await quick.keyboard.press('Enter');
    await sleep(300);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Refunds are processed within 5 business days.');
    assert.equal((await quickVisible()).visible, false, 'hidden after copy');

    // Usage was recorded, so the entry is now "recent"
    const recent = await library.evaluate(() => window.velto.listEntries({ view: 'recent' }));
    assert.deepEqual(recent.rows.map((e) => e.title), ['Refund policy']);

    // Reopening resets the query and arrow keys move the selection
    await toggleViaSecondInstance();
    await quick.getByRole('option').first().waitFor();
    assert.equal(await quick.getByRole('combobox').inputValue(), '');
    await quick.getByRole('combobox').fill('');
    await quick.keyboard.press('ArrowDown');
    assert.equal(await quick.locator('[aria-selected=true]').count(), 1);

    // Escape hides without copying
    await app.evaluate(({ clipboard }) => clipboard.writeText('untouched'));
    await quick.keyboard.press('Escape');
    await sleep(300);
    assert.equal((await quickVisible()).visible, false, 'Escape hides');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'untouched');

    // Template entries open the variable form; the result is copied
    await toggleViaSecondInstance();
    await quick.getByRole('combobox').fill('greeting');
    await quick.getByRole('option', { name: /Greeting/ }).waitFor();
    await quick.keyboard.press('Enter');
    await quick.locator('.field-group').first().waitFor();
    assert.equal(await quick.locator('.field-group').count(), 2);
    await quick.locator('.field-group', { hasText: 'Name' }).locator('textarea').fill('Ada');
    await quick.locator('.field-group', { hasText: 'Company' }).locator('textarea').fill('Velto');
    await quick.getByRole('button', { name: /Copy result/ }).click();
    await sleep(400);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Hello Ada, welcome to Velto!');
    assert.equal((await quickVisible()).visible, false, 'hidden after template copy');

    // A template with a field-only placeholder opens the form and can copy that field.
    await library.evaluate(() => window.velto.createEntry({
        title: 'Field template', content: 'Body', is_template: true,
        fields: [{ label: 'Subject', value: 'Hello %person%' }],
    }));
    await toggleViaSecondInstance();
    await quick.getByRole('combobox').fill('subject');
    await quick.getByRole('option', { name: /Field template/ }).waitFor();
    await quick.keyboard.press('Enter');
    await quick.locator('.field-group', { hasText: 'Person' }).locator('textarea').fill('Ada');
    const copyBox = await quick.getByRole('button', { name: /Copy result/ }).boundingBox();
    const fieldBox = await quick.getByRole('region', { name: 'Subject' }).boundingBox();
    assert.ok(copyBox.y + copyBox.height <= fieldBox.y, 'additional fields follow copy result in Quick Search');
    const valueBox = await quick.getByRole('region', { name: 'Subject' }).locator('.preview').boundingBox();
    const fieldCopyBox = await quick.getByRole('button', { name: 'Copy Subject' }).boundingBox();
    assert.equal(await quick.getByRole('button', { name: 'Copy Subject' }).innerText(), 'Copy');
    assert.ok(fieldCopyBox.x >= valueBox.x + valueBox.width && fieldCopyBox.y < valueBox.y + valueBox.height, 'field copy is beside its value in Quick Search');
    await quick.getByRole('button', { name: 'Copy Subject' }).click();
    await sleep(300);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Hello Ada');
    assert.equal((await quickVisible()).visible, false);

    // Blur hides it
    await toggleViaSecondInstance();
    assert.equal((await quickVisible()).visible, true);
    await library.bringToFront();
    await app.evaluate(({ BrowserWindow }) => {
        const lib = BrowserWindow.getAllWindows().find((w) => !/#\/(quick|capture)/.test(w.webContents.getURL()));
        lib.show();
        lib.focus();
    });
    await sleep(500);
    assert.equal((await quickVisible()).visible, false, 'hides on blur');

    // Both result lists announce when matches are truncated.
    await library.evaluate(async () => {
        for (let i = 0; i < 51; i++) {
            await window.velto.createEntry({ title: `Limit ${i}`, content: 'limitmatch' });
        }
    });
    await library.getByLabel('Search entries').fill('limitmatch');
    await library.getByText('Showing first 50 results, refine your search.').waitFor();
    assert.equal(await library.locator('.item').count(), 50);
    await toggleViaSecondInstance();
    await quick.getByText('Showing first 12 results, refine your search.').waitFor();
    await quick.getByRole('combobox').fill('limitmatch');
    await quick.getByText('Showing first 50 results, refine your search.').waitFor();
    assert.equal(await quick.getByRole('option').count(), 50);
    await quick.getByRole('combobox').fill('refund');
    await quick.getByRole('option', { name: /Refund policy/ }).waitFor();
    assert.equal(await quick.getByText(/Showing first/).count(), 0);
    await quick.evaluate(() => window.velto.hideQuickSearch());

    // Shortcut status is reported and shown in settings
    const status = await library.evaluate(() => window.velto.getSettings()).then((state) => state.shortcuts.quickSearch);
    assert.equal(status.preferred, 'Control+Shift+Space');
    await library.getByRole('button', { name: /settings/i }).click();
    await library.getByTestId('shortcut-status').waitFor();

    console.log('QUICK SEARCH E2E PASSED');
} finally {
    await app?.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
