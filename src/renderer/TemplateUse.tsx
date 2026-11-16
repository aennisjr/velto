import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import type { LibraryEntry } from '../shared/types.js';
import { entryVariableNames, renderWithDefinitions } from '../shared/template.js';

interface Props {
    entry: LibraryEntry;
    onCopy: (text: string) => Promise<void>;
    onClose: () => void;
}

function labelFor(name: string): string {
    const spaced = name.replace(/_/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default function TemplateUse({ entry, onCopy, onClose }: Props) {
    const variables = useMemo(() => entryVariableNames(entry.content, entry.fields), [entry.content, entry.fields]);
    const [values, setValues] = useState<Record<string, string>>({});
    const firstField = useRef<HTMLElement | null>(null);
    const definitions = useMemo(() => new Map(entry.variables.map((definition) => [definition.name, definition])), [entry.variables]);

    // Values live only in this component, so the saved template is never modified.
    const { text, missing } = useMemo(() => renderWithDefinitions(entry.content, entry.variables, values), [entry.content, entry.variables, values]);
    const renderedFields = useMemo(() => entry.fields.map((field) => ({
        ...field,
        ...renderWithDefinitions(field.value, entry.variables, values),
    })), [entry.fields, entry.variables, values]);

    useEffect(() => {
        firstField.current?.focus();
    }, []);

    const canCopy = missing.length === 0;

    function copy(): void {
        if (canCopy) {
            void onCopy(text);
        }
    }

    return (
        <div
            className="template-use"
            onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    copy();
                }
                if (event.key === 'Escape') {
                    onClose();
                }
            }}
        >
            <h2>{entry.title}</h2>
            {variables.length === 0 ? (
                <p className="muted">This template has no placeholders.</p>
            ) : (
                <div className="fields">
                    {variables.map((name, index) => {
                        const definition = definitions.get(name);
                        const value = values[name] ?? definition?.default_value ?? '';
                        const set = (next: string): void => setValues({ ...values, [name]: next });
                        const type = definition?.field_type ?? 'text';
                        const common = {
                            ref: index === 0 ? (element: HTMLElement | null) => { firstField.current = element; } : undefined,
                            value,
                        };
                        return (
                            <label key={name} className="field-group">
                                <span>
                                    {definition?.label || labelFor(name)} <code className="chip">%{name}%</code>
                                    {definition && !definition.required && <span className="muted"> (optional)</span>}
                                </span>
                                {type === 'dropdown' ? (
                                    <select {...common} onChange={(event) => set(event.target.value)}>
                                        <option value="">Select…</option>
                                        {(definition?.options ?? []).map((option) => (
                                            <option key={option} value={option}>{option}</option>
                                        ))}
                                    </select>
                                ) : type === 'date' || type === 'number' ? (
                                    <input {...common} type={type} onChange={(event) => set(event.target.value)} />
                                ) : (
                                    <textarea {...common} rows={type === 'multiline' ? 3 : 1} onChange={(event) => set(event.target.value)} />
                                )}
                            </label>
                        );
                    })}
                </div>
            )}
            <h3>Preview</h3>
            <pre className="preview">{text}</pre>
            {!canCopy && (
                <p className="warning" role="status">
                    Fill in: {missing.map((name) => labelFor(name)).join(', ')}
                </p>
            )}
            <div className="actions">
                <button type="button" className="btn primary" disabled={!canCopy} onClick={copy}>
                    <Copy size={15} /> Copy result <kbd>Ctrl+Enter</kbd>
                </button>
                {renderedFields.length === 0 && (
                    <button type="button" className="btn" onClick={onClose}>
                        Back <kbd>Esc</kbd>
                    </button>
                )}
            </div>
            {renderedFields.map((field, index) => (
                <section className="additional-field-preview" key={index} aria-label={field.label}>
                    <h3>{field.label}</h3>
                    <div className="additional-field-content">
                        <pre className="preview">{field.text}</pre>
                        <button type="button" className="btn" aria-label={`Copy ${field.label}`} disabled={field.missing.length > 0} onClick={() => void onCopy(field.text)}>
                            <Copy size={15} /> Copy
                        </button>
                    </div>
                    {field.missing.length > 0 && <p className="warning">Fill in: {field.missing.map(labelFor).join(', ')}</p>}
                </section>
            ))}
            {renderedFields.length > 0 && (
                <div className="actions">
                    <button type="button" className="btn" onClick={onClose}>
                        Back <kbd>Esc</kbd>
                    </button>
                </div>
            )}
        </div>
    );
}
