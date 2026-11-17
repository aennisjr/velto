// After the installer finishes, Squirrel launches Velto with --squirrel-firstrun. That launch must
// confirm the install and explain where Velto lives; ordinary launches must not.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const userData = mkdtempSync(join(tmpdir(), 'velto-welcome-'));
let app;

async function launch(...extra) {
    app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`, ...extra] });
    // Quick Search and Quick Capture windows are created hidden at startup, so pick the library by URL.
    for (let attempt = 0; attempt < 100; attempt++) {
        const page = app.windows().find((window) => window.url().includes('index.html') && !/#\/(quick|capture)/.test(window.url()));
        if (page) {
            await page.getByText('Create your first entry').first().waitFor();
            return page;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Library window did not open');
}

try {
    let page = await launch('--squirrel-firstrun');
    const welcome = page.getByRole('dialog', { name: 'Velto is installed' });
    await welcome.waitFor();
    await welcome.getByText(/system tray/i).waitFor();
    await welcome.getByText(/Start menu/i).waitFor();
    // The shortcuts shown are the ones actually registered, which may be a fallback.
    const shortcuts = await page.evaluate(async () => (await window.velto.getSettings()).shortcuts);
    for (const status of Object.values(shortcuts)) {
        const shown = status.active ? status.active.replace(/\+/g, ' + ') : 'Not set';
        await welcome.getByText(shown, { exact: true }).waitFor();
    }

    // The primary button is focused, so Enter dismisses the dialog.
    const start = welcome.getByRole('button', { name: 'Get started' });
    assert.ok(await start.evaluate((element) => element === document.activeElement), 'Get started should have focus');
    await page.keyboard.press('Enter');
    await welcome.waitFor({ state: 'detached' });

    // Reopening the library window in the same session does not show it again.
    await page.reload();
    await page.getByText('Create your first entry').first().waitFor();
    assert.equal(await page.getByRole('dialog', { name: 'Velto is installed' }).count(), 0);
    await app.close();

    // Escape also dismisses it.
    page = await launch('--squirrel-firstrun');
    await page.getByRole('dialog', { name: 'Velto is installed' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Velto is installed' }).waitFor({ state: 'detached' });
    await app.close();

    // An ordinary launch never shows it.
    page = await launch();
    await page.waitForTimeout(500);
    assert.equal(await page.getByRole('dialog', { name: 'Velto is installed' }).count(), 0);
    await app.close();
    app = undefined;

    console.log('WELCOME E2E PASSED');
} finally {
    await app?.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true });
}
