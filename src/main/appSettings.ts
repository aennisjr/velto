import { app } from 'electron';
import type { Database } from 'sqlite3';
import { loadSettings, saveSettings } from '../database/settingsRepository.js';
import type { SettingsState } from '../shared/settings.js';
import { applyShortcuts, getShortcutState } from './shortcutManager.js';

export const HIDDEN_FLAG = '--hidden';

// Registering the dev Electron binary as a login item would start the wrong program.
function launchAtLoginAvailable(): boolean {
    return app.isPackaged && process.platform === 'win32';
}

async function apply(db: Database): Promise<SettingsState> {
    const settings = await loadSettings(db);
    const shortcuts = applyShortcuts(settings.shortcuts);
    const available = launchAtLoginAvailable();
    if (available) {
        app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, args: [HIDDEN_FLAG] });
    }
    return { settings, shortcuts, launchAtLoginAvailable: available };
}

export const applyStoredSettings = apply;

export async function getSettingsState(db: Database): Promise<SettingsState> {
    return { settings: await loadSettings(db), shortcuts: getShortcutState(), launchAtLoginAvailable: launchAtLoginAvailable() };
}

export async function updateSettings(db: Database, patch: unknown): Promise<SettingsState> {
    await saveSettings(db, patch);
    return apply(db);
}
