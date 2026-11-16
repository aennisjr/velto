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
    const { rows: [entry] } = await page.evaluate(() => window.velto.listEntries({ view: 'all' }));
    assert.deepEqual(entry.variables.map((variable) => variable.name), ['name', 'plan', 'date']);
    await page.getByRole('button', { name: /^Edit/ }).click();
    await page.getByPlaceholder(/^Content/).fill('Hi %name%.');
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Saved').waitFor();
    const { rows: [pruned] } = await page.evaluate(() => window.velto.listEntries({ view: 'all' }));
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

    // Additional fields participate in draft recovery and template variables.
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('Field 1 name').fill('Subject');
    await page.getByLabel('Field 1 value').fill('For %name%: %account%');
    await page.waitForTimeout(700);
    await page.reload();
    await page.getByText('Reply').first().click();
    await page.getByRole('button', { name: /^Edit/ }).click();
    await page.getByText('Restored your unsaved changes').waitFor();
    assert.equal(await page.getByLabel('Field 1 value').inputValue(), 'For %name%: %account%');
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Saved').waitFor();
    const rawField = page.getByRole('region', { name: 'Subject' });
    const rawValueBox = await rawField.locator('.preview').boundingBox();
    const rawButtonBox = await rawField.getByRole('button', { name: 'Copy Subject raw' }).boundingBox();
    assert.equal(await rawField.getByRole('button', { name: 'Copy Subject raw' }).innerText(), 'Copy');
    assert.ok(rawButtonBox.x >= rawValueBox.x + rawValueBox.width && rawButtonBox.y < rawValueBox.y + rawValueBox.height, 'raw field copy is beside its value');
    await page.getByRole('button', { name: 'Copy Subject raw' }).click();
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent === 'Copied');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'For %name%: %account%');
    await page.getByRole('button', { name: /Use template/i }).click();
    assert.equal(await page.locator('.field-group').count(), 2, 'shared placeholder appears once');
    const bodyPreviewBox = await page.locator('.template-use > .preview').boundingBox();
    const copyResultBox = await page.getByRole('button', { name: /Copy result/ }).boundingBox();
    const subjectBox = await page.getByRole('region', { name: 'Subject' }).boundingBox();
    assert.ok(bodyPreviewBox.y + bodyPreviewBox.height <= copyResultBox.y, 'copy result is below the content preview');
    assert.ok(copyResultBox.y + copyResultBox.height <= subjectBox.y, 'additional fields follow the copy result button');
    const subjectValueBox = await page.getByRole('region', { name: 'Subject' }).locator('.preview').boundingBox();
    const subjectCopyBox = await page.getByRole('button', { name: 'Copy Subject' }).boundingBox();
    assert.equal(await page.getByRole('button', { name: 'Copy Subject' }).innerText(), 'Copy');
    assert.ok(subjectCopyBox.x >= subjectValueBox.x + subjectValueBox.width && subjectCopyBox.y < subjectValueBox.y + subjectValueBox.height, 'template field copy is beside its value');
    assert.equal(await page.getByRole('button', { name: 'Copy Subject' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: /Copy result/ }).isDisabled(), false, 'body copy is independent of field-only variables');
    await page.locator('.field-group', { hasText: 'Account' }).locator('textarea').fill('A-42');
    await page.getByRole('button', { name: 'Copy Subject' }).click();
    await page.waitForTimeout(150);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'For Sam: A-42');
    await page.getByRole('button', { name: /^Back/ }).click();
    await page.getByLabel('Search entries').fill('account');
    await page.locator('.item', { hasText: 'Reply' }).waitFor();

    // Ordinary entries also expose individually copyable fields and support removing them.
    await page.getByRole('button', { name: 'New entry' }).click();
    await page.getByPlaceholder(/^Title/).fill('Plain entry');
    await page.getByPlaceholder(/^Content/).fill('Plain body');
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByLabel('Field 1 name').fill('Reference');
    await page.getByLabel('Field 1 value').fill('ABC-123');
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Saved').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Copy Reference' }).innerText(), 'Copy');
    await page.getByRole('button', { name: 'Copy Reference' }).click();
    await page.waitForTimeout(150);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'ABC-123');
    await page.getByRole('button', { name: /^Edit/ }).click();
    await page.getByRole('button', { name: 'Remove field' }).click();
    await page.getByRole('button', { name: /^Save/ }).click();
    await page.getByText('Saved').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Copy Reference' }).count(), 0);

    console.log('VARIABLES E2E PASSED');
} finally {
    await app?.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
