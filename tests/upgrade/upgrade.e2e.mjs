// Upgrade test: a library created by an older packaged build must open intact in the current packaged build.
//
// Usage: node tests/upgrade/upgrade.e2e.mjs [--from <git ref>] [--skip-build]
//   --from        baseline to upgrade from (default: newest v* tag, else the root commit)
//   --skip-build  reuse out/velto-win32-x64 instead of repackaging the current tree
//
// Each app runs against a throwaway --user-data-dir, so an installed copy of Velto and its library are never touched.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sqlite3 from 'sqlite3';
import { _electron as electron } from 'playwright';

const repo = resolve(import.meta.dirname, '../..');
const cacheRoot = join(repo, '.upgrade-cache');
const packagedDir = 'out/velto-win32-x64';
const exeName = process.platform === 'win32' ? 'velto.exe' : 'velto';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const argv = process.argv.slice(2);
const option = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
};

const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const sh = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

function defaultBaseline() {
    const tag = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').find(Boolean);
    return tag ?? git('rev-list', '--max-parents=0', 'HEAD').split('\n')[0];
}

function buildBaseline(ref) {
    const sha = git('rev-parse', '--verify', `${ref}^{commit}`);
    const cached = join(cacheRoot, sha);
    if (existsSync(join(cached, exeName))) {
        console.log(`Using cached baseline ${ref} (${sha.slice(0, 7)})`);
        return cached;
    }
    console.log(`Packaging baseline ${ref} (${sha.slice(0, 7)})…`);
    const worktree = mkdtempSync(join(tmpdir(), 'velto-baseline-'));
    rmSync(worktree, { recursive: true, force: true });
    git('worktree', 'add', '--detach', worktree, sha);
    try {
        sh(npm, ['ci', '--no-audit', '--no-fund'], worktree);
        sh(npm, ['run', 'package'], worktree);
        mkdirSync(cacheRoot, { recursive: true });
        cpSync(join(worktree, packagedDir), cached, { recursive: true });
    } finally {
        git('worktree', 'remove', '--force', worktree);
    }
    return cached;
}

function buildCurrent() {
    if (!argv.includes('--skip-build')) {
        console.log('Packaging current tree…');
        sh(npm, ['run', 'package'], repo);
    }
    return join(repo, packagedDir);
}

async function launch(appDir, userData) {
    const app = await electron.launch({ executablePath: join(appDir, exeName), args: [`--user-data-dir=${userData}`] });
    const page = await app.firstWindow();
    await page.waitForFunction(async () => (await window.velto.databaseStatus()).ready, null, { timeout: 30_000 });
    return { app, page };
}

function readDb(file, sql) {
    return new Promise((resolveRows, reject) => {
        const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (openError) => {
            if (openError) {
                reject(openError);
                return;
            }
            db.all(sql, (error, rows) => db.close(() => (error ? reject(error) : resolveRows(rows))));
        });
    });
}

const versionParts = (version) => version.split(/[.-]/).slice(0, 3).map(Number);
const isNewer = (next, previous) => {
    const [a, b] = [versionParts(next), versionParts(previous)];
    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
};

const baselineRef = option('--from') ?? defaultBaseline();
const baselineDir = buildBaseline(baselineRef);
const currentDir = buildCurrent();
const userData = mkdtempSync(join(tmpdir(), 'velto-upgrade-'));
const dbFile = join(userData, 'velto.db');
const open = [];

try {
    // 1. Create a varied library with the baseline build.
    const before = await launch(baselineDir, userData);
    open.push(before.app);
    const seeded = await before.page.evaluate(async () => {
        const v = window.velto;
        const support = await v.createCategory('Support');
        await v.createEntry({
            title: 'Refund processed',
            content: 'Hi %name%, your refund of %amount% has been sent.',
            category_id: support.id,
            tags: ['billing', 'customers'],
            is_template: true,
            variables: [
                { name: 'name', label: 'Customer name', required: true, field_type: 'text' },
                { name: 'amount', label: 'Amount', default_value: '10', required: false, field_type: 'number' },
            ],
        });
        const meeting = await v.createEntry({ title: 'Meeting move', content: 'Can we meet later today?', tags: ['scheduling'] });
        await v.toggleFavorite(meeting.id);
        const archived = await v.createEntry({ title: 'Old policy', content: 'Returns within 14 days.', tags: ['legacy'] });
        await v.updateEntry({ ...archived, is_archived: true });
        await v.createEntry({ title: 'Debounce helper', content: 'const debounce = (fn, ms) => fn;', syntax_language: 'javascript' });
        await v.createEntry({ title: 'Unicode note', content: 'Café ☕ — naïve 日本語 emoji 🎉', description: 'Non-ASCII content' });
        // Leave an unused tag behind; the baseline keeps it, the upgrade should remove it.
        const temp = await v.createEntry({ title: 'Tag churn', content: 'Temporary tags', tags: ['temporary'] });
        await v.updateEntry({ ...temp, tags: [] });
        await v.updateSettings({ autoBackup: false });

        const rows = (result) => (Array.isArray(result) ? result : result.rows);
        const all = [...rows(await v.listEntries({ view: 'all' })), ...rows(await v.listEntries({ view: 'archived' }))];
        return {
            version: await v.appVersion(),
            entries: Object.fromEntries(all.map((entry) => [entry.title, entry])),
            categories: await v.listCategories(),
            tagUsage: await v.listTagUsage(),
        };
    });
    await before.app.close();
    open.length = 0;

    const baselineSchema = (await readDb(dbFile, 'PRAGMA user_version'))[0].user_version;
    assert.equal(Object.keys(seeded.entries).length, 6, 'baseline should hold six entries');
    assert.ok(seeded.tagUsage.some((tag) => tag.name === 'temporary'), 'baseline should keep the unused tag');

    // 2. Open the same library with the current build.
    const after = await launch(currentDir, userData);
    open.push(after.app);
    const upgraded = await after.page.evaluate(async () => {
        const v = window.velto;
        const rows = (result) => (Array.isArray(result) ? result : result.rows);
        const all = [...rows(await v.listEntries({ view: 'all' })), ...rows(await v.listEntries({ view: 'archived' }))];
        return {
            version: await v.appVersion(),
            entries: Object.fromEntries(all.map((entry) => [entry.title, entry])),
            categories: await v.listCategories(),
            tagUsage: await v.listTagUsage(),
            settings: (await v.getSettings()).settings,
            search: rows(await v.searchEntries('refund')).map((result) => result.entry?.title ?? result.title),
            unicodeSearch: rows(await v.searchEntries('naïve')).length,
        };
    });

    // Every entry survives with its content and metadata unchanged.
    assert.deepEqual(Object.keys(upgraded.entries).sort(), Object.keys(seeded.entries).sort());
    for (const [title, old] of Object.entries(seeded.entries)) {
        const now = upgraded.entries[title];
        for (const key of Object.keys(old)) {
            assert.deepEqual(now[key], old[key], `"${title}" changed ${key} during upgrade`);
        }
        assert.deepEqual(now.fields, [], `"${title}" should start with no additional fields`);
    }
    assert.deepEqual(upgraded.categories, seeded.categories);
    assert.deepEqual(
        upgraded.tagUsage.map((tag) => tag.name),
        seeded.tagUsage.map((tag) => tag.name).filter((name) => name !== 'temporary'),
        'only the unused tag should be removed',
    );
    // Archived entries now count toward tag usage (the baseline reported 0 for them).
    assert.deepEqual(upgraded.tagUsage.find((tag) => tag.name === 'legacy'), { name: 'legacy', count: 1 });
    assert.equal(upgraded.settings.autoBackup, false, 'settings should carry over');
    assert.ok(upgraded.search.includes('Refund processed'), 'full-text search should work on upgraded entries');
    assert.equal(upgraded.unicodeSearch, 1, 'search should match non-ASCII content');

    // The library window renders the upgraded, non-archived entries.
    await after.page.waitForFunction(() => document.querySelectorAll('.item').length === 5);

    // New features work on upgraded entries and persist across restarts.
    await after.page.evaluate(async () => {
        const v = window.velto;
        const { rows } = await v.listEntries({ view: 'all' });
        const refund = rows.find((entry) => entry.title === 'Refund processed');
        await v.updateEntry({ ...refund, fields: [{ label: 'Subject', value: 'Refund for %name%' }] });
    });
    await after.app.close();
    open.length = 0;

    const schema = (await readDb(dbFile, 'PRAGMA user_version'))[0].user_version;
    const integrity = (await readDb(dbFile, 'PRAGMA integrity_check'))[0].integrity_check;
    assert.equal(integrity, 'ok');

    const again = await launch(currentDir, userData);
    open.push(again.app);
    const fields = await again.page.evaluate(async () => {
        const { rows } = await window.velto.listEntries({ view: 'all' });
        return rows.find((entry) => entry.title === 'Refund processed').fields;
    });
    assert.deepEqual(fields, [{ label: 'Subject', value: 'Refund for %name%' }]);
    await again.app.close();
    open.length = 0;

    console.log(`Upgraded ${baselineRef} (v${seeded.version}, schema ${baselineSchema}) → current (v${upgraded.version}, schema ${schema})`);
    if (!isNewer(upgraded.version, seeded.version)) {
        console.warn(
            `WARNING: package.json version ${upgraded.version} is not newer than the baseline's ${seeded.version}. ` +
                'Squirrel will not offer this build as an update; bump the version before releasing.',
        );
    }
    console.log('UPGRADE E2E PASSED');
} finally {
    await Promise.all(open.map((app) => app.close().catch(() => undefined)));
    rmSync(userData, { recursive: true, force: true });
}
