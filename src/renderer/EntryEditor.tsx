import { useEffect, useMemo, useRef, useState } from 'react';
import type { CategorySummary, LibraryEntry, VariableFieldType } from '../shared/types.js';
import type { LibraryEntryDraft } from '../shared/validators.js';
import { parseTemplateVariables } from '../shared/template.js';

interface Props {
    entry: LibraryEntry | null;
    categories: CategorySummary[];
    defaultCategoryId?: string;
    onSave: (draft: LibraryEntryDraft) => Promise<void>;
    onCancel: () => void;
    onDirtyChange: (dirty: boolean) => void;
}

interface VariableForm {
    label: string;
    default_value: string;
    required: boolean;
    field_type: VariableFieldType;
    optionsText: string;
}

interface Draft {
    title: string;
    description: string;
    content: string;
    tags: string;
    isTemplate: boolean;
    categoryId: string;
    forms: Record<string, VariableForm>;
}

const draftKey = (entryId: string | undefined): string => `velto.draft.${entryId ?? 'new'}`;

function readDraft(key: string): Draft | null {
    try {
        const raw = localStorage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && typeof (parsed as Draft).content === 'string' && typeof (parsed as Draft).title === 'string') {
            return parsed as Draft;
        }
    } catch {
        // A corrupt draft is ignored rather than blocking the editor.
    }
    return null;
}

const DEFAULT_FORM: VariableForm = { label: '', default_value: '', required: true, field_type: 'text', optionsText: '' };

function deriveTitle(content: string): string {
    const firstLine = content.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
    return firstLine.trim().slice(0, 60);
}

export default function EntryEditor({ entry, categories, defaultCategoryId, onSave, onCancel, onDirtyChange }: Props) {
    const initial = useMemo(
        () => ({
            title: entry?.title ?? '',
            description: entry?.description ?? '',
            content: entry?.content ?? '',
            tags: (entry?.tags ?? []).join(', '),
            isTemplate: entry?.is_template ?? false,
            categoryId: entry ? (entry.category_id ?? '') : (defaultCategoryId ?? ''),
            forms: Object.fromEntries(
                (entry?.variables ?? []).map((variable): [string, VariableForm] => [
                    variable.name,
                    {
                        label: variable.label ?? '',
                        default_value: variable.default_value ?? '',
                        required: variable.required,
                        field_type: variable.field_type,
                        optionsText: (variable.options ?? []).join(', '),
                    },
                ]),
            ) as Record<string, VariableForm>,
        }),
        [entry, defaultCategoryId],
    );

    const key = draftKey(entry?.id);
    const [recovered, setRecovered] = useState<Draft | null>(() => {
        const stored = readDraft(key);
        return stored && JSON.stringify(stored) !== JSON.stringify(initial) ? stored : null;
    });
    const start: Draft = recovered ?? initial;
    const [title, setTitle] = useState(start.title);
    const [description, setDescription] = useState(start.description);
    const [content, setContent] = useState(start.content);
    const [tagsText, setTagsText] = useState(start.tags);
    const [isTemplate, setIsTemplate] = useState(start.isTemplate);
    const [categoryId, setCategoryId] = useState(start.categoryId);
    const [forms, setForms] = useState<Record<string, VariableForm>>(start.forms ?? initial.forms);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const templateTouched = useRef(entry !== null || recovered !== null);
    const titleRef = useRef<HTMLInputElement>(null);

    const variables = useMemo(() => parseTemplateVariables(content).uniqueNames, [content]);
    const formFor = (name: string): VariableForm => forms[name] ?? DEFAULT_FORM;
    const updateForm = (name: string, changes: Partial<VariableForm>): void =>
        setForms((current) => ({ ...current, [name]: { ...(current[name] ?? DEFAULT_FORM), ...changes } }));
    const formsChanged = JSON.stringify(variables.map((name) => [name, forms[name] ?? DEFAULT_FORM])) !==
        JSON.stringify(variables.map((name) => [name, initial.forms[name] ?? DEFAULT_FORM]));
    const dirty =
        formsChanged ||
        title !== initial.title ||
        description !== initial.description ||
        content !== initial.content ||
        tagsText !== initial.tags ||
        categoryId !== initial.categoryId ||
        isTemplate !== initial.isTemplate;

    // Unsaved work survives a crash or accidental close; it is removed on save or an explicit cancel.
    useEffect(() => {
        if (!dirty) {
            localStorage.removeItem(key);
            return;
        }
        const timer = window.setTimeout(() => {
            const draft: Draft = { title, description, content, tags: tagsText, isTemplate, categoryId, forms };
            try {
                localStorage.setItem(key, JSON.stringify(draft));
            } catch {
                // Storage full or unavailable: recovery is best-effort.
            }
        }, 400);
        return () => window.clearTimeout(timer);
    }, [dirty, key, title, description, content, tagsText, isTemplate, categoryId, forms]);

    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);

    useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

    useEffect(() => {
        titleRef.current?.focus();
    }, []);

    // Until the user decides, tick "template" automatically when placeholders appear.
    useEffect(() => {
        if (!templateTouched.current) {
            setIsTemplate(variables.length > 0);
        }
    }, [variables.length]);

    async function save(): Promise<void> {
        const finalTitle = title.trim() || deriveTitle(content);
        if (!finalTitle) {
            setError('Add a title or some content first.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            await onSave({
                title: finalTitle,
                description: description.trim() || undefined,
                content,
                syntax_language: entry?.syntax_language ?? 'plaintext',
                tags: tagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
                is_template: isTemplate,
                is_favorite: entry?.is_favorite ?? false,
                is_archived: entry?.is_archived ?? false,
                category_id: categoryId || undefined,
                variables: variables.map((name) => {
                    const form = formFor(name);
                    const options = form.optionsText.split(',').map((option) => option.trim()).filter(Boolean);
                    return {
                        name,
                        label: form.label.trim() || undefined,
                        default_value: form.default_value || undefined,
                        required: form.required,
                        field_type: form.field_type,
                        options: form.field_type === 'dropdown' ? options : undefined,
                    };
                }),
            });
            localStorage.removeItem(key);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not save.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <form
            className="editor"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void save();
                }
                if (event.key === 'Escape') {
                    onCancel();
                }
            }}
        >
            {recovered && (
                <p className="banner" role="status">
                    Restored your unsaved changes.{' '}
                    <button
                        type="button"
                        className="link-btn"
                        onClick={() => {
                            localStorage.removeItem(key);
                            setTitle(initial.title);
                            setDescription(initial.description);
                            setContent(initial.content);
                            setTagsText(initial.tags);
                            setIsTemplate(initial.isTemplate);
                            setCategoryId(initial.categoryId);
                            setForms(initial.forms);
                            setRecovered(null);
                        }}
                    >
                        Discard them
                    </button>
                </p>
            )}
            <input
                ref={titleRef}
                className="editor-title"
                placeholder="Title (optional — taken from the first line)"
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
            />
            <input
                className="field"
                placeholder="When to use this (optional)"
                value={description}
                maxLength={2000}
                onChange={(event) => setDescription(event.target.value)}
            />
            <textarea
                className="editor-content"
                placeholder="Content. Use %name% style placeholders to make a template."
                value={content}
                onChange={(event) => setContent(event.target.value)}
                spellCheck
            />
            <div className="variable-row">
                {variables.length > 0 ? (
                    <>
                        <span className="muted">Variables:</span>
                        {variables.map((name) => (
                            <code key={name} className="chip">
                                %{name}%
                            </code>
                        ))}
                    </>
                ) : (
                    <span className="muted">No placeholders detected.</span>
                )}
            </div>
            {variables.length > 0 && (
                <details className="variable-defs">
                    <summary>Variable settings</summary>
                    {variables.map((name) => {
                        const form = formFor(name);
                        return (
                            <fieldset key={name} className="variable-def">
                                <legend>
                                    <code className="chip">%{name}%</code>
                                </legend>
                                <input
                                    className="field"
                                    aria-label={`Label for ${name}`}
                                    placeholder="Label"
                                    value={form.label}
                                    maxLength={120}
                                    onChange={(event) => updateForm(name, { label: event.target.value })}
                                />
                                <input
                                    className="field"
                                    aria-label={`Default value for ${name}`}
                                    placeholder="Default value"
                                    value={form.default_value}
                                    onChange={(event) => updateForm(name, { default_value: event.target.value })}
                                />
                                <select
                                    className="field"
                                    aria-label={`Field type for ${name}`}
                                    value={form.field_type}
                                    onChange={(event) => updateForm(name, { field_type: event.target.value as VariableFieldType })}
                                >
                                    <option value="text">Text</option>
                                    <option value="multiline">Multi-line text</option>
                                    <option value="date">Date</option>
                                    <option value="number">Number</option>
                                    <option value="dropdown">Dropdown</option>
                                </select>
                                {form.field_type === 'dropdown' && (
                                    <input
                                        className="field"
                                        aria-label={`Options for ${name}`}
                                        placeholder="Options, separated by commas"
                                        value={form.optionsText}
                                        onChange={(event) => updateForm(name, { optionsText: event.target.value })}
                                    />
                                )}
                                <label className="check">
                                    <input
                                        type="checkbox"
                                        checked={form.required}
                                        onChange={(event) => updateForm(name, { required: event.target.checked })}
                                    />
                                    Required
                                </label>
                            </fieldset>
                        );
                    })}
                </details>
            )}
            <input
                className="field"
                placeholder="Tags, separated by commas"                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
            />
            <label className="field-label">
                Category
                <select className="field" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                    <option value="">No category</option>
                    {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                            {category.name}
                        </option>
                    ))}
                </select>
            </label>
            <label className="check">
                <input
                    type="checkbox"
                    checked={isTemplate}
                    onChange={(event) => {
                        templateTouched.current = true;
                        setIsTemplate(event.target.checked);
                    }}
                />
                Treat as a template (adds “Use Template”)
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="actions">
                <button type="submit" className="btn primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save'} <kbd>Ctrl+Enter</kbd>
                </button>
                <button type="button" className="btn" onClick={onCancel}>
                    Cancel <kbd>Esc</kbd>
                </button>
            </div>
        </form>
    );
}
