import type { Database } from 'sqlite3';
import { canonicalAccelerator, DEFAULT_SETTINGS, SettingsPatchSchema, SettingsSchema, type AppSettings, type SettingsPatch } from '../shared/settings.js';
import { all, run } from './entryRepository.js';

const KEY = 'app';

export async function loadSettings(db: Database): Promise<AppSettings> {
    const rows = await all(db, 'SELECT value FROM settings WHERE key = ?', [KEY]);
    if (rows.length === 0) {
        return structuredClone(DEFAULT_SETTINGS);
    }

    try {
        return SettingsSchema.parse(JSON.parse(String(rows[0].value)));
    } catch {
        return structuredClone(DEFAULT_SETTINGS);
    }
}

export async function saveSettings(db: Database, patch: unknown): Promise<AppSettings> {
    const parsed: SettingsPatch = SettingsPatchSchema.parse(patch);
    const current = await loadSettings(db);
    const next: AppSettings = {
        ...current,
        ...parsed,
        shortcuts: { ...current.shortcuts, ...parsed.shortcuts },
    };

    if (canonicalAccelerator(next.shortcuts.quickSearch) === canonicalAccelerator(next.shortcuts.quickCapture)) {
        throw new Error('Quick Search and Quick Capture need different shortcuts.');
    }

    await run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        KEY,
        JSON.stringify(next),
    ]);
    return next;
}
