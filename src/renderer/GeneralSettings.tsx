import { formatAccelerator } from '../shared/shortcuts.js';
import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Keyboard, RotateCcw } from 'lucide-react';
import {
    DEFAULT_SHORTCUTS,
    type BackupInfo,
    type SettingsPatch,
    type SettingsState,
    type ShortcutAction,
} from '../shared/settings.js';

const LABELS: Record<ShortcutAction, string> = { quickSearch: 'Quick Search', quickCapture: 'Quick Capture' };
const NAMED_KEYS: Record<string, string> = {
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
};

// Turns a key press into an Electron accelerator, or null while only modifiers are held.
export function acceleratorFromEvent(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null {
    let key: string | undefined;
    if (/^Key[A-Z]$/.test(event.code)) {
        key = event.code.slice(3);
    } else if (/^Digit[0-9]$/.test(event.code)) {
        key = event.code.slice(5);
    } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) {
        key = event.code;
    } else {
        key = NAMED_KEYS[event.code];
    }

    if (!key) {
        return null;
    }

    const modifiers = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean);
    return modifiers.length === 0 ? null : [...modifiers, key].join('+');
}

function errorText(caught: unknown): string {
    const message = caught instanceof Error ? caught.message : 'Something went wrong.';
    return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export default function GeneralSettings() {
    const [state, setState] = useState<SettingsState | null>(null);
    const [backup, setBackup] = useState<BackupInfo | null>(null);
    const [recording, setRecording] = useState<ShortcutAction | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        void window.velto.getSettings().then(setState).catch((caught) => setError(errorText(caught)));
        void window.velto.backupInfo().then(setBackup).catch(() => undefined);
    }, []);

    const update = useCallback(async (patch: SettingsPatch) => {
        setError(null);
        try {
            setState(await window.velto.updateSettings(patch));
        } catch (caught) {
            setError(errorText(caught));
        }
    }, []);

    useEffect(() => {
        if (!recording) {
            return;
        }
        const onKey = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.key === 'Escape') {
                setRecording(null);
                return;
            }
            const accelerator = acceleratorFromEvent(event);
            if (accelerator) {
                setRecording(null);
                void update({ shortcuts: { [recording]: accelerator } });
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [recording, update]);

    async function backupNow(): Promise<void> {
        setError(null);
        setMessage(null);
        try {
            const result = await window.velto.backupNow();
            setBackup(result.info);
            setMessage(`Backup saved (${result.count} ${result.count === 1 ? 'entry' : 'entries'}).`);
        } catch (caught) {
            setError(errorText(caught));
        }
    }

    if (!state) {
        return error ? <p className="error" role="alert">{error}</p> : null;
    }

    return (
        <>
            <section className="modal-section">
                <h3>Shortcuts</h3>
                {(Object.keys(LABELS) as ShortcutAction[]).map((action) => {
                    const status = state.shortcuts[action];
                    const isRecording = recording === action;
                    return (
                        <div key={action} className="shortcut-row" data-testid={`shortcut-${action}`}>
                            <span className="shortcut-name">{LABELS[action]}</span>
                            <kbd data-testid={action === 'quickSearch' ? 'shortcut-status' : undefined}>
                                {isRecording ? 'Press keys… (Esc to cancel)' : status.active ? formatAccelerator(status.active) : 'Not active'}
                            </kbd>
                            <button type="button" className="btn" onClick={() => setRecording(isRecording ? null : action)}>
                                <Keyboard size={14} /> {isRecording ? 'Cancel' : 'Change'}
                            </button>
                            <button
                                type="button"
                                className="icon-btn"
                                aria-label={`Reset ${LABELS[action]} shortcut`}
                                title="Reset to default"
                                disabled={state.settings.shortcuts[action] === DEFAULT_SHORTCUTS[action]}
                                onClick={() => void update({ shortcuts: { [action]: DEFAULT_SHORTCUTS[action] } })}
                            >
                                <RotateCcw size={14} />
                            </button>
                            {status.active === null && (
                                <p className="warning-text" role="alert">
                                    {formatAccelerator(status.preferred)} is in use by another app. Pick a different shortcut, or open {LABELS[action]} from the tray icon.
                                </p>
                            )}
                            {status.active !== null && status.active !== status.preferred && (
                                <p className="muted">{formatAccelerator(status.preferred)} is in use by another app, so {formatAccelerator(status.active)} is used instead.</p>
                            )}
                        </div>
                    );
                })}
            </section>

            <section className="modal-section">
                <h3>General</h3>
                <label className="check">
                    <input
                        type="checkbox"
                        checked={state.settings.launchAtLogin}
                        disabled={!state.launchAtLoginAvailable}
                        onChange={(event) => void update({ launchAtLogin: event.target.checked })}
                    />
                    Start Velto when I sign in to Windows (runs in the tray)
                </label>
                {!state.launchAtLoginAvailable && <p className="muted">Available in the installed app, not in development builds.</p>}
            </section>

            <section className="modal-section">
                <h3>Backups</h3>
                <label className="check">
                    <input type="checkbox" checked={state.settings.autoBackup} onChange={(event) => void update({ autoBackup: event.target.checked })} />
                    Back up my library automatically (keeps the last 7 daily backups)
                </label>
                <p className="muted" data-testid="backup-status">
                    {backup?.latest ? `Latest backup: ${new Date(backup.latest.modifiedAt).toLocaleString()} · ${backup.count} saved` : 'No backups yet.'}
                </p>
                <div className="modal-actions">
                    <button type="button" className="btn" onClick={() => void backupNow()}>
                        Back up now
                    </button>
                    <button type="button" className="btn" onClick={() => void window.velto.openBackupFolder()}>
                        <FolderOpen size={14} /> Open backup folder
                    </button>
                </div>
                {message && <p className="muted" role="status">{message}</p>}
            </section>
            {error && <p className="error" role="alert">{error}</p>}
        </>
    );
}
