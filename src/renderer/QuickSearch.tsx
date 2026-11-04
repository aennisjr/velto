import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Search, Sparkles, Star } from 'lucide-react';
import type { LibraryEntry } from '../shared/types.js';
import { parseTemplateVariables } from '../shared/template.js';
import TemplateUse from './TemplateUse.js';
import { initTheme } from './ThemeMenu.js';

interface Result {
    entry: LibraryEntry;
    preview: string;
}

const EMPTY_QUERY_LIMIT = 12;

function snippet(content: string): string {
    return content.replace(/\s+/g, ' ').slice(0, 140);
}

function needsForm(entry: LibraryEntry): boolean {
    return entry.is_template && parseTemplateVariables(entry.content).uniqueNames.length > 0;
}

export default function QuickSearch() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<Result[]>([]);
    const [selected, setSelected] = useState(0);
    const [template, setTemplate] = useState<LibraryEntry | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loaded, setLoaded] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const requestId = useRef(0);

    const load = useCallback(async (text: string) => {
        const id = ++requestId.current;
        try {
            let next: Result[];
            if (text.trim()) {
                next = (await window.velto.searchEntries(text.trim())).map((hit) => ({ entry: hit.entry, preview: hit.preview }));
            } else {
                const entries = await window.velto.listEntries({ view: 'all' });
                next = entries.slice(0, EMPTY_QUERY_LIMIT).map((entry) => ({ entry, preview: snippet(entry.content) }));
            }
            if (id === requestId.current) {
                setResults(next);
                setSelected(0);
                setLoaded(true);
                setError(null);
            }
        } catch (caught) {
            if (id === requestId.current) {
                setError(caught instanceof Error ? caught.message : 'Search failed.');
            }
        }
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => void load(query), query ? 50 : 0);
        return () => window.clearTimeout(timer);
    }, [query, load]);

    // The window is created once and reused, so each opening starts from a clean state.
    useEffect(() => {
        return window.velto.onQuickSearchShown(() => {
            initTheme();
            setTemplate(null);
            setQuery('');
            void load('');
            inputRef.current?.focus();
        });
    }, [load]);

    useEffect(() => {
        listRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' });
    }, [selected, results]);

    useEffect(() => {
        if (template) {
            return;
        }
        inputRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                void window.velto.hideQuickSearch();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [template]);

    const copyAndClose = useCallback(async (text: string, entry: LibraryEntry) => {
        try {
            await window.velto.copyText({ text, entryId: entry.id });
            await window.velto.hideQuickSearch();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Copy failed.');
        }
    }, []);

    function choose(entry: LibraryEntry): void {
        if (needsForm(entry)) {
            setTemplate(entry);
        } else {
            void copyAndClose(entry.content, entry);
        }
    }

    function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelected((index) => Math.min(results.length - 1, index + 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected((index) => Math.max(0, index - 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const result = results[selected];
            if (result) {
                choose(result.entry);
            }
        }
    }

    const activeId = useMemo(() => results[selected]?.entry.id, [results, selected]);

    if (template) {
        return (
            <div className="quick">
                <div className="quick-template">
                    <TemplateUse entry={template} onCopy={(text) => copyAndClose(text, template)} onClose={() => setTemplate(null)} />
                </div>
            </div>
        );
    }

    return (
        <div className="quick">
            <div className="quick-search">
                <Search size={18} />
                <input
                    ref={inputRef}
                    autoFocus
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="quick-results"
                    aria-activedescendant={activeId ? `quick-${activeId}` : undefined}
                    placeholder="Search your library…"
                    value={query}
                    maxLength={500}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onKeyDown}
                    spellCheck={false}
                />
            </div>

            {error && <p className="error quick-message" role="alert">{error}</p>}

            <ul className="quick-results" id="quick-results" role="listbox" ref={listRef}>
                {results.map(({ entry, preview }, index) => (
                    <li
                        key={entry.id}
                        id={`quick-${entry.id}`}
                        role="option"
                        aria-selected={index === selected}
                        className={`quick-item${index === selected ? ' selected' : ''}`}
                        onMouseMove={() => index !== selected && setSelected(index)}
                        onClick={() => choose(entry)}
                    >
                        <div className="quick-title">
                            {entry.is_favorite && <Star size={12} className="fav" />}
                            <span>{entry.title}</span>
                            {entry.is_template && (
                                <span className="badge">
                                    <Sparkles size={11} /> Template
                                </span>
                            )}
                        </div>
                        <div className="quick-preview">{preview}</div>
                    </li>
                ))}
            </ul>

            {loaded && results.length === 0 && !error && (
                <p className="muted quick-message">{query.trim() ? `No matches for “${query.trim()}”.` : 'Your library is empty. Open Velto to add entries.'}</p>
            )}

            <div className="quick-footer">
                <span>
                    <kbd>↑</kbd> <kbd>↓</kbd> navigate
                </span>
                <span>
                    <kbd>Enter</kbd> copy
                </span>
                <span>
                    <kbd>Esc</kbd> close
                </span>
                <button type="button" className="link-btn" onClick={() => void window.velto.openLibrary()}>
                    <ExternalLink size={12} /> Open Velto
                </button>
            </div>
        </div>
    );
}
