// End-to-end smoke test: launches the built app (run via `npm run test:e2e`) with a throwaway profile.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';

const userData = mkdtempSync(join(tmpdir(), 'velto-e2e-'));
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
    await app.firstWindow();
    let page;
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
        page = app.windows().find((window) => window.url().includes('index.html') && !/#\/(quick|capture)/.test(window.url()));
        if (!page) await sleep(100);
    }
    assert.ok(page, 'library window opens');
    const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());

    // Security boundaries
    assert.equal(await page.evaluate(() => typeof require), 'undefined', 'node integration must be off');
    assert.equal(await page.evaluate(() => typeof process), 'undefined', 'process must not leak into renderer');
    assert.deepEqual(
        await page.evaluate(() => Object.keys(window.velto).sort()),
        ['appVersion', 'applyImport', 'backupInfo', 'backupNow', 'cancelImport', 'chooseImportFile', 'consumeFirstRun', 'copyText', 'createCategory', 'createEntry', 'databaseStatus', 'deleteCategory', 'deleteEntries', 'deleteEntry', 'deleteTag', 'duplicateEntry', 'exportLibrary', 'getSettings', 'hideQuickCapture', 'hideQuickSearch', 'listCategories', 'listEntries', 'listTagUsage', 'listTags', 'onLibraryShown', 'onQuickCaptureShown', 'onQuickSearchShown', 'openBackupFolder', 'openLibrary', 'platform', 'readClipboard', 'renameCategory', 'renameTag', 'searchEntries', 'setArchived', 'setSyntaxLanguage', 'toggleFavorite', 'updateEntry', 'updateSettings'],
    );
    assert.equal(await app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.webContents.openDevTools({ mode: 'detach' });
        await new Promise((resolve) => setTimeout(resolve, 300));
        return window.webContents.isDevToolsOpened();
    }), false, 'release builds disable developer tools');
    const appVersion = await page.evaluate(() => window.velto.appVersion());
    await page.getByLabel(`Version ${appVersion}`).waitFor();
    assert.equal(await page.locator('.app-version').innerText(), `v${appVersion}`);
    await assert.rejects(() => page.evaluate(() => window.velto.createEntry({ title: '', content: 'x' })), /at least 1/);
    await assert.rejects(() => page.evaluate(() => window.velto.setArchived('id', 'yes')), /boolean/i);
    await assert.rejects(() => page.evaluate(() => window.velto.setSyntaxLanguage('id', 'invalid')), /enum/i);

    // Empty state -> create a template
    await page.getByText('Create your first entry').click();
    await page.getByPlaceholder(/^Title/).fill('Customer support follow-up');
    await page
        .getByPlaceholder(/^Content/)
        .fill('Hello %name%,\n\nYour support ticket, %ticket_id%, has been updated.\n\n%message%\n\nBye %name%');
    await page.getByPlaceholder(/^Tags/).fill('support, customer');
    assert.equal(await page.getByRole('checkbox').isChecked(), true, 'template auto-detected');
    assert.equal(await page.locator('.variable-row .chip').count(), 3, 'three unique variables');
    await page.keyboard.press('Control+Enter');
    await page.getByText('Saved').waitFor();

    // Use the template: one field per unique variable, live preview, blocked until complete
    await page.getByRole('button', { name: /Use Template/ }).click();
    assert.equal(await page.locator('.field-group').count(), 3);
    const copyButton = page.getByRole('button', { name: /Copy result/ });
    assert.equal(await copyButton.isDisabled(), true, 'copy blocked while values are missing');
    await page.locator('.field-group', { hasText: 'Name' }).locator('textarea').fill('Ada');
    await page.locator('.field-group', { hasText: 'Ticket id' }).locator('textarea').fill('#4521 (50% done)');
    await page.locator('.field-group', { hasText: 'Message' }).locator('textarea').fill('Line one\nLine two $& %name%');
    const expected = 'Hello Ada,\n\nYour support ticket, #4521 (50% done), has been updated.\n\nLine one\nLine two $& %name%\n\nBye Ada';
    assert.equal(await page.locator('.preview').innerText(), expected);
    await copyButton.click();
    await page.getByText('Copied').waitFor();
    assert.equal(await clipboard(), expected);
    await page.keyboard.press('Escape');

    // Saved template is unchanged, raw copy is exact
    assert.match(await page.locator('.content').innerText(), /Hello %name%,/);
    await page.getByRole('button', { name: 'Copy raw' }).click();
    assert.equal(await clipboard(), 'Hello %name%,\n\nYour support ticket, %ticket_id%, has been updated.\n\n%message%\n\nBye %name%');
    const syntaxLanguage = page.getByLabel('Syntax highlighting');
    await syntaxLanguage.selectOption('markdown');
    await page.waitForFunction(() => document.querySelector('#syntax-language-select')?.value === 'markdown');
    await page.locator('.syntax-highlight').waitFor();
    assert.equal(await page.locator('.content').innerText(), 'Hello %name%,\n\nYour support ticket, %ticket_id%, has been updated.\n\n%message%\n\nBye %name%');
    await page.getByRole('button', { name: 'Copy raw' }).click();
    assert.equal(await clipboard(), 'Hello %name%,\n\nYour support ticket, %ticket_id%, has been updated.\n\n%message%\n\nBye %name%');

    // Plain entry, found by a word deep in its body; keyboard search + Enter copies
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByPlaceholder(/^Content/).fill('Thanks for waiting.\n\nYour refund was processed today.');
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Saved').waitFor();
    assert.equal(await page.locator('.entry h1').innerText(), 'Thanks for waiting.', 'title derived from content');

    const search = page.getByLabel('Search entries');
    await search.fill('refund');
    await page.waitForFunction(() => document.querySelectorAll('.item').length === 1);
    await search.press('Enter');
    assert.equal(await clipboard(), 'Thanks for waiting.\n\nYour refund was processed today.');

    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByPlaceholder(/^Content/).fill('const answer = 42;\nconsole.log(answer);');
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Saved').waitFor();
    await page.getByLabel('Syntax highlighting').selectOption('javascript');
    await page.locator('.syntax-highlight .hljs-keyword').waitFor();

    await search.fill('customer');
    await page.locator('.item', { hasText: 'Customer support follow-up' }).waitFor();
    await page.locator('.item', { hasText: 'Customer support follow-up' }).click();
    await page.waitForFunction(() => document.querySelector('#syntax-language-select')?.value === 'markdown');
    await search.fill('zzzz"(*');
    await page.getByText(/No matches/).waitFor();
    await search.press('Escape');

    // Favorite, delete requires confirmation
    await search.fill('Thanks for waiting');
    await page.waitForFunction(() => document.querySelectorAll('.item').length === 1);
    await page.locator('.item', { hasText: 'Thanks for waiting' }).click();
    await page.getByRole('button', { name: 'Favorite', exact: true }).click();
    await page.getByRole('button', { name: 'Unfavorite' }).waitFor();
    await page.getByRole('button', { name: /^Delete/ }).click();
    await page.getByRole('button', { name: 'Confirm delete' }).click();
    await page.getByText('Deleted').waitFor();
    assert.equal(await page.locator('.item', { hasText: 'Thanks for waiting' }).count(), 0);
    await page.getByText('Select an entry, or press Ctrl+N to create one.').waitFor();
    assert.equal(await page.locator('.content').count(), 0, 'deleted entry content is no longer shown');

    console.log('E2E PASSED');
} finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true });
}
