import type { Category, CategorySummary, EntryResults, LibraryEntry, ListFilter, SearchResult, TagSummary } from './types.js';
import type { SyntaxLanguage } from './syntaxLanguages.js';
import type { ExportResult, ImportMode, ImportPreview, ImportResult } from './portability.js';
import type { BackupInfo, SettingsPatch, SettingsState } from './settings.js';
import type { LibraryEntryDraft } from './validators.js';

export interface VeltoApi {
    platform: string;
    hideQuickSearch(): Promise<void>;
    openLibrary(): Promise<void>;
    hideQuickCapture(): Promise<void>;
    onQuickSearchShown(listener: () => void): () => void;
    onQuickCaptureShown(listener: () => void): () => void;
    onLibraryShown(listener: () => void): () => void;
    readClipboard(): Promise<string>;
    getSettings(): Promise<SettingsState>;
    updateSettings(patch: SettingsPatch): Promise<SettingsState>;
    backupInfo(): Promise<BackupInfo>;
    backupNow(): Promise<{ path: string; count: number; info: BackupInfo }>;
    openBackupFolder(): Promise<void>;
    exportLibrary(): Promise<ExportResult | null>;
    chooseImportFile(): Promise<ImportPreview | null>;
    applyImport(mode: ImportMode): Promise<ImportResult>;
    cancelImport(): Promise<void>;
    appVersion(): Promise<string>;
    /** True only for the first call after the installer launched the app. */
    consumeFirstRun(): Promise<boolean>;
    databaseStatus(): Promise<{ ready: boolean; path: string | null }>;
    listEntries(filter: ListFilter): Promise<EntryResults<LibraryEntry>>;
    searchEntries(query: string, filter?: ListFilter): Promise<EntryResults<SearchResult>>;
    listTags(): Promise<string[]>;
    listCategories(): Promise<CategorySummary[]>;
    createCategory(name: string): Promise<Category>;
    renameCategory(id: string, name: string): Promise<void>;
    deleteCategory(id: string): Promise<void>;
    listTagUsage(): Promise<TagSummary[]>;
    renameTag(name: string, newName: string): Promise<void>;
    deleteTag(name: string): Promise<void>;
    createEntry(draft: LibraryEntryDraft): Promise<LibraryEntry>;
    updateEntry(draft: LibraryEntryDraft & { id: string }): Promise<LibraryEntry>;
    deleteEntry(id: string): Promise<void>;
    deleteEntries(ids: string[]): Promise<void>;
    duplicateEntry(id: string): Promise<LibraryEntry>;
    toggleFavorite(id: string): Promise<LibraryEntry>;
    setArchived(id: string, value: boolean): Promise<LibraryEntry>;
    setSyntaxLanguage(id: string, language: SyntaxLanguage): Promise<LibraryEntry>;
    copyText(payload: { text: string; entryId?: string }): Promise<void>;
}
