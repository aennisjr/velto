import { globalShortcut } from 'electron';
import { DEFAULT_SHORTCUTS, FALLBACK_SHORTCUTS, SHORTCUT_ACTIONS, type ShortcutAction, type ShortcutsState } from '../shared/settings.js';
import { createPopup } from './popup.js';
import { registerFirstAvailable } from './shortcuts.js';

export const quickSearch = createPopup({ route: 'quick', width: 680, height: 460, shownEvent: 'quick:shown', topRatio: 0.18 });
export const quickCapture = createPopup({ route: 'capture', width: 600, height: 540, shownEvent: 'capture:shown', topRatio: 0.14 });

const actions: Record<ShortcutAction, () => void> = {
    quickSearch: quickSearch.toggle,
    quickCapture: quickCapture.toggle,
};

let state: ShortcutsState = {
    quickSearch: { preferred: DEFAULT_SHORTCUTS.quickSearch, active: null },
    quickCapture: { preferred: DEFAULT_SHORTCUTS.quickCapture, active: null },
};

export function preparePopups(): void {
    quickSearch.prepare();
    quickCapture.prepare();
}

// Re-registers everything so a changed shortcut never leaves the old one active.
export function applyShortcuts(preferred: Record<ShortcutAction, string>): ShortcutsState {
    globalShortcut.unregisterAll();

    const next = {} as ShortcutsState;
    for (const action of SHORTCUT_ACTIONS) {
        const fallbacks = preferred[action] === DEFAULT_SHORTCUTS[action] ? FALLBACK_SHORTCUTS[action] : [];
        next[action] = registerFirstAvailable((accelerator) => globalShortcut.register(accelerator, actions[action]), preferred[action], fallbacks);
        if (next[action].active === null) {
            console.warn(`${action} shortcut ${preferred[action]} could not be registered.`);
        }
    }
    state = next;
    return state;
}

export function getShortcutState(): ShortcutsState {
    return state;
}

export function unregisterShortcuts(): void {
    globalShortcut.unregisterAll();
}
