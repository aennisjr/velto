import { useEffect, useRef, useState } from 'react';
import type { ShortcutAction, ShortcutsState } from '../shared/settings.js';
import { formatAccelerator } from '../shared/shortcuts.js';

interface Props {
    onClose: () => void;
}

const SHORTCUTS: { action: ShortcutAction; label: string; help: string }[] = [
    { action: 'quickSearch', label: 'Quick Search', help: 'find and copy saved text' },
    { action: 'quickCapture', label: 'Quick Capture', help: 'save new text from any app' },
];

// Shown once, right after the installer finishes, because the Squirrel installer itself has no
// confirmation screen and Velto keeps running in the tray after its window closes.
export default function WelcomeDialog({ onClose }: Props) {
    const [shortcuts, setShortcuts] = useState<ShortcutsState | null>(null);
    const startRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        startRef.current?.focus();
        void window.velto.getSettings().then((state) => setShortcuts(state.shortcuts)).catch(() => undefined);
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            } else if (event.key === 'Tab') {
                // The button is the only control, so keep focus on it.
                event.preventDefault();
                startRef.current?.focus();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    return (
        <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
            <div className="modal welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" aria-describedby="welcome-intro">
                <div className="modal-header">
                    <h2 id="welcome-title">Velto is installed</h2>
                </div>
                <p id="welcome-intro">
                    Velto keeps running in the system tray, so your shortcuts work even after you close this window. Look for its
                    icon at the right end of the taskbar; you may need to select the arrow to show hidden icons. You can also open
                    Velto from the Start menu or the desktop shortcut.
                </p>
                <h3>Shortcuts that work in any app</h3>
                <ul className="welcome-shortcuts">
                    {SHORTCUTS.map(({ action, label, help }) => {
                        const active = shortcuts?.[action].active;
                        return (
                            <li key={action}>
                                <span>
                                    <strong>{label}</strong> — {help}
                                </span>
                                {shortcuts && (active ? <kbd>{formatAccelerator(active)}</kbd> : <span className="muted">Not set</span>)}
                            </li>
                        );
                    })}
                </ul>
                <p className="muted">You can change shortcuts any time in Settings.</p>
                <div className="modal-actions">
                    <button ref={startRef} className="btn primary" onClick={onClose}>
                        Get started
                    </button>
                </div>
            </div>
        </div>
    );
}
