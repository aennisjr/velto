import { useEffect, useRef, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';

type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'velto.theme';

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
    { mode: 'light', label: 'Light', icon: Sun },
    { mode: 'dark', label: 'Dark', icon: Moon },
    { mode: 'system', label: 'System', icon: Monitor },
];

function readTheme(): ThemeMode {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function applyTheme(mode: ThemeMode): void {
    const root = document.documentElement;
    if (mode === 'system') {
        root.removeAttribute('data-theme');
    } else {
        root.setAttribute('data-theme', mode);
    }
}

export function initTheme(): void {
    applyTheme(readTheme());
}

export default function ThemeMenu() {
    const [mode, setMode] = useState<ThemeMode>(readTheme);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointer = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const choose = (next: ThemeMode) => {
        setMode(next);
        applyTheme(next);
        localStorage.setItem(STORAGE_KEY, next);
        setOpen(false);
    };

    const Current = OPTIONS.find((option) => option.mode === mode)!.icon;

    return (
        <div className="theme-menu" ref={ref}>
            {open && (
                <div className="theme-popover" role="menu">
                    {OPTIONS.map(({ mode: optionMode, label, icon: Icon }) => (
                        <button key={optionMode} role="menuitemradio" aria-checked={mode === optionMode} className="nav-item" onClick={() => choose(optionMode)}>
                            <Icon size={14} /> {label}
                            {mode === optionMode && <Check size={14} className="theme-check" />}
                        </button>
                    ))}
                </div>
            )}
            <button className="icon-btn" aria-label="Theme" aria-haspopup="menu" aria-expanded={open} title="Theme" onClick={() => setOpen(!open)}>
                <Current size={16} />
            </button>
        </div>
    );
}
