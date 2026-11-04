import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Star } from 'lucide-react';
import type { CategorySummary } from '../shared/types.js';
import { initTheme } from './ThemeMenu.js';

function deriveTitle(content: string): string {
    const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
    return firstLine.trim().slice(0, 60);
}

export default function QuickCapture() {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [favorite, setFavorite] = useState(false);
    const [categories, setCategories] = useState<CategorySummary[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const bodyRef = useRef<HTMLTextAreaElement>(null);

    const loadCategories = useCallback(() => {
        void window.velto.listCategories().then(setCategories).catch(() => undefined);
    }, []);

    useEffect(() => {
        loadCategories();
        bodyRef.current?.focus();
        // The window is reused, so refresh the category list and focus the body each time it opens.
        const offShown = window.velto.onQuickCaptureShown(() => {
            initTheme();
            loadCategories();
            setSaved(false);
            setError(null);
            bodyRef.current?.focus();
        });
        return () => {
            offShown();
        };
    }, [loadCategories]);

    function reset(): void {
        setTitle('');
        setContent('');
        setTags('');
        setCategoryId('');
        setFavorite(false);
    }

    async function pasteClipboard(): Promise<void> {
        try {
            const text = await window.velto.readClipboard();
            if (!text) {
                setError('The clipboard has no text.');
                return;
            }
            setError(null);
            setContent((current) => (current ? `${current}\n${text}` : text));
            bodyRef.current?.focus();
        } catch {
            setError('Could not read the clipboard.');
        }
    }

    async function save(): Promise<void> {
        const finalTitle = title.trim() || deriveTitle(content);
        if (!finalTitle) {
            setError('Add a title or some content first.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await window.velto.createEntry({
                title: finalTitle,
                content,
                tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
                category_id: categoryId || undefined,
                is_favorite: favorite,
                is_template: false,
                is_archived: false,
            });
            reset();
            setSaved(true);
            await window.velto.hideQuickCapture();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not save.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <form
            className="quick capture"
            aria-label="Quick Capture"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void save();
                } else if (event.key === 'Escape') {
                    void window.velto.hideQuickCapture();
                }
            }}
        >
            <div className="capture-body">
                <input
                    className="field"
                    aria-label="Title"
                    placeholder="Title (optional — taken from the first line)"
                    value={title}
                    maxLength={200}
                    onChange={(event) => setTitle(event.target.value)}
                />
                <textarea
                    ref={bodyRef}
                    className="editor-content capture-content"
                    aria-label="Content"
                    placeholder="Type or paste your text…"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    spellCheck
                />
                <input
                    className="field"
                    aria-label="Tags"
                    placeholder="Tags, separated by commas"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                />
                <div className="capture-row">
                    <select className="field" aria-label="Category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                        <option value="">No category</option>
                        {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                                {category.name}
                            </option>
                        ))}
                    </select>
                    <label className="check">
                        <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} />
                        <Star size={14} aria-hidden /> Favorite
                    </label>
                </div>
                {error && (
                    <p className="error" role="alert">
                        {error}
                    </p>
                )}
                {saved && (
                    <p className="muted" role="status">
                        Saved.
                    </p>
                )}
            </div>
            <div className="quick-footer">
                <button type="button" className="link-btn" onClick={() => void pasteClipboard()}>
                    <ClipboardPaste size={14} /> Paste clipboard
                </button>
                <span className="capture-actions">
                    <button type="button" className="btn" onClick={() => void window.velto.hideQuickCapture()}>
                        Close <kbd>Esc</kbd>
                    </button>
                    <button type="submit" className="btn primary" disabled={saving}>
                        Save <kbd>Ctrl+Enter</kbd>
                    </button>
                </span>
            </div>
        </form>
    );
}
