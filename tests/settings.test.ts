import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type sqlite3 from 'sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openTestDatabase } from './testDatabase.js';
import { createEntry } from '../src/database/entryRepository.js';
import { loadSettings, saveSettings } from '../src/database/settingsRepository.js';
import { AcceleratorSchema, DEFAULT_SETTINGS } from '../src/shared/settings.js';
import { createBackup, describeBackups, rotateAutoBackups, runAutoBackup } from '../src/main/backup.js';
import { LibraryEntryDraftSchema } from '../src/shared/validators.js';
import { LibraryFileSchema } from '../src/shared/portability.js';
import { readFileSync } from 'node:fs';

const open: sqlite3.Database[] = [];
const directories: string[] = [];

async function createDatabase(): Promise<sqlite3.Database> {
    const db = await openTestDatabase();
    open.push(db);
    return db;
}

function tempDirectory(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'velto-settings-'));
    directories.push(directory);
    return directory;
}

afterEach(() => {
    for (const db of open.splice(0)) {
        db.close();
    }
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('settings', () => {
    it('returns defaults when nothing is stored', async () => {
        expect(await loadSettings(await createDatabase())).toEqual(DEFAULT_SETTINGS);
    });

    it('merges partial updates and persists them', async () => {
        const db = await createDatabase();
        await saveSettings(db, { shortcuts: { quickCapture: 'Control+Shift+K' } });
        const settings = await saveSettings(db, { launchAtLogin: true });
        expect(settings.shortcuts).toEqual({ quickSearch: DEFAULT_SETTINGS.shortcuts.quickSearch, quickCapture: 'Control+Shift+K' });
        expect(await loadSettings(db)).toEqual(settings);
        expect(settings.launchAtLogin).toBe(true);
    });

    it('rejects invalid shortcuts, unknown shapes and duplicate shortcuts', async () => {
        const db = await createDatabase();
        await expect(saveSettings(db, { shortcuts: { quickSearch: 'Space' } })).rejects.toThrow();
        await expect(saveSettings(db, { shortcuts: { quickSearch: 'Control+Foo' } })).rejects.toThrow();
        await expect(saveSettings(db, { autoBackup: 'yes' })).rejects.toThrow();
        await expect(saveSettings(db, { shortcuts: { quickCapture: 'Shift+Ctrl+Space' } })).rejects.toThrow(/different/);
        expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
    });

    it('falls back to defaults for corrupt stored values', async () => {
        const db = await createDatabase();
        await new Promise<void>((resolve, reject) =>
            db.run("INSERT INTO settings (key, value) VALUES ('app', ?)", [JSON.stringify({ shortcuts: { quickSearch: 'nope' }, launchAtLogin: 'x' })], (error) =>
                error ? reject(error) : resolve(),
            ),
        );
        expect(await loadSettings(db)).toEqual(DEFAULT_SETTINGS);
    });

    it.each(['Control+Alt+N', 'Control+Shift+Space', 'Alt+F12', 'Control+Shift+Alt+Up'])('accepts %s', (value) => {
        expect(AcceleratorSchema.safeParse(value).success).toBe(true);
    });

    it.each(['N', 'Control', 'Control+', 'Control+nn', 'Control+Alt+Shift+Control+Super+N', 'Meta+N', ''])('rejects "%s"', (value) => {
        expect(AcceleratorSchema.safeParse(value).success).toBe(false);
    });
});

describe('backups', () => {
    const draft = () => LibraryEntryDraftSchema.parse({ title: 'Kept', content: 'Some text' });

    it('writes a valid library file', async () => {
        const db = await createDatabase();
        await createEntry(db, draft());
        const directory = tempDirectory();
        const result = await createBackup(db, directory, '1.0.0', 'manual');
        expect(result.count).toBe(1);
        const parsed = LibraryFileSchema.parse(JSON.parse(readFileSync(result.path, 'utf8')));
        expect(parsed.entries[0].title).toBe('Kept');
        expect(readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(false);
    });

    it('skips empty libraries and recent backups', async () => {
        const db = await createDatabase();
        const directory = tempDirectory();
        expect(await runAutoBackup(db, directory, '1.0.0')).toBeNull();
        await createEntry(db, draft());
        expect(await runAutoBackup(db, directory, '1.0.0')).not.toBeNull();
        expect(await runAutoBackup(db, directory, '1.0.0')).toBeNull();
        const later = new Date(Date.now() + 21 * 60 * 60 * 1000);
        expect(await runAutoBackup(db, directory, '1.0.0', later)).not.toBeNull();
    });

    it('keeps only the newest automatic backups and never touches manual ones', async () => {
        const directory = tempDirectory();
        for (let day = 1; day <= 5; day++) {
            const file = path.join(directory, `velto-auto-2026-01-0${day}T00-00-00.velto`);
            writeFileSync(file, '{}');
            const time = new Date(`2026-01-0${day}T00:00:00Z`);
            utimesSync(file, time, time);
        }
        writeFileSync(path.join(directory, 'velto-backup-manual.velto'), '{}');
        writeFileSync(path.join(directory, 'unrelated.txt'), 'x');

        expect(await rotateAutoBackups(directory, 2)).toBe(3);
        expect(readdirSync(directory).sort()).toEqual([
            'unrelated.txt',
            'velto-auto-2026-01-04T00-00-00.velto',
            'velto-auto-2026-01-05T00-00-00.velto',
            'velto-backup-manual.velto',
        ]);
    });

    it('describes a missing folder as empty', async () => {
        const info = await describeBackups(path.join(tempDirectory(), 'nope'));
        expect(info).toMatchObject({ latest: null, count: 0 });
    });
});
