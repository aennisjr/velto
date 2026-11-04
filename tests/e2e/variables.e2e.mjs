import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const userData = mkdtempSync(join(tmpdir(), 'velto-variables-'));
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

    // Define variables in the editor
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByPlaceholder(/^Title/).fill('Reply');
    await page.getByPlaceholder(/^Content/).fill('Hi %name%, your %plan% plan renews on %date%.');
    await page.getByText('Variable settings').click();
    await page.getByLabel('Label for name').fill('Customer name');
    await page.getByLabel('Default value for name').fill('Sam');
    await page.getByLabel('Field type for plan').selectOption('dropdown');
    await page.getByLabel('Options for plan').fill('Basic, Pro');
    await page.getByLabel('Field type for date').selectOption('date');
    await page.getByRole('group', { name: '%date%' }).getByLabel('Required').uncheck();
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Saved').waitFor();

    const renderedVariables = page.locator('.content-variable');
    assert.deepEqual(await renderedVariables.allTextContents(), ['%name%', '%plan%', '%date%']);
    assert.equal(await page.locator('.content').innerText(), 'Hi %name%, your %plan% plan renews on %date%.', 'highlight preserves the template text');

    // Use the template: labels, defaults, dropdown, optional date
    await page.getByRole('button', { name: /Use template/i }).click();
    await page.getByText('Customer name').waitFor();
    assert.equal(await page.locator('.field-group textarea').first().inputValue(), 'Sam', 'default is prefilled');
    assert.equal(await page.getByRole('button', { name: /Copy result/ }).isDisabled(), true, 'required dropdown blocks copy');
    await page.locator('.field-group select').selectOption('Pro');
    assert.equal(await page.getByRole('button', { name: /Copy result/ }).isDisabled(), false, 'optional date may stay empty');
    await page.getByRole('button', { name: /Copy result/ }).click();
    await page.getByText(/Copied/).first().waitFor();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'Hi Sam, your Pro plan renews on .');
    await page.getByRole('button', { name: /^Back/ }).click();

    // Definitions survive an edit and are pruned when a placeholder is removed
    const [entry] = await page.evaluate(() => window.velto.listEntries({ view: 'all' }));
    assert.deepEqual(entry.variables.map((variable) => variable.name), ['name', 'plan', 'date']);
    await page.getByRole('button', { name: /^Edit/ }).click();
    await page.getByPlaceholder(/^Content/).fill('Hi %name%.');
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Saved').waitFor();
    const [pruned] = await page.evaluate(() => window.velto.listEntries({ view: 'all' }));
    assert.deepEqual(pruned.variables.map((variable) => variable.name), ['name']);
    assert.equal(pruned.variables[0].label, 'Customer name');

    // Unsaved editor work is recovered after the editor is torn down without saving
    await page.getByRole('button', { name: /^Edit/ }).click();
    await page.getByPlaceholder(/^Content/).fill('Unsaved draft text %name%');
    await page.waitForTimeout(700);
    await page.reload();
    await page.getByText('Reply').first().click();
    await page.getByRole('button', { name: /^Edit/ }).click();
    await page.getByText('Restored your unsaved changes').waitFor();
    assert.equal(await page.getByPlaceholder(/^Content/).inputValue(), 'Unsaved draft text %name%');
    await page.getByRole('button', { name: 'Discard them' }).click();
    assert.equal(await page.getByPlaceholder(/^Content/).inputValue(), 'Hi %name%.');

    console.log('VARIABLES E2E PASSED');
} finally {
    await app?.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
