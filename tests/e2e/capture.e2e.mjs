import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const userData = mkdtempSync(join(tmpdir(), 'velto-capture-'));
const args = ['.', `--user-data-dir=${userData}`];
let app;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const captureVisible = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('#/capture'));
    return w.isVisible();
});

try {
    app = await electron.launch({ args });
    await app.firstWindow();
    let library;
    for (let i = 0; i < 100 && !library; i++) {
        library = app.windows().find((p) => p.url().includes('index.html') && !/#\/(quick|capture)/.test(p.url()));
        if (!library) await sleep(100);
    }
    await library.getByText('Create your first entry').waitFor();

    const previousEntry = await library.evaluate(() => window.velto.createEntry({
        title: 'Previously used entry',
        content: 'This older entry was used before Quick Capture.',
    }));
    await library.evaluate((id) => window.velto.copyText({ text: 'This older entry was used before Quick Capture.', entryId: id }), previousEntry.id);

    let capture;
    for (let i = 0; i < 50 && !capture; i++) {
        capture = app.windows().find((p) => p.url().includes('#/capture'));
        if (!capture) await sleep(100);
    }
    assert.ok(capture, 'capture window exists');
    assert.equal(await captureVisible(), false, 'hidden at startup');
    assert.equal(await capture.evaluate(() => typeof require), 'undefined', 'renderer is locked down');

    // Open through the command-line flag, type and save with the keyboard
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().includes('#/'))?.hide());
    const second = spawn(electronPath, [...args, '--quick-capture'], { stdio: 'ignore' });
    await new Promise((resolve) => second.on('exit', resolve));
    await sleep(400);
    assert.equal(await captureVisible(), true, 'shown by --quick-capture');

    await library.evaluate(() => window.velto.createCategory('Support'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('#/capture')).webContents.send('capture:shown'));
    await capture.getByLabel('Content').fill('Thanks for reaching out!\nWe will reply soon.');
    await capture.getByLabel('Tags').fill('greeting, quick');
    await capture.getByLabel('Category').selectOption({ label: 'Support' });
    await capture.getByLabel('Favorite').check();
    await capture.keyboard.press('Control+Enter');
    await sleep(500);
    assert.equal(await captureVisible(), false, 'hidden after saving');
    assert.equal(await library.locator('.item', { hasText: 'Thanks for reaching out!' }).count(), 0, 'hidden library has not refreshed yet');
    await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((win) => !win.webContents.getURL().includes('#/'));
        window?.show();
        window?.focus();
    });
    await library.locator('.item', { hasText: 'Thanks for reaching out!' }).waitFor();

    const entries = await library.evaluate(() => window.velto.listEntries({ view: 'all' }));
    assert.equal(entries.rows.length, 2);
    const capturedEntry = entries.rows.find((entry) => entry.title === 'Thanks for reaching out!');
    assert.ok(capturedEntry, 'captured entry was saved');
    assert.deepEqual([...capturedEntry.tags].sort(), ['greeting', 'quick']);
    assert.equal(capturedEntry.is_favorite, true);
    assert.ok(capturedEntry.category_id, 'category assigned');

    // A new capture is offered in Quick Search even when another entry was already used.
    const quick = app.windows().find((page) => page.url().includes('#/quick'));
    assert.ok(quick, 'quick search window exists');
    await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('#/quick'));
        window.show();
        window.webContents.send('quick:shown');
    });
    await quick.getByRole('option', { name: /Thanks for reaching out!/ }).waitFor();
    assert.match(await quick.getByRole('option').first().innerText(), /Thanks for reaching out!/);
    await quick.evaluate(() => window.velto.hideQuickSearch());

    // The form starts empty next time, and empty content is refused
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('#/capture')).show());
    assert.equal(await capture.getByLabel('Content').inputValue(), '');
    await capture.getByRole('button', { name: /^Save/ }).click();
    await capture.getByRole('alert').waitFor();
    assert.equal((await library.evaluate(() => window.velto.listEntries({ view: 'all' }))).rows.length, 2);

    // Clipboard paste and Escape (the text survives so nothing typed is lost)
    await app.evaluate(({ clipboard }) => clipboard.writeText('From the clipboard'));
    await capture.getByRole('button', { name: 'Paste clipboard' }).click();
    await capture.waitForFunction(() => document.querySelector('[aria-label="Content"]')?.value === 'From the clipboard');
    assert.equal(await capture.getByLabel('Content').inputValue(), 'From the clipboard');
    await capture.keyboard.press('Escape');
    await sleep(300);
    assert.equal(await captureVisible(), false, 'Escape hides');
    assert.equal(await capture.getByLabel('Content').inputValue(), 'From the clipboard', 'draft kept while hidden');

    // Settings: change a shortcut, reject a duplicate, toggle options, back up
    let state = await library.evaluate(() => window.velto.getSettings());
    assert.equal(state.shortcuts.quickCapture.preferred, 'Control+Alt+N');
    state = await library.evaluate(() => window.velto.updateSettings({ shortcuts: { quickCapture: 'Control+Shift+Alt+K' } }));
    assert.equal(state.shortcuts.quickCapture.active, 'Control+Shift+Alt+K', 'new shortcut is registered');
    assert.equal(state.shortcuts.quickSearch.active !== null, true, 'quick search stays registered');
    const duplicate = await library.evaluate(() => window.velto.updateSettings({ shortcuts: { quickCapture: 'Control+Shift+Space' } }).then(() => 'ok', (error) => error.message));
    assert.match(duplicate, /different shortcuts/);
    const invalid = await library.evaluate(() => window.velto.updateSettings({ shortcuts: { quickCapture: 'K' } }).then(() => 'ok', () => 'rejected'));
    assert.equal(invalid, 'rejected');

    await library.getByRole('button', { name: 'Settings' }).click();
    await library.getByTestId('shortcut-quickCapture').getByText('Control + Shift + Alt + K').waitFor();
    await library.getByRole('button', { name: 'Reset Quick Capture shortcut' }).click();
    await library.getByTestId('shortcut-quickCapture').getByText(/Control \+ Alt \+ N/).waitFor();

    // Recording a shortcut from the keyboard
    await library.getByTestId('shortcut-quickCapture').getByRole('button', { name: 'Change' }).click();
    await library.keyboard.press('Control+Shift+Alt+J');
    await library.getByTestId('shortcut-quickCapture').getByText('Control + Alt + Shift + J').waitFor();

    await library.getByRole('button', { name: 'Back up now' }).click();
    await library.getByText(/Backup saved \(2 entries\)/).waitFor();
    const files = readdirSync(join(userData, 'backups'));
    assert.ok(files.some((name) => name.startsWith('velto-backup-')), 'manual backup written');

    // Focus is trapped in the settings dialog and returns to the opener on close
    await library.keyboard.press('Escape');
    await library.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await library.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Settings', 'focus returns to Settings button');

    console.log('QUICK CAPTURE E2E PASSED');
} finally {
    await app?.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
