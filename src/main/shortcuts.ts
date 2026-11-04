import type { ShortcutStatus } from '../shared/shortcuts.js';

// register() may return false or throw when another app already owns the combination.
export function registerFirstAvailable(
    register: (accelerator: string) => boolean,
    preferred: string,
    fallbacks: string[] = [],
): ShortcutStatus {
    for (const accelerator of [preferred, ...fallbacks]) {
        try {
            if (register(accelerator)) {
                return { preferred, active: accelerator };
            }
        } catch {
            continue;
        }
    }
    return { preferred, active: null };
}
