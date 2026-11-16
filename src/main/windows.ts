import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, nativeImage, Tray, type BrowserWindowConstructorOptions } from 'electron';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VELTO_DEV_SERVER_URL;
const assetsDir = path.resolve(currentDir, '../../../assets');

let libraryWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

export function markQuitting(): void {
    quitting = true;
}

export function isQuitting(): boolean {
    return quitting;
}

export function createSecureWindow(options: BrowserWindowConstructorOptions, route = ''): BrowserWindow {
    const window = new BrowserWindow({
        icon: path.join(assetsDir, 'icon.png'),
        ...options,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: Boolean(devServerUrl),
            preload: path.resolve(currentDir, '../../preload/index.cjs'),
        },
    });

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
        if (!devServerUrl || !url.startsWith(devServerUrl)) {
            event.preventDefault();
        }
    });

    const hash = route ? `#/${route}` : '';
    const loading = devServerUrl
        ? window.loadURL(`${devServerUrl}${hash}`)
        : window.loadFile(path.resolve(currentDir, '../../renderer/index.html'), { hash: route ? `/${route}` : undefined });
    loading.catch((error) => console.error('Failed to load window:', error));

    return window;
}

export function showLibrary(): void {
    if (libraryWindow && !libraryWindow.isDestroyed()) {
        if (libraryWindow.isMinimized()) {
            libraryWindow.restore();
        }
        libraryWindow.show();
        libraryWindow.focus();
        return;
    }

    libraryWindow = createSecureWindow({
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 640,
        backgroundColor: '#f5f5f5',
    });
    libraryWindow.on('focus', () => {
        libraryWindow?.webContents.send('library:shown');
    });

    // Closing the window keeps Velto running in the tray; Quit from the tray menu exits.
    libraryWindow.on('close', (event) => {
        if (!quitting) {
            event.preventDefault();
            libraryWindow?.hide();
        }
    });
    libraryWindow.on('closed', () => {
        libraryWindow = null;
    });
}

export function createTray(actions: { label: string; click: () => void }[]): void {
    if (tray) {
        return;
    }

    const icon = nativeImage.createFromPath(path.join(assetsDir, 'tray.png'));
    tray = new Tray(icon);
    tray.setToolTip('Velto');
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: 'Open Velto', click: showLibrary },
            ...actions,
            { type: 'separator' },
            { label: 'Quit Velto', click: () => app.quit() },
        ]),
    );
    tray.on('click', showLibrary);
}

export function destroyTray(): void {
    tray?.destroy();
    tray = null;
}
