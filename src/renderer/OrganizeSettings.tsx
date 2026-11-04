import { useCallback, useEffect, useState } from 'react';
import { Check, Folder, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import type { CategorySummary, TagSummary } from '../shared/types.js';

interface Props {
    onChanged: () => void;
}

interface Row {
    key: string;
    name: string;
    count: number;
}

function errorText(caught: unknown): string {
    const message = caught instanceof Error ? caught.message : 'Something went wrong.';
    return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

interface ListProps {
    label: string;
    icon: typeof Tag;
    rows: Row[];
    onRename: (row: Row, name: string) => Promise<void>;
    onDelete: (row: Row) => Promise<void>;
    onAdd?: (name: string) => Promise<void>;
    deleteWarning: (row: Row) => string;
}

function ManageList({ label, icon: Icon, rows, onRename, onDelete, onAdd, deleteWarning }: ListProps) {
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [confirming, setConfirming] = useState<string | null>(null);
    const [adding, setAdding] = useState('');

    async function submitRename(row: Row) {
        await onRename(row, draft);
        setEditing(null);
    }

    return (
        <div className="manage-list" role="group" aria-label={label}>
            {rows.length === 0 && <p className="muted">None yet.</p>}
            {rows.map((row) => (
                <div key={row.key} className="manage-row">
                    {editing === row.key ? (
                        <>
                            <input
                                className="field"
                                aria-label={`New name for ${row.name}`}
                                value={draft}
                                maxLength={50}
                                autoFocus
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === 'Enter') void submitRename(row);
                                    if (event.key === 'Escape') setEditing(null);
                                }}
                            />
                            <button className="icon-btn" aria-label="Save name" onClick={() => void submitRename(row)}>
                                <Check size={14} />
                            </button>
                            <button className="icon-btn" aria-label="Cancel rename" onClick={() => setEditing(null)}>
                                <X size={14} />
                            </button>
                        </>
                    ) : (
                        <>
                            <span className="manage-name">
                                <Icon size={14} /> {row.name}
                            </span>
                            <span className="muted manage-count">{row.count}</span>
                            <button
                                className="icon-btn"
                                aria-label={`Rename ${row.name}`}
                                onClick={() => {
                                    setEditing(row.key);
                                    setDraft(row.name);
                                    setConfirming(null);
                                }}
                            >
                                <Pencil size={14} />
                            </button>
                            {confirming === row.key ? (
                                <button className="btn danger" onClick={() => void onDelete(row).then(() => setConfirming(null))} title={deleteWarning(row)}>
                                    Confirm delete
                                </button>
                            ) : (
                                <button className="icon-btn" aria-label={`Delete ${row.name}`} onClick={() => setConfirming(row.key)}>
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </>
                    )}
                    {confirming === row.key && <p className="warning-text manage-warning">{deleteWarning(row)}</p>}
                </div>
            ))}
            {onAdd && (
                <form
                    className="manage-row"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (adding.trim()) {
                            void onAdd(adding).then(() => setAdding(''));
                        }
                    }}
                >
                    <input className="field" aria-label={`New ${label.toLowerCase()} name`} placeholder="New category" value={adding} maxLength={50} onChange={(event) => setAdding(event.target.value)} />
                    <button className="btn" type="submit" disabled={!adding.trim()}>
                        <Plus size={14} /> Add
                    </button>
                </form>
            )}
        </div>
    );
}

export default function OrganizeSettings({ onChanged }: Props) {
    const [categories, setCategories] = useState<CategorySummary[]>([]);
    const [tags, setTags] = useState<TagSummary[]>([]);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const [nextCategories, nextTags] = await Promise.all([window.velto.listCategories(), window.velto.listTagUsage()]);
        setCategories(nextCategories);
        setTags(nextTags);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    async function change(work: () => Promise<unknown>) {
        setError(null);
        try {
            await work();
            await load();
            onChanged();
        } catch (caught) {
            setError(errorText(caught));
        }
    }

    return (
        <section className="modal-section">
            <h3>Categories</h3>
            <ManageList
                label="Categories"
                icon={Folder}
                rows={categories.map((category) => ({ key: category.id, name: category.name, count: category.count }))}
                onAdd={(name) => change(() => window.velto.createCategory(name))}
                onRename={(row, name) => change(() => window.velto.renameCategory(row.key, name))}
                onDelete={(row) => change(() => window.velto.deleteCategory(row.key))}
                deleteWarning={(row) => `Entries in “${row.name}” are kept and become uncategorized.`}
            />

            <h3>Tags</h3>
            <p className="muted">Renaming a tag to an existing name merges them.</p>
            <ManageList
                label="Tags"
                icon={Tag}
                rows={tags.map((tag) => ({ key: tag.name, name: tag.name, count: tag.count }))}
                onRename={(row, name) => change(() => window.velto.renameTag(row.name, name))}
                onDelete={(row) => change(() => window.velto.deleteTag(row.name))}
                deleteWarning={(row) => `Removes “${row.name}” from every entry. The entries are kept.`}
            />
            {error && <p className="error-text" role="alert">{error}</p>}
        </section>
    );
}
