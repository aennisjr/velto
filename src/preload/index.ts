import { contextBridge, ipcRenderer } from 'electron';
import type { VeltoApi } from '../shared/api.js';

function subscribe(channel: string, listener: () => void): () => void {
    const handler = () => listener();
    ipcRenderer.on(channel, handler);
    return () => {
        ipcRenderer.removeListener(channel, handler);
    };
}

const api: VeltoApi = {
    platform: process.platform,
    hideQuickSearch: () => ipcRenderer.invoke('quick:hide'),
    openLibrary: () => ipcRenderer.invoke('app:open-library'),
    hideQuickCapture: () => ipcRenderer.invoke('capture:hide'),
    onQuickSearchShown: (listener) => subscribe('quick:shown', listener),
    onQuickCaptureShown: (listener) => subscribe('capture:shown', listener),
    onLibraryShown: (listener) => subscribe('library:shown', listener),
    readClipboard: () => ipcRenderer.invoke('clipboard:read'),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
    backupInfo: () => ipcRenderer.invoke('backup:info'),
    backupNow: () => ipcRenderer.invoke('backup:now'),
    openBackupFolder: () => ipcRenderer.invoke('backup:open-folder'),
    exportLibrary: () => ipcRenderer.invoke('library:export'),
    chooseImportFile: () => ipcRenderer.invoke('library:choose-import'),
    applyImport: (mode) => ipcRenderer.invoke('library:apply-import', mode),
    cancelImport: () => ipcRenderer.invoke('library:cancel-import'),
    appVersion: () => ipcRenderer.invoke('app:get-version'),
    databaseStatus: () => ipcRenderer.invoke('database:status'),
    listEntries: (filter) => ipcRenderer.invoke('entries:list', filter),
    searchEntries: (query) => ipcRenderer.invoke('entries:search', query),
    listTags: () => ipcRenderer.invoke('entries:tags'),
    listCategories: () => ipcRenderer.invoke('categories:list'),
    createCategory: (name) => ipcRenderer.invoke('categories:create', name),
    renameCategory: (id, name) => ipcRenderer.invoke('categories:rename', { id, name }),
    deleteCategory: (id) => ipcRenderer.invoke('categories:delete', id),
    listTagUsage: () => ipcRenderer.invoke('tags:usage'),
    renameTag: (name, newName) => ipcRenderer.invoke('tags:rename', { name, newName }),
    deleteTag: (name) => ipcRenderer.invoke('tags:delete', name),
    createEntry: (draft) => ipcRenderer.invoke('entries:create', draft),
    updateEntry: (draft) => ipcRenderer.invoke('entries:update', draft),
    deleteEntry: (id) => ipcRenderer.invoke('entries:delete', id),
    deleteEntries: (ids) => ipcRenderer.invoke('entries:delete-many', ids),
    duplicateEntry: (id) => ipcRenderer.invoke('entries:duplicate', id),
    toggleFavorite: (id) => ipcRenderer.invoke('entries:toggle-favorite', id),
    copyText: (payload) => ipcRenderer.invoke('clipboard:copy', payload),
};

contextBridge.exposeInMainWorld('velto', api);
