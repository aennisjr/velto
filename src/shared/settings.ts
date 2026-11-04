import { z } from 'zod';
import type { ShortcutStatus } from './shortcuts.js';

export const SHORTCUT_ACTIONS = ['quickSearch', 'quickCapture'] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
    quickSearch: 'Control+Shift+Space',
    quickCapture: 'Control+Alt+N',
};

// Only used while the default is selected; a shortcut the user typed is never silently replaced.
export const FALLBACK_SHORTCUTS: Record<ShortcutAction, string[]> = {
    quickSearch: ['Control+Alt+Space', 'Control+Shift+Alt+Space'],
    quickCapture: ['Control+Shift+Alt+N'],
};

const MODIFIER = '(?:Control|Ctrl|Alt|Shift|Super|CommandOrControl)';
const KEY = '(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)';
const ACCELERATOR = new RegExp(`^(?:${MODIFIER}\\+){1,4}${KEY}$`);

// A global shortcut without a modifier would hijack a plain key everywhere in Windows.
export const AcceleratorSchema = z.string().regex(ACCELERATOR, 'Use at least one modifier plus a key, for example Control+Alt+N.');

// Equivalent spellings (Ctrl/Control, modifier order) must count as the same shortcut.
export function canonicalAccelerator(accelerator: string): string {
    const parts = accelerator.split('+').map((part) => (part === 'Ctrl' || part === 'CommandOrControl' ? 'Control' : part));
    const key = parts.pop() ?? '';
    return [...new Set(parts)].sort().concat(key).join('+');
}

export const SettingsSchema = z.object({
    shortcuts: z.object({
        quickSearch: AcceleratorSchema.catch(DEFAULT_SHORTCUTS.quickSearch),
        quickCapture: AcceleratorSchema.catch(DEFAULT_SHORTCUTS.quickCapture),
    }),
    launchAtLogin: z.boolean().catch(false),
    autoBackup: z.boolean().catch(true),
});

export type AppSettings = z.infer<typeof SettingsSchema>;

export const SettingsPatchSchema = z
    .object({
        shortcuts: z.object({ quickSearch: AcceleratorSchema, quickCapture: AcceleratorSchema }).partial(),
        launchAtLogin: z.boolean(),
        autoBackup: z.boolean(),
    })
    .partial();

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
    shortcuts: { ...DEFAULT_SHORTCUTS },
    launchAtLogin: false,
    autoBackup: true,
};

export type ShortcutsState = Record<ShortcutAction, ShortcutStatus>;

export interface SettingsState {
    settings: AppSettings;
    shortcuts: ShortcutsState;
    launchAtLoginAvailable: boolean;
}

export interface BackupInfo {
    directory: string;
    latest: { name: string; modifiedAt: string } | null;
    count: number;
}
