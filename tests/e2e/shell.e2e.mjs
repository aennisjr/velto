import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const sqlite3 = require('sqlite3');

const userData = mkdtempSync(join(tmpdir(), 'velto-shell-'));
const args = ['.', `--user-data-dir=${userData}`];
let app;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForLibrary() {
    for (let attempt = 0; attempt < 100; attempt++) {
        const page = app.windows().find((window) => window.url().includes('index.html') && !/#\/(quick|capture)/.test(window.url()));
        if (page) {
            await page.getByText('Create your first entry').waitFor();
            return page;
        }
        await sleep(100);
    }
    throw new Error('Library window did not open');
}

function readUserVersion(file) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (openError) => {
            if (openError) return reject(openError);
            db.get('PRAGMA user_version', (error, row) => {
                db.close();
                error ? reject(error) : resolve(row.user_version);
            });
        });
    });
}

const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !/#\/(quick|capture)/.test(w.webContents.getURL())).map((w) => ({ visible: w.isVisible(), destroyed: w.isDestroyed() })));

try {
    app = await electron.launch({ args });
    await app.firstWindow();
    await waitForLibrary();

    assert.equal(await readUserVersion(join(userData, 'velto.db')), 3, 'database is at schema version 3');

    // Closing the window hides it to the tray instead of quitting
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !/#\/(quick|capture)/.test(w.webContents.getURL())).close());
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(await windows(), [{ visible: false, destroyed: false }], 'window hidden, app still running');

    // A second launch exits and brings the existing window back
    const second = spawn(electronPath, args, { stdio: 'ignore' });
    const code = await new Promise((resolve) => second.on('exit', resolve));
    assert.equal(code, 0, 'second instance exits');
    await app.evaluate(async () => new Promise((resolve) => setTimeout(resolve, 500)));
    assert.deepEqual(await windows(), [{ visible: true, destroyed: false }], 'second launch shows the existing window');

    // Quit actually exits, even though close hides the window
    const exited = new Promise((resolve) => app.process().once('exit', resolve));
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await exited;
    app = undefined;

    // Reopening against the same data keeps the schema version
    app = await electron.launch({ args });
    await app.firstWindow();
    await waitForLibrary();
    assert.equal(await readUserVersion(join(userData, 'velto.db')), 3);
    await app.close();
    app = undefined;
    console.log('SHELL E2E PASSED');
} finally {
    await app?.close().catch(() => undefined);
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
