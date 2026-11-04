import path from 'node:path';
import { app, Menu } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { closeDatabase, initializeDatabase, type VeltoDatabase } from '../database/index.js';
import { AUTO_BACKUP_INTERVAL_MS, runAutoBackup } from './backup.js';
import { applyStoredSettings, HIDDEN_FLAG } from './appSettings.js';
import { loadSettings } from '../database/settingsRepository.js';
import { registerIpc } from './ipc.js';
import { preparePopups, quickCapture, quickSearch, unregisterShortcuts } from './shortcutManager.js';
import { createTray, destroyTray, markQuitting, showLibrary } from './windows.js';

const QUICK_SEARCH_FLAG = '--quick-search';
const QUICK_CAPTURE_FLAG = '--quick-capture';

let db: VeltoDatabase | null = null;
let backupTimer: NodeJS.Timeout | null = null;

function configureApplicationMenu(): void {
    const template = [];
    if (process.platform === 'darwin') {
        template.push({ role: 'appMenu' as const });
    }
    template.push({ role: 'fileMenu' as const }, { role: 'editMenu' as const });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function backupIfDue(): Promise<void> {
    if (!db) {
        return;
    }
    try {
        if ((await loadSettings(db)).autoBackup) {
            await runAutoBackup(db, path.join(app.getPath('userData'), 'backups'), app.getVersion());
        }
    } catch (error) {
        console.error('Automatic backup failed:', error);
    }
}

async function startApplication(): Promise<void> {
    db = await initializeDatabase();
    registerIpc(db, path.join(app.getPath('userData'), 'velto.db'));
    createTray([
        { label: 'Quick Search', click: quickSearch.toggle },
        { label: 'Quick Capture', click: quickCapture.toggle },
    ]);
    // Started from the login item, Velto stays in the tray until it is needed.
    if (!process.argv.includes(HIDDEN_FLAG)) {
        showLibrary();
    }
    preparePopups();
    await applyStoredSettings(db);

    void backupIfDue();
    backupTimer = setInterval(() => void backupIfDue(), AUTO_BACKUP_INTERVAL_MS / 4);
    backupTimer.unref();
}

if (squirrelStartup) {
    app.quit();
} else if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    // `velto --quick-search` and `--quick-capture` let other tools bind their own hotkey.
    app.on('second-instance', (_event, argv) => {
        if (argv.includes(QUICK_SEARCH_FLAG)) {
            quickSearch.toggle();
        } else if (argv.includes(QUICK_CAPTURE_FLAG)) {
            quickCapture.toggle();
        } else {
            showLibrary();
        }
    });

    app.whenReady().then(() => {
        configureApplicationMenu();
        void startApplication().catch((error) => {
            console.error('Failed to start Velto application:', error);
            app.quit();
        });

        app.on('activate', () => showLibrary());
    });

    app.on('before-quit', () => {
        markQuitting();
        unregisterShortcuts();
        destroyTray();
        if (backupTimer) {
            clearInterval(backupTimer);
        }
        if (db) {
            const closing = db;
            db = null;
            void closeDatabase(closing).catch(() => undefined);
        }
    });

    // Velto keeps running in the tray when every window is closed.
    app.on('window-all-closed', () => undefined);
}
