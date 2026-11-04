import { useEffect, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import type { ImportMode, ImportPreview, ImportResult } from '../shared/portability.js';
import GeneralSettings from './GeneralSettings.js';
import OrganizeSettings from './OrganizeSettings.js';

interface Props {
    onClose: () => void;
    onOrganized: () => void;
    onImported: (result: ImportResult) => void;
}

const MODES: { mode: ImportMode; label: string; help: string }[] = [
    { mode: 'merge', label: 'Merge', help: 'Add new entries and update ones that are older here. Nothing is deleted.' },
    { mode: 'duplicate', label: 'Import as copies', help: 'Add every entry as a new copy, even if it already exists.' },
    { mode: 'replace', label: 'Replace library', help: 'Delete everything here and use the file instead. A backup is saved first.' },
];

function plural(count: number, word: string): string {
    return `${count} ${count === 1 ? word : word === 'entry' ? 'entries' : `${word}s`}`;
}

function errorText(caught: unknown): string {
    const message = caught instanceof Error ? caught.message : 'Something went wrong.';
    return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export default function SettingsDialog({ onClose, onImported, onOrganized }: Props) {
    const [preview, setPreview] = useState<ImportPreview | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const [mode, setMode] = useState<ImportMode>('merge');
    const [confirmReplace, setConfirmReplace] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Keep keyboard focus inside the dialog and hand it back to the opener on close.
    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null;
        dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
        const onTab = (event: KeyboardEvent) => {
            if (event.key !== 'Tab' || !dialogRef.current) {
                return;
            }
            const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')].filter(
                (element) => !(element as HTMLButtonElement).disabled && element.offsetParent !== null,
            );
            if (focusable.length === 0) {
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onTab);
        return () => {
            document.removeEventListener('keydown', onTab);
            opener?.focus();
        };
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                if ((event.target as HTMLElement).closest?.('.manage-row input, .shortcut-row')) {
                    return;
                }
                event.stopPropagation();
                close();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    });

    function close() {
        if (preview) {
            void window.velto.cancelImport();
        }
        onClose();
    }

    async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
            return await work();
        } catch (caught) {
            setError(errorText(caught));
            return undefined;
        } finally {
            setBusy(false);
        }
    }

    async function exportLibrary() {
        const result = await run(() => window.velto.exportLibrary());
        if (result) {
            setMessage(`Exported ${plural(result.count, 'entry')} to ${result.path}`);
        }
    }

    async function chooseFile() {
        const result = await run(() => window.velto.chooseImportFile());
        if (result) {
            setPreview(result);
            setMode('merge');
            setConfirmReplace(false);
        }
    }

    async function applyImport() {
        if (mode === 'replace' && !confirmReplace) {
            setConfirmReplace(true);
            return;
        }
        const result = await run(() => window.velto.applyImport(mode));
        if (result) {
            setPreview(null);
            onImported(result);
            onClose();
        }
    }

    return (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
            <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
                <div className="modal-header">
                    <h2 id="settings-title">Settings</h2>
                    <button className="icon-btn" aria-label="Close settings" onClick={close}>
                        <X size={16} />
                    </button>
                </div>

                <GeneralSettings />

                <OrganizeSettings onChanged={onOrganized} />

                <section className="modal-section">
                    <h3>Data</h3>
                    <p className="muted">Move your library to another computer with an export file. Open it in Velto there with Import.</p>

                    {!preview && (
                        <div className="modal-actions">
                            <button className="btn" disabled={busy} onClick={() => void exportLibrary()}>
                                <Download size={14} /> Export library…
                            </button>
                            <button className="btn" disabled={busy} onClick={() => void chooseFile()}>
                                <Upload size={14} /> Import library…
                            </button>
                        </div>
                    )}

                    {preview && (
                        <div className="import-panel">
                            <div className="import-summary">
                                <strong>{preview.fileName}</strong>
                                <span className="muted">
                                    {plural(preview.total, 'entry')} · {preview.added} new · {preview.changed} newer than yours · {preview.identical} identical
                                    {preview.newerLocally > 0 && ` · ${preview.newerLocally} newer here`}
                                </span>
                            </div>

                            <div role="radiogroup" aria-label="Import mode" className="mode-list">
                                {MODES.map((option) => (
                                    <label key={option.mode} className="mode-option">
                                        <input
                                            type="radio"
                                            name="import-mode"
                                            checked={mode === option.mode}
                                            onChange={() => {
                                                setMode(option.mode);
                                                setConfirmReplace(false);
                                            }}
                                        />
                                        <span>
                                            <strong>{option.label}</strong>
                                            <span className="muted">{option.help}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>

                            {confirmReplace && (
                                <p className="warning-text" role="alert">
                                    This deletes everything currently in your library. An automatic backup is saved first. Click again to confirm.
                                </p>
                            )}

                            <div className="modal-actions">
                                <button className={`btn ${mode === 'replace' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => void applyImport()}>
                                    {confirmReplace ? 'Yes, replace my library' : 'Import'}
                                </button>
                                <button
                                    className="btn"
                                    disabled={busy}
                                    onClick={() => {
                                        void window.velto.cancelImport();
                                        setPreview(null);
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {message && <p className="success-text" role="status">{message}</p>}
                    {error && <p className="error-text" role="alert">{error}</p>}
                </section>
            </div>
        </div>
    );
}
