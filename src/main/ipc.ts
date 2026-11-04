import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import type { Database } from 'sqlite3';
import * as repo from '../database/entryRepository.js';
import * as organizer from '../database/organizerRepository.js';
import { applyImport, buildLibraryFile, previewImport } from '../database/portability.js';
import { getSettingsState, updateSettings } from './appSettings.js';
import { createBackup, describeBackups } from './backup.js';
import { quickCapture, quickSearch } from './shortcutManager.js';
import { showLibrary } from './windows.js';
import {
    ImportModeSchema,
    LibraryFileSchema,
    MAX_IMPORT_BYTES,
    type ExportResult,
    type ImportPreview,
    type ImportResult,
    type LibraryFile,
} from '../shared/portability.js';
import {
    CopyPayloadSchema,
    EntryIdSchema,
    EntryIdsSchema,
    LibraryEntryDraftSchema,
    ListFilterSchema,
    NameSchema,
    RenameCategorySchema,
    RenameTagSchema,
    SearchQuerySchema,
} from '../shared/validators.js';

const FILE_FILTERS = [{ name: 'Velto library', extensions: ['velto', 'json'] }];

function timestampForFile(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function registerIpc(db: Database, dbPath: string): void {
    // The file chosen for import stays in the main process; the renderer only ever sees a preview.
    let pendingImport: { file: LibraryFile; fileName: string } | null = null;

    ipcMain.handle('app:get-version', () => app.getVersion());
    ipcMain.handle('database:status', () => ({ ready: true, path: dbPath }));
    const backupDirectory = path.join(app.getPath('userData'), 'backups');

    ipcMain.handle('quick:hide', () => quickSearch.hide());
    ipcMain.handle('capture:hide', () => quickCapture.hide());
    ipcMain.handle('settings:get', () => getSettingsState(db));
    ipcMain.handle('settings:update', (_event, patch: unknown) => updateSettings(db, patch));
    ipcMain.handle('backup:info', () => describeBackups(backupDirectory));
    ipcMain.handle('backup:now', async () => {
        const result = await createBackup(db, backupDirectory, app.getVersion(), 'manual');
        return { ...result, info: await describeBackups(backupDirectory) };
    });
    ipcMain.handle('backup:open-folder', async () => {
        await mkdir(backupDirectory, { recursive: true });
        await shell.openPath(backupDirectory);
    });
    ipcMain.handle('clipboard:read', async () => (await clipboard.readText()).slice(0, 500000));
    ipcMain.handle('app:open-library', () => {
        quickSearch.hide();
        quickCapture.hide();
        showLibrary();
    });

    ipcMain.handle('library:export', async (event): Promise<ExportResult | null> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const options = {
            title: 'Export library',
            defaultPath: `velto-library-${timestampForFile()}.velto`,
            filters: FILE_FILTERS,
        };
        const choice = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
        if (choice.canceled || !choice.filePath) {
            return null;
        }

        const file = await buildLibraryFile(db, app.getVersion());
        await writeFile(choice.filePath, JSON.stringify(file, null, 2), 'utf8');
        return { path: choice.filePath, count: file.entries.length };
    });

    ipcMain.handle('library:choose-import', async (event): Promise<ImportPreview | null> => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const options = { title: 'Import library', properties: ['openFile' as const], filters: FILE_FILTERS };
        const choice = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
        if (choice.canceled || choice.filePaths.length === 0) {
            return null;
        }

        const filePath = choice.filePaths[0];
        if ((await stat(filePath)).size > MAX_IMPORT_BYTES) {
            throw new Error('That file is too large to import.');
        }

        let json: unknown;
        try {
            json = JSON.parse(await readFile(filePath, 'utf8'));
        } catch {
            throw new Error('That file is not a valid Velto library.');
        }

        const parsed = LibraryFileSchema.safeParse(json);
        if (!parsed.success) {
            throw new Error('That file is not a valid Velto library, or it comes from a newer version of Velto.');
        }

        const fileName = path.basename(filePath);
        pendingImport = { file: parsed.data, fileName };
        return previewImport(db, parsed.data, fileName);
    });

    ipcMain.handle('library:apply-import', async (_event, mode: unknown): Promise<ImportResult> => {
        const parsedMode = ImportModeSchema.parse(mode);
        if (!pendingImport) {
            throw new Error('Choose a file to import first.');
        }

        const { file } = pendingImport;
        let backupPath: string | undefined;
        if (parsedMode === 'replace') {
            const backupDir = path.join(app.getPath('userData'), 'backups');
            await mkdir(backupDir, { recursive: true });
            backupPath = path.join(backupDir, `velto-before-replace-${timestampForFile()}.velto`);
            await writeFile(backupPath, JSON.stringify(await buildLibraryFile(db, app.getVersion())), 'utf8');
        }

        const result = await applyImport(db, file, parsedMode);
        pendingImport = null;
        return { ...result, backupPath };
    });

    ipcMain.handle('library:cancel-import', () => {
        pendingImport = null;
    });

    ipcMain.handle('entries:list', (_event, filter: unknown) => repo.listEntries(db, ListFilterSchema.parse(filter)));
    ipcMain.handle('entries:search', (_event, query: unknown) => repo.searchEntries(db, SearchQuerySchema.parse(query)));
    ipcMain.handle('entries:tags', () => repo.listTags(db));
    ipcMain.handle('categories:list', () => organizer.listCategories(db));
    ipcMain.handle('categories:create', (_event, name: unknown) => organizer.createCategory(db, NameSchema.parse(name)));
    ipcMain.handle('categories:rename', (_event, payload: unknown) => {
        const { id, name } = RenameCategorySchema.parse(payload);
        return organizer.renameCategory(db, id, name);
    });
    ipcMain.handle('categories:delete', (_event, id: unknown) => organizer.deleteCategory(db, EntryIdSchema.parse(id)));
    ipcMain.handle('tags:usage', () => organizer.listTagUsage(db));
    ipcMain.handle('tags:rename', (_event, payload: unknown) => {
        const { name, newName } = RenameTagSchema.parse(payload);
        return organizer.renameTag(db, name, newName);
    });
    ipcMain.handle('tags:delete', (_event, name: unknown) => organizer.deleteTag(db, NameSchema.parse(name)));
    ipcMain.handle('entries:create', (_event, draft: unknown) => repo.createEntry(db, LibraryEntryDraftSchema.parse(draft)));
    ipcMain.handle('entries:update', (_event, draft: unknown) => {
        const parsed = LibraryEntryDraftSchema.required({ id: true }).parse(draft);
        return repo.updateEntry(db, parsed as typeof parsed & { id: string });
    });
    ipcMain.handle('entries:delete', (_event, id: unknown) => repo.deleteEntry(db, EntryIdSchema.parse(id)));
    ipcMain.handle('entries:delete-many', (_event, ids: unknown) => repo.deleteEntries(db, EntryIdsSchema.parse(ids)));
    ipcMain.handle('entries:duplicate', (_event, id: unknown) => repo.duplicateEntry(db, EntryIdSchema.parse(id)));
    ipcMain.handle('entries:toggle-favorite', (_event, id: unknown) => repo.toggleFavorite(db, EntryIdSchema.parse(id)));

    ipcMain.handle('clipboard:copy', async (_event, payload: unknown) => {
        const { text, entryId } = CopyPayloadSchema.parse(payload);
        clipboard.writeText(text);
        if (entryId) {
            await repo.recordUse(db, entryId);
        }
    });
}
