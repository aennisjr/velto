import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Check, Clock, Copy, Folder, Library, Pencil, Plus, Search, Settings as SettingsIcon, Sparkles, Square, Star, Tag, Trash2 } from 'lucide-react';
import type { CategorySummary, LibraryEntry, LibraryView } from '../shared/types.js';
import type { LibraryEntryDraft } from '../shared/validators.js';
import { SYNTAX_LANGUAGES, type SyntaxLanguage } from '../shared/syntaxLanguages.js';
import EntryEditor from './EntryEditor.js';
import TemplateUse from './TemplateUse.js';
import SyntaxContent from './SyntaxContent.js';
import ThemeMenu from './ThemeMenu.js';
import SettingsDialog from './SettingsDialog.js';

type Mode = 'view' | 'edit' | 'new' | 'use';

interface ListItem {
    entry: LibraryEntry;
    preview: string;
}

const NAV: { view: LibraryView; label: string; icon: typeof Library }[] = [
    { view: 'all', label: 'All entries', icon: Library },
    { view: 'favorites', label: 'Favorites', icon: Star },
    { view: 'recent', label: 'Recent', icon: Clock },
    { view: 'archived', label: 'Archived', icon: Archive },
];

function snippet(content: string): string {
    return content.replace(/\s+/g, ' ').slice(0, 140);
}

export default function App() {
    const [view, setView] = useState<LibraryView>('all');
    const [tag, setTag] = useState<string | undefined>();
    const [categoryId, setCategoryId] = useState<string | undefined>();
    const [categories, setCategories] = useState<CategorySummary[]>([]);
    const [query, setQuery] = useState('');
    const [items, setItems] = useState<ListItem[]>([]);
    const [truncated, setTruncated] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [tags, setTags] = useState<string[]>([]);
    const [detail, setDetail] = useState<LibraryEntry | null>(null);
    const [mode, setMode] = useState<Mode>('view');
    const [dirty, setDirty] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [toast, setToast] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savingLanguage, setSavingLanguage] = useState(false);
    const [appVersion, setAppVersion] = useState<string | null>(null);
    const requestId = useRef(0);
    const searchRef = useRef<HTMLInputElement>(null);
    const toastTimer = useRef<number | undefined>(undefined);

    const showToast = useCallback((message: string) => {
        setToast(message);
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 1400);
    }, []);

    const refresh = useCallback(async () => {
        const id = ++requestId.current;
        try {
            const text = query.trim();
            let next: ListItem[];
            let nextTruncated: boolean;
            const filter = { view, tag, category_id: categoryId };
            if (text) {
                const result = await window.velto.searchEntries(text, filter);
                next = result.rows.map((hit) => ({ entry: hit.entry, preview: hit.preview }));
                nextTruncated = result.truncated;
            } else {
                const result = await window.velto.listEntries(filter);
                next = result.rows.map((entry) => ({ entry, preview: snippet(entry.content) }));
                nextTruncated = result.truncated;
            }
            const [nextTags, nextCategories] = await Promise.all([window.velto.listTags(), window.velto.listCategories()]);
            if (id !== requestId.current) {
                return;
            }
            setItems(next);
            setTruncated(nextTruncated);
            setTags(nextTags);
            setCategories(nextCategories);
            setLoaded(true);
            setError(null);
        } catch (caught) {
            if (id === requestId.current) {
                setError(caught instanceof Error ? caught.message : 'Could not load entries.');
            }
        }
    }, [query, view, tag, categoryId]);

    useEffect(() => {
        const timer = window.setTimeout(() => void refresh(), query ? 80 : 0);
        return () => window.clearTimeout(timer);
    }, [refresh, query]);

    useEffect(() => {
        return window.velto.onLibraryShown(() => void refresh());
    }, [refresh]);

    useEffect(() => {
        void window.velto.appVersion().then(setAppVersion).catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : 'Could not load app version.');
        });
    }, []);

    // Show the first entry on load without disturbing an edit in progress.
    useEffect(() => {
        if (detail === null && mode === 'view' && items.length > 0) {
            setDetail(items[0].entry);
        }
    }, [items, detail, mode]);

    useEffect(() => setConfirmDelete(false), [detail?.id, mode]);
    useEffect(() => {
        setSelectionMode(false);
        setSelectedIds([]);
    }, [query, view, tag, categoryId]);

    // Returns false when the user chooses to keep editing.
    const guard = useCallback((): boolean => {
        if (dirty && !window.confirm('You have unsaved changes. Discard them?')) {
            return false;
        }
        if (dirty) {
            // The user chose to discard, so the recovery copy must not come back.
            for (const name of Object.keys(localStorage).filter((item) => item.startsWith('velto.draft.'))) {
                localStorage.removeItem(name);
            }
        }
        setDirty(false);
        return true;
    }, [dirty]);

    function select(entry: LibraryEntry): void {
        if (entry.id === detail?.id && mode === 'view') {
            return;
        }
        if (guard()) {
            setDetail(entry);
            setMode('view');
        }
    }

    function startNew(): void {
        if (guard()) {
            setMode('new');
        }
    }

    function startEdit(): void {
        if (detail && guard()) {
            setMode('edit');
        }
    }

    function changeView(next: LibraryView, nextTag?: string, nextCategoryId?: string): void {
        if (!guard()) {
            return;
        }
        setQuery('');
        setView(next);
        setTag(nextTag);
        setCategoryId(nextCategoryId);
        setDetail(null);
        setMode('view');
    }

    async function copyText(text: string, entry: LibraryEntry): Promise<void> {
        try {
            await window.velto.copyText({ text, entryId: entry.id });
            showToast('Copied');
            void refresh();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Copy failed.');
        }
    }

    function primaryAction(entry: LibraryEntry): void {
        if (entry.is_template) {
            setDetail(entry);
            setMode('use');
        } else {
            void copyText(entry.content, entry);
        }
    }

    async function saveDraft(draft: LibraryEntryDraft): Promise<void> {
        if (mode === 'new') {
            const created = await window.velto.createEntry(draft);
            setQuery('');
            setView('all');
            setTag(undefined);
            setDetail(created);
        } else if (detail) {
            setDetail(await window.velto.updateEntry({ ...draft, id: detail.id }));
        }
        setDirty(false);
        setMode('view');
        showToast('Saved');
        void refresh();
    }

    async function runAction(work: () => Promise<void>): Promise<void> {
        try {
            await work();
            setError(null);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Something went wrong.');
        }
    }

    async function changeSyntaxLanguage(language: SyntaxLanguage): Promise<void> {
        if (!detail || language === detail.syntax_language || savingLanguage) {
            return;
        }

        const entryId = detail.id;
        setSavingLanguage(true);
        try {
            const updated = await window.velto.setSyntaxLanguage(entryId, language);
            setDetail((current) => current?.id === entryId ? updated : current);
            setError(null);
            await refresh();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not save syntax language.');
        } finally {
            setSavingLanguage(false);
        }
    }

    const toggleFavorite = (entry: LibraryEntry) =>
        runAction(async () => {
            setDetail(await window.velto.toggleFavorite(entry.id));
            await refresh();
        });

    const duplicate = (entry: LibraryEntry) =>
        runAction(async () => {
            if (!guard()) {
                return;
            }
            setDetail(await window.velto.duplicateEntry(entry.id));
            setMode('view');
            showToast('Duplicated');
            await refresh();
        });

    const toggleArchive = (entry: LibraryEntry) =>
        runAction(async () => {
            setDetail(await window.velto.setArchived(entry.id, !entry.is_archived));
            showToast(entry.is_archived ? 'Restored' : 'Archived');
            await refresh();
        });

    const remove = (entry: LibraryEntry) =>
        runAction(async () => {
            await window.velto.deleteEntry(entry.id);
            setItems((current) => current.filter(({ entry: listedEntry }) => listedEntry.id !== entry.id));
            setDetail(null);
            setMode('view');
            showToast('Deleted');
            await refresh();
        });

    function toggleSelectionMode(): void {
        if (selectionMode) {
            setSelectionMode(false);
            setSelectedIds([]);
        } else if (guard()) {
            setSelectionMode(true);
        }
    }

    function toggleSelected(entryId: string): void {
        setSelectedIds((current) => current.includes(entryId) ? current.filter((id) => id !== entryId) : [...current, entryId]);
    }

    const deleteSelected = () =>
        runAction(async () => {
            const count = selectedIds.length;
            if (count === 0 || !window.confirm(`Permanently delete ${count} selected ${count === 1 ? 'entry' : 'entries'}? This cannot be undone.`)) {
                return;
            }
            await window.velto.deleteEntries(selectedIds);
            setItems((current) => current.filter(({ entry }) => !selectedIds.includes(entry.id)));
            if (detail && selectedIds.includes(detail.id)) {
                setDetail(null);
                setMode('view');
            }
            setSelectedIds([]);
            setSelectionMode(false);
            showToast(`Deleted ${count} ${count === 1 ? 'entry' : 'entries'}`);
            await refresh();
        });

    useEffect(() => {
        function onKey(event: KeyboardEvent): void {
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }
            const key = event.key.toLowerCase();
            if (key === 'n') {
                event.preventDefault();
                startNew();
            } else if (key === 'f') {
                event.preventDefault();
                searchRef.current?.focus();
                searchRef.current?.select();
            } else if (key === 'e' && mode === 'view' && detail) {
                event.preventDefault();
                startEdit();
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    function onSearchKey(event: React.KeyboardEvent<HTMLInputElement>): void {
        const index = items.findIndex((item) => item.entry.id === detail?.id);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const nextIndex = Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            if (items[nextIndex]) {
                select(items[nextIndex].entry);
            }
        } else if (event.key === 'Enter' && detail && mode === 'view') {
            event.preventDefault();
            primaryAction(detail);
        } else if (event.key === 'Escape') {
            setQuery('');
        }
    }

    const searching = query.trim().length > 0;
    const activeCategory = categories.find((category) => category.id === categoryId);
    const heading = searching ? 'Search results' : activeCategory ? activeCategory.name : tag ? `#${tag}` : NAV.find((item) => item.view === view)?.label;
    const detailCategory = categories.find((category) => category.id === detail?.category_id);

    return (
        <div className="app">
            <aside className="sidebar" aria-label="Library navigation">
                <div className="brand">Velto</div>
                <nav aria-label="Views">
                    {NAV.map(({ view: navView, label, icon: Icon }) => (
                        <button
                            key={navView}
                            className={`nav-item${!searching && !tag && !categoryId && view === navView ? ' active' : ''}`}
                            onClick={() => changeView(navView)}
                        >
                            <Icon size={16} /> {label}
                        </button>
                    ))}
                </nav>
                {categories.length > 0 && <div className="sidebar-heading">Categories</div>}
                <nav className="tag-list" aria-label="Categories">
                    {categories.map((category) => (
                        <button
                            key={category.id}
                            className={`nav-item${!searching && categoryId === category.id ? ' active' : ''}`}
                            onClick={() => changeView('all', undefined, category.id)}
                        >
                            <Folder size={14} /> {category.name}
                        </button>
                    ))}
                </nav>
                {tags.length > 0 && <div className="sidebar-heading">Tags</div>}
                <nav className="tag-list" aria-label="Tags">
                    {tags.map((name) => (
                        <button
                            key={name}
                            className={`nav-item${!searching && tag === name ? ' active' : ''}`}
                            onClick={() => changeView('all', name)}
                        >
                            <Tag size={14} /> {name}
                        </button>
                    ))}
                </nav>
                <div className="sidebar-footer">
                    <span className="app-version" aria-label={appVersion ? `Version ${appVersion}` : 'Loading version'}>
                        {appVersion ? `v${appVersion}` : ''}
                    </span>
                    <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
                        <SettingsIcon size={16} />
                    </button>
                    <ThemeMenu />
                </div>
            </aside>

            <section className="list-pane" aria-label="Entries">
                <div className="list-head">
                    <div className="search">
                        <Search size={15} />
                        <input
                            ref={searchRef}
                            placeholder="Search entries…  (Ctrl+F)"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={onSearchKey}
                            aria-label="Search entries"
                        />
                    </div>
                    <button className="icon-btn primary" onClick={startNew} title="New entry (Ctrl+N)" aria-label="New entry">
                        <Plus size={16} />
                    </button>
                </div>
                <div className="list-heading">
                    <span>{heading}</span>
                    {items.length > 0 && (
                        <button type="button" className="link-btn" onClick={toggleSelectionMode}>
                            {selectionMode ? 'Cancel' : 'Select'}
                        </button>
                    )}
                </div>
                {selectionMode && (
                    <div className="bulk-actions" role="group" aria-label="Bulk actions">
                        <span>{selectedIds.length} selected</span>
                        <button type="button" className="btn danger" disabled={selectedIds.length === 0} onClick={() => void deleteSelected()}>
                            <Trash2 size={14} /> Delete selected
                        </button>
                    </div>
                )}
                <ul className="list" role="listbox" aria-label="Entries">
                    {items.map(({ entry, preview }) => (
                        <li key={entry.id}>
                            <button
                                className={`item${!selectionMode && entry.id === detail?.id ? ' selected' : ''}${selectionMode && selectedIds.includes(entry.id) ? ' bulk-selected' : ''}`}
                                onClick={() => selectionMode ? toggleSelected(entry.id) : select(entry)}
                                onDoubleClick={() => !selectionMode && primaryAction(entry)}
                                role="option"
                                aria-selected={selectionMode ? selectedIds.includes(entry.id) : entry.id === detail?.id}
                                aria-label={selectionMode ? `${selectedIds.includes(entry.id) ? 'Deselect' : 'Select'} ${entry.title}` : undefined}
                            >
                                <span className="item-title">
                                    {selectionMode && (selectedIds.includes(entry.id) ? <Check size={14} className="bulk-check checked" /> : <Square size={14} className="bulk-check" />)}
                                    {entry.is_favorite && <Star size={12} className="fav" fill="currentColor" />}
                                    {entry.title}
                                    {entry.is_template && <span className="badge">Template</span>}
                                </span>
                                <span className="item-preview">{preview || 'Empty'}</span>
                            </button>
                        </li>
                    ))}
                </ul>
                {truncated && <p className="muted results-limit" role="status">Showing first {items.length.toLocaleString()} results, refine your search.</p>}
                {loaded && items.length === 0 && (
                    <div className="empty small">
                        {searching ? (
                            <p>No matches for “{query.trim()}”.</p>
                        ) : view === 'all' && !tag ? (
                            <>
                                <p>Your library is empty.</p>
                                <button className="btn primary" onClick={startNew}>
                                    <Plus size={15} /> Create your first entry
                                </button>
                            </>
                        ) : (
                            <p>Nothing here yet.</p>
                        )}
                    </div>
                )}
            </section>

            <main className="detail">
                {error && (
                    <p className="error banner" role="alert">
                        {error}
                    </p>
                )}
                {mode === 'new' && (
                    <EntryEditor key="new" entry={null} categories={categories} defaultCategoryId={categoryId} onSave={saveDraft} onCancel={() => guard() && setMode('view')} onDirtyChange={setDirty} />
                )}
                {mode === 'edit' && detail && (
                    <EntryEditor key={detail.id} entry={detail} categories={categories} onSave={saveDraft} onCancel={() => guard() && setMode('view')} onDirtyChange={setDirty} />
                )}
                {mode === 'use' && detail && (
                    <TemplateUse entry={detail} onCopy={(text) => copyText(text, detail)} onClose={() => setMode('view')} />
                )}
                {mode === 'view' && detail && (
                    <article className="entry">
                        <header>
                            <h1>{detail.title}</h1>
                            {detailCategory && (
                                <p className="entry-category">
                                    <Folder size={13} /> {detailCategory.name}
                                </p>
                            )}
                            {detail.description && <p className="muted">{detail.description}</p>}
                            {detail.tags.length > 0 && (
                                <div className="chips">
                                    {detail.tags.map((name) => (
                                        <span key={name} className="chip">
                                            {name}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </header>
                        <div className="actions">
                            {detail.is_template ? (
                                <button className="btn primary" onClick={() => primaryAction(detail)}>
                                    <Sparkles size={15} /> Use Template
                                </button>
                            ) : null}
                            <button className={`btn${detail.is_template ? '' : ' primary'}`} onClick={() => void copyText(detail.content, detail)}>
                                <Copy size={15} /> {detail.is_template ? 'Copy raw' : 'Copy'}
                            </button>
                            <button className="btn" onClick={startEdit}>
                                <Pencil size={15} /> Edit
                            </button>
                            <button className="btn" onClick={() => void toggleFavorite(detail)}>
                                <Star size={15} fill={detail.is_favorite ? 'currentColor' : 'none'} /> {detail.is_favorite ? 'Unfavorite' : 'Favorite'}
                            </button>
                            <button className="btn" onClick={() => void duplicate(detail)}>
                                Duplicate
                            </button>
                            <button className="btn" onClick={() => void toggleArchive(detail)}>
                                {detail.is_archived ? <ArchiveRestore size={15} /> : <Archive size={15} />} {detail.is_archived ? 'Restore' : 'Archive'}
                            </button>
                            {confirmDelete ? (
                                <button className="btn danger" onClick={() => void remove(detail)} autoFocus>
                                    <Trash2 size={15} /> Confirm delete
                                </button>
                            ) : (
                                <button className="btn" onClick={() => setConfirmDelete(true)}>
                                    <Trash2 size={15} /> Delete
                                </button>
                            )}
                        </div>
                        <SyntaxContent content={detail.content} isTemplate={detail.is_template} language={detail.syntax_language} />
                        {detail.fields.map((field, index) => (
                            <section className="additional-field-preview" key={index} aria-label={field.label}>
                                <h3>{field.label}</h3>
                                <div className="additional-field-content">
                                    <pre className="preview">{field.value}</pre>
                                    <button type="button" className="btn" aria-label={`Copy ${field.label}${detail.is_template ? ' raw' : ''}`} onClick={() => void copyText(field.value, detail)}>
                                        <Copy size={15} /> Copy
                                    </button>
                                </div>
                            </section>
                        ))}
                        <div className="syntax-language">
                            <label htmlFor="syntax-language-select">Syntax highlighting</label>
                            <select
                                id="syntax-language-select"
                                value={detail.syntax_language}
                                disabled={savingLanguage}
                                onChange={(event) => {
                                    const language = SYNTAX_LANGUAGES.find(({ value }) => value === event.target.value)?.value;
                                    if (language) {
                                        void changeSyntaxLanguage(language);
                                    }
                                }}
                            >
                                {SYNTAX_LANGUAGES.map(({ value, label }) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                            {savingLanguage && <span className="muted" role="status">Saving…</span>}
                        </div>
                        <footer className="muted">
                            Used {detail.use_count} {detail.use_count === 1 ? 'time' : 'times'} · Updated {new Date(detail.updated_at).toLocaleString()}
                        </footer>
                    </article>
                )}
                {mode === 'view' && !detail && (
                    <div className="empty">
                        <p>Select an entry, or press Ctrl+N to create one.</p>
                    </div>
                )}
            </main>

            {settingsOpen && (
                <SettingsDialog
                    onClose={() => setSettingsOpen(false)}
                    onOrganized={() => {
                        setTag(undefined);
                        setCategoryId(undefined);
                        setDetail(null);
                        setMode('view');
                        void refresh();
                    }}
                    onImported={(result) => {
                        setDetail(null);
                        setMode('view');
                        setDirty(false);
                        void refresh();
                        showToast(`Imported: ${result.added} added, ${result.updated} updated`);
                    }}
                />
            )}

            {toast && (
                <div className="toast" role="status">
                    {toast}
                </div>
            )}
        </div>
    );
}
